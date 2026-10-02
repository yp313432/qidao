import type { WorldEntry } from "@/lib/types";

/**
 * 内置的世界书 / 思考引导预设。
 *
 * **全部默认关着** —— 用户自己开。
 * 悄悄改他的思考方式等于偷偷换人，那是另一回事。
 *
 * 前几条专门治"想太久"：
 * 思考链一长，经过代理时流式连接容易被掐断，最后只剩一条空回复。
 * 让模型想短一点、先说结论，是最直接的缓解。
 */
export function worldPresets(): WorldEntry[] {
  const at = Date.now();
  const make = (
    id: string,
    title: string,
    keywords: string[],
    content: string,
    position: "system" | "tail",
  ): WorldEntry => ({ id, title, keywords, content, position, enabled: false, createdAt: at });

  return [
    make(
      "preset_short_think",
      "别想太久",
      [],
      "思考别超过十步：想清楚就停，先给结论，再补最多两条理由。想太久容易把回答拖没。",
      "system",
    ),
    make(
      "preset_conclusion_first",
      "先给结论",
      [],
      "先给结论或答案，再解释。不用「让我想想」「这是个好问题」这类开场，直接说。",
      "system",
    ),
    make(
      "preset_no_selfdoubt",
      "别绕圈",
      [],
      "思考里不要反复自我怀疑、不要重复复述同一件事、不要列一堆备选又全部推翻。想到哪算哪。",
      "system",
    ),
    make(
      "preset_honest_unsure",
      "不确定就说不确定",
      [],
      "不确定就直说不确定，别编。宁可说「我不知道」，也不要给一个像模像样的假答案。",
      "system",
    ),
    make(
      "preset_no_flatter",
      "别客套",
      [],
      "不要一味附和、不要夸用户的问题好。有不同看法就直接说，语气温和但不绕弯。",
      "system",
    ),
    make(
      "preset_qidao",
      "栖岛是什么",
      ["栖岛", "这个app", "这个app"],
      "栖岛是用户自己动手做的私人 App：界面、数据、记忆都只存在他那台设备上，不联网、不上传。",
      "tail",
    ),
    make(
      "preset_shigan",
      "时感",
      ["时感"],
      "「时感」是栖岛里嵌着的一个时钟页面（在 玩乐 → 时感）。",
      "tail",
    ),
    make(
      "preset_sleep",
      "他的作息",
      ["睡不着", "熬夜", "失眠"],
      "用户习惯晚睡，凌晨还在的时候别说教、别催他睡，陪着就行。",
      "tail",
    ),
  ];
}
