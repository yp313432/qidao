import { isNativeApp } from "./platform";
import type { McpOAuth, McpServer } from "./types";

/**
 * MCP 的 OAuth 客户端 —— 让对方要令牌的 MCP 服务器也能连上。
 *
 * ── 为什么要自己写这一整套 ──────────────────────────────────────
 *
 * 用户在 Claude 里连 MCP「只填名称和地址就行」，是因为**客户端替他把
 * OAuth 全干了**。栖岛要接 OAuth 型服务（Horizon、Notion 那类），
 * 就得自己走一遍。规范（MCP 2025-06-18 的 Authorization 一节）要求：
 *
 *   1. 401 → 读 `WWW-Authenticate` → 找受保护资源元数据（RFC 9728）
 *   2. 取受保护资源元数据 → 拿到授权服务器地址
 *   3. 取授权服务器元数据（RFC 8414）
 *   4. **动态注册**（RFC 7591）拿 client_id —— 用户不用手填
 *   5. **PKCE**（规范写的是 MUST）+ `state`
 *   6. 开浏览器让用户授权 → 回跳拿 code
 *   7. 用 code + PKCE 换令牌；之后每个请求带 `Authorization: Bearer`
 *
 * 另外两条**规范要求 MUST**、很容易漏的：
 *   · 授权请求和换令牌请求都要带 `resource` 参数（RFC 8707），
 *     把令牌绑死在"给哪个服务器用"上
 *   · 换令牌必须校验 `state`，对不上就得拒绝
 *
 * ── 三个实测踩出来的坑（别重踩）────────────────────────────────
 *
 * ① **换令牌必须用 `application/x-www-form-urlencoded`。**
 *    用 JSON 会触发 CORS 预检（OPTIONS），而很多授权服务器**不答预检**，
 *    浏览器里就报 `TypeError: Failed to fetch` —— 看起来像"这个端点根本
 *    不放跨域"，其实只是编码方式错了。实测同一台服务器：
 *    JSON → Failed to fetch；form → 正常拿到 401 响应体。
 *    （form 编码是"简单请求"，免预检；而且这本来就是 OAuth 规范要求的写法。）
 *
 * ② **跨域时读不到 `Access-Control-Allow-Origin`。**
 *    跨域响应只暴露白名单响应头，ACAO 自己不在里面。所以
 *    `res.headers.get("access-control-allow-origin")` 拿到 null
 *    **不能**说明对方没放跨域 —— 能读到响应体就说明放行了。
 *    （我一开始就拿它判断，误判了一轮。）
 *
 * ③ **`WWW-Authenticate` 也读不到**（同理，它不在白名单里）。
 *    所以"从 401 的响应头里取元数据地址"这一步在浏览器里**拿不到**，
 *    只能按 RFC 9728 的规则猜地址。下面两个候选地址就是这么来的。
 */

/** 授权会话（点了"去授权"→ 跳出去 → 跳回来，中间要活下来，所以放 localStorage） */
const PENDING_KEY = "qidao:mcp-oauth-pending";

/** 一次授权最多等多久。超过就作废，免得拿一个很旧的 code 去换 */
const PENDING_TTL_MS = 15 * 60 * 1000;

/** 令牌还剩不到这么久就算"该续期了"，提前续，别等到请求失败 */
const REFRESH_MARGIN_MS = 60 * 1000;

type Pending = {
  serverId: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  issuer?: string;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  resource: string;
  startedAt: number;
};

export type AsMetadata = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

export type Discovery = {
  /** 受保护资源元数据里的 resource（= 我们的 MCP 地址，换令牌时要带回去） */
  resource: string;
  authorizationServer: string;
  as: AsMetadata;
};

/* ───────────────────── 小工具 ───────────────────── */

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

/** PKCE：verifier 是随机串，challenge 是它的 SHA-256（S256 是规范推荐的唯一方式） */
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}

/**
 * 我们用什么回调地址。
 *
 * · 网页版：跟页面同源（`http://127.0.0.1:8080/oauth/callback` 这种）。
 *   规范允许 localhost 和 HTTPS，所以这是**最合规**的一种。
 * · App（安卓）：**必须**换成自定义 scheme。因为 App 里没有本地服务端，
 *   系统浏览器跳 `https://localhost/...` 会落到 Chrome 自己身上，回不到 App。
 *   ⚠️ 自定义 scheme 是事实标准（FastMCP 默认 `application_type: native`
 *   就允许），但规范原文写的是 "localhost 或 HTTPS" —— 所以**别家的授权
 *   服务器不一定接受**，这条要在真机上试。
 */
export function redirectUri(): string {
  if (isNativeApp()) return "qidao://oauth/callback";
  return `${window.location.origin}/oauth/callback`;
}

/**
 * 从回调地址里把参数抠出来。
 *
 * 网页版传进来的是 `http://…/oauth/callback?code=…`；
 * **App 里传进来的是深链** `qidao://oauth/callback?code=…` ——
 * `new URL()` 对自定义 scheme 一样能解析（`searchParams` 也能用），
 * 所以两端共用这一个函数。
 */
export function parseCallbackUrl(raw: string): {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
} {
  try {
    const q = new URL(raw).searchParams;
    return {
      code: q.get("code") ?? undefined,
      state: q.get("state") ?? undefined,
      error: q.get("error") ?? undefined,
      errorDescription: q.get("error_description") ?? undefined,
    };
  } catch {
    return {};
  }
}

/** 从 401 的 `WWW-Authenticate` 里抠 `resource_metadata="..."`（拿不到时返回 null） */
export function resourceMetadataFrom(wwwAuth: string | null): string | null {
  if (!wwwAuth) return null;
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(wwwAuth);
  return m?.[1] ?? null;
}

/* ───────────────────── 1~3 步：发现 ───────────────────── */

/**
 * 发现：找到受保护资源元数据 + 授权服务器元数据。
 *
 * ⚠️ 浏览器里读不到 `WWW-Authenticate`（见文件开头坑 ③），
 * 所以主要靠按 RFC 9728 的规则猜地址：
 * 资源是 `https://host/mcp` 时，元数据在
 * `https://host/.well-known/oauth-protected-resource/mcp` 或根下。
 */
export async function discover(server: McpServer, wwwAuth?: string | null): Promise<Discovery> {
  const target = server.url.trim();
  let origin = "";
  let path = "";
  try {
    const u = new URL(target);
    origin = u.origin;
    path = u.pathname.replace(/\/+$/, "");
  } catch {
    throw new Error("地址解析不出来，检查一下是不是写全了（https://…）");
  }

  const prmUrls = [
    resourceMetadataFrom(wwwAuth ?? null),
    `${origin}/.well-known/oauth-protected-resource${path}`,
    `${origin}/.well-known/oauth-protected-resource`,
  ].filter((u): u is string => Boolean(u));

  let prm: { resource?: string; authorization_servers?: string[] } | null = null;
  let tried = "";
  for (const url of prmUrls) {
    tried += `\n  · ${url}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        prm = (await res.json()) as { resource?: string; authorization_servers?: string[] };
        break;
      }
    } catch {
      /* 这个候选不行就试下一个 */
    }
  }
  if (!prm) {
    throw new Error(
      [
        "对方要求认证，但它没有提供 OAuth 元数据（不是标准 OAuth 服务）。",
        "这种情况只能在「请求头」里手填令牌。试过这些地址：",
        tried,
      ].join("\n"),
    );
  }

  const authorizationServer = prm.authorization_servers?.[0] ?? origin;
  const as = await discoverAs(authorizationServer);
  return { resource: prm.resource ?? target, authorizationServer, as };
}

/** 第 3 步：授权服务器元数据（RFC 8414；顺手兼容 OIDC 的 discovery） */
export async function discoverAs(authorizationServer: string): Promise<AsMetadata> {
  const base = authorizationServer.replace(/\/+$/, "");
  let origin = base;
  let path = "";
  try {
    const u = new URL(base);
    origin = u.origin;
    path = u.pathname.replace(/\/+$/, "");
  } catch {
    throw new Error(`授权服务器地址不对：${authorizationServer}`);
  }

  const candidates = [
    // 带路径时的规范写法：well-known 插在 host 和 path 之间
    path ? `${origin}/.well-known/oauth-authorization-server${path}` : null,
    `${base}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ].filter((u): u is string => Boolean(u));

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const meta = (await res.json()) as Partial<AsMetadata>;
      if (meta.authorization_endpoint && meta.token_endpoint) {
        return {
          issuer: meta.issuer,
          authorization_endpoint: meta.authorization_endpoint,
          token_endpoint: meta.token_endpoint,
          registration_endpoint: meta.registration_endpoint,
          scopes_supported: meta.scopes_supported,
        };
      }
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    `拿不到授权服务器元数据：${authorizationServer}\n（对方可能不是标准 OAuth 服务，那就只能手填令牌）`,
  );
}

/* ───────────────────── 4 步：动态注册 ───────────────────── */

/**
 * 动态注册（RFC 7591）—— 这一步是「为什么 Claude 只要填地址」的关键：
 * 客户端自己注册，用户不用去对方后台建应用、抄 client_id。
 *
 * ⚠️ 这一步用 JSON 是对的（发送方本来就该发 JSON），
 * 实测对方的注册端点**答预检**，所以 JSON 能过；
 * 换令牌那一步用 JSON 会被预检挡住，别搞混（见文件开头坑 ①）。
 */
export async function registerClient(as: AsMetadata, redirect: string): Promise<string> {
  if (!as.registration_endpoint) {
    throw new Error(
      "这个授权服务器不支持动态注册（元数据里没有 registration_endpoint）。\n需要你自己去对方后台建一个客户端，把 client_id 填进来。",
    );
  }
  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "栖岛 Qidao",
      redirect_uris: [redirect],
      // native = 允许自定义 scheme / loopback 回调（FastMCP 的默认值）
      application_type: "native",
      // 公开客户端，没有密钥；安全性靠 PKCE
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`动态注册失败（HTTP ${res.status}）：\n${text.slice(0, 400)}`);
  }
  let json: { client_id?: string };
  try {
    json = JSON.parse(text) as { client_id?: string };
  } catch {
    throw new Error(`动态注册返回的不是 JSON：\n${text.slice(0, 300)}`);
  }
  if (!json.client_id) throw new Error(`动态注册没给 client_id：\n${text.slice(0, 300)}`);
  return json.client_id;
}

/* ───────────────────── 5~6 步：开浏览器授权 ───────────────────── */

/**
 * 准备好一次授权：发现 → （需要的话）注册 → 生成 PKCE → 存下会话 → 给出授权地址。
 *
 * 调用方拿到 `url` 之后负责真正跳转（`window.location.assign(url)`），
 * 并把 `persist` 写回服务器记录（client_id 要留着，下次不用重复注册）。
 */
export async function planAuthorize(
  server: McpServer,
): Promise<{ url: string; persist: Pick<McpOAuth, "clientId"> & Partial<McpOAuth> }> {
  const d = await discover(server);
  const redirect = redirectUri();
  const clientId = server.oauth?.clientId || (await registerClient(d.as, redirect));

  const codeVerifier = randomToken(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = randomToken(16);

  const pending: Pending = {
    serverId: server.id,
    clientId,
    authorizationEndpoint: d.as.authorization_endpoint,
    tokenEndpoint: d.as.token_endpoint,
    issuer: d.as.issuer,
    redirectUri: redirect,
    codeVerifier,
    state,
    resource: d.resource,
    startedAt: Date.now(),
  };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const u = new URL(d.as.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  // 规范 MUST：把令牌绑死到这个资源上（RFC 8707）
  u.searchParams.set("resource", d.resource);

  return {
    url: u.toString(),
    persist: {
      clientId,
      issuer: d.as.issuer ?? d.authorizationServer,
      tokenEndpoint: d.as.token_endpoint,
      resource: d.resource,
    },
  };
}

/** 清掉未完成的授权会话（重试 / 用户主动放弃时用） */
export function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

export type CompleteResult =
  | { ok: true; serverId: string; oauth: McpOAuth }
  /**
   * `serverId` 在失败时也尽量给出来 —— App 里回跳失败时，界面要能把
   * "失败原因"写在那一条服务器卡片上，不然用户只看到"没反应"。
   */
  | { ok: false; message: string; serverId?: string };

/**
 * 第 7 步：回调页拿到 code，换令牌。
 *
 * 这里做的校验一个都不能省：
 *   · `state` 必须跟发起时一致（规范要求，防"别人的授权码塞给你"）
 *   · 必须带 `code_verifier`（PKCE）和 `resource`
 *   · 请求体用 **form-urlencoded**（见文件开头坑 ①）
 */
export async function completeAuthorize(params: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<CompleteResult> {
  if (params.error) {
    clearPending();
    return {
      ok: false,
      message: `对方拒绝了授权：${params.error}${params.errorDescription ? `\n${params.errorDescription}` : ""}`,
    };
  }

  let pending: Pending | null = null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    pending = raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    pending = null;
  }
  if (!pending) {
    return {
      ok: false,
      message: "找不到这次授权的记录。可能是超过 15 分钟作废了，或者换了浏览器/设备。回工具页重新点一次「去授权」。",
    };
  }
  if (Date.now() - pending.startedAt > PENDING_TTL_MS) {
    clearPending();
    return {
      ok: false,
      serverId: pending.serverId,
      message: "授权超时（超过 15 分钟），回工具页重新点一次。「去授权」",
    };
  }
  if (!params.code) {
    return { ok: false, serverId: pending.serverId, message: "回调地址里没有 code，这次授权没完成。" };
  }
  if (params.state !== pending.state) {
    clearPending();
    return {
      ok: false,
      serverId: pending.serverId,
      message: "state 对不上，按规范必须拒绝这次授权（可能是授权码被劫持或被塞了别人的码）。请重新授权。",
    };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
    resource: pending.resource,
  });

  let res: Response;
  try {
    res = await fetch(pending.tokenEndpoint, {
      method: "POST",
      // ⚠️ 千万别改成 application/json —— 会触发预检，被 Failed to fetch 挡住
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      serverId: pending.serverId,
      message: `连不上换令牌的地址：${(err as Error).message}\n${pending.tokenEndpoint}`,
    };
  }

  const text = await res.text();
  let json: { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return {
      ok: false,
      serverId: pending.serverId,
      message: `换令牌返回的不是 JSON（HTTP ${res.status}）：\n${text.slice(0, 400)}`,
    };
  }
  if (!res.ok || !json.access_token) {
    return {
      ok: false,
      serverId: pending.serverId,
      message: `换令牌失败（HTTP ${res.status}）：${json.error_description ?? text.slice(0, 300)}`,
    };
  }

  clearPending();
  return {
    ok: true,
    serverId: pending.serverId,
    oauth: {
      clientId: pending.clientId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
      issuer: pending.issuer,
      tokenEndpoint: pending.tokenEndpoint,
      resource: pending.resource,
      at: Date.now(),
    },
  };
}

/* ───────────────────── 之后每次请求：带令牌 / 续期 ───────────────────── */

/**
 * 给一个服务器取可用的访问令牌；快过期就顺手续期。
 *
 * 返回值里的 `patch` 是需要写回记录的新令牌（续期过的），
 * 由调用方落库 —— 这个文件刻意**不碰 store**，免得跟 store → mcp 形成循环依赖。
 */
export async function accessTokenFor(
  server: McpServer,
): Promise<{ token?: string; patch?: Partial<McpOAuth>; message?: string }> {
  const o = server.oauth;
  if (!o?.accessToken) return {};

  const fresh = !o.expiresAt || o.expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (fresh) return { token: o.accessToken };

  if (!o.refreshToken || !o.tokenEndpoint) {
    return {
      token: o.accessToken,
      message: "令牌可能已经过期（对方没给 refresh_token，续不了期）。如果失败就重新授权一次。",
    };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: o.refreshToken,
    client_id: o.clientId,
  });
  if (o.resource) body.set("resource", o.resource);

  try {
    const res = await fetch(o.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    const json = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        message: `续期失败（HTTP ${res.status}）：${json.error_description ?? text.slice(0, 200)}\n需要重新授权。`,
      };
    }
    return {
      token: json.access_token,
      patch: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? o.refreshToken,
        expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
      },
    };
  } catch (err) {
    return { message: `续期请求没发出去：${(err as Error).message}` };
  }
}

/** 界面上判断"这条到底授权了没有" */
export function isAuthorized(server: McpServer): boolean {
  return Boolean(server.oauth?.accessToken);
}
