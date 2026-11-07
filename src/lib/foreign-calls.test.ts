/**
 * `lib/foreign-calls.ts` 的不变量 —— 为什么值得测：
 *
 * 那个模块要**从自由文本里可靠地**认出"别人的工具调用 JSON"，同时**绝不误删正文**。
 * 这两件事都容易写歪，而歪了的表现是"用户的气泡里冒出一坨 JSON"或"正文被吃掉"，
 * 只能在真机上撞见 —— 所以在这里钉住四个方向：
 *
 *   ① 认得出三种 shape（OpenAI 兼容 `name+arguments`、Gemini `functionCall`、带命名空间前缀）
 *   ② 名字能换算成我们的 kind（`default_api:emotion_report` → `emotion.report`）
 *   ③ 参数里被上游字符串化的嵌套对象要拆一层（Gemini 老毛病：`dimensions` 变成字符串）
 *   ④ 抹掉之后正文一个字不丢；普通 JSON 示例、不含 name+arguments 的对象**不许动**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanForeignCalls, stripForeignCalls, toActionKind } from "./foreign-calls.ts";

describe("toActionKind", () => {
  it("下划线形式换回 kind", () => {
    assert.equal(toActionKind("emotion_report"), "emotion.report");
    assert.equal(toActionKind("garden_walk"), "garden.walk");
    assert.equal(toActionKind("memory_add"), "memory.add");
  });

  it("带命名空间前缀也能认（Gemini 的 default_api:）", () => {
    assert.equal(toActionKind("default_api:emotion_report"), "emotion.report");
    assert.equal(toActionKind("functions.garden.walk"), "garden.walk");
  });

  it("认不出来的返回 null（真的不属于我们的名字）", () => {
    assert.equal(toActionKind("default_api:do_something_else"), null);
    assert.equal(toActionKind(""), null);
    assert.equal(toActionKind("nope"), null);
  });

  it("注意：web_search 是我们自己的 web.search，别当外部工具", () => {
    assert.equal(toActionKind("default_api:web_search"), "web.search");
  });
});

describe("scanForeignCalls", () => {
  it("Gemini 那种数组形态：摘出调用、正文抹干净", () => {
    const raw = [
      "把手给我，不闹你了，闭眼睡觉。💫",
      '[{"name":"default_api:emotion_report","arguments":{"confidence":"0.95","group":"flutter","intensity":"0.88"}}]',
    ].join("\n");
    const got = scanForeignCalls(raw);
    assert.equal(got.calls.length, 1);
    assert.equal(got.calls[0].kind, "emotion.report");
    assert.equal(JSON.parse(got.calls[0].args).group, "flutter");
    assert.equal(got.text, "把手给我，不闹你了，闭眼睡觉。💫");
  });

  it("Gemini 无命名空间 + functionCall 形态", () => {
    const raw = '好。{"functionCall":{"name":"memory.add","args":{"text":"她怕冷"}}}';
    const got = scanForeignCalls(raw);
    assert.equal(got.calls.length, 1);
    assert.equal(got.calls[0].kind, "memory.add");
    assert.equal(JSON.parse(got.calls[0].args).text, "她怕冷");
    assert.equal(got.text, "好。");
  });

  it("参数里被字符串化的嵌套对象会拆一层", () => {
    const raw =
      '[{"name":"default_api:emotion_report","arguments":{"dimensions":"{\\"attraction\\":0.9,\\"fondness\\":0.95}"}}]';
    const got = scanForeignCalls(raw);
    assert.equal(got.calls.length, 1);
    const args = JSON.parse(got.calls[0].args) as { dimensions: unknown };
    assert.equal(typeof args.dimensions, "object");
    assert.deepEqual(args.dimensions, { attraction: 0.9, fondness: 0.95 });
  });

  it("流式做到一半（配不平）时整段藏起来，不留半截 JSON", () => {
    const raw = '晚安。\n[{"name":"default_api:emotion_report","arguments":{"group":"flut';
    const got = scanForeignCalls(raw);
    assert.equal(got.text, "晚安。");
  });

  it("普通正文 / 普通 JSON 不动", () => {
    const plain = '这个接口返回 {"ok":true}，你看下。';
    assert.equal(stripForeignCalls(plain), plain);
    const sample = '比如：[{"id":1,"title":"测试"}]';
    assert.equal(stripForeignCalls(sample), sample);
  });

  it("认不出的名字也照样从正文里抹掉（宁可藏掉，也不给用户看一坨 JSON）", () => {
    const raw = '马上。\n[{"name":"default_api:do_something_else","arguments":{"q":"天气"}}]';
    const got = scanForeignCalls(raw);
    assert.equal(got.calls[0].kind, null);
    assert.equal(got.text, "马上。");
  });
});
