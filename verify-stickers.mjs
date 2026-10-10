#!/usr/bin/env node
/**
 * 验收：**表情包**（纯 node，不起浏览器、不连外网）。
 *
 * 用户原话（2026-11）：
 *   "可以发表情包……我感觉这个表情包应该是挺成熟，他们自己就可以调用表情包，
 *    而且发的就是他的表情包格式。"
 *
 * 钉三件事：
 *   ① 挑图：空库 → 什么都不发（不许发空气）；库里只有一张 → 就是它；
 *      多张 → 随机，但**尽量不跟上一次重复**（连着发同一张很假）
 *   ② 入库：动图/透明格式**不重画**（canvas 会把 GIF 动画吃掉）+ 一律存 PNG（保透明）
 *   ③ 接线：动作在册（三边一致）、常驻集合两处顺序一致、挑完的图挂到**这一条回复**上
 *
 * 跑法：node verify-stickers.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-stickers.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pickSticker,
  pickStickerByGroup,
  matchStickerGroup,
  stickerGroupList,
  STICKER_TAGS,
  DEFAULT_STICKER_GROUP,
} from "./src/lib/stickers.ts";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
const j = (v) => JSON.stringify(v);

/* ── ① 挑图 ── */
check("① 表情库是空的 → 不挑（调用方要如实说「库里还没有」）", pickSticker([]) === undefined);
check("① 只有一张 → 就是它", pickSticker(["A"]) === "A");
const many = ["A", "B", "C"];
const picks = new Set();
for (let i = 0; i < 60; i += 1) picks.add(pickSticker(many, "A"));
check("① 库里有三张时**不会**总挑同一张", picks.size >= 2, j([...picks]));
check("① **避开上一次发过的那张**（传了 last=A，就不该再出 A）", !picks.has("A"), j([...picks]));
check(
  "① 库里只有一张、又刚好是上次那张 → 还是得发它（不能因为避重就什么都不发）",
  pickSticker(["A"], "A") === "A",
);
check("① 脏数据（空串/null）会被跳过", pickSticker(["", "B"]) === "B");
check("① 预设标签是给「按情绪挑」那一步用的（先摆在这儿，别散落）", STICKER_TAGS.length >= 8);

/* ── ① b 分组（2026-11：用户要的"库里带分组，我自己分，他就能用了"） ── */
/** 假的库：两组各两张 + 一张未分组（`.mjs` 里不写 TS 类型标注） */
const LIB = [
  { id: "1", url: "u-wuyu-1", group: "无语" },
  { id: "2", url: "u-wuyu-2", group: "无语" },
  { id: "3", url: "u-bao-1", group: "抱抱" },
  { id: "4", url: "u-none-1", group: DEFAULT_STICKER_GROUP },
];
check("①b 分组名完全一样 → 命中", matchStickerGroup(["无语", "抱抱"], "无语") === "无语");
check("①b 他说得更长（『发个抱抱』）→ 也命中", matchStickerGroup(["抱抱"], "发个抱抱") === "抱抱");
check("①b 他说得更短（『抱』）→ 也命中", matchStickerGroup(["抱抱"], "抱") === "抱抱");
check("①b 两个分组都可能命中时取**更长**的（「难过到哭」不该被「难过」抢走）", matchStickerGroup(["难过", "难过到哭"], "难过到哭") === "难过到哭");
check("①b 对不上 → null（调用方要如实说「没这个分组」）", matchStickerGroup(["无语"], "生气") === null);
check("①b 空的 feel → null（他没点名就全库随机）", matchStickerGroup(["无语"], "  ") === null);

const byGroup = pickStickerByGroup(LIB, "无语", undefined);
check(
  "①b 点了分组 → **只从那组里挑**",
  Boolean(byGroup) && byGroup.matched && byGroup.url.startsWith("u-wuyu"),
  j(byGroup),
);
const noMatch = pickStickerByGroup(LIB, "生气", undefined);
check(
  "①b 对不上分组 → 全库随机 + `matched:false`（好让他知道该改口）",
  Boolean(noMatch) && noMatch.matched === false,
  j(noMatch),
);
const avoid = new Set();
for (let i = 0; i < 60; i += 1) {
  const p = pickStickerByGroup(LIB, "无语", "u-wuyu-1");
  if (p) avoid.add(p.url);
}
check("①b 同一组里也避重", !avoid.has("u-wuyu-1"), j([...avoid]));
check("①b 空库 → null", pickStickerByGroup([], "无语") === null);
check(
  "①b 分组清单 = 用户建的空组 + 库里出现过的组（未分组永远在）",
  j(stickerGroupList(LIB, ["新组"])) === j(["新组", "无语", "抱抱", DEFAULT_STICKER_GROUP]),
  j(stickerGroupList(LIB, ["新组"])),
);

/* ── ② 入库 ── */
const attach = src("src/lib/attachments.ts");
check(
  "② 动图/透明格式**原样保留**（不重画 —— 否则 GIF 动画没了）",
  attach.includes("/^image\\/(gif|webp|png)$/") && attach.includes("return await readAsDataUrl(file)"),
);
check("② 表情一律存 PNG（jpeg 会把透明变成白底）", attach.includes('toDataURL("image/png")'));
check("② 长边限到 320（表情在聊天里只有一百多像素）", attach.includes("STICKER_MAX_EDGE = 320"));

const removal = src("src/lib/white-removal.ts");
check("② 去白底是**从边缘漫水填充**（内部的白要留住：眼白、白字）", removal.includes("flood fill"));
check("② 白边不到一半就放弃（避免把正常照片啃掉）", removal.includes("border * 0.5"));

/* ── ③ 接线 ── */
const composer = src("src/components/chat/composer.tsx");
check(
  "③ 加表情走的是**表情那条路**（stickerFromFile + 去白底），不是普通附件那条",
  composer.includes("stickerFromFile(f)") && composer.includes("stripWhiteBackground(url)"),
);
const actions = src("src/lib/actions.ts");
check(
  "③ 挑好的图挂到**这一条回复**上（不是单发一条消息）",
  actions.includes("setReplySticker(picked.url)") && src("src/lib/use-chat.ts").includes("takeReplySticker()"),
);
const schema = src("src/lib/action-schema.ts");
const kinds = src("src/lib/types.ts");
check(
  "③ 动作三边都在（schema / AppAction 联合 / 执行器）",
  schema.includes('kind: "sticker.send"') &&
    kinds.includes('{ kind: "sticker.send"') &&
    actions.includes('case "sticker.send"'),
);
const always = src("src/lib/tool-select.ts");
const corpus = src("tool-recall-corpus.ts");
const orderOf = (text, re) => (text.match(re) ?? []).length;
check(
  "③ 常驻集合两处都加上了（顺序一致，verify-tool-recall 盯这个）",
  always.includes('"sticker.send"') && corpus.includes('"sticker.send"'),
  j({ always: orderOf(always, /"sticker\.send"/g), corpus: orderOf(corpus, /"sticker\.send"/g) }),
);

/* ── ④ 库：分组能改、老数据能迁、工具区有入口 ── */
const store = src("src/lib/store.ts");
check(
  "④ 库有增删挪 + 三个分组操作（新建/改名/删组）",
  store.includes("addStickerGroup:") &&
    store.includes("renameStickerGroup:") &&
    store.includes("removeStickerGroup:") &&
    store.includes("moveSticker:"),
);
check(
  "④ **删组不删图**（组里的图挪回未分组，图还在）",
  /removeStickerGroup:[\s\S]{0,400}DEFAULT_STICKER_GROUP/.test(store),
);
check(
  "④ 老存档（`stickers: string[]`）平滑迁到「未分组」——一张都不丢",
  /stickerLib: \(\(\) => \{[\s\S]{0,600}DEFAULT_STICKER_GROUP/.test(store),
);
const toolsView = src("src/components/tools-view.tsx");
check(
  "④ 工具区多了「表情」这个 tab（跟 HTTP / MCP / 文档 并排）",
  toolsView.includes('label: "表情"') && toolsView.includes("<StickerLibrary />"),
);
check(
  "④ 库页面真的有「传/分组/挪/删」四件事",
  src("src/components/tools/sticker-library.tsx").includes("stickerFromFile") &&
    src("src/components/tools/sticker-library.tsx").includes("addStickerGroup") &&
    src("src/components/tools/sticker-library.tsx").includes("moveSticker") &&
    src("src/components/tools/sticker-library.tsx").includes("removeSticker"),
);
check(
  "④ 他能现问一份分组清单（挑得准的那个动作）",
  kinds.includes('{ kind: "sticker.groups" }') && actions.includes('case "sticker.groups"'),
);

if (REVERSE) {
  /* 反向：把"避开上次那张"的逻辑去掉（只随机）—— 上面那条断言必须变红 */
  const naive = (urls, last) => {
    void last;
    return urls[Math.floor(Math.random() * urls.length)];
  };
  passed = 0;
  failures = 0;
  const set = new Set();
  for (let i = 0; i < 200; i += 1) set.add(naive(many, "A"));
  check("反向：不避重的版本**会**再挑到上次那张（所以那条断言真的在看行为）", set.has("A"), j([...set]));
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败：连朴素版都没被认出重复");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
