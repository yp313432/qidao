/**
 * 摘要块 → 可检索小记忆。
 *
 * 钉死的是 id 契约：检索结果靠 `block:<会话>:<水位>:<下标>` 找回来，
 * 摘要库又靠 `summaryIdOfBlock()` 从它反查整份摘要。改格式而不改这两个
 * 函数，表现是"摘要来源点进去打不开"——不报错，但很难查。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Conversation } from "@/lib/types";
import {
  blockIndexOf,
  blockToRecallable,
  summaryBlockRefs,
  summaryIdOfBlock,
  summaryQuoteNeighbor,
  verifiedSummaryQuote,
} from "./summary-blocks.ts";

function fakeConversation(): Conversation {
  return {
    id: "c1",
    title: "论文",
    incognito: false,
    messages: [],
    summary: {
      text: "这段时间她一直在赶论文。",
      upToIndex: 50,
      updatedAt: 1000,
      blocks: [
        { text: "论文第三章数据要重跑，改到凌晨两点", tags: ["论文", "疲惫"], at: "11-18" },
        { text: "导师要求下周一交初稿" },
      ],
    },
    summaryArchive: [
      { text: "更早的摘要。她也提过论文。", upToIndex: 20, updatedAt: 500 },
    ],
  } as unknown as Conversation;
}

describe("summaryBlockRefs", () => {
  it("当前摘要用 blocks，旧摘要按句临时拆，按时间新→旧", () => {
    const refs = summaryBlockRefs([fakeConversation()]);
    assert.equal(refs.length, 3);
    assert.equal(refs[0].id, "block:c1:50:0");
    assert.equal(refs[0].summaryId, "summary:c1:50");
    assert.equal(refs[0].latest, true);
    assert.equal(refs[0].conversationTitle, "论文");
    assert.equal(refs[1].id, "block:c1:50:1");
    /* 旧摘要懒拆：没有 blocks 字段也照样能检索 */
    assert.equal(refs[2].latest, false);
    assert.ok(refs[2].text.includes("更早的摘要"));
  });

  it("隐身对话不参与", () => {
    const conv = { ...fakeConversation(), incognito: true };
    assert.equal(summaryBlockRefs([conv]).length, 0);
  });

  it("没有摘要的对话给空数组", () => {
    const conv = { id: "c2", title: "", incognito: false, messages: [] } as unknown as Conversation;
    assert.deepEqual(summaryBlockRefs([conv]), []);
  });
});

describe("blockToRecallable", () => {
  it("日期并进正文和标签，kind 标成 summary", () => {
    const [ref] = summaryBlockRefs([fakeConversation()]);
    const memory = blockToRecallable(ref);
    assert.equal(memory.id, "block:c1:50:0");
    assert.equal(memory.content, "11-18 论文第三章数据要重跑，改到凌晨两点");
    assert.deepEqual(memory.tags, ["11-18", "论文", "疲惫"]);
    assert.equal(memory.kind, "summary");
    assert.equal(memory.updatedAt, 1000);
  });

  it("没有日期时用摘要更新时间补一个 M-D", () => {
    const conv = fakeConversation();
    conv.summary!.blocks = [{ text: "导师要求下周一交初稿" }];
    conv.summary!.updatedAt = new Date(2026, 10, 19, 10, 0, 0).getTime();
    const [ref] = summaryBlockRefs([conv]);
    assert.match(blockToRecallable(ref).content, /^11-19 /);
  });
});

describe("verifiedSummaryQuote", () => {
  const quote = "老师一催，我脑子就空白了。";
  const message = { id: "u1", role: "user" as const, content: quote, createdAt: 500, thinking: "", thinkingDurationMs: 0 };

  it("keeps verified source text out of the search index and checks the live message before reuse", () => {
    const conv = fakeConversation();
    conv.messages = [message];
    conv.summary!.blocks = [{ text: "老师催交让她紧张", source: { messageId: "u1", quote } }];
    const [ref] = summaryBlockRefs([conv]);
    assert.doesNotMatch(blockToRecallable(ref).content, /脑子就空白/);
    assert.deepEqual(verifiedSummaryQuote(ref, conv), { quote, role: "user", messageId: "u1" });
    assert.equal(verifiedSummaryQuote(ref, { ...conv, incognito: true }), undefined);
    assert.equal(verifiedSummaryQuote(ref, { ...conv, messages: [] }), undefined);
    assert.equal(verifiedSummaryQuote(ref, { ...conv, messages: [{ ...message, content: "编辑后的话" }] }), undefined);
  });

  it("uses a legacy quote only when one covered message contains it verbatim", () => {
    const conv = fakeConversation();
    conv.messages = [{ ...message, id: "before", content: "其他内容" }, message];
    Object.assign(conv.summary!, { fromIndex: 1, upToIndex: 2, blocks: [{ text: `她说「${quote}」` }] });
    const [ref] = summaryBlockRefs([conv]);
    assert.deepEqual(verifiedSummaryQuote(ref, conv), { quote, role: "user", messageId: "u1" });
    assert.equal(verifiedSummaryQuote({ ...ref, fromIndex: 0, upToIndex: 1 }, conv), undefined);
    assert.equal(verifiedSummaryQuote({ ...ref, fromIndex: undefined }, conv), undefined);
    assert.equal(verifiedSummaryQuote({ ...ref, fromIndex: 0 }, {
      ...conv, messages: [{ ...message, id: "another" }, message],
    }), undefined);
  });

  it("only returns the adjacent turn, without crossing another user message", () => {
    const conv = fakeConversation();
    const reply = { ...message, id: "a1", role: "assistant" as const, content: "先缓一下，我陪你理理。" };
    conv.messages = [message, reply];
    assert.equal(summaryQuoteNeighbor(conv, "u1"), reply);
    assert.equal(summaryQuoteNeighbor(conv, "a1"), message);
    conv.messages = [message, { ...message, id: "u2" }, reply];
    assert.equal(summaryQuoteNeighbor(conv, "u1"), undefined);
    assert.equal(summaryQuoteNeighbor(conv, "a1")?.id, "u2");
  });
});

describe("id 反查", () => {
  it("块 id 能反查到摘要 id 和块下标", () => {
    assert.equal(summaryIdOfBlock("block:c1:50:3"), "summary:c1:50");
    assert.equal(blockIndexOf("block:c1:50:3"), 3);
  });

  it("别的 id 不误判", () => {
    assert.equal(summaryIdOfBlock("summary:c1:50"), null);
    assert.equal(summaryIdOfBlock("c1"), null);
    assert.equal(blockIndexOf("summary:c1:50"), -1);
    assert.equal(blockIndexOf("block:c1:50:x"), -1);
  });
});

it("显式无要点的摘要不参与分块检索；旧摘要仍能按原来源 ID 定位", () => {
  const conversation = {
    id: "conv", title: "对话", incognito: false,
    summary: { text: "仅有回顾正文。", upToIndex: 10, updatedAt: 2, blocks: [] },
    summaryArchive: [{ text: "旧摘要的完整句子。", upToIndex: 5, updatedAt: 1 }],
  } as unknown as Conversation;
  assert.deepEqual(summaryBlockRefs([conversation]).map(({ id, summaryId }) => ({ id, summaryId })), [
    { id: "block:conv:5:0", summaryId: "summary:conv:5" },
  ]);
});
