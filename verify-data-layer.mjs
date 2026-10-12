#!/usr/bin/env node
/**
 * 验收：**数据层 PH2**（表结构 / 迁移守恒 / 失败语义 / 保留上限 / 唤醒配置一致）。
 *
 * 依据：`qidao-docs/UI统一规范.md` §12（数据统一规范）+ `数据架构-①设计.md`。
 * 用户原话："我们不能哪里出问题再补哪一块了，拆东补西，而是把整体搭建好了，变得统一有条理。"
 *
 * 跑法：node verify-data-layer.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-data-layer.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

/**
 * ⚠️ 这两个坑（前几轮踩过，写在这儿省得再踩）：
 *   1. 静态 import 在 `register()` 之前就解析完了 → 只能**动态** await import()
 *   2. 源码里的相对引用是**不带扩展名**的（`./schema`，给打包器用的）→ 钩子里补 `.ts`
 */
register(
  `data:text/javascript,${encodeURIComponent(
    [
      "export async function resolve(specifier, context, next) {",
      "  if (specifier.startsWith('.')) {",
      "    const seg = specifier.slice(specifier.lastIndexOf('/') + 1);",
      "    if (!/\\.[a-z]+$/i.test(seg)) {",
      "      return next(new URL(specifier + '.ts', context.parentURL).href, context);",
      "    }",
      "  }",
      "  return next(specifier, context);",
      "}",
    ].join("\n"),
  )}`,
  import.meta.url,
);

const { SCHEMA_VERSION, TABLES, checksum, newId } = await import("./src/lib/data/schema.ts");
const { planMigration, roundTrip } = await import("./src/lib/data/migrate.ts");
const { changedRows } = await import("./src/lib/data/adapter.ts");
const {
  ACTION_LOG_MAX,
  ACTION_LOG_MAX_AGE_MS,
  REQUEST_LOG_MAX,
  pushActionLog,
  trimActionLog,
  trimRequestLog,
} = await import("./src/lib/data/retention.ts");
const {
  WAKE_META_KEYS,
  checkWakeDrawer,
  needsRepush,
  wakeConfigPayload,
} = await import("./src/lib/data/wake-config.ts");

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** 遍历 src 下所有源码（断言"唯一开库入口"这种全局约束时用） */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push({ path: p, text: src(p) });
  }
  return out;
}

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}

/* ═══════════════ ① 表结构 ═══════════════ */
check("① schema 版本是正数（加表要 +1）", Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 1);
check(
  "① 表齐了（11 张：meta/settings/conversations/messages/blobs/memories/writings/emotions/schedules/stats/logs）",
  Object.keys(TABLES).length === 11,
  String(Object.keys(TABLES).length),
);
check("① 校验和稳定（同输入同结果）", checksum({ a: 1 }) === checksum({ a: 1 }));
check("① 校验和能区分不同内容", checksum({ a: 1 }) !== checksum({ a: 2 }));
check("① 新 id 不重复", new Set(Array.from({ length: 200 }, () => newId("t"))).size === 200);

/* ═══════════════ ② 迁移守恒（往返） ═══════════════ */
const LEGACY = {
  settings: { displayName: "yan", aiName: "小克", customBaseUrl: "https://api.example.com", customApiKey: "sk-x", upstreamModel: "m1" },
  model: "m1",
  activeId: "c1",
  conversations: [
    {
      id: "c1",
      title: "对齐检查",
      createdAt: 1000,
      updatedAt: 3000,
      messages: [
        { id: "m1", role: "user", content: "在吗", createdAt: 1000 },
        {
          id: "m2",
          role: "assistant",
          content: "在的",
          thinking: "先打个招呼",
          thinkingDurationMs: 1200,
          createdAt: 2000,
          origin: "wake",
          parts: ["在的", "你说"],
          attachments: [
            { id: "a1", kind: "image", name: "图.png", mime: "image/png", size: 12, dataUrl: "data:image/png;base64,AAAA" },
            { id: "a2", kind: "file", name: "笔记.txt", mime: "text/plain", size: 5, text: "hello", truncated: true },
          ],
        },
        { id: "m3", role: "user", content: "看看背景", createdAt: 3000 },
      ],
    },
    { id: "c2", title: "偷偷聊", incognito: true, messages: [{ id: "x1", role: "user", content: "别记", createdAt: 1 }] },
  ],
  memories: [{ id: "me1", text: "他喜欢花", tags: ["喜好"], createdAt: 500, updatedAt: 600, pinned: true }],
  worldBook: [{ id: "wb1", text: "栖岛设定", tags: ["设定"] }],
  diary: [{ id: "d1", text: "今天累", mood: "tired", at: 700 }],
  moments: [{ id: "mo1", text: "发个动态", at: 710 }],
  letters: [{ id: "l1", title: "给你", text: "见字如面", at: 720 }],
  docs: [{ id: "doc1", title: "使用备忘", text: "…", at: 730 }],
  todos: [{ id: "t1", text: "买菜", done: true, at: 740 }],
  dates: [{ id: "dt1", title: "认识的日子", text: "2026-10-01", at: 750 }],
  emotionEvents: [{ id: "e1", kind: "miss", at: 800, note: "想他" }],
  reminders: [{ id: "r1", text: "喝水", at: 900 }],
  tasks: [{ id: "tk1", text: "写周报", done: false, at: 910 }],
  actionLog: [{ id: "al1", act: "sticker.send", at: 950 }],
  requestLog: [{ id: "rl1", at: 960, tokens: 123 }],
  stickerLib: [{ id: "s1", url: "data:image/png;base64,BBBB", group: "未分组" }],
};

const plan = planMigration(LEGACY, 1000);
check("② 对话搬过来了（隐藏对话不算）", plan.conversations.length === 1, String(plan.conversations.length));
check("② 消息按条拆开了（3 条）", plan.messages.length === 3, String(plan.messages.length));
check("② 图片附件进了二进制表（1 条 dataUrl）", plan.blobs.length === 1, String(plan.blobs.length));
check("② 文本附件留在消息里（不重复建二进制）", plan.messages.find((m) => m.id === "m2").attachments.length === 2);
check("② 附件正文不在消息里（只有引用 blobId）", !JSON.stringify(plan.messages).includes("data:image"));
check("② 消息带上对话 id（能按对话查）", plan.messages.every((m) => m.convId === "c1"));
check("② 记忆 + 世界书进了同一张表，用 kind 分", plan.memories.filter((m) => m.kind === "worldbook").length === 1);
check("② 日记/动态/信/文档/待办/日子合并成一张表（6 条）", plan.writings.length === 6, String(plan.writings.length));
check("② 认不出的字段没丢（pinned 进了 extra）", JSON.stringify(plan.memories.find((m) => m.id === "me1")).includes("pinned"));
check("② 守恒报告：条数全对", Object.values(plan.report.counts).every((c) => c.ok), JSON.stringify(Object.entries(plan.report.counts).filter(([, c]) => !c.ok)));
check("② 守恒报告：内容校验和全对", Object.values(plan.report.checksums).every((c) => c.ok), JSON.stringify(Object.entries(plan.report.checksums).filter(([, c]) => !c.ok)));
check("② 守恒报告：没有对不上的（anyMismatch=false）", plan.report.anyMismatch === false);

const back = roundTrip(plan);
check("② 往返：消息内容一字不差", checksum(back.conversations) === checksum([LEGACY.conversations[0]]));
check("② 往返：附件正文能拼回 dataUrl", JSON.stringify(back.conversations).includes("data:image/png;base64,AAAA"));
check("② 往返：世界书能拼回去", JSON.stringify(back.worldBook) === JSON.stringify(LEGACY.worldBook));
check("② 往返：提醒/任务能拼回去", back.reminders.length === 1 && back.tasks.length === 1);
check("② 往返：字符串附件字段（truncated）没丢", JSON.stringify(back.conversations).includes("truncated"));

/* ═══════════════ ③ 保留上限（D5：用户口径） ═══════════════ */
check("③ 动作记录上限 = 200（用户口径）", ACTION_LOG_MAX === 200);
check("③ 动作记录时间上限 = 1 天（用户口径）", ACTION_LOG_MAX_AGE_MS === 24 * 3600 * 1000);
check("③ 请求记录上限 = 500", REQUEST_LOG_MAX === 500);
const now = 1_700_000_000_000;
const old = Array.from({ length: 300 }, (_, i) => ({ at: now - i * 1000 }));
check("③ 满 200 条自动清（300 条 → 200）", trimActionLog(old, now).length === 200);
const stale = Array.from({ length: 50 }, () => ({ at: now - 25 * 3600 * 1000 }));
check("③ 过一天的清掉（50 条陈旧 → 0）", trimActionLog(stale, now).length === 0);
check("③ 写入时顺手清（push 之后仍然 ≤ 200）", pushActionLog(old, { at: now }, now).length === 200);
check("③ 请求记录只按条数截", trimRequestLog(Array.from({ length: 900 }, (_, i) => ({ at: now - i })), now).length === 500);

/* ═══════════════ ④ 唤醒上游一致（D8） ═══════════════ */
const good = wakeConfigPayload({
  baseUrl: "https://api.example.com/",
  apiKey: "sk-abc",
  model: "m1",
  rest: { cfg_prompt_normal: "P", cfg_enabled: "1" },
  now,
});
check("④ 配好上游 → 指纹非空", Boolean(good[WAKE_META_KEYS.fingerprint]));
check("④ 配好上游 → enabled=1", good.cfg_enabled === "1");
check("④ 推了「怎么问这家上游」（路径），不再由后台写死", good[WAKE_META_KEYS.chatPath] === "/chat/completions");
check("④ 地址尾斜杠被归一（同一家不会算出两个指纹）", good.cfg_base_url === "https://api.example.com");
check("④ 记录了同步时间", good[WAKE_META_KEYS.syncedAt] === String(now));

const cleared = wakeConfigPayload({ baseUrl: "", apiKey: "", model: "", rest: { cfg_prompt_normal: "P", cfg_enabled: "1" } });
check("④ **清空上游 → 也必须推**（W1 的修正）：地址空", cleared.cfg_base_url === "");
check("④ 清空上游 → 密钥/模型也写成空（不留旧值）", cleared.cfg_api_key === "" && cleared.cfg_model === "");
check("④ 清空上游 → 指纹清空", cleared[WAKE_META_KEYS.fingerprint] === "");
check("④ 清空上游 → 顺手关掉唤醒（后台不会拿旧配置乱发）", cleared.cfg_enabled === "0");

check("④ 自检：完整 + 有指纹 → 可以发", checkWakeDrawer(good).ok === true);
check("④ 自检：关着 → 不说话", checkWakeDrawer({ ...good, cfg_enabled: "0" }).ok === false);
check("④ 自检：没有指纹（旧版写的）→ 拒绝并提示同步", checkWakeDrawer({ ...good, [WAKE_META_KEYS.fingerprint]: "" }).ok === false);
check("④ 自检：上游不全 → 拒绝", checkWakeDrawer({ ...good, cfg_api_key: "" }).ok === false);
check("④ 自检：指纹跟配置对不上 → 拒绝", checkWakeDrawer({ ...good, [WAKE_META_KEYS.fingerprint]: "deadbeef" }).ok === false);
check(
  "④ 指纹只存哈希（抽屉里读不出密钥原文）",
  !good[WAKE_META_KEYS.fingerprint].includes("sk-abc") && good[WAKE_META_KEYS.fingerprint].length === 8,
);
check(
  "④ 换家（地址变）→ 前台知道要重推",
  needsRepush(good, { baseUrl: "https://other.example.com", apiKey: "sk-abc", model: "m1" }) === true,
);
check(
  "④ 没变 → 不用重推（不白写）",
  needsRepush(good, { baseUrl: "https://api.example.com", apiKey: "sk-abc", model: "m1" }) === false,
);
check(
  "④ 后台 runner 用的是同一套规则（读指纹 + 用抽屉里的路径，不写死）",
  src("public/runners/wake.js").includes("cfg_fingerprint") &&
    src("public/runners/wake.js").includes("cfg_chat_path"),
);

/* ═══════════════ ⑤ 失败语义（源码级硬约束） ═══════════════ */
const db = src("src/lib/data/db.ts");
check("⑤ 读接口返回 {ok}/{why}（没有「读失败给你个 undefined 当空」的写法）", db.includes("export type ReadResult<T>") && db.includes("ok: false; why: string"));
check("⑤ 读失败会记账（readFailedThisSession）", db.includes("readFailedThisSession = true"));
check("⑤ 这次读失败 → 暂停写入（guardWrite）", db.includes("function guardWrite") && db.includes("dataFlags.skippedWrites += 1"));
check("⑤ 坏档留证（不静默丢）", db.includes("preserveCorrupt") && db.includes("::corrupt-"));
check("⑤ 单条写（改一条只写一条）", db.includes("export async function writeRecord") && db.includes("s.put(record, key"));
check("⑤ 二进制用 Blob（不是 base64 常住）", db.includes("dataUrlToBlob") && db.includes("blobToDataUrl") && db.includes("new Blob("));
check(
  "⑤ 数据层内部只有一处开库（唯一的门）；旧的三处列在待搬清单里（PH4）",
  (() => {
    const openings = walk("src").filter(({ path, text }) => text.includes("indexedDB.open("));
    const newLayer = openings.filter(({ path }) => path.replace(/\\/g, "/").includes("/lib/data/"));
    const legacy = openings
      .map(({ path }) => path.replace(/\\/g, "/").split("/").pop())
      .filter((n) => !["db.ts"].includes(n))
      .sort();
    return newLayer.length === 1 && newLayer[0].path.replace(/\\/g, "/").endsWith("lib/data/db.ts") && legacy.includes("idb-storage.ts");
  })(),
);

/* ═══════════════ ⑥ PH3：切换的硬保护（真跑时被咬过的地方） ═══════════════ */
const adapter = src("src/lib/data/adapter.ts");
const dbSrc = src("src/lib/data/db.ts");
check(
  "⑥ **没读过就不许写**（守护进程在 hydration 之前写了一次，曾把搬过去的行全删了）",
  adapter.includes("if (!hydrated)") && adapter.includes("refusedBeforeHydration"),
);
check("⑥ 只有读成功后才放开写入闸门", /hydrated = true;/.test(adapter) && adapter.indexOf("hydrated = true") < adapter.indexOf("if (!hydrated)"));
check(
  "⑥ 增量写：只写变了的行（同一份内容再写一次 = 0 条）",
  (() => {
    const digest = new Map();
    const rows = [{ id: "c1", title: "T" }, { id: "m1", content: "hi" }];
    const first = changedRows(TABLES.conversations, rows, digest);
    const second = changedRows(TABLES.conversations, rows, digest);
    return first.put.length === 2 && second.put.length === 0 && second.unchanged === 2;
  })(),
);
check(
  "⑥ 增量写：改一条只写一条",
  (() => {
    const digest = new Map();
    changedRows(TABLES.messages, [{ id: "m1", content: "a" }, { id: "m2", content: "b" }], digest);
    const r = changedRows(TABLES.messages, [{ id: "m1", content: "a" }, { id: "m2", content: "b2" }], digest);
    return r.put.length === 1 && r.put[0].id === "m2";
  })(),
);
check(
  "⑥ 增量写：内存里没有的行会被删（所以「没读过」必须先拦住）",
  (() => {
    const digest = new Map();
    changedRows(TABLES.messages, [{ id: "m1" }, { id: "m2" }], digest);
    const r = changedRows(TABLES.messages, [{ id: "m1" }], digest);
    return r.del.length === 1 && r.del[0] === "m2";
  })(),
);
check(
  "⑥ 建库**不许**传 `{keyPath: undefined}`（会被当成非法参数 → 升级事务中止 → 库被丢掉）",
  (() => {
    /** 只看代码不看注释（注释里正解释这个坑） */
    const code = dbSrc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    return !code.includes("keyPath: table ===") && !/keyPath:\s*undefined/.test(code) && code.includes("isKeyless(table)");
  })(),
);
check("⑥ 空坏库自愈（版本对但一张表都没有 → 删掉重建）", dbSrc.includes("db.objectStoreNames.length === 0") && dbSrc.includes("deleteDatabase"));
check("⑥ 少的表不会静默忽略（记下来，靠 schema 版本 +1 补）", dbSrc.includes("库里少了这几张表"));
check(
  "⑥ 原字段名要留着（日记 body / 文档 content / createdAt）—— 否则切回去读不出来",
  src("src/lib/data/migrate.ts").includes("keys: {") && src("src/lib/data/schema.ts").includes("keys?: { text?: string; time?: string; title?: string }"),
);
check(
  "⑥ 开关默认关（没显式打开就走老路）",
  src("src/lib/data/switch.ts").includes('=== "1" ? "v2" : "legacy"'),
);
check(
  "⑥ 切回老存储**不删任何东西**",
  (() => {
    const s = src("src/lib/data/switch.ts");
    const fn = s.slice(s.indexOf("export function disableV2"));
    return fn.slice(0, 400).includes("removeItem") && !fn.slice(0, 400).includes("deleteDatabase");
  })(),
);

if (REVERSE) {
  passed = 0;
  failures = 0;
  /** 反向：把"老逻辑"（没有上游就不推）拿来跑 —— 第 ④ 组必须变红 */
  const oldLogicPayload = (input) => (input.baseUrl && input.apiKey && input.model ? { cfg_base_url: input.baseUrl } : {});
  const oldOut = oldLogicPayload({ baseUrl: "", apiKey: "", model: "" });
  check(
    "反向：老逻辑「没上游就跳过推送」→ 抽屉里旧值留着（正是用户遇到的那个 bug）",
    oldOut.cfg_base_url === undefined && cleared.cfg_base_url === "",
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
console.log("（PH2 骨架：还没接入现有功能，切换在 PH3 —— 用户点头才做）");
process.exit(failures === 0 ? 0 : 1);
