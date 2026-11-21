/**
 * 摘要解析：正文 + 「【要点】」小块。
 *
 * 为什么值得钉死：解析错不会立刻报错，而是**安静地**变成两种事故 ——
 * ① 要点没拆出来 → 检索又退回整段摘要（用户 m00416 明确不要）；
 * ② 正文超长/截断被当完整记忆 → 水位线推进，后半段永远不再被总结。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_MAX_CHARS,
  looseSummaryBlocks,
  parseSummaryOutput,
} from "./summary.ts";

describe("parseSummaryOutput", () => {
  it("标题、正文、【要点】小块都拆出来", () => {
    const raw = [
      "标题：论文与失眠",
      "这段时间她一直在赶论文，第三章的数据要重跑，连着两晚改到凌晨。",
      "",
      "【要点】",
      "- [11-18][论文,疲惫] 论文第三章数据有问题，改到凌晨两点，很累",
      "- [11-18][导师] 导师要求下周一交初稿",
      "- 她说想先睡一觉再改",
    ].join("\n");
    const result = parseSummaryOutput(raw);
    assert.ok(result);
    assert.equal(result.title, "论文与失眠");
    assert.match(result.text, /第三章/);
    assert.equal(result.blocks.length, 3);
    assert.deepEqual(result.blocks[0], {
      text: "论文第三章数据有问题，改到凌晨两点，很累",
      at: "11-18",
      tags: ["论文", "疲惫"],
    });
    /* 只有一个括号且像日期 → 当日期，不当标签 */
    assert.equal(result.blocks[2].at, undefined);
    assert.equal(result.blocks[2].tags, undefined);
  });

  it("只给一个括号但内容像标签 → 认成标签", () => {
    const result = parseSummaryOutput("标题：随手记\n正文一句。\n【要点】\n- [论文,疲惫] 改到凌晨，很累");
    assert.ok(result);
    assert.equal(result.blocks[0].at, undefined);
    assert.deepEqual(result.blocks[0].tags, ["论文", "疲惫"]);
  });

  it("没有【要点】时只返回正文，不硬凑块", () => {
    const result = parseSummaryOutput("标题：随手记\n只有正文的一段回顾。");
    assert.ok(result);
    assert.deepEqual(result.blocks, []);
  });

  it("剥掉代码围栏；空正文返回 null", () => {
    const fenced = parseSummaryOutput("```markdown\n标题：随手记\n围栏里的正文。\n```");
    assert.ok(fenced);
    assert.equal(fenced.text, "围栏里的正文。");
    assert.equal(parseSummaryOutput("   "), null);
    assert.equal(parseSummaryOutput("【要点】\n- [11-18] 只有块没有正文"), null);
  });

  it("正文超长返回 null —— 宁可不推进水位线，也不把半截当完整记忆", () => {
    const long = "字".repeat(SUMMARY_MAX_CHARS + 1);
    assert.equal(parseSummaryOutput(`标题：长\n${long}`), null);
  });

  it("小块去重、最多 8 块、单块截到 200 字", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `- [11-1${i % 9}] 第 ${i} 件小事，足够长到能被认出来`);
    lines.push(`- ${"长".repeat(240)}`);
    const result = parseSummaryOutput(`标题：多\n正文。\n【要点】\n${lines.join("\n")}`);
    assert.ok(result);
    assert.equal(result.blocks.length, 8);
    assert.ok(result.blocks.every((block) => block.text.length <= 200));
  });

  it("同一句出现两次只留一条", () => {
    const result = parseSummaryOutput(
      "标题：重复\n正文。\n【要点】\n- [11-18] 她昨天很累\n- [11-18] 她昨天很累",
    );
    assert.ok(result);
    assert.equal(result.blocks.length, 1);
  });
});

describe("looseSummaryBlocks", () => {
  it("旧摘要按句切成几块，顺序和信息都不丢", () => {
    const text = "她昨天赶论文到凌晨。导师催下周一交初稿。今天想先补觉。";
    const blocks = looseSummaryBlocks(text);
    assert.ok(blocks.length >= 1);
    assert.equal(blocks.map((block) => block.text).join(""), text);
    assert.ok(blocks.every((block) => block.text.length <= 200));
  });

  it("超长的一整段会拆成多块，最多 12 块", () => {
    const text = Array.from({ length: 40 }, (_, i) => `第${i}句话写在这里。`).join("");
    const blocks = looseSummaryBlocks(text);
    assert.ok(blocks.length > 1);
    assert.ok(blocks.length <= 12);
  });

  it("空文本给空数组", () => {
    assert.deepEqual(looseSummaryBlocks("   "), []);
  });
});

describe("新摘要的模型要点", () => {
  it("保留独立改写的要点和标签", () => {
    const raw = "标题：论文\n我记得她说选题已经定下来了。\n【要点】\n- [论文] 用户确认采用八段锦与老年衰弱作为综述方向。";
    assert.deepEqual(parseSummaryOutput(raw, true)?.blocks.map(({ text, tags }) => ({ text, tags })), [
      { text: "用户确认采用八段锦与老年衰弱作为综述方向。", tags: ["论文"] },
    ]);
  });

  it("有正文无要点时需明确写无，拒绝照搬、超长或格式不完整的要点", () => {
    const narrative = "标题：论文\n她确定写八段锦与老年衰弱。";
    assert.deepEqual(parseSummaryOutput(narrative + "\n【要点】\n无", true)?.blocks, []);
    assert.equal(parseSummaryOutput(narrative, true), null);
    assert.equal(parseSummaryOutput(narrative + "\n【要点】\n- 她确定写八段锦与老年衰弱！", true), null);
    assert.equal(parseSummaryOutput(narrative + "\n【要点】\n要点缺少列表标记", true), null);
    assert.equal(parseSummaryOutput(narrative + "\n【要点】\n- " + "长".repeat(201), true), null);
  });
});
