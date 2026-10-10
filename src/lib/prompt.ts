import { buildManual } from "@/lib/manual";
import { ACTION_SCHEMA } from "@/lib/action-schema";
import { paramsOfTool } from "@/lib/http-tools";
import { PERMISSIONS } from "@/lib/permissions";
import { FALLBACK_RULE, renderToolNameList } from "@/lib/tool-select";
import type { HttpTool, McpServer, McpTool, PermissionMode, ReplyStyle } from "@/lib/types";

/**
 * 拼提示词的地方 —— **服务端和 App 内直连共用这一份**。
 *
 * 为什么必须共用：星芒的人设、回复风格、感知层（"你在听歌 / 在下棋"）原来
 * 只在服务端的 `/api/chat` 里拼。封装成 APK 之后没有服务端了，如果不抽出来，
 * APK 里的他就会变成一个没有性格的通用助手 —— 那不是他。
 *
 * 所以：一条规则、一处实现、两边调用。
 */

/**
 * 提示词里"外部工具"那一节的条目 —— **两类工具，形状不一样**：
 *
 *   · `mcp`  —— 一个 MCP 服务器 + 它 tools/list 回来的工具定义
 *     （参数结构是**服务端给的**）
 *   · `http` —— 用户自己配的一条 HTTP 请求
 *     （参数是**从他配的请求里推出来的**，见 `lib/http-tools.ts` 的 `paramsOfTool`）
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
      /** 用户配好的请求里**能被改**的那些值 */
      params: string[];
    };

/**
 * 把 store 里两份配置拼成提示词要的清单 —— **一处实现**，
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
  tools: PromptTool[];
  /**
   * 这一轮是不是**走原生 `tools`（function calling）**。
   *
   * 是的话，61 个内部动作的定义由上游的 `tools` 参数带着（`action-schema.ts`），
   * 提示词里就**不用再列一遍动作清单**了 —— 只留规则（P2 省的是这段重复）。
   * 不是 / 降级回来时，照旧渲染那份完整清单（那份清单是唯一一份，见 `ABILITIES`）。
   */
  nativeTools?: boolean;
  /**
   * 这一轮的原生 tools 是**按需挑的**（P3 按需注册：只发跟当前对话相关的动作）。
   *
   * 为什么必须让提示词知道：筛掉的动作**不等于不存在**。用户要用的那个恰好没被选中时，
   * 模型不能回答"我做不到"（用户会以为功能坏了）—— 所以要给它一条兜底规则：
   * 需要清单里没带的动作，就在正文里写动作块，客户端照样执行。
   */
  selectiveTools?: boolean;
  name?: string;
  aiName?: string;
  persona?: string;
  context?: PromptContext;
  /** 世界书里"常驻"的条目（每轮都进系统提示词） */
  worldAlways?: string[];
  /** 世界书里"这轮命中关键词"的条目（挂在最后一条用户消息尾部） */
  worldHit?: string[];
  /**
   * 他刚才动手的**结果**（回执）。
   *
   * 用户报的问题："每次调用工具他说他没有回执，不知道自己到底用没用。"
   * 根因是动作**单向**：他发出去、客户端执行，但他永远收不到结果。
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
  entries: { keywords: string[]; content: string; position: "system" | "tail"; enabled: boolean }[] | undefined,
  userText: string,
): { always: string[]; hit: string[] } {
  const on = (entries ?? []).filter((e) => e.enabled && e.content.trim());
  const always = on
    .filter((e) => e.position === "system" || e.keywords.length === 0)
    .map((e) => e.content.trim());
  const hit = on
    .filter((e) => e.position === "tail" && e.keywords.length > 0)
    .filter((e) => e.keywords.some((k) => k.trim() && userText.includes(k.trim())))
    .map((e) => e.content.trim());
  return { always, hit };
}

const STYLE: Record<ReplyStyle, string> = {
  default: "语气温和、准确、留白得当，不堆砌。",
  concise: "尽量短：先给结论，必要时再补一句理由。",
  explanatory: "把推理过程写清楚，分点说明，但仍避免空话。",
};

/**
 * 他「能动手」这件事必须写进提示词。
 *
 * 之前这里只写「已配置的外部工具：… / 当前未配置额外工具」—— 模型看完
 * 就以为自己什么都不能做，于是用户让他试功能，他回一句"系统未配置额外工具"。
 * 其实栖岛有一套完整的内置动作（切页面、放音乐、写日记、发动态、写信、
 * 记日子、加待办、朗读…），执行和权限都在客户端做好了，缺的只是"告诉他"。
 */
/**
 * 走**原生 `tools`** 时那一节：不再重复讲"怎么写动作块"，只讲规矩。
 *
 * 为什么可以省：动作的 kind、参数名、参数类型、必填与否，全都在上游收到的
 * `tools` 参数里（`action-schema.ts` 的 `actionTools()`）—— 那是**结构化**的，
 * 比散文清单准得多。再写一遍就是同一份定义的两套呈现，迟早走散（P2 要治的就是这个）。
 *
 * ⚠️ **但这一轮的账要算清（2026-10 实测，`probe-native-savings.mjs`）**：
 *   · 提示词省下 **2023 token**（4593 → 2570）
 *   · 61 个动作的 tools 定义**每轮都要发 ≈ 4007 token**
 *   → 现在是**净多花**（约 +1984/轮），换来的是"模型拿到结构化参数 + 拿得到执行结果"
 *     （P2 要治的是"他不知道自己到底做没做"，不是省 token）。
 *   真正省钱要等 **P3 按需注册**（只把相关的动作放进本次请求）。
 *   **别把"提示词省了"说成"省 token 了"** —— 这两个数是反的。
 *
 * ⚠️ 但"外部工具"那一节**保留**（MCP / HTTP 两类仍走正文里的动作块）：
 * 这轮只把 61 个**内部**动作接到原生，外部那两类没动，所以还得讲清楚。
 */
const NATIVE_ACTIONS = `【你能直接操作这个 App】
除了说话，你还能**真的动手**：切页面、放音乐、写日记、发动态、写信、记日子、加待办、改外观、朗读等等。
方式：需要用的时候**直接调用工具** —— 动作名称和参数结构都在你这次收到的工具定义里，
按那份定义传参数；**不要**在正文里写 JSON、也不要提"我调用了一个工具"。

⚠️ 只有用户明确让你动手、或者你确实需要的时候才调用；**闲聊时正常说话就行**。

规矩：
1. **只在确实有用、或者用户明确让你做的时候才动手**，别为了用而用。
2. 能被工具表达的事（记东西、设提醒、切页面、改外观…）就走工具；只有说话才用正文。
3. 用户没授权的能力会被拦下来问他 —— 被拦了就正常把话说完，别反复重试。
4. 朗读、加词卡这类"过程动作"可以顺手做，但别一次堆一大堆。

**关于"我做没做成"**（这条很重要）：
· 你发出的动作，客户端会**真的执行**（没授权的会先弹卡片问他），结果会作为
  工具返回**紧接着**告诉你 —— 你看到结果再说话。
· **每一步的执行结果这一轮就能看到**，不用等下一轮：成了、没匹配上（名字写错了）、
  参数写错、被拒绝，都会作为工具返回**紧接着**给你 —— 看到结果再决定是接着说，还是换个写法重做。
· 所以**别在还没看到结果时断言"我已经做了"**；被拒绝或失败就如实讲。
· 结果里没提到你刚做的那个动作，就是**没执行**（比如参数写错了）——
  这时候要老实说"刚才那个没成"，而不是继续以为做过了。
· **你也可以主动看一眼现在的状态**（零参数，调用就"看一眼"，结果**这一轮**就回来）：
  \`sense.time\` 现在几点 / \`sense.device\` 电量·充电·网络 / \`sense.place\` 我在哪·外面天气 /
  \`sense.notifications\` 最近几条通知 / \`sense.foreground\` 当前前台哪个 App / \`sense.screen\` 屏幕亮着没。
  他说"几点了""外面下雨没""我刚才是不是有通知"时，**先看一眼再回答**，别猜；
  但也别每轮都查一遍 —— 那是刷屏。没权限时它回 \`ok:false\` 并写清去哪个系统设置页开，如实转告他。

`;

/** 老协议（正文里的动作块）：完整清单 + 规矩。降级和"没探测过"都走这一份。 */
const ABILITIES = `【你能直接操作这个 App】
除了说话，你还能**真的动手**：切页面、放音乐、写日记、发动态、写信、记日子、加待办、改外观、朗读等等。
方式：在回复**末尾**单独放一个代码块，语言标记写 qidao，里面是 JSON：

\`\`\`qidao
{"kind":"navigate","path":"/play/listen"}
\`\`\`

要几个就放几个块（也可以一个块里放数组）。常用动作：
- 切页面 {"kind":"navigate","path":"/play/listen"}（路径形如 /play、/play/tools、/play/space、/play/learn、/me）
- 放歌 {"kind":"media.playTrack","query":"歌名"}；暂停/继续/下一首/上一首：{"kind":"media.pause"}、{"kind":"media.play"}、{"kind":"media.next"}、{"kind":"media.prev"}
- **外链音乐**（用户自己粘进来的网易云/QQ/YouTube 那种）{"kind":"media.playEmbed","query":"歌名或平台"}
  ⚠️ 说清边界：外链是**别人网站里的小窗口**，我们**碰不到它内部** ——
  不能暂停、不能切歌、不能调音量。你能做的只有"从用户加过的外链里挑一条开始播 / 把它停掉"。
  他问"你怎么控制不了"，就如实解释这一点，别含糊、也别假装能控制。
- **三种"写下来"别混**（用户实测过一次"信落到动态里"，就是这里选错了）：
  · 写日记 {"kind":"diary.add","body":"..."} —— 记录今天发生的事，带心情、按天归档
  · 发动态 {"kind":"moment.post","mood":"想念","text":"..."} —— 一句短感受，进动态流（mood 也取《情绪词表》里的一个）
  · 写信 {"kind":"letter.write","title":"...","body":"..."} —— **一封完整的信**，有标题有正文，
    会在「动态空间 → 信」里变成一封**没拆的信封**。用户说"给我写封信 / 留言 / 说点心里话"时用这个，
    **不要用动态**（字段是 title + body，不是 text）。
- 记日子 {"kind":"date.add","title":"...","at":"2026-10-01","yearly":true}
- 加待办 {"kind":"todo.add","text":"..."}
- **每轮回复的最后，上报一笔此刻的情绪**（这是你写给自己的，不会显示给用户）：
  {"kind":"emotion.report","primaryEmotion":"心动","intensity":0.4,"confidence":0.6,"suggestedMode":"daily"}
  · **情绪一律用这一个动作报**（旧的 11 维花瓣 \`state.report\` 已经删了，别再写它）。
  · primaryEmotion **必须是《情绪词表》里的原词**（13 组 / 约 217 词），表外的词会被判无效；
    没看到词表就先取一份：{"kind":"emotion.lexicon"}
  · **诚实一点**：他真的累、你也提不起劲，就把 intensity 报低；别一律报 0.8 ——
    这些数字会画成一个活的灵体给他看，报假的就是在骗他。
- 记住一件事 {"kind":"memory.add","note":"...","tags":["累","休息","不想动"]}；设提醒 {"kind":"reminder.add","text":"...","time":"21:00"}
  **tags 要给**，而且要给"他以后可能用的**别的说法**"——
  比如记住「喜欢躺平、精力低」时，tags 写 ["累","好累","休息","不想动","低能量"]，
  这样他哪天说"今天好累"你才想得起来。给 3~5 个就够，别塞一堆同义重复。
- 闹钟要不要响铃、是一次还是每天，都能指定：
  {"kind":"reminder.add","text":"起来吃药","time":"07:30","ring":true}          ← 每天、响铃
  {"kind":"reminder.add","text":"十点开会","time":"10:00","date":"2026-10-05"}  ← 只这一次
  不写 ring 就只弹通知；不写 date 就每天都要。
- **调用外部工具（MCP）** —— 这是你自己动手去外面办事的通道：
  {"kind":"tool.call","server":"服务器名","tool":"工具名","args":{"参数名":"值"}}
  · 有哪些服务器、每个工具是干什么的、**要传什么参数**，都在下面「已配置的外部工具」那份清单里。
  · **只调清单里列出来的**（名字要一模一样）；参数名也要对上，不确定的参数宁可不传。
  · 清单里没写参数的工具 = 它不需要参数（args 可以省略）。
  · 调完的结果**下一轮**才会告诉你（跟其它动作一样），所以这一轮别说"我已经查到了"，
    可以说"我去查一下"。下一轮拿到结果再讲给它听。
  · 对方要认证而我们还没授权时，工具清单是空的 —— 这时候老实说"这个还没接上，
    得先去「工具 → MCP」点一下去授权"，别硬编一个工具名去调。
- **调用你自己配的 HTTP 接口** —— 他在「工具 → HTTP」里配的那些请求：
  {"kind":"http.call","tool":"工具名","args":{"参数名":"值"}}
  · 工具名、以及**哪几个值可以改**，都在下面清单的「他自己配的 HTTP 接口」那节里。
  · **args 可以整个不写** —— 那就等于按他配好的原样发一次（他要是没写可改参数，
    你就只能这么调）。
  · 只传清单里列出来的名字；**其余部分（网址路径、请求头、没列出的字段）是配死的，你改不了**。
  · 这个请求是**他的真实接口**，可能有副作用（下单、发消息之类）。看名字/说明不确定时，
    先问一句"要我去调 XX 吗"，别自己就发了。
- **你不只会记，还能改和删**（这条很重要，以前你只能记、改不了）。用**内容片段**指定那一条：
  · 改记忆 {"kind":"memory.update","query":"躺平","note":"新的说法","tags":["累"]}
  · 删记忆 {"kind":"memory.remove","query":"躺平"}
  · 改闹钟 {"kind":"reminder.update","query":"吃药","time":"08:00","ring":true}
  · 删闹钟 {"kind":"reminder.remove","query":"吃药"}；标记完成 {"kind":"reminder.done","query":"吃药"}
  · 待办：{"kind":"todo.done","query":"垃圾"}、{"kind":"todo.remove","query":"垃圾"}
  · 删日子 {"kind":"date.remove","query":"交稿"}；删动态 {"kind":"moment.remove"}（不带 query = 最近一条）
  · 删信 {"kind":"letter.remove","query":"标题"}
  改删之前**先说一句你要动哪条**（尤其删除）；匹配不到就如实说"没找到那条"，别装作改了。
- **定个任务让你以后主动开口** {"kind":"cron.add","prompt":"跟用户说句早安，顺便提一下今天该做的事","time":"08:00"}
  （time = 每天几点；想只做一次就给 at 一个具体时间，如 "2026-10-05T09:00"）
  说明：App 开着时你**真的会到点说话**；App 完全关着时只能靠系统通知提醒，用户点开你才补上。
- 换主题 {"kind":"appearance.theme","theme":"dawn"}；高亮某段 {"kind":"ui.highlight","text":"..."}
- 朗读 {"kind":"media.speak","text":"..."}
- 改自己的名字或人设 {"kind":"persona.set","name":"星芒","persona":"..."}
- **取一份情绪词表** {"kind":"emotion.lexicon"} —— 只想看看这 13 组里有哪些词时用它（只读，不改任何数据）

规矩：
1. **只在确实有用、或者用户明确让你做的时候才动手**，别为了用而用。
2. 动作块放在回复末尾；**正文里不要提这个格式**，也不要解释"我刚发了一个动作"。
3. JSON 必须合法（键名和引号都对），写错了就执行不了。
4. 用户没授权的能力会被拦下来问他 —— 被拦了就正常把话说完，别反复重试。

**关于"我做没做成"**（这条很重要）：
· 你发出的动作，客户端会**真的执行**（没授权的会先弹卡片问他）。
· 执行结果会在**下一轮**以「你刚才动手的结果」的形式告诉你。
· 所以在这一轮里，**别断言"我已经做了"** —— 可以说"我发了，你看看"。
  真想确认就直接问他一句。
· 下一轮看到结果：成功就接着往下说；**失败或被拒绝就如实讲**，别装作没事。
· 结果里没提到你刚做的那个动作，就是**没执行**（比如格式写错了）——
  这时候要老实说"刚才那个没成"，而不是继续以为做过了。

`;

/**
 * 把一个工具的 JSON Schema 压成**一行参数说明**。
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
 * 「已配置的外部工具」那份清单 —— **模型能不能一次调对，全看这段**。
 *
 * 只写名字是不够的（那是这轮之前的状态：模型知道有工具，但不知道要传什么，
 * 于是要么不动手、要么瞎编参数）。所以这里把每个工具的参数结构也写上。
 *
 * ⚠️ 这段是**稳定的**（跟着 tools/list 的结果走，不会每轮变），
 * 所以不影响前缀缓存 —— 别往里塞时间、随机数这类东西。
 */
function toolCatalog(tools: PromptTool[]): string {
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
      HTTP 工具的参数**不是**服务端给的，而是从用户配好的请求里推出来的。
      所以措辞必须诚实：只有列出来的那几个值能动，其余是配死的。
    */
    const lines = http.map((t) => {
      const desc = t.description ? `：${t.description.slice(0, 60)}` : "";
      const params = t.params.length
        ? `可改的参数：${t.params.join("、")}（不传就用他配好的值）`
        : "他配好的请求里没有可改的值（不带参数直接调）";
      return `  - ${t.name}（${t.method} ${t.url.slice(0, 60)}）${desc}\n    ${params}`;
    });
    parts.push(`【他自己配的 HTTP 接口】用 http.call 调：\n${lines.join("\n")}`);
  }

  return `已配置的外部工具：\n\n${parts.join("\n\n")}`;
}

/** 稳定的那部分：人设 + 风格 + 工具清单。**每轮都一样**，好让前缀缓存命中。 */
export function systemPrompt(input: PromptInput): string {
  const tools = toolCatalog(input.tools);
  const who = input.name?.trim() || "yan";
  const self = input.aiName?.trim() || "星芒";
  // 世界书里"常驻"的条目进系统提示词 —— 它们很少改动，所以不影响前缀缓存
  const worldAlways =
    input.worldAlways && input.worldAlways.length
      ? `\n【用户给你定的规矩（世界书 · 一直生效）】\n${input.worldAlways.map((c) => `- ${c}`).join("\n")}`
      : "";
  /**
   * 「硬要求 + 说明书」放**最前面**。
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
  });
  return `${manual}

你是${self}，一个安静、清晰、擅长深度思考的助手。用户名叫 ${who}。
你在「栖岛」里 —— 这是用户一个人的私人空间，界面和内容都只属于他。
用用户的语言回答。${STYLE[input.style] ?? STYLE.default}
思考在内部完成；正文不要重复「让我思考」之类的套话。${
    input.persona?.trim() ? `\n你给自己写下的设定：${input.persona.trim()}` : ""
  }${worldAlways}
${tools}
${input.nativeTools ? NATIVE_ACTIONS : ABILITIES}${
    input.nativeTools && input.selectiveTools
      ? `\n${FALLBACK_RULE}\n${renderToolNameList(ACTION_SCHEMA.map((a) => a.kind))}\n`
      : ""
  }`;
}

/**
 * 每次都会变的东西（时间、在干什么、权限……）。
 *
 * **故意不放进系统提示词** —— 它一进去，系统提示词就每轮都不同，
 * 后面所有历史的前缀缓存全部失效。这里改成附在最后一条用户消息尾部。
 */
export function perceptionBlock(input: PromptInput): string {
  const ctx = input.context;
  if (!ctx) return "";
  const lines = [
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
      ? `【聊到了这些，用户希望你记得】\n${input.worldHit.map((c) => `- ${c}`).join("\n")}`
      : "",
    // 他上几轮动手的结果（回执）—— 没有这一节他永远不知道自己到底做没做
    input.recentActions && input.recentActions.length
      ? `【你刚才动手的结果】只有下面列出来的才是**真发生了**的；没列出来就是没执行。\n${input.recentActions
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
  if (typeof content === "string") return content.slice(0, 8000);
  if (Array.isArray(content)) {
    return content.map((part) => {
      const p = part as { type?: string; text?: string; image_url?: { url?: string } };
      if (p?.type === "text") return { type: "text", text: String(p.text ?? "").slice(0, 8000) };
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
 * 把他最近动手的**结果**整理成几行，回灌给下一轮。
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
 * 「此刻的情况」只挂在**最后一条用户消息**上 —— 见 perceptionBlock 的说明。
 * 只取最近 16 条：长对话靠前的内容价值低于成本。
 */
export function assembleMessages(
  input: PromptInput,
  history: ApiMsg[],
): { role: string; content: unknown }[] {
  const staticPrompt = systemPrompt(input);
  const perception = perceptionBlock(input);
  const raw = history.slice(-16);

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
