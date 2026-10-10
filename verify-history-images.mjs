#!/usr/bin/env node
/**
 * 验收：**发给上游的历史里，图片只能挂在用户消息上**。
 *
 * 真机事故（2026-11，用户报："接让他测完之后就变成这样了，连点两次都是这样"）：
 * 界面上显示上游的报错原文 —— `Image in assistant message is not supported`。
 *
 * 真凶：他发了一张表情包 → 那条**助手**消息带上了 `sticker` 附件 →
 * 下一轮把历史发回去时成了 `role:"assistant"` + `image_url`，
 * 而 DeepSeek 这类接口**只允许 user 消息带图** → 整轮失败。
 *
 * 所以这里钉两条：
 *   ① user 的图片/表情照旧走图片通道（视觉模型才看得见）
 *   ② **assistant 的附件一律不走图片通道**，只靠文字说明（表情 → 「【表情包】」）
 *
 * 跑法：node verify-history-images.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-history-images.mjs
 */
import { register } from "node:module";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";

/** `chat-client.ts` 用的是 `@/…` 别名、还有 `./models` 这种**没有后缀**的相对 import，
 *  node 里都要靠 resolve 钩子补 `.ts`（只在内存里，不改任何文件） */
const base = new URL("./src/", import.meta.url).href;
register(
  `data:text/javascript,${encodeURIComponent(
    [
      "export async function resolve(specifier, context, next) {",
      `  if (specifier.startsWith("@/")) return next(${JSON.stringify(base)} + specifier.slice(2) + ".ts", context);`,
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

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
/**
 * ⚠️ 必须**动态** import：静态 import 会在模块体执行**之前**就解析依赖，
 * 那时钩子还没注册 → `./models` 这种没后缀的相对 import 直接 ERR_MODULE_NOT_FOUND。
 */
const { historyForApi } = await import("./src/lib/chat-client.ts");
const { attachmentsToText } = await import("./src/lib/attachments.ts");
const j = (v) => JSON.stringify(v).slice(0, 200);
/** 一份最小的假消息（只带这条断言在乎的字段） */
const msg = (role, content, attachments) => ({
  id: `${role}-1`,
  role,
  content,
  thinking: "",
  thinkingDurationMs: 0,
  createdAt: Date.now(),
  attachments,
});
const STICKER = {
  id: "att-s",
  kind: "sticker",
  name: "表情",
  mime: "image/png",
  size: 0,
  dataUrl: "data:image/png;base64,AAAA",
};
const IMAGE = {
  id: "att-i",
  kind: "image",
  name: "截图.png",
  mime: "image/png",
  size: 10,
  dataUrl: "data:image/png;base64,BBBB",
};

/** 有没有 image_url 那种 part */
const hasImagePart = (m) =>
  Array.isArray(m.content) && m.content.some((p) => p && p.type === "image_url");

const built = historyForApi(
  [
    msg("user", "你看这张", [IMAGE]),
    msg("assistant", "嗯，看到了", [STICKER]),
    msg("user", "那这个呢", []),
  ],
  { autoCompact: false, keepRecent: 10 },
);

const userMsg = built.find((m) => m.role === "user");
const assistantMsg = built.find((m) => m.role === "assistant");

check(
  "① 用户消息带图 → **走图片通道**（视觉模型才看得见）",
  Boolean(userMsg) && hasImagePart(userMsg),
  j(userMsg?.content),
);
check(
  "② **助手消息带表情 → 绝不走图片通道**（上游会直接报 Image in assistant message is not supported）",
  Boolean(assistantMsg) && !hasImagePart(assistantMsg),
  j(assistantMsg?.content),
);
check(
  "② 助手那句里写着「【表情包】」——他知道自己发过，但不再是图片 part",
  Boolean(assistantMsg) && String(assistantMsg.content).includes("【表情包】"),
  j(assistantMsg?.content),
);
check(
  "② 表情折成文字时是「【表情包】」，不是「附件：表情（0KB，无法读取内容）」",
  attachmentsToText([STICKER]).includes("【表情包】") &&
    !attachmentsToText([STICKER]).includes("无法读取内容"),
  j(attachmentsToText([STICKER])),
);
check(
  "② 顺手确认：任何一条 assistant 消息都不含 image_url（扫全部）",
  built.filter((m) => m.role === "assistant").every((m) => !hasImagePart(m)),
  j(built.map((m) => [m.role, hasImagePart(m)])),
);

if (REVERSE) {
  /** 反向：恢复"不分角色都发图"的旧行为，第 ② 条必须变红 */
  const naive = (messages) =>
    messages.map((m) => {
      const images = (m.attachments ?? []).filter(
        (a) => (a.kind === "image" || a.kind === "sticker") && a.dataUrl,
      );
      return images.length === 0
        ? { role: m.role, content: m.content }
        : {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...images.map((a) => ({ type: "image_url", image_url: { url: a.dataUrl } })),
            ],
          };
    });
  passed = 0;
  failures = 0;
  const bad = naive([msg("assistant", "嗯，看到了", [STICKER])]);
  check(
    "反向：旧行为（助手消息也发图）确实会被第 ② 条抓住",
    hasImagePart(bad[0]),
    j(bad[0].content),
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
