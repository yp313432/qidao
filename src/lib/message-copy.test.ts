import { test } from "node:test";
import assert from "node:assert/strict";
import { messageCopyText, messagePlainText, copyMessageText } from "./message-copy.ts";
import { messageLinks, messageWebUrl } from "./message-links.ts";

test("plain text removes prose formatting while Markdown preserves the source", () => {
  const source = "## 标题\n\n**你好**\n下一行\n\n- 第一项\n- 第二项\n\n> 引用";
  assert.equal(messagePlainText(source), "标题\n\n你好\n下一行\n\n• 第一项\n• 第二项\n\n引用");
  assert.equal(messageCopyText(source, "markdown"), source);
});

test("code, indentation, identifiers and escaped characters survive plain copying", () => {
  const source = "```ts\n  const user_id = '**literal**';\n```\n\n`a_b * c` 和 user_id，\\*保留星号\\*";
  assert.equal(messagePlainText(source), "  const user_id = '**literal**';\n\na_b * c 和 user_id，*保留星号*");
});

test("plain links retain their destinations and current-bubble copying excludes siblings", () => {
  const part = "访问 [文档](https://example.com/docs)\n**这段就够了**";
  assert.equal(messageCopyText(part, "plain"), "访问 文档 (https://example.com/docs)\n这段就够了");
  assert.equal(messageCopyText(part, "markdown"), part);
  assert.equal(messagePlainText("https://example.com/a_b?q=x_y"), "https://example.com/a_b?q=x_y");
});

test("link detection supports Chinese punctuation, queries and balanced parentheses", () => {
  const text = "看 [文档](https://example.com/a_(b)?x=1&y=2)，以及 https://example.org/path。";
  const links = messageLinks(text);
  assert.deepEqual(links.map((link) => [link.label, link.url]), [
    ["文档", "https://example.com/a_(b)?x=1&y=2"], ["https://example.org/path", "https://example.org/path"],
  ]);
  assert.equal(text.slice(links[0].start, links[0].end), "[文档](https://example.com/a_(b)?x=1&y=2)");
  assert.equal(messageLinks("网址：https://example.com/path). 下一句")[0].url, "https://example.com/path");
});

test("generated scripts, app schemes, credentials and invalid addresses stay inert", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "intent://test", "https://user:secret@example.com", "https://"]) {
    assert.equal(messageWebUrl(value), null);
  }
  assert.deepEqual(messageLinks("[点这里](javascript:alert(1))"), []);
  assert.deepEqual(messageLinks("![图](https://example.com/image.png)"), []);
});

test("literal placeholder characters never collide with protected code", () => {
  assert.equal(messagePlainText("\uE0000\uE000 `**代码**`"), "\uE0000\uE000 **代码**");
});

test("clipboard success, unavailable API fallback, and denied writes are distinguished", async () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const doc = Object.getOwnPropertyDescriptor(globalThis, "document");
  let copied = "";
  let removed = 0;
  const field = { style: {}, focus() {}, select() {}, setSelectionRange() {}, remove() { removed++; } };
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied = text; } } } });
    await copyMessageText("第一段\n第二行");
    assert.equal(copied, "第一段\n第二行");
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      activeElement: null, getSelection: () => null, createElement: () => field,
      body: { appendChild() {} }, execCommand: () => true,
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await copyMessageText("fallback");
    assert.equal(removed, 1);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
    Object.assign(document, { execCommand: () => false });
    await assert.rejects(copyMessageText("failed"), /clipboard unavailable/);
    assert.equal(removed, 2);
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav); else Reflect.deleteProperty(globalThis, "navigator");
    if (doc) Object.defineProperty(globalThis, "document", doc); else Reflect.deleteProperty(globalThis, "document");
  }
});
