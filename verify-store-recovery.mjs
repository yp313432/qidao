#!/usr/bin/env node
/**
 * 验收：**存档安全网**（"数据全没了"那件事的根治）。
 *
 * 用户反馈（2026-11）：
 *   "我的数据包括设置啥的都没了，刚打开就闪退了两次，然后就是全新的界面了。
 *    我又没卸载过，也没有选择清除过数据。"
 *
 * 老实现只有一份存档、读不出来就当"没有"、然后空档又写回去 —— 这就是入口。
 * 现在钉四条：
 *   ① 好档 → 就用它
 *   ② **主档坏/缺 → 自动退到备份**（绝不当成"没有"）
 *   ③ 备份也坏 → 才退到 localStorage 老数据 → 再没有才算"真没有"
 *   ④ 判"像不像档"要严：空串 / 半截 JSON / `{"state":null}` 都算坏档
 *
 * 跑法：node verify-store-recovery.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-store-recovery.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikeSnapshot, pickSnapshot } from "./src/lib/idb-storage.ts";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}

const GOOD = JSON.stringify({ state: { conversations: [{ id: "c1" }], settings: {} }, version: 1 });
const GOOD2 = JSON.stringify({ state: { conversations: [{ id: "c2" }] }, version: 1 });

/* ── ④ 判据 ── */
check("④ 正常存档 → 认", looksLikeSnapshot(GOOD));
check("④ 空串 → 不认", !looksLikeSnapshot(""));
check("④ null / undefined → 不认", !looksLikeSnapshot(null) && !looksLikeSnapshot(undefined));
check("④ 半截 JSON（崩在写档当口的样子）→ 不认", !looksLikeSnapshot('{"state":{"conversations":[{"id":"c1"'));
check("④ 字面量 null → 不认", !looksLikeSnapshot("null"));
check("④ 数组 → 不认（没有 state）", !looksLikeSnapshot("[]"));
/** ⚠️ `typeof null === "object"` 的经典坑：`{"state":null}` 必须算坏档 */
check("④ `{\"state\":null}` → 不认（typeof null 也是 object，这里专抓）", !looksLikeSnapshot('{"state":null}'));

/* ── ① ② ③ 挑哪一份 ── */
check("① 主档好 → 用主档", pickSnapshot({ main: GOOD, backup: GOOD2 }).source === "main");
check(
  "② **主档坏 + 备份好 → 用备份**（老代码会当成「没有」，数据就这么没了）",
  pickSnapshot({ main: "坏档{{{", backup: GOOD2 }).source === "backup",
  JSON.stringify(pickSnapshot({ main: "坏档{{{", backup: GOOD2 }).source),
);
check("② 主档缺（第一次装/被清）+ 备份好 → 用备份", pickSnapshot({ backup: GOOD2 }).source === "backup");
check(
  "③ 主档坏 + 备份坏 + localStorage 老数据好 → 用老数据",
  pickSnapshot({ main: "坏", backup: "也坏", legacy: GOOD }).source === "legacy",
);
check("③ 三份都没有 → none（这才叫真的没有）", pickSnapshot({}).source === "none");
check("③ 三份都坏 → none", pickSnapshot({ main: "坏", backup: "坏", legacy: "坏" }).source === "none");
check(
  "② 主档好但备份更好看时**不许越级**（用户的当前数据优先）",
  pickSnapshot({ main: GOOD, backup: GOOD2 }).text === GOOD,
);

/* ── ⑤ 两条"防覆盖"的硬保护（这次真机上唯一能确定的事实：只有主档那条没了） ── */
const storageSrc = readFileSync(join(process.cwd(), "src/lib/idb-storage.ts"), "utf8");
check(
  "⑤ 读档失败时**暂停自动保存**（不许拿空状态盖掉老记录）",
  storageSrc.includes("readFailedThisSession") &&
    /readFailedThisSession\s*\)\s*\{\s*skippedWrites/s.test(storageSrc),
);
check(
  "⑤ 读不出来的坏档要**挪到一边留证**（aster-app::corrupt），不静默丢",
  storageSrc.includes("::corrupt") && storageSrc.includes("corruptKeyOf"),
);
check(
  "⑤ 备份是「覆盖前先存」（不是事后补）",
  /if \(name === MAIN_KEY && looksLikeSnapshot\(value\)\)/.test(storageSrc),
);

if (REVERSE) {
  /** 反向：把"坏档当没有"的老逻辑拿来跑一遍 —— 第 ② 条必须变红 */
  const oldLogic = (main, backup) => (main ? { source: "main" } : { source: backup ? "backup" : "none" });
  passed = 0;
  failures = 0;
  const bad = oldLogic("坏档{{{", GOOD2);
  check(
    "反向：老逻辑把坏档当成「有档」→ 于是从不看备份（数据丢失的真正原因）",
    bad.source !== "backup",
    JSON.stringify(bad),
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
