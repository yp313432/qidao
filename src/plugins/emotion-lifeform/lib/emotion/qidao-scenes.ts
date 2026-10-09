import type { EmotionEventRecord } from "@/lib/types";
import type { EmotionEvent } from "./types";
/** ⚠️ 带 `.ts` 后缀：这样 `node --experimental-strip-types` 能直接 import 这个文件做真断言 */
import { familyOf } from "./visual.ts";

/**
 * **栖岛上报的情绪事件 → 插件要的 `EmotionEvent`**（纯映射，不造数据）。
 *
 * 用户的要求："插件读真数据（有真数据用真数据，没有才回落模拟，不许白屏）"。
 *
 * | 插件要的 | 从哪来 | 怎么算 |
 * |---|---|---|
 * | `eventId` | `record.id` | `qidao:<id>`（跟模拟场景的 id 不会撞） |
 * | `timestamp` | `record.at` | 事件时间（ISO），**不是"读出来的时间"** |
 * | `title` | `primaryEmotion` + 第一层次情绪 | 一句短的（如「心动 · 羞涩」） |
 * | `intensity` / `confidence` | 0~1 的原值 | **×100**（插件的量表是 0~100，见 `visual.ts` 的 `intensity / 100`） |
 * | `dimensions` | 六个 0~1 | 同上 ×100 |
 * | `category` / `suggestedMode` / `memoryQuery` | 原样 | 上报时已经校验过（词表外的值进不来） |
 * | `evidenceRefs` | `record.evidence` | 每条要么是 `quote`、要么是 `summary`（两者互斥，见上报那一侧） |
 * | `summary` / `motion` / `coach` | 由上面几项**如实拼** | 不编情节：只说主情绪、强度、置信度、走哪一支动态 |
 *
 * ⚠️ 两条纪律：
 *   ① **拿不到的不编**（跟记忆宇宙那次一样）：`expressionTendencies` 在栖岛上报的字段里
 *      没有对应物，所以留空数组 —— 面板对空数组本来就有兜底（整块不显示）。
 *   ② **这里不碰美术**：`visual.ts` / `present.ts` / `draw-lifeform.ts` 一行都没改，
 *      颜色和动作依旧是它们按 `family` + 强度算出来的。
 */

/** 「心动 · 羞涩」这种短标题：只用已有的词，不编形容词。 */
function shortTitle(record: EmotionEventRecord): string {
  const second = record.secondaryEmotions[0];
  return second ? `${record.primaryEmotion} · ${second}` : record.primaryEmotion;
}

function pct(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function toEmotionEvent(record: EmotionEventRecord): EmotionEvent {
  const intensity = pct(record.intensity);
  const confidence = pct(record.confidence);
  const family = familyOf(record.primaryEmotion);

  return {
    eventId: `qidao:${record.id}`,
    timestamp: new Date(record.at).toISOString(),
    title: shortTitle(record),
    primaryEmotion: record.primaryEmotion,
    secondaryEmotions: record.secondaryEmotions,
    intensity,
    confidence,
    /**
     * 目前只有一种来源：他在对话里**推断**出来的
     * （插件那边 `SOURCE_LABEL` 会显示成「当前文本推断」）。
     */
    sourceType: "conversation_inference",
    /** 栖岛没上报表达倾向 —— 留空，不编（面板对空数组不显示那一块） */
    expressionTendencies: [],
    suggestedMode: record.suggestedMode,
    evidenceRefs: record.evidence.map((item, index) => ({
      id: `qidao:${record.id}:ev${index + 1}`,
      // 上报时就规定了"要么 quote 要么 summary"，两者至少有一个
      quote: item.quote ?? item.summary ?? "",
      note: item.quote
        ? "他自己引的那一句（引起波动的那一句，≤40 字）。"
        : "他自己写的一句摘要（≤20 字）。",
    })),
    memoryQuery: record.memoryQuery,
    summary: `他在对话里报的主情绪是「${record.primaryEmotion}」${
      record.secondaryEmotions.length ? `，还有 ${record.secondaryEmotions.join("、")}` : ""
    }。强度 ${intensity}、置信度 ${confidence}（0~100，两者分开看）。`,
    motion: `这一条按「${family}」那一支的基础动态走；强度 ${intensity} 只改亮度和粒子浓淡，不另开一套动作。`,
    category: record.category,
    dimensions: {
      attraction: pct(record.dimensions.attraction),
      longing: pct(record.dimensions.longing),
      shyness: pct(record.dimensions.shyness),
      restraint: pct(record.dimensions.restraint),
      warmth: pct(record.dimensions.warmth),
      unease: pct(record.dimensions.unease),
    },
    coach: "这一笔是他真实上报的（不是模拟场景）。强度、置信度和依据都照原样显示。",
    isDemoData: false,
  };
}

/** 批量映射（栖岛那边是"新的在前"，这里保持同序）。 */
export function toEmotionEvents(records: readonly EmotionEventRecord[]): EmotionEvent[] {
  return records.map(toEmotionEvent);
}
