export type DareKind = "truth" | "dare";

export type DeckCard = {
  kind: DareKind;
  intensity: 1 | 2 | 3;
  text: string;
};

export const DECK: DeckCard[] = [
  { kind: "truth", intensity: 1, text: "最近一次让你真正安静下来的事是什么？" },
  { kind: "truth", intensity: 1, text: "你对自己哪个小小的习惯最得意？" },
  { kind: "truth", intensity: 1, text: "如果明天只能带三首歌出门，会是哪三首？" },
  { kind: "truth", intensity: 2, text: "有哪句你没说出口的话，现在仍然记得？" },
  { kind: "truth", intensity: 2, text: "你最怕别人看穿你的哪一面？" },
  { kind: "truth", intensity: 2, text: "最近一次改变主意，是因为什么？" },
  { kind: "truth", intensity: 3, text: "如果你必须放弃一个身份标签，会是哪一个？" },
  { kind: "truth", intensity: 3, text: "有没有一件你一直在等别人先开口的事？" },
  { kind: "dare", intensity: 1, text: "用十个字描述此刻的心情，发到日记动态。" },
  { kind: "dare", intensity: 1, text: "闭眼三十秒，只听房间里最远的一声。" },
  { kind: "dare", intensity: 1, text: "给今天的自己取一个新的中间名。" },
  { kind: "dare", intensity: 2, text: "下一局五子棋必须先走边角。" },
  { kind: "dare", intensity: 2, text: "把一段思考链保存成文档，标题写成诗。" },
  { kind: "dare", intensity: 2, text: "切换到墨色主题待满三分钟再换回来。" },
  { kind: "dare", intensity: 3, text: "坦白一件你很少承认的小事。" },
  { kind: "dare", intensity: 3, text: "写一条只给未来自己看的日记，设定为一年后才读。" },
];

export function drawCard(kind?: DareKind, intensity?: 1 | 2 | 3): DeckCard {
  const pool = DECK.filter(
    (c) => (!kind || c.kind === kind) && (!intensity || c.intensity <= intensity),
  );
  return pool[Math.floor(Math.random() * pool.length)] ?? DECK[0]!;
}
