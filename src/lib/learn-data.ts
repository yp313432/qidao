// 英语学习模块的本地数据：单词卡、翻译词库、阅读素材。
// 全部离线可用，不依赖后端。

export type WordCard = {
  id: string;
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
  example: string;
  exampleZh: string;
};

export const WORDS: WordCard[] = [
  { id: "w1", word: "serendipity", phonetic: "/ˌserənˈdɪpəti/", pos: "n.", meaning: "意外发现珍宝的运气", example: "Meeting her was pure serendipity.", exampleZh: "遇见她纯粹是机缘巧合。" },
  { id: "w2", word: "ephemeral", phonetic: "/ɪˈfemərəl/", pos: "adj.", meaning: "短暂的；转瞬即逝的", example: "Fame in the internet age is ephemeral.", exampleZh: "互联网时代的盛名转瞬即逝。" },
  { id: "w3", word: "resilient", phonetic: "/rɪˈzɪliənt/", pos: "adj.", meaning: "有韧性的；能迅速恢复的", example: "Children are often more resilient than adults.", exampleZh: "孩子往往比成年人更有韧性。" },
  { id: "w4", word: "nostalgia", phonetic: "/nɒˈstældʒə/", pos: "n.", meaning: "怀旧；乡愁", example: "The song fills me with nostalgia.", exampleZh: "这首歌让我充满了怀旧之情。" },
  { id: "w5", word: "subtle", phonetic: "/ˈsʌtl/", pos: "adj.", meaning: "微妙的；不易察觉的", example: "There is a subtle difference between the two.", exampleZh: "两者之间有细微的差别。" },
  { id: "w6", word: "contemplate", phonetic: "/ˈkɒntəmpleɪt/", pos: "v.", meaning: "沉思；仔细考虑", example: "She sat by the window to contemplate.", exampleZh: "她坐在窗边沉思。" },
  { id: "w7", word: "vivid", phonetic: "/ˈvɪvɪd/", pos: "adj.", meaning: "生动的；鲜明的", example: "He gave a vivid description of the trip.", exampleZh: "他对这次旅行做了生动的描述。" },
  { id: "w8", word: "tranquil", phonetic: "/ˈtræŋkwɪl/", pos: "adj.", meaning: "宁静的；平静的", example: "The lake was calm and tranquil.", exampleZh: "湖面平静而安宁。" },
  { id: "w9", word: "ambitious", phonetic: "/æmˈbɪʃəs/", pos: "adj.", meaning: "有雄心的；志向远大的", example: "She is ambitious about her career.", exampleZh: "她对事业很有抱负。" },
  { id: "w10", word: "diligent", phonetic: "/ˈdɪlɪdʒənt/", pos: "adj.", meaning: "勤奋的；用功的", example: "A diligent student rarely fails.", exampleZh: "勤奋的学生很少失败。" },
  { id: "w11", word: "glimpse", phonetic: "/ɡlɪmps/", pos: "n./v.", meaning: "一瞥；瞥见", example: "I caught a glimpse of the sea.", exampleZh: "我瞥见了大海。" },
  { id: "w12", word: "horizon", phonetic: "/həˈraɪzn/", pos: "n.", meaning: "地平线；眼界", example: "Travel broadens your horizon.", exampleZh: "旅行能开阔你的眼界。" },
  { id: "w13", word: "genuine", phonetic: "/ˈdʒenjuɪn/", pos: "adj.", meaning: "真诚的；真正的", example: "Her smile is warm and genuine.", exampleZh: "她的微笑温暖而真诚。" },
  { id: "w14", word: "wander", phonetic: "/ˈwɒndə/", pos: "v.", meaning: "漫游；漫步", example: "We wandered through the old town.", exampleZh: "我们在老城里漫步。" },
  { id: "w15", word: "cherish", phonetic: "/ˈtʃerɪʃ/", pos: "v.", meaning: "珍惜；珍爱", example: "I cherish the time we spent together.", exampleZh: "我珍惜我们一起度过的时光。" },
  { id: "w16", word: "blossom", phonetic: "/ˈblɒsəm/", pos: "v./n.", meaning: "开花；花朵", example: "The trees blossom in spring.", exampleZh: "树在春天开花。" },
  { id: "w17", word: "insight", phonetic: "/ˈɪnsaɪt/", pos: "n.", meaning: "洞察力；深刻的见解", example: "The book offers fresh insights.", exampleZh: "这本书提供了新的洞见。" },
  { id: "w18", word: "endeavor", phonetic: "/ɪnˈdevə/", pos: "v./n.", meaning: "努力；尽力", example: "We endeavor to improve every day.", exampleZh: "我们努力每天进步。" },
];

export type DictEntry = { en: string; zh: string };

// 英⇄中 快速词库（离线匹配）。
export const DICTIONARY: DictEntry[] = [
  { en: "hello", zh: "你好" },
  { en: "goodbye", zh: "再见" },
  { en: "thank you", zh: "谢谢你" },
  { en: "you're welcome", zh: "不客气" },
  { en: "sorry", zh: "对不起" },
  { en: "excuse me", zh: "打扰一下" },
  { en: "please", zh: "请" },
  { en: "yes", zh: "是的" },
  { en: "no", zh: "不" },
  { en: "good morning", zh: "早上好" },
  { en: "good night", zh: "晚安" },
  { en: "see you later", zh: "回头见" },
  { en: "how are you", zh: "你好吗" },
  { en: "I'm fine", zh: "我很好" },
  { en: "what's your name", zh: "你叫什么名字" },
  { en: "my name is", zh: "我的名字是" },
  { en: "nice to meet you", zh: "很高兴认识你" },
  { en: "where", zh: "哪里" },
  { en: "when", zh: "什么时候" },
  { en: "why", zh: "为什么" },
  { en: "how", zh: "怎样；如何" },
  { en: "what", zh: "什么" },
  { en: "who", zh: "谁" },
  { en: "time", zh: "时间" },
  { en: "today", zh: "今天" },
  { en: "tomorrow", zh: "明天" },
  { en: "yesterday", zh: "昨天" },
  { en: "friend", zh: "朋友" },
  { en: "family", zh: "家人" },
  { en: "love", zh: "爱" },
  { en: "happy", zh: "快乐的" },
  { en: "sad", zh: "悲伤的" },
  { en: "tired", zh: "疲惫的" },
  { en: "hungry", zh: "饿的" },
  { en: "food", zh: "食物" },
  { en: "water", zh: "水" },
  { en: "book", zh: "书" },
  { en: "work", zh: "工作" },
  { en: "study", zh: "学习" },
  { en: "travel", zh: "旅行" },
  { en: "dream", zh: "梦想；梦" },
  { en: "weather", zh: "天气" },
  { en: "help", zh: "帮助" },
  { en: "question", zh: "问题" },
  { en: "answer", zh: "回答" },
  { en: "beautiful", zh: "美丽的" },
];

export type ReadingPassage = {
  id: string;
  title: string;
  level: "入门" | "进阶";
  en: string;
  zh: string;
  glossary: { w: string; zh: string }[];
};

export const READINGS: ReadingPassage[] = [
  {
    id: "r1",
    title: "A Quiet Morning",
    level: "入门",
    en: "The morning is quiet. Light comes through the window and falls on the wooden table. I make a cup of tea and sit by the window. Outside, a bird sings a short, simple song. For a few minutes, there is nowhere to go and nothing to fix. I just listen.\n\nThis is a small kind of happiness. It does not shout. But if you slow down, it is always there.",
    zh: "清晨很安静。阳光透过窗户洒在木桌上。我泡了一杯茶，坐在窗边。窗外，一只鸟唱着短小而简单的歌。有那么几分钟，没有非去不可的地方，也没有非修不可的东西。我只是听着。\n\n这是一种小小的幸福。它不会大声喧哗。但只要你慢下来，它一直都在。",
    glossary: [
      { w: "quiet", zh: "安静的" },
      { w: "through", zh: "透过" },
      { w: "wooden", zh: "木制的" },
      { w: "simple", zh: "简单的" },
      { w: "slow down", zh: "慢下来" },
    ],
  },
  {
    id: "r2",
    title: "The Value of Slowness",
    level: "进阶",
    en: "We are taught to be fast: fast replies, fast results, fast growth. But speed is not the same as direction. A person running quickly in the wrong direction only gets lost faster.\n\nSlowness is not laziness. It is the space where attention lives. When you read slowly, you hear the writer's voice. When you walk slowly, you notice the street. When you think slowly, you find the question behind the question.",
    zh: "我们被教导要快：快速回复、快速见效、快速增长。但快并不等于方向正确。一个朝错误方向跑得很快的人，只会更快地迷失。\n\n慢不是懒惰。慢是注意力栖息的地方。慢慢读，你能听见作者的声音；慢慢走，你能留意到街道；慢慢想，你能找到问题背后的问题。",
    glossary: [
      { w: "speed", zh: "速度" },
      { w: "direction", zh: "方向" },
      { w: "laziness", zh: "懒惰" },
      { w: "attention", zh: "注意力" },
      { w: "notice", zh: "注意到" },
    ],
  },
  {
    id: "r3",
    title: "On Curiosity",
    level: "进阶",
    en: "Curiosity begins with a small admission: I do not know. This sounds like weakness, but it is the beginning of learning. Every expert was once a beginner who kept asking why.\n\nStay curious about ordinary things. A flower, a cloud, a stranger's habit — each one hides a door. Open enough doors, and the world stops feeling small.",
    zh: "好奇心始于一个小小的承认：我不知道。这听起来像软弱，却是学习的开端。每个专家都曾是那个不停追问为什么的新手。\n\n对平凡的事物保持好奇。一朵花、一片云、一个陌生人的习惯——每一样都藏着一扇门。打开的门足够多，世界就不再显得狭小。",
    glossary: [
      { w: "curiosity", zh: "好奇心" },
      { w: "admission", zh: "承认" },
      { w: "weakness", zh: "软弱；弱点" },
      { w: "expert", zh: "专家" },
      { w: "ordinary", zh: "平凡的" },
    ],
  },
];