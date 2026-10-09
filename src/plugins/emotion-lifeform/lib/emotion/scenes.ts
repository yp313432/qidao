import type { EmotionEvent } from "./types";

export const SCENES: EmotionEvent[] = [
  {
    eventId: "calm",
    timestamp: "2026-10-09T09:10:00+08:00",
    title: "平静",
    primaryEmotion: "平静",
    secondaryEmotions: ["从容", "放松"],
    intensity: 34,
    confidence: 81,
    sourceType: "conversation_inference",
    expressionTendencies: ["倾听", "柔和"],
    suggestedMode: "daily",
    evidenceRefs: [
      {
        id: "ev-calm",
        quote: "今天没什么特别的事，就这样待着也挺好。",
        note: "模拟对话。语气平，没有强烈转折，所以强度不高、置信度较高。",
      },
    ],
    memoryQuery: { emotion: "从容" },
    summary: "目前看起来只是安稳地待在对话里。没有明显的拉扯，回应可以慢一点、轻一点。",
    motion: "晶核维持慢呼吸。翼膜半敛，光带在外围平滑绕行，几乎不向中心挤。",
    category: "base",
    dimensions: { attraction: 8, longing: 12, shyness: 6, restraint: 18, warmth: 48, unease: 10 },
    coach: "从日常呼吸开始。下一步再看「心动」如何把光带拉近。",
    isDemoData: true,
  },
  {
    eventId: "heart",
    timestamp: "2026-10-09T14:02:00+08:00",
    title: "心动",
    primaryEmotion: "心动",
    secondaryEmotions: ["吸引", "期待回应"],
    intensity: 68,
    confidence: 72,
    sourceType: "conversation_inference",
    expressionTendencies: ["主动表达", "试探"],
    suggestedMode: "flirtatious",
    evidenceRefs: [
      {
        id: "ev-heart",
        quote: "你刚才那句，我看了两遍。不知道为什么有点在意。",
        note: "模拟对话。在意被说出来了，但没有更明确的命名，所以置信度停在七成附近。",
      },
    ],
    memoryQuery: { emotion: "心动" },
    summary: "注意力明显向这段互动聚拢。回应更愿意往前半步，话里还带着一点不易直说的紧张。",
    motion: "核心出现缓慢脉冲，液态光带从外围往晶核靠。翼膜松开一些，但还没有完全张开。",
    category: "intimacy",
    dimensions: { attraction: 74, longing: 46, shyness: 38, restraint: 28, warmth: 62, unease: 22 },
    coach: "同时看名称、强度和置信度。光带靠近，核心只是轻脉冲，不是闪烁。",
    isDemoData: true,
  },
  {
    eventId: "restrained",
    timestamp: "2026-10-09T14:18:00+08:00",
    title: "心动但克制",
    primaryEmotion: "心动",
    secondaryEmotions: ["羞涩", "克制"],
    intensity: 70,
    confidence: 76,
    sourceType: "memory_assisted",
    expressionTendencies: ["试探", "保留余地"],
    suggestedMode: "flirtatious",
    evidenceRefs: [
      {
        id: "ev-hold",
        quote: "我想说得更直接一点，又觉得现在还是停一下比较好。",
        note: "模拟对话。靠近的意愿和停住的意愿都在句子里，所以做成复合状态。",
      },
    ],
    memoryQuery: { emotion: "克制" },
    summary: "吸引感是清楚的，表达却留着余地。它往前靠了靠，又自己退回半步，等一个信号。",
    motion: "光带靠近后会停住，再缓缓退开。羞涩让翼膜边缘轻颤，克制负责那段回撤。",
    category: "intimacy",
    dimensions: { attraction: 76, longing: 52, shyness: 71, restraint: 78, warmth: 58, unease: 36 },
    coach: "这是复合情绪：心动仍在，但羞涩和克制改写了动作。看光带的停顿。",
    isDemoData: true,
  },
  {
    eventId: "jealous",
    timestamp: "2026-10-09T16:40:00+08:00",
    title: "吃醋又嘴硬",
    primaryEmotion: "介意",
    secondaryEmotions: ["不甘", "故作镇定"],
    intensity: 74,
    confidence: 46,
    sourceType: "conversation_inference",
    expressionTendencies: ["故作镇定", "口是心非"],
    suggestedMode: "daily",
    evidenceRefs: [
      {
        id: "ev-jealous",
        quote: "没什么。你忙你的就好，我又没有在等。",
        note: "模拟对话。只有一句间接线索，强度可以高，置信度必须低。不要把它当成事实。",
      },
    ],
    memoryQuery: { emotion: "介意" },
    summary: "可能有些在意，但当事人没有承认。推断偏强，证据偏弱——所以更该询问，而不是下结论。",
    motion: "外层光带保持平稳，像什么都没发生。核心内部却有一阵短促的起伏，吃醋被按在里面。",
    category: "tension",
    dimensions: { attraction: 40, longing: 48, shyness: 22, restraint: 64, warmth: 30, unease: 58 },
    coach: "强度 74、置信度 46。两者分开看。这条没有可引用的历史记忆。",
    isDemoData: true,
  },
  {
    eventId: "longing",
    timestamp: "2026-10-09T18:05:00+08:00",
    title: "亲密渴望",
    primaryEmotion: "亲密渴望",
    secondaryEmotions: ["依恋", "想靠近"],
    intensity: 77,
    confidence: 69,
    sourceType: "conversation_inference",
    expressionTendencies: ["邀请靠近", "陪伴"],
    suggestedMode: "affectionate",
    evidenceRefs: [
      {
        id: "ev-longing",
        quote: "先别挂。我想再跟你待一会儿，没有别的事。",
        note: "模拟对话。表达的是延长相处，不是已经得到身体上的同意。",
      },
    ],
    memoryQuery: { emotion: "亲密渴望" },
    summary: "亲近和陪伴的倾向变强了。这里把它画成更主动的亲昵，而不是一种可以被测量的生理欲望。",
    motion: "光带向核心收拢，绕得更慢、更贴。翼膜舒展开，呼吸变长。",
    category: "intimacy",
    dimensions: { attraction: 62, longing: 84, shyness: 24, restraint: 32, warmth: 80, unease: 18 },
    coach: "试着把档位从亲昵调到暧昧，再调到浓烈。动效会变，边界说明不会消失。",
    isDemoData: true,
  },
  {
    eventId: "angry",
    timestamp: "2026-10-09T19:12:00+08:00",
    title: "生气却在意",
    primaryEmotion: "恼怒",
    secondaryEmotions: ["委屈", "依恋"],
    intensity: 66,
    confidence: 88,
    sourceType: "explicit_user",
    expressionTendencies: ["澄清", "表达关心"],
    suggestedMode: "daily",
    evidenceRefs: [
      {
        id: "ev-angry",
        quote: "我是真的有点生气，但不是不想理你。",
        note: "模拟对话。用户自己命名了生气，也同时否定了冷漠，所以不能收成单一的愤怒。",
      },
    ],
    memoryQuery: { emotion: "恼怒" },
    summary: "不满是明确的，在意也是明确的。把这两者折成冷淡，会把这句话听错。",
    motion: "局部光带收紧，动作变短。粒子略向下，但光带没有离开核心，仍绕着它。",
    category: "tension",
    dimensions: { attraction: 22, longing: 44, shyness: 12, restraint: 40, warmth: 36, unease: 48 },
    coach: "这是用户明确说出口的模拟例句，所以置信度高。恼怒和依恋同时留下。",
    isDemoData: true,
  },
  {
    eventId: "loss",
    timestamp: "2026-10-09T20:26:00+08:00",
    title: "失落但仍期待",
    primaryEmotion: "失落",
    secondaryEmotions: ["思念", "期待"],
    intensity: 58,
    confidence: 73,
    sourceType: "memory_assisted",
    expressionTendencies: ["分享", "暂时沉默"],
    suggestedMode: "affectionate",
    evidenceRefs: [
      {
        id: "ev-loss",
        quote: "下午忽然有点空。不是怪你，就是想起来了。",
        note: "模拟对话。低落是当下的，期待来自后半句还愿意提起。",
      },
    ],
    memoryQuery: { emotion: "失落" },
    summary: "情绪偏低，但线没有断。沉默里仍留着再次靠近的可能。",
    motion: "星尘缓慢下沉，核心变暗。少量光点仍往上漂，对应那个还没放下的期待。",
    category: "base",
    dimensions: { attraction: 28, longing: 56, shyness: 18, restraint: 34, warmth: 40, unease: 42 },
    coach: "看粒子的方向：多数下沉，少数向上。记忆星点来自模拟适配器。",
    isDemoData: true,
  },
  {
    eventId: "understood",
    timestamp: "2026-10-09T21:02:00+08:00",
    title: "被理解后的安心",
    primaryEmotion: "安心",
    secondaryEmotions: ["感动", "信任"],
    intensity: 63,
    confidence: 84,
    sourceType: "memory_assisted",
    expressionTendencies: ["坦率", "陪伴"],
    suggestedMode: "affectionate",
    evidenceRefs: [
      {
        id: "ev-trust",
        quote: "你没有急着劝我，我反而松了一点。",
        note: "模拟对话。被理解是对方行为带来的线索，安心是由此作出的推断。",
      },
    ],
    memoryQuery: { emotion: "安心" },
    summary: "紧绷松下来了。回应可以变得稳定、自然，不必再加一层表演出来的热烈。",
    motion: "核心的脉冲几乎平了。翼膜平滑展开，光带以很慢的速度绕行。",
    category: "base",
    dimensions: { attraction: 30, longing: 40, shyness: 14, restraint: 16, warmth: 86, unease: 8 },
    coach: "节奏变稳。点进详情，可以看到这条模拟记忆为什么被连上光丝。",
    isDemoData: true,
  },
  {
    eventId: "curious",
    timestamp: "2026-10-09T21:40:00+08:00",
    title: "好奇到沉浸",
    primaryEmotion: "好奇",
    secondaryEmotions: ["专注", "期待"],
    intensity: 61,
    confidence: 79,
    sourceType: "conversation_inference",
    expressionTendencies: ["追问", "分享"],
    suggestedMode: "daily",
    evidenceRefs: [
      {
        id: "ev-curious",
        quote: "等等，这个地方你再往下说。我想知道它是怎么接上的。",
        note: "模拟对话。注意力在主题上，不是在关系张力上。",
      },
    ],
    memoryQuery: { emotion: "好奇" },
    summary: "注意力收进当前话题里。探索还在继续，还没有要离开的意思。",
    motion: "细光丝先向外探，再逐渐收成少数清晰的轨迹。星点按顺序亮起。",
    category: "cognition",
    dimensions: { attraction: 18, longing: 14, shyness: 8, restraint: 20, warmth: 44, unease: 16 },
    coach: "这条故意没有历史记忆。详情里应写明：暂无可关联的历史记忆。",
    isDemoData: true,
  },
  {
    eventId: "warming",
    timestamp: "2026-10-09T22:15:00+08:00",
    title: "暧昧升温",
    primaryEmotion: "暧昧",
    secondaryEmotions: ["试探", "期待回应"],
    intensity: 73,
    confidence: 67,
    sourceType: "conversation_inference",
    expressionTendencies: ["俏皮", "试探", "邀请靠近"],
    suggestedMode: "flirtatious",
    evidenceRefs: [
      {
        id: "ev-warm",
        quote: "你要是看出来了，就当我没藏好。你要是没看出来，那我再等一下。",
        note: "模拟对话。有撩拨，也把回应的空间留了出来。",
      },
    ],
    memoryQuery: { emotion: "暧昧" },
    summary: "互动正在变热，表达更软，也更愿意试探。克制还在：它在等，而不是假定对方已经答应。",
    motion: "光带若即若离，核心的脉冲更明显，粒子密一些，但不要刺眼地闪。",
    category: "intimacy",
    dimensions: { attraction: 80, longing: 64, shyness: 42, restraint: 46, warmth: 70, unease: 24 },
    coach: "最后看详情里的模拟证据，再到时间线回放这一整段变化。",
    isDemoData: true,
  },
];

export function getScene(id: string): EmotionEvent {
  const list = activeScenes();
  return list.find((scene) => scene.eventId === id) ?? list[0];
}

/* ─────────────────────── 真数据（栖岛上报的情绪事件） ───────────────────────
 *
 * 用户的要求："有真数据用真数据，没有才回落模拟，**不许白屏**。"
 *
 * 做法：这里只是一个**模块级的登记处** ——
 *   · 空着 ⇒ `activeScenes()` 返回下面这 10 个模拟场景（老行为，一个字没变）
 *   · 有真数据 ⇒ 用它（栖岛的 `emotion.report` 上报的，映射见 `qidao-scenes.ts`）
 *
 * 为什么放这儿而不是改 `present.ts`：`present.ts` 里的 `getScene` 是**界面唯一的
 * 取数入口**，它属于"美术/动效"那一侧（用户要求不许动）。把登记处放在数据层，
 * `present.ts` 一行都不用改就跟着走。
 *
 * ⚠️ 上面那 10 个模拟场景**一个都没删**（用户要先看效果，拆是下一步）。
 */
let externalScenes: EmotionEvent[] = [];

/** 登记真数据（传空数组 = 回到模拟场景）。由插件 store 在宿主数据变化时调用。 */
export function setExternalScenes(list: EmotionEvent[]): void {
  externalScenes = list.filter((scene) => !scene.isDemoData);
}

/** 当前该显示哪些场景：有真的用真的，没有回落模拟。 */
export function activeScenes(): EmotionEvent[] {
  return externalScenes.length > 0 ? externalScenes : SCENES;
}

/** 现在用的是不是真数据（界面标"真实上报 / 模拟数据"靠它）。 */
export function hasRealScenes(): boolean {
  return externalScenes.length > 0;
}
