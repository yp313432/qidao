/**
 * 引用（`> 引用：…`）的解析与校验 —— 为什么值得钉死：
 *
 * 用户 m01498 第 1 条要「引用跟微信那样」：发送时把原句拼在正文最前面，
 * 显示时摘出来摆一条小灰条。这里一旦解析错，两种事故都很显眼：
 * ① 摘多了 → 正文头少一截；② 摘少了 → 气泡里多出一行「> 引用：…」；
 * ③ 2026-11-18 起 AI 也能引用她（用户 m01264/m01282）：模型编造一句"她说过的话"
 *    如果被当引用画出来，就是伪造对话记录，所以校验必须是「逐字包含」。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isVerbatimQuote, splitQuote } from "./quote.ts";

describe("splitQuote", () => {
  it("摘掉引用头，正文原样保留", () => {
    assert.deepEqual(splitQuote("> 引用：早点睡\n\n我记着呢"), {
      quote: "早点睡",
      body: "我记着呢",
    });
  });

  it("半角冒号和前后空格也认", () => {
    assert.deepEqual(splitQuote(">  引用:  别熬夜  \n\n\n好"), { quote: "别熬夜", body: "好" });
  });

  it("多行正文不被吃掉", () => {
    const r = splitQuote("> 引用：第一句\n\n第二段\n\n第三段");
    assert.equal(r.quote, "第一句");
    assert.equal(r.body, "第二段\n\n第三段");
  });

  it("没有引用头时原样返回、不误判", () => {
    assert.deepEqual(splitQuote("普通一句话"), { quote: null, body: "普通一句话" });
    assert.deepEqual(splitQuote("> 普通引用块"), { quote: null, body: "> 普通引用块" });
    assert.deepEqual(splitQuote(""), { quote: null, body: "" });
  });
});

describe("isVerbatimQuote", () => {
  const said = "今天好累啊，想早点睡。明天还要早起呢";

  it("逐字摘一句算真", () => {
    assert.equal(isVerbatimQuote("今天好累啊", said), true);
  });

  it("标点/空白不一样不算抄错", () => {
    assert.equal(isVerbatimQuote("今天好累啊 想早点睡", said), true);
    assert.equal(isVerbatimQuote("今天好累啊,想早点睡!", said), true);
  });

  it("模型编出来的句子不算", () => {
    assert.equal(isVerbatimQuote("我想养一只猫", said), false);
  });

  it("太短的不算（单字/空串没有引用价值）", () => {
    assert.equal(isVerbatimQuote("今", said), false);
    assert.equal(isVerbatimQuote("", said), false);
  });

  it("她一个字都没说过时一律不算", () => {
    assert.equal(isVerbatimQuote("随便一句", ""), false);
  });
});
