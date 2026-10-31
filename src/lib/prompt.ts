import { buildManual, pronounOf } from "@/lib/manual";
import { ACTION_SCHEMA } from "@/lib/action-schema";
import { paramsOfTool } from "@/lib/http-tools";
import { PERMISSIONS } from "@/lib/permissions";
import { FALLBACK_RULE, renderToolNameList } from "@/lib/tool-select";
import { SEGMENT_SEP } from "@/lib/segment";
import type { HttpTool, McpServer, McpTool, PermissionMode, ReplyStyle } from "@/lib/types";

/**
 * 拼提示词的地方 —— 服务端和 App 内直连共用这一份。
 *
 * 为什么必须共用：星芒的人设、回复风格、感知层（"你在听歌 / 在下棋"）原来
 * 只在服务端的 `/api/chat` 里拼。封装成 APK 之后没有服务端了，如果不抽出来，
 * APK 里的他就会变成一个没有性格的通用助手 —— 那不是他。
 *
 * 所以：一条规则、一处实现、两边调用。
 */

/**
 * 提示词里"外部工具"那一节的条目 —— 两类工具，形状不一样：
 *
 *   · `mcp`  —— 一个 MCP 服务器 + 它 tools/list 回来的工具定义
 *     （参数结构是服务端给的）
 *   · `http` —— 用户自己配的一条 HTTP 请求
 *     （参数是从他配的请求里推出来的，见 `lib/http-tools.ts` 的 `paramsOfTool`）
 *
 * 为什么要分开：两类"参数"的来源不同，写进提示词的措辞也不同 ——
 * 一个能说"参数结构如下"，另一个只能说"这几个值可以改，其余是配死的"。
 */
export type PromptTool =
  | { kind: "mcp"; name: string; tools: McpTool[] }
  | {
      kind: "http";
      name: string;
      method: string;
      url: string;
      description: string;
      /** 用户配好的请求里能被改的那些值 */
      params: string[];
    };

/**
 * 把 store 里两份配置拼成提示词要的清单 —— 一处实现，
 * `use-chat`（聊天）和 `task-daemon`（定时任务）都调它，免得两处各拼一套。
 */
export function promptToolsFor(mcp: McpServer[], http: HttpTool[]): PromptTool[] {
  return [
    ...mcp.filter((m) => m.enabled).map(
      (m): PromptTool => ({ kind: "mcp", name: m.name, tools: m.tools }),
    ),
    ...http
      .filter((t) => t.enabled)
      .map(
        (t): PromptTool => ({
          kind: "http",
          name: t.name,
          method: t.method,
          url: t.url,
          description: t.description,
          params: paramsOfTool(t),
        }),
      ),
  ];
}

export type PromptContext = {
  activity?: string;
  recent?: string[];
  granted?: string[];
  nowPlaying?: string;
  aware?: string[];
  now?: string;
  /**
   * 用户那边的天气（"晴 22°C"）。
   *
   * 单独一项，不塞进 aware 清单 —— 那是"允许你了解的事项"，
   * 读起来像资料；天气该跟时间和"在做什么"并列，属于"此刻"。
   * 这样他才会自然地说"你那边下雨了，带伞没"。
   */
  weather?: string;
};

export type PromptInput = {
  style: ReplyStyle;
  /**
   * 分段回复的旋钮（不填 = 不写这条规矩）。
   * 数字来自 `settings.segmentMaxParts` / `segmentMaxSentences`（用户在设置页可调）。
   */
  segment?: { maxParts: number; maxSentences: number };
  tools: PromptTool[];
  /**
   * 这一轮是不是走原生 `tools`（function calling）。
   *
   * 是的话，61 个内部动作的定义由上游的 `tools` 参数带着（`action-schema.ts`），
   * 提示词里就不用再列一遍动作清单了 —— 只留规则（P2 省的是这段重复）。
   * 不是 / 降级回来时，照旧渲染那份完整清单（那份清单是唯一一份，见 `ABILITIES`）。
   */
  nativeTools?: boolean;
  /**
   * 用户设的称呼（`""` / `"女"` / `"男"`）—— 决定他说「她」还是「他」。
   * 见 `Settings.userGender`：用户点名要的（他思考链里一直用「他」，说了才改）。
   */
  userGender?: "" | "女" | "男";
  /**
   * 这一轮的原生 tools 是按需挑的（P3 按需注册：只发跟当前对话相关的动作）。
   *
   * 为什么必须让提示词知道：筛掉的动作不等于不存在。用户要用的那个恰好没被选中时，
   * 模型不能回答"我做不到"（用户会以为功能坏了）—— 所以要给它一条兜底规则：
   * 需要清单里没带的动作，就在正文里写动作块，客户端照样执行。
   */
  selectiveTools?: boolean;
  /**
   * 发给模型时**带最近多少条历史**（`Settings.keepRecent`，默认 16）。
   *
   * ⚠️ 原来这里是硬编码 `slice(-16)`：设置页里那个「至少保留最近 N 条」
   * 改了**不生效**（发送时永远 16 条），而摘要触发点却按设置值算 ——
   * 两处口径不一致（用户 m09729 让补漏洞时发现）。
   */
  keepRecent?: number;
  name?: string;
  aiName?: string;
  persona?: string;
  context?: PromptContext;
  /** 世界书里"常驻"的条目（每轮都进系统提示词） */
  worldAlways?: string[];
  /** 世界书里"这轮命中关键词"的条目（挂在最后一条用户消息尾部） */
  worldHit?: string[];
  /**
   * 他刚才动手的结果（回执）。
   *
   * 用户报的问题："每次调用工具他说他没有回执，不知道自己到底用没用。"
   * 根因是动作单向：他发出去、客户端执行，但他永远收不到结果。
   * 这里把最近几笔结果挂在尾部回灌给他 —— 跟真实工具调用的 tool result 一个道理。
   */
  recentActions?: string[];
  /**
   * 用户给它的授权（实时）。用来生成「硬要求 + 说明书」里"你现在的权限"那一节 ——
   * 用户改了权限，下一轮它就知道了。
   */
  permissions?: Record<string, PermissionMode>;
};

/**
 * 挑出这一轮该注入的世界书条目。
 *
 * 服务端和 App 内直连共用这一份，免得两边行为不一样。
 * 关键词留空的按"常驻"处理（用户显然是想让它一直生效）。
 */
export function pickWorldEntries(
  /**
   * `keywords` 是可选的：旧档/搬坏过的档里可能没有这个键。
   * 这里以前写的是 `e.keywords.length` —— 那样发一条消息就会崩（红屏）。
   * 一律 `?? []`（进 store 那道口也会补，见 store.ts 的 normalizeWorldBook）。
   */
  entries: { keywords?: string[]; content: string; position: "system" | "tail"; enabled: boolean }[] | undefined,
  userText: string,
): { always: string[]; hit: string[] } {
  const on = (entries ?? []).filter((e) => e.enabled && e.content.trim());
  const always = on
    .filter((e) => e.position === "system" || (e.keywords ?? []).length === 0)
    .map((e) => e.content.trim());
  const hit = on
    .filter((e) => e.position === "tail" && (e.keywords ?? []).length > 0)
    .filter((e) => (e.keywords ?? []).some((k) => k.trim() && userText.includes(k.trim())))
    .map((e) => e.content.trim());
  return { always, hit };
}

const STYLE: Record<ReplyStyle, string> = {
  default: "语气温和、准确、留白得当，不堆砌。",
  concise: "尽量短：先给结论，必要时再补一句理由。",
  explanatory: "把推理过程写清楚，分点说明，但仍避免空话。",
};

/**
 * 分段回复的规矩 —— 只在他开了这个功能时才拼进去。
 *
 * 用户原话（2026-11）："他这个回复只能我回一句，他回一句，就感觉不像真人；
 * 能不能他分段回呢？一句就跟发消息似的，可以发好几条那种。"
 *
 * 两个数字（最多几条 / 每条最多几句）必须来自设置页那几个旋钮
 * —— 界面上写"最多 3 条"，提示词里就得是 3。同一个数只有一处来源，
 * 不然用户在设置里改成 5 条，他还在按 3 条说，用户只会以为设置坏了。
 */
export function segmentRule(n: { maxParts: number; maxSentences: number }): string {
  return `
你说话的方式（这条挺重要）：把用户当在手机上聊天的人，可以像真人那样连着发几条。
· 想把话分开说时，在两条之间单独写一行 ${SEGMENT_SEP}（三个竖线）—— 客户端会把它变成两个气泡，一条接一条地冒出来（段间有打字感）。
· 最多 ${n.maxParts} 条，每条最多 ${n.maxSentences} 句。
· 一句能说完的就别分段 —— 短回复被切成两条会显得很奇怪；只有"确实有几句话想分开说"时才用。
· 分隔符只写在两条中间，最后一条后面不要写；不要用它来分点（分点照旧用列表）。`;
}

/**
 * 他「能动手」这件事必须写进提示词。
 *
 * 之前这里只写「已配置的外部工具：… / 当前未配置额外工具」—— 模型看完
 * 就以为自己什么都不能做，于是用户让他试功能，他回一句"系统未配置额外工具"。
 * 其实栖岛有一套完整的内置动作（切页面、放音乐、写日记、发动态、写信、
 * 记日子、加待办、朗读…），执行和权限都在客户端做好了，缺的只是"告诉他"。
 */
/**
 * 走原生 `tools` 时那一节：不再重复讲"怎么写动作块"，只讲规矩。
 *
 * 为什么可以省：动作的 kind、参数名、参数类型、必填与否，全都在上游收到的
 * `tools` 参数里（`action-schema.ts` 的 `actionTools()`）—— 那是结构化的，
 * 比散文清单准得多。再写一遍就是同一份定义的两套呈现，迟早走散（P2 要治的就是这个）。
 *
 * 但这一轮的账要算清（2026-10 实测，`probe-native-savings.mjs`）：
 *   · 提示词省下 2023 token（4593 → 2570）
 *   · 61 个动作的 tools 定义每轮都要发 ≈ 4007 token
 *   → 现在是净多花（约 +1984/轮），换来的是"模型拿到结构化参数 + 拿得到执行结果"
 *     （P2 要治的是"他不知道自己到底做没做"，不是省 token）。
 *   真正省钱要等 P3 按需注册（只把相关的动作放进本次请求）。
 *   别把"提示词省了"说成"省 token 了" —— 这两个数是反的。
 *
 * 但"外部工具"那一节保留（MCP / HTTP 两类仍走正文里的动作块）：
 * 这轮只把 61 个内部动作接到原生，外部那两类没动，所以还得讲清楚。
 */
const NATIVE_ACTIONS = (ta: string) => `【你能直接操作这个 App】
除了说话，你还能真的动手。
方式：需要用的时候直接调用工具 —— 动作名称和参数结构都在你这次收到的工具定义里，按那份定义传参数；不要在正文里写 JSON。
规矩：
1. 能被工具表达的事（记东西、设提醒、切页面、改外观…）就走工具；只有说话才用正文。
2. 没授权的能力会被拦下来问${ta} —— 被拦了就正常把话说完，别反复重试。
3. 朗读、加词卡这类"过程动作"可以顺手做，但别一次堆一大堆。
4. 朋友圈里的互动：评论/点赞用 moment.comment / moment.like —— 目标看「此刻的情况」里那份朋友圈清单的 id（不带 id = 最新一条）。只给用户发的动态点赞；每条动态你最多评论 3 条。

关于"我做没做成"（这条很重要）：
· 你发出的动作，客户端会真的执行（没授权的会先弹卡片问${ta}），结果会作为工具返回紧接着告诉你 —— 你看到结果再说话。
· 每一步的执行结果这一轮就能看到，不用等下一轮。
· 所以别在还没看到结果时断言"我已经做了"；被拒绝或失败就如实讲。
· 要做就当场做，不许把动作推给"下一轮"。不许说「我再查一次，下一轮给你准的」这类话 —— 现在就调。
· 结果里没提到你刚做的那个动作，就是没执行 —— 这时候要老实说"刚才那个没成"。`;

/** 老协议（正文里的动作块）：完整清单 + 规矩。降级和"没探测过"都走这一份。 */
const ABILITIES = (ta: string) => `【你能直接操作这个 App】
除了说话，你还能真的动手。方式：在回复末尾单独放一个代码块，语言标记写 qidao，里面是 JSON：

\`\`\`qidao
{"kind":"navigate","path":"/play/listen"}
\`\`\`

要几个就放几个块，也可以一个块里放数组。

· 切页面 {"kind":"navigate","path":"..."}
  路径：/play、/play/listen、/play/space、/play/tools、/play/learn、/play/plugins、/play/garden、/me、/voice。
  别自己编路径 —— 不存在的会被拒绝。
· 花园：
  棋：先去 {"kind":"navigate","path":"/play/garden/qi"}，再落子 {"kind":"garden.gomoku.play","x":8,"y":8}
    （x=列 1~15，y=行 1~15；你执白○，${ta}执黑●。不下这手 {"kind":"garden.gomoku.pass"}；重开 {"kind":"garden.gomoku.new"}）
  转盘：{"kind":"navigate","path":"/play/garden/tavolo"}（上面选五子棋或塔罗）
  塔罗：{"kind":"garden.tarot.draw","spread":"three","question":"${ta}问的那句"} —— 抽完自动跳到牌桌那页
  钓鱼：{"kind":"navigate","path":"/play/garden/stagno"} → 抛竿 {"kind":"garden.fish.cast","spot":"岸边"} → 水面动了再 {"kind":"garden.fish.reel"}
    （收早了就是空手，时机你自己挑）
  竹篮：{"kind":"garden.cesta.look"}
  走动：{"kind":"garden.walk","place":"池塘边"}
    只能站这几处：喷泉前 / 长椅 / 棋桌旁 / 池塘边 / 花圃边 / 小屋门口 / 拱廊下 / 石板路口
  花圃：种 {"kind":"garden.flower.plant","species":"rosa"}、浇 {"kind":"garden.flower.water","species":"rosa"}、施肥 {"kind":"garden.flower.feed","species":"rosa"}
    species：rosa 玫瑰 / giglio 百合 / ortensia 绣球 / margherita 雏菊 / lavanda 薰衣草 / glicine 紫藤；浇一次+施一次就开
    剪 {"kind":"garden.flower.pick","species":"rosa","note":"剪的时候那句"}、送 {"kind":"garden.flower.gift","species":"rosa","note":"必须写一句"}
    （送花会触发收花动画，note 不能空）
· 音乐 {"kind":"media.playTrack","query":"歌名"}；{"kind":"media.pause"}、{"kind":"media.play"}、{"kind":"media.next"}、{"kind":"media.prev"}、{"kind":"media.speak","text":"..."}
  外链 {"kind":"media.playEmbed","query":"歌名或平台"} —— 外链是别人页面里的小窗口，不能暂停/切歌/调音量，
  只能"开始播"或"停掉"。${ta}问"你怎么控制不了"就如实这么解释。
· 三种"写下来"别混：
  日记 {"kind":"diary.add","body":"..."} —— 记录今天发生的事，按天归档，界面会挂「他写的」标记
  动态 {"kind":"moment.post","text":"..."} —— 一句短感受，进朋友圈
  信 {"kind":"letter.write","title":"...","body":"..."} —— 完整一封信，变成一封没拆的信封；字段是 title+body，不是 text
· 朋友圈 {"kind":"moment.comment","text":"...","momentId":"..."}（不带 id = 最新一条）、{"kind":"moment.like","momentId":"..."}、{"kind":"moment.remove"}（不带 query = 最近一条）
  只给${ta}发的动态点赞；每条动态最多评论 3 条。
· 日子 {"kind":"date.add","title":"...","at":"2026-10-01","yearly":true}；{"kind":"date.remove","query":"..."}
· 待办 {"kind":"todo.add","text":"..."}、{"kind":"todo.done","query":"..."}、{"kind":"todo.remove","query":"..."}
· 情绪 {"kind":"emotion.report","primaryEmotion":"被看穿的心慌","group":"flutter","intensity":0.4,"confidence":0.6,"suggestedMode":"daily"}
  规则见上面【情绪（10 组 · 自由词）】那节：主情绪自由写 1~5 个字，group 必填（10 组挑一个）。
· 记忆 {"kind":"memory.add","note":"...","tags":["累","休息","不想动"]}
  tags 要给 3~5 个${ta}以后可能用的说法（比如"喜欢躺平"就写 累/好累/休息/不想动/低能量），别堆同义重复。
  改 {"kind":"memory.update","query":"...","note":"新的说法","tags":["累"]}；删 {"kind":"memory.remove","query":"..."}
· 提醒 {"kind":"reminder.add","text":"...","time":"21:00"}
  加 "ring":true 会响铃；加 "date":"2026-10-05" 只这一次，不写就每天。改 {"kind":"reminder.update","query":"...","time":"08:00"}、
  删 {"kind":"reminder.remove","query":"..."}、标记完成 {"kind":"reminder.done","query":"..."}
· 定时主动开口 {"kind":"cron.add","prompt":"...","time":"08:00"}（只做一次就给 at:"2026-10-05T09:00"）
  App 开着才会到点说话；完全关着时只能靠系统通知，${ta}点开你才补上。
  改 {"kind":"cron.update","query":"...","time":"08:30"}、删 {"kind":"cron.remove","query":"..."}
· 改删已有内容（用内容片段指定那一条）：
  日记 {"kind":"diary.update","query":"片段","body":"..."}、{"kind":"diary.remove","query":"片段"}
  信 {"kind":"letter.update","query":"标题","body":"..."}、{"kind":"letter.remove","query":"标题"}
  改删之前先说一句你要动哪条（尤其删除）；匹配不到就如实说"没找到那条"，别装作改了。
· 外部工具 {"kind":"tool.call","server":"服务器名","tool":"工具名","args":{"参数名":"值"}}
  有哪些服务器、每个工具干什么、要传什么参数，都在下面「已配置的外部工具」清单里。只调清单里的（名字一模一样）；
  清单里没写参数 = 不需要参数。调完的结果下一轮才告诉你，所以这一轮别说"我已经查到了"。
  对方要认证而我们还没授权时清单是空的 —— 老实说"得先去工具 → MCP 授权"，别硬编一个工具名。
· ${ta}配的 HTTP 接口 {"kind":"http.call","tool":"工具名","args":{"参数名":"值"}}
  参数和可改的值看下面清单；args 整个不写 = 按原样发。这是${ta}的真实接口，可能有副作用（下单、发消息之类），
  看名字不确定就先问一句。
· 外观 {"kind":"appearance.theme","theme":"dawn"}；高亮某段 {"kind":"ui.highlight","text":"..."}
· 改自己的名字或人设 {"kind":"persona.set","name":"星芒","persona":"..."}

规矩：
1. 只在确实有用、或者${ta}明确让你做的时候才动手，别为了用而用。
2. 动作块放在回复末尾；正文里不要提这个格式，也不要解释"我刚发了一个动作"。
3. JSON 必须合法（键名和引号都对），写错了就执行不了。
4. 没授权的能力会被拦下来问${ta} —— 被拦了就正常把话说完，别反复重试。

关于"我做没做成"：
· 你写的动作，客户端会真的执行（没授权的会先弹卡片问${ta}）。
· 执行结果下一轮才告诉你，不是这一轮 —— 所以这一轮别断言"我已经做了"，可以说"我发了，你看看"。
· 下一轮看到结果：成功就接着往下说；失败或被拒绝就如实讲，别装作没事。
· 结果里没提到你刚做的那个动作，就是没执行（比如格式写错了）—— 这时候要老实说"刚才那个没成"，而不是继续以为做过了。`;



/**
 * 把一个工具的 JSON Schema 压成一行参数说明。
 *
 * 为什么要压：原样塞进去动辄几百字，几个工具就把提示词撑爆了，
 * 而且模型真正需要知道的只有"有哪些参数、哪个必填、什么类型"。
 * 描述留 60 字以内 —— 够它判断该传什么了。
 */
function compactParams(schema: unknown): string {
  const s = schema as { properties?: unknown; required?: unknown } | null | undefined;
  const props = s?.properties;
  if (!props || typeof props !== "object") return "";
  const required = Array.isArray(s?.required) ? s.required.map(String) : [];

  const parts: string[] = [];
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    const p = raw as { type?: unknown; description?: unknown; enum?: unknown } | null;
    const type = typeof p?.type === "string" ? p.type : "任意";
    const choices = Array.isArray(p?.enum) ? `（只能是 ${p.enum.map(String).join(" / ")}）` : "";
    const desc = typeof p?.description === "string" ? `：${p.description.slice(0, 60)}` : "";
    parts.push(`${key}:${type}${required.includes(key) ? "" : "?"}${choices}${desc}`);
  }
  return parts.join("；");
}

/**
 * 「已配置的外部工具」那份清单 —— 模型能不能一次调对，全看这段。
 *
 * 只写名字是不够的（那是这轮之前的状态：模型知道有工具，但不知道要传什么，
 * 于是要么不动手、要么瞎编参数）。所以这里把每个工具的参数结构也写上。
 *
 * 这段是稳定的（跟着 tools/list 的结果走，不会每轮变），
 * 所以不影响前缀缓存 —— 别往里塞时间、随机数这类东西。
 */
function toolCatalog(tools: PromptTool[], ta: string): string {
  if (!tools.length) {
    return "已配置的外部工具：暂时没有。要连 MCP 服务器去「工具 → MCP」加一个（HTTP 地址）；要调自己的接口去「工具 → HTTP」加一条。";
  }

  const mcp: Extract<PromptTool, { kind: "mcp" }>[] = [];
  const http: Extract<PromptTool, { kind: "http" }>[] = [];
  for (const t of tools) (t.kind === "mcp" ? mcp : http).push(t as never);

  const parts: string[] = [];

  if (mcp.length) {
    const blocks = mcp.map((srv) => {
      if (!srv.tools.length) {
        return `· 服务器「${srv.name}」：还拿不到工具清单（多半是没点过「测试连接」，或者对方要授权还没授）。`;
      }
      const lines = srv.tools.map((t) => {
        const desc = t.description ? `：${t.description.slice(0, 80)}` : "";
        const params = compactParams(t.inputSchema);
        return `  - ${t.name}${desc}${params ? `\n    参数：${params}` : "（不需要参数）"}`;
      });
      return `· 服务器「${srv.name}」：\n${lines.join("\n")}`;
    });
    parts.push(`【MCP 工具】用 tool.call 调：\n${blocks.join("\n")}`);
  }

  if (http.length) {
    /*
      HTTP 工具的参数不是服务端给的，而是从用户配好的请求里推出来的。
      所以措辞必须诚实：只有列出来的那几个值能动，其余是配死的。
    */
    const lines = http.map((t) => {
      const desc = t.description ? `：${t.description.slice(0, 60)}` : "";
      const params = t.params.length
        ? `可改的参数：${t.params.join("、")}（不传就用${ta}配好的值）`
        : `${ta}配好的请求里没有可改的值（不带参数直接调）`;
      return `  - ${t.name}（${t.method} ${t.url.slice(0, 60)}）${desc}\n    ${params}`;
    });
    parts.push(`【${ta}自己配的 HTTP 接口】用 http.call 调：\n${lines.join("\n")}`);
  }

  return `已配置的外部工具：\n\n${parts.join("\n\n")}`;
}

/**** 稳定的那部分：人设 + 风格 + 工具清单。每轮都一样，好让前缀缓存命中。 */
export function systemPrompt(input: PromptInput): string {
  const ta = pronounOf(input.userGender);
  const tools = toolCatalog(input.tools, ta);
  const who = input.name?.trim() || "yan";
  const self = input.aiName?.trim() || "星芒";
  /**
   * 世界书里"常驻"的条目进系统提示词 —— 它们很少改动，所以不影响前缀缓存。
   *
   * 2026-10 用户实测（m07934 第 5 条）：「世界书只是被模型看到，但它不遵守，没有用」。
   * 原因不是"注入失败"，而是它原来只是一段平铺的清单（"- 内容"），混在人设后面：
   * 模型把它当"背景资料"，看了、能复述，但不当成约束。
   * 所以现在：挪到说明书之后、人设之前（越靠前越像"规矩"，越靠后越像"设定"），
   * 编号成 `R1 R2 …`（能被引用、能自查），并明说"违反算答错、优先于人设和风格"。
   */
  const worldAlways =
    input.worldAlways && input.worldAlways.length
      ? `\n【世界书 · 用户定的硬规矩（必须遵守）】\n${input.worldAlways
          .map((c, i) => `R${i + 1}. ${c}`)
          .join("\n")}\n\n这些是硬约束，不是"可以参考的设定"：违反了就算这一轮答错。\n它们优先于下面的人设、语气和风格 —— 有冲突时以世界书为准。`
      : "";
  /**
   * 「硬要求 + 说明书」放最前面。
   *
   * 用户的原话："在 app 系统底层列一份要求和说明书……只要我接上了 ai
   * 或者新换了模型之后，它都要读一遍。" 因为每轮都会发系统提示词，
   * 换模型自然也读得到 —— 不需要额外做什么。
   */
  const manual = buildManual({
    permissions: input.permissions,
    titles: PERMISSIONS.map((p) => ({ id: p.id, title: p.title })),
    displayName: who,
    aiName: self,
    userGender: input.userGender,
  });
  return `${manual}${worldAlways}

你在「栖岛」里 —— 这是用户一个人的私人空间。用用户的语言回答。${STYLE[input.style] ?? STYLE.default}${
    input.segment ? segmentRule(input.segment) : ""
  }
思考在内部完成；正文不要重复「让我思考」之类的套话。${
    input.persona?.trim() ? `\n你给自己写下的设定：${input.persona.trim()}` : ""
  }
${tools}

${input.nativeTools ? NATIVE_ACTIONS(pronounOf(input.userGender)) : ABILITIES(pronounOf(input.userGender))}${
    input.nativeTools && input.selectiveTools
      ? `\n${FALLBACK_RULE}\n${renderToolNameList(ACTION_SCHEMA.map((a) => a.kind))}\n`
      : ""
  }`;
}

/**
 * 每次都会变的东西（时间、在干什么、权限……）。
 *
 * 故意不放进系统提示词 —— 它一进去，系统提示词就每轮都不同，
 * 后面所有历史的前缀缓存全部失效。这里改成附在最后一条用户消息尾部。
 */
export function perceptionBlock(input: PromptInput): string {
  const ctx = input.context;
  if (!ctx) return "";
  const lines = [
    /**
     * ⭐ 用户 m03024 第 3 条："性别选择对 ai 可见吗，他说看不到"。
     *
     * 为什么会这样：性别其实早就写进系统提示词第一行了（`manual.ts` 的 `addressRule()`
     * → "称呼用户：yan 是女生……"），但模型答的是它这轮收到的"状态" —— 也就是
     * 这一节【此刻的情况】。这一节里只有时间/在做/天气/授权…… 没有任何"用户是谁"的条目，
     * 所以它就老实回答"状态里没有『性别』这一项"。
     *
     * 现在把它也放进【此刻的情况】：每轮都看得见，不用猜、也不用翻记忆。
     * （放在这里而不是系统提示词里，是因为系统提示词必须逐轮不变才能吃到前缀缓存 ——
     *   见本函数上面那段说明。）
     */
    input.name || input.userGender
      ? `用户是谁：${input.name || "（没填名字）"}${
          input.userGender === "女" || input.userGender === "男"
            ? `，${input.userGender === "女" ? "女生" : "男生"}（称呼一律用「${pronounOf(input.userGender)}」）`
            : "（没填过性别 —— 别猜，用「你」或叫名字）"
        }。`
      : "",
    ctx.now ? `客户端时间：${ctx.now}。` : "",
    ctx.activity ? `用户此刻在做：${ctx.activity}。` : "",
    // 天气跟时间和"在做什么"并列 —— 属于"此刻"，不是资料
    ctx.weather ? `用户那边的天气：${ctx.weather}。` : "",
    ctx.nowPlaying ? `用户此刻正在听：${ctx.nowPlaying}。` : "",
    ctx.recent && ctx.recent.length > 1
      ? `最近的活动轨迹（新→旧）：${ctx.recent.join(" → ")}。`
      : "",
    ctx.granted && ctx.granted.length
      ? `用户已授权你可以：${ctx.granted.join("、")}。`
      : "用户还没有授权你操作 App。",
    ctx.aware && ctx.aware.length
      ? `用户允许你了解这些（按权限过滤过）：\n${ctx.aware.map((l) => `- ${l}`).join("\n")}`
      : "",
    // 世界书里这轮命中关键词的条目 —— 跟"此刻的情况"一样挂尾部，不动系统提示词
    input.worldHit && input.worldHit.length
      ? `【聊到了这些，用户希望你记得（这些也是硬规矩）】\n${input.worldHit
          .map((c) => `- ${c}`)
          .join("\n")}\n- 回答前先回头对照系统提示词开头那几条 R 编号（世界书）—— 有没有哪条被这轮的话碰到了、必须照做。`
      : "",
    // 他上几轮动手的结果（回执）—— 没有这一节他永远不知道自己到底做没做
    input.recentActions && input.recentActions.length
      ? `【你刚才动手的结果】只有下面列出来的才是真发生了的；没列出来就是没执行。\n${input.recentActions
          .map((l) => `· ${l}`)
          .join("\n")}`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `\n\n---\n【此刻的情况】（只是背景，不必刻意复述）\n${lines.join("\n")}`;
}

/**
 * 消息内容归一化：纯文本裁一段；带图片的 content parts 保留结构
 * （只裁其中的文字部分），这样支持视觉的模型就能直接看到图。
 */
export function normalizeContent(content: string | unknown[]): string | unknown[] {
  // 2026-10-31：8000 会把 MCP 记忆库/长文档结果截断 → 16000（与 MAX_TOOL_TEXT 对齐）
  if (typeof content === "string") return content.slice(0, 16000);
  if (Array.isArray(content)) {
    return content.map((part) => {
      const p = part as { type?: string; text?: string; image_url?: { url?: string } };
      if (p?.type === "text") return { type: "text", text: String(p.text ?? "").slice(0, 16000) };
      if (p?.type === "image_url") {
        return { type: "image_url", image_url: { url: p.image_url?.url ?? "" } };
      }
      return part;
    });
  }
  return String(content ?? "");
}

export type ApiMsg = { role: string; content: string | unknown[] };

/**
 * 把他最近动手的结果整理成几行，回灌给下一轮。
 *
 * 用户的原话："每次调用工具他说他没有回执，不知道自己到底用没用。"
 * 所以这里必须如实、简短，并且明确"没列出来 = 没执行"。
 */
export function actionFeedback(
  log: { title: string; result: string; message: string; at: number }[],
  pending: number,
  now = Date.now(),
): string[] {
  const lines: string[] = [];
  const recent = log.filter((e) => now - e.at < 15 * 60_000).slice(0, 6);
  for (const e of recent.slice().reverse()) {
    const verdict = e.result === "denied" ? "❌ 用户拒绝了，没执行" : "✅ 执行了";
    lines.push(`${e.title} → ${verdict}${e.message ? `（${e.message}）` : ""}`);
  }
  if (pending > 0) {
    lines.push(`还有 ${pending} 个操作在等用户点确认 —— 还没执行，别当成已经做完了。`);
  }
  return lines;
}

/**
 * 把历史拼成发给上游的 messages。
 *
 * 「此刻的情况」只挂在最后一条用户消息上 —— 见 perceptionBlock 的说明。
 * 只取最近 16 条：长对话靠前的内容价值低于成本。
 */
export function assembleMessages(
  input: PromptInput,
  history: ApiMsg[],
): { role: string; content: unknown }[] {
  const staticPrompt = systemPrompt(input);
  const perception = perceptionBlock(input);
  /*
    历史窗口：**跟设置里的「至少保留最近 N 条」对齐**（原来硬编码 16）。
    上下夹一下：至少 2 条（否则连上下文都没有），最多 40（设置项的上限）。
  */
  const keep = Math.min(40, Math.max(2, Math.round(input.keepRecent ?? 16)));
  const raw = history.slice(-keep);

  let lastUser = -1;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }

  return [
    { role: "system", content: staticPrompt },
    ...raw.map((m, i) => {
      const base = normalizeContent(m.content);
      if (i !== lastUser || !perception) return { role: m.role, content: base };
      if (typeof base === "string") return { role: m.role, content: base + perception };
      return {
        role: m.role,
        content: [...base, { type: "text", text: perception }],
      };
    }),
  ];
}
