/**
 * 网页相关的**纯函数**（零 IO、零依赖）—— 服务端路由和手机端共用这一份。
 *
 * ── 为什么单独拆出这个文件（2026-10）─────────────────────────────
 *
 * 原来 `isPublicHttpUrl` / `htmlToText` 长在 `lib/web-tools.ts` 里，而那个文件
 * 同时住着 `CORS` / `json()` / `preflight()` / `fetchText()` 这些**服务端专属**的东西
 * （`json()` 直接返回 `Response`，在手机 WebView 里根本没有"服务端"这一层）。
 *
 * APK 里没有服务端（`QIDAO_TARGET=android` 是纯前端构建），所以"读网页正文"这件事
 * 现在要搬到端上做（见 `lib/web-http.ts`）。抽正文 + 挡内网这两件事**两边一模一样**，
 * 于是把纯函数抽到这里：
 *   · 服务端路由（`routes/api/search.ts` / `read.ts` / `hot.ts`）继续从 `web-tools.ts` 拿
 *     （那边 re-export，**一行调用都不用改**）；
 *   · 端上（`lib/web-http.ts`）直接 import 这里 —— 不带任何服务端包袱。
 *
 * ⚠️ **不许复制第二份实现**：改抽正文规则只改这个文件，两边同时生效。
 */

/**
 * SSRF 判定：这个网址能不能取？
 *
 * 服务端那条接口是公网可达的，如果不管，别人就能拿它去戳内网
 * （`http://10.0.0.1/admin`、`http://127.0.0.1:6379` 这类）；
 * 端上更危险 —— 手机本身就在内网里，"本地地址"那一侧是**他自己的局域网**。
 *
 * ── 挡住的东西（清单，验收脚本逐条断言）───────────────────────
 *   · 协议不是 http / https（`file:` / `ftp:` / `data:` / `javascript:` 全拒）
 *   · 主机字面量：`localhost` / `127.0.0.1` / `0.0.0.0` / `::1` / `*.local` /
 *     `*.internal` / `*.localhost`
 *   · **IP 的变形写法**（只挡点分四段是不够的，这是最常见的绕过）：
 *       - 十进制整数：`http://2130706433/` = 127.0.0.1
 *       - 十六进制：`http://0x7f000001/`、`http://0x7f.0.0.1/`
 *       - 八进制前导零：`http://0177.0.0.1/`
 *       - 缺段：`http://127.1/` = 127.0.0.1、`http://192.168.1/` = 192.168.1.1
 *   · 私有网段：10/8、172.16-31/12、192.168/16、169.254/16（链路本地）、
 *     100.64-127/16（CGNAT）、127/8、0/8
 *   · IPv6：`::`、`::1`、唯一本地 `fc00::/7`、链路本地 `fe80::/10`、
 *     **IPv4 映射** `::ffff:127.0.0.1`（URL 会把它规范成 `::ffff:7f00:1`，按段解析才拦得住）
 *
 * ⚠️ **端口不在这里管**（2026-10 取掉了"只允许 80/443"的老口径）：正常站点跑在
 * 8443 / 8080 上的多得是，一律拒会让"读网页"废掉一半；而端口从来不是 SSRF 的防线。
 * 真正的防线是**主机指向哪儿** —— 也就是上面那张清单。
 *
 * ⚠️ **边界（写在明处）**：域名解析到内网的情况（DNS rebinding）在这一层挡不干净
 * —— 浏览器里拿不到 DNS 结果，原生那侧也只能看到 URL 字符串。个人自用够，
 * 但"公网可达的接口"要自己清楚这一点。
 */
export function isPublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "不是合法网址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, why: "只支持 http / https" };
  }
  /*
    ⚠️ **2026-10 取掉了老口径里的"只允许 80/443 端口"** —— 那是服务端那版的习惯
    （把接口收窄成"只能取网页"）。端上这条能力是"读他给的任意网页"，
    而正常站点跑在 8443 / 8080 / 3000 上的多得是：一律拒 = 一半网页读不到，
    而他只会看到"这个读不了"。
    **端口从来不是 SSRF 的防线**（真防线是下面那串内网地址判定）——
    所以这里放开端口，把判定集中在一件事上：这个主机名指向哪儿。
  */

  // `new URL()` 会把方括号去掉一部分情况，统一再剥一次
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return { ok: false, why: "本机/内网地址不给读" };
  }

  /*
    先把"变形 IP"还原成点分四段，再走同一套私有网段判定。
    还原不了（比如 `example.com`）就跳过 —— 域名那一层只看上面那串后缀。
  */
  const v4 = resolveIpv4(host);
  if (v4 && isPrivateV4(v4)) return { ok: false, why: "内网地址不给读" };
  /*
    一段的写法（`127.1`）也在这里拦：`resolveIpv4` 认得它（a=127，后面补零），
    所以不用单独再写一条规则 —— 这正是"只挡点分四段"会漏掉的那一类。
  */

  /*
    IPv6 字面量：回环 / 唯一本地（fc00::/7）/ 链路本地（fe80::/10）/
    **IPv4 映射**（`::ffff:127.0.0.1` —— 实测它会被 URL 规范化成 `::ffff:7f00:1`，
    所以必须**真的按 16 位段解析**，靠字符串前缀那套一定漏）。
  */
  if (host.includes(":")) {
    if (/^(fc|fd|fe80)/.test(host)) return { ok: false, why: "内网地址不给读" };
    const groups = parseIpv6(host);
    if (groups) {
      if (groups.every((g) => g === 0)) return { ok: false, why: "本机/内网地址不给读" }; // `::`
      if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
        return { ok: false, why: "本机/内网地址不给读" }; // `::1`
      }
      // 前 80 位全 0 + 第 6 段是 ffff → 这是 IPv4 映射，取后 32 位按 IPv4 判定
      if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        const mapped: Quad = [(groups[6] >> 8) & 255, groups[6] & 255, (groups[7] >> 8) & 255, groups[7] & 255];
        if (isPrivateV4(mapped)) return { ok: false, why: "内网地址不给读" };
      }
    }
  }
  return { ok: true, url };
}

/**
 * 把 IPv6 字面量解析成 8 个 16 位段（`::` 按零补齐）；解不了就返回 null。
 * 输入是 `URL.hostname` 那串（方括号已剥掉），所以只会是十六进制段 + 点分四段尾巴。
 */
function parseIpv6(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const segs = part.split(":");
    const out: number[] = [];
    for (const seg of segs) {
      const v4 = parseQuad(seg);
      if (v4) {
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = parseGroups(halves[0]);
    return groups && groups.length === 8 ? groups : null;
  }
  const left = parseGroups(halves[0]);
  const right = parseGroups(halves[1]);
  if (!left || !right) return null;
  if (left.length + right.length > 8) return null;
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/**
 * 取网页时统一带的请求头 —— **服务端和手机端共用这一份**（口径必须一致：
 * 实测没有 UA 的请求很多站点直接 403，而两边的 UA 一旦不一样，就会出现
 * "网页版读得到、手机版读不到"这种最难查的问题）。
 */
export const WEB_FETCH_HEADERS: Record<string, string> = {
  // 安卓 Chrome 的 UA：跟这个 App 的真实身份一致（它就是个安卓 WebView）
  "user-agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
};

type Quad = [number, number, number, number];function parseQuad(s: string): Quad | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * 把主机名里的 IPv4 **变形写法**还原成点分四段；不是 IP 就返回 null。
 *
 * 支持的写法（都是浏览器的 URL 解析器真心会连过去的）：
 *   · `127.0.0.1`     —— 点分四段，每段可以是十进制 / 十六进制（`0x7f`）/ 八进制（`0177`）
 *   · `127.1`         —— 缺段：最后一段吃掉剩下的全部位数（= 127.0.0.1）
 *   · `192.168.1`     —— 同上（= 192.168.1.1）
 *   · `2130706433`    —— 整个地址写成一个整数
 *   · `0x7f000001`    —— 整个地址写成一个十六进制整数
 */
function resolveIpv4(host: string): Quad | null {
  // 纯整数（十进制 / 十六进制）：整个 32 位地址
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) {
    const n = host.startsWith("0x") ? parseInt(host.slice(2), 16) : Number(host);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let v: number;
    if (/^0x[0-9a-f]+$/.test(p)) v = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p.slice(1), 8);
    else if (/^\d+$/.test(p)) v = Number(p);
    else return null; // 有字母段 = 域名（`example.com` 这种带数字的也走这里）
    if (!Number.isFinite(v) || v < 0) return null;
    nums.push(v);
  }
  /*
    **缺段**的真规则（照浏览器来）：每个点分段 8 位、最后一段吃掉剩下的全部位数。
       `127.1`      → 127 << 24 | 1        = 127.0.0.1
       `192.168.1`  → 192 << 16 | 168 << 8 | 1 = 192.168.1.1
       `10.1`       → 10.0.0.1
    前 n-1 段必须在 0..255，最后一段的上限按剩余位数算。
  */
  for (let i = 0; i < nums.length - 1; i += 1) {
    if (nums[i] > 255) return null;
  }
  const bits = 8 * (4 - (nums.length - 1));
  if (nums[nums.length - 1] >= 2 ** bits) return null;
  let addr = 0;
  for (let i = 0; i < nums.length - 1; i += 1) addr += nums[i] * 2 ** (8 * (3 - i));
  addr += nums[nums.length - 1];
  if (addr < 0 || addr > 0xffffffff) return null;
  return [(addr >>> 24) & 255, (addr >>> 16) & 255, (addr >>> 8) & 255, addr & 255];
}

/** 回环 / 私有 / 链路本地 / CGNAT / 保留段 */
function isPrivateV4(q: Quad): boolean {
  const [a, b] = q;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * 把 HTML 弄成能读的纯文本（不做完美解析，够模型读就行）。
 *
 * 这套规则是服务端 `/api/read` 一直在用的那一份（原样搬过来，**行为没变**）：
 *   · 整块丢掉 script / style / nav / header / footer / aside / form / iframe
 *     —— 实测读百度首页时正文只有 141 字，而且几乎全是导航噪声；
 *   · 块级标签变换行，其余标签变空格；
 *   · 常见实体还原，收尾去掉多余空行。
 *
 * ⚠️ 它**不是**正文识别（没有 Readability 那种启发式），别指望对 JS 渲染的
 * 单页应用有效 —— 那种页面取回来只有壳，取不到正文是**如实结果**，不是 bug。
 */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] ?? "").trim();
  const text = html
    // 整块丢掉脚本/样式/导航这些"读起来没意义"的部分
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    /*
      丢掉导航/页脚/侧栏/表单 —— 实测读百度首页时，正文只有 141 字，
      而且几乎全是"登录/我的关注/我的收藏/皮肤中心"这类导航噪声。
      这些块对"这页讲了什么"没有价值，先整块去掉再抽文本。
    */
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    // 换行语义：块级标签变空格，br/段落变换行
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    // 常见实体
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    // 收尾：去掉多余空行
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return { title, text };
}
