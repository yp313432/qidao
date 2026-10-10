import type { AppAction, PermissionId } from "@/lib/types";
import { moodDisplay } from "@/lib/emotion-lexicon";

/**
 * 每类动作落在哪项权限上（权限清单见 lib/permissions.ts）。
 *
 * ⚠️ 是 **Partial**：**没有映射的动作 = 不需要授权，闸门直接放行**
 * （现在只有 `emotion.report` / `emotion.lexicon` 这两个 —— 见下面那一段注释）。
 * 加新动作时忘了在这里挂权限 = 它变成"免确认直接执行"，所以宁可在这里写清楚。
 */
export const ACTION_PERMISSION: Partial<Record<AppAction["kind"], PermissionId>> = {
  navigate: "navigate",
  "media.play": "media",
  "media.pause": "media",
  "media.next": "media_track",
  "media.prev": "media_track",
  "media.volume": "media_volume",
  "media.seek": "media_seek",
  "media.playTrack": "media_search",
  /**
   * ⚠️ 挂**现役的 `media`**（跟 `media.play` 同一道闸）。
   *
   * 2026-10 修：这里原来写的是 `media_play` —— 那是**幽灵权限**（`permissions.ts`
   * 里根本没有这个 id，历史上叫 `media`）。后果有两个，都是用户能感觉到的：
   *   · 闸门读不到这一项 → 永远按 `ask` 走，用户点过「以后都允许」也不生效；
   *   · `buildContext()` 里"已授权"那份清单按 ACTION_PERMISSION 反查，
   *     于是 AI **永远不知道**自己已经被允许播外链。
   * 不新增权限 id、也不改名（改 id 等于作废用户已经点过的那些授权）。
   */
  "media.playEmbed": "media",
  "appearance.theme": "appearance",
  "appearance.font": "appearance",
  "appearance.textColor": "appearance",
  "ui.highlight": "highlight",
  "ui.scroll": "scroll_to",
  "ui.panel": "open_panel",
  "ui.model": "switch_model",
  "ui.style": "switch_model",
  "ui.toggle": "toggle_feature",
  "chat.rename": "rename_chat",
  "chat.pin": "rename_chat",
  "docs.write": "docs_write",
  "docs.archive": "archive_chat",
  "learn.addCard": "learn_card",
  "reminder.add": "reminder",
  "cron.add": "scheduled_job",
  /**
   * ——— 情绪这两个动作**不挂权限**（2026-10 用户要求删掉"情绪权限"那一项）———
   *
   * 为什么可以直接删：`emotion.report` 已经**常驻**（`tool-select.ts` 的常驻集合）、
   * 11 维花瓣与 `state.report` 早已退场，`emotion.lexicon` 只是"取一份词表看看" ——
   * 两者都是 L0 静默、无副作用（写本机的情绪记录），给他看的那道闸没有意义。
   *
   * ⚠️ 删掉的是权限**这一项**，不是动作。这两个 kind 在这里没有映射 = **无权限直接执行**
   * （`action-gate.tsx`：没有权限的动作不弹卡片、直接放行）—— 所以情绪上报不会被卡住。
   * ⚠️ 别再给它们新开一项权限：那等于把"他给自己记一笔"重新变成"要用户再点一次同意"。
   */
  "memory.add": "memory",
  "persona.set": "persona",
  "play.gobang": "gobang_play",
  "play.truth": "truth_pick",
  "play.recordResult": "score",
  "learn.openReading": "pick_reading",
  "learn.speak": "read_aloud",
  "learn.removeCard": "wordbook",
  "media.speak": "tts",
  "ambience.play": "ambience",
  "media.import": "media_import",
  "chat.delete": "delete_chat",
  "docs.delete": "delete_doc",
  "diary.deleteLast": "delete_diary",
  "media.clear": "clear_music",
  "data.reset": "reset_all",
  "settings.setUpstream": "edit_upstream",
  "moment.post": "moment_post",
  "letter.write": "letter_write",
  "date.add": "date_add",
  "todo.add": "todo_add",
  "diary.add": "diary",
  "chat.new": "chat",
  // 改与删：落在各自功能原有的权限上（不新开权限）
  "memory.update": "memory",
  "memory.remove": "memory",
  "reminder.update": "reminder",
  "reminder.remove": "reminder",
  "reminder.done": "reminder",
  "todo.done": "todo_add",
  "todo.remove": "todo_add",
  "date.remove": "date_add",
  "moment.remove": "moment_post",
  "letter.remove": "letter_write",
  // 调外部 MCP 工具：落在「调用 MCP 工具」这项权限上（L2，默认要问一下）
  "tool.call": "mcp_tools",
  // 调自己配的 HTTP 工具：落在「调用 HTTP 工具」那项上（另一项权限，可以分别放行）
  "http.call": "http_tools",
  /**
   * ——— 搜网页 / 读网页正文（2026-10 新增）———
   *
   * 两个动作挂**同一项** `web_search`（L2，默认每次问一下）。
   * 为什么不给 `web.fetch` 单开一项：它们是一件事的两半（先搜到、再读进去），
   * 用户点两次同意换不来任何额外保护 —— 真要说风险，两者的风险是同一档
   * （都是"往外发一个请求、拿回公开网页"）。
   */
  "web.search": "web_search",
  "web.fetch": "web_search",
  /**
   * ——— 主动感知（"他自己调一下，看一眼现在的状态"）———
   *
   * 口径（跟别的动作一致）：**能让他知道什么**落在 sense 组那几项上。
   *   · 时间 / 电量 / 网络 → `read_device`（L0，默认放行 —— 那就是"看一眼"）
   *   · 在哪 / 外面天气   → `see_location`（L2，跟"此刻的情况"里那份定位同一道闸，
   *     所以他要看位置时会弹一次确认卡片；用户点「以后都允许」之后就畅通了）
   *   · 屏幕亮没亮        → `read_screen`（L0；网页版拿不到，装了 App 才有）
   *   · 最近的通知        → `read_notifications`（L2 + 系统「通知使用权」）
   *   · 前台是哪个 App    → `read_usage`（L2 + 系统「使用情况访问」）
   */
  "sense.time": "read_device",
  "sense.device": "read_device",
  "sense.place": "see_location",
  "sense.screen": "read_screen",
  "sense.notifications": "read_notifications",
  "sense.foreground": "read_usage",
};

const THEME_LABEL: Record<string, string> = { dawn: "黎明", dusk: "黄昏", ink: "墨色" };

/** 把一个动作翻译成给人看的一句话（审批弹窗 / 日志都用它）。 */
export function actionTitle(action: AppAction): string {
  switch (action.kind) {
    case "navigate":
      return `切换到页面 ${action.path}`;
    case "media.play":
      return "开始播放音乐";
    case "media.pause":
      return "暂停音乐";
    case "media.next":
      return "切到下一首";
    case "media.prev":
      return "切到上一首";
    case "media.volume":
      return `把音量调到 ${Math.round(action.value * 100)}%`;
    case "media.seek": {
      const m = Math.floor(action.seconds / 60);
      const s = String(Math.floor(action.seconds % 60)).padStart(2, "0");
      return `跳到 ${m}:${s}`;
    }
    case "media.playTrack":
      return `播放「${action.query}」`;
    case "media.playEmbed":
      return `播外链音乐${action.query ? `（找「${action.query}」）` : ""}`;
    case "appearance.theme":
      return `把主题换成「${THEME_LABEL[action.theme] ?? action.theme}」`;
    case "appearance.font":
      return `把正文字体换成「${action.font}」`;
    case "appearance.textColor":
      return `把文字颜色改成 ${action.color}`;
    case "ui.highlight":
      return `高亮页面上的「${action.text.slice(0, 14)}」`;
    case "ui.scroll":
      return `滚动到「${action.text.slice(0, 14)}」`;
    case "ui.panel":
      return action.panel === "lyrics" ? "打开歌词面板" : "打开对话列表";
    case "ui.model":
      return `把模型切成「${action.model}」`;
    case "ui.style":
      return `把回复风格改成「${action.style}」`;
    case "ui.toggle":
      return `${action.on ? "打开" : "关闭"}「${action.feature}」`;
    case "chat.rename":
      return `把这个对话改名为「${action.title.slice(0, 16)}」`;
    case "chat.pin":
      return "把这个对话置顶";
    case "docs.write":
      return `新建文档「${action.title.slice(0, 16)}」`;
    case "docs.archive":
      return `把当前对话存成文档${action.title ? `「${action.title.slice(0, 12)}」` : ""}`;
    case "learn.addCard":
      return `把「${action.word}」加进生词本`;
    case "reminder.add":
      return `设一个提醒：${action.text.slice(0, 16)}${action.time ? `（${action.time}）` : ""}`;
    case "cron.add":
      return `设一个定时任务：${action.prompt.slice(0, 14)}${action.time ? `（每天 ${action.time}）` : ""}`;
    case "emotion.report": {
      // 词表外的词在 actions.ts 会被退回 —— 这里只负责把那笔写成人话
      const secondary = (action.secondaryEmotions ?? []).slice(0, 2);
      const pct = Math.round(Number(action.intensity ?? 0.5) * 100);
      return `上报一笔情绪：${action.primaryEmotion}${
        secondary.length ? `（+${secondary.join("、")}）` : ""
      } · 强度 ${pct}%`;
    }
    case "emotion.lexicon":
      return "取一份情绪词表看看";
    case "sticker.send":
      return "发一张表情包";
    case "sticker.groups":
      return "看一眼表情分组";
    case "memory.add":
      return `记住：${action.note.slice(0, 20)}`;
    case "persona.set":
      return action.name
        ? `把自己改名为「${action.name}」`
        : "调整他自己的设定";
    case "play.gobang":
      return "陪你下一局五子棋";
    case "play.truth":
      return "抽一个真心话问题";
    case "play.recordResult":
      return `记一笔战绩（${action.result}）`;
    case "learn.openReading":
      return "打开一篇阅读材料";
    case "learn.speak":
    case "media.speak":
      return `朗读「${action.text.slice(0, 12)}」`;
    case "ambience.play":
      return "播放 / 停止氛围音";
    case "media.import":
      return `从网址导入音乐（${action.url.slice(0, 40)}）`;
    case "learn.removeCard":
      return `把「${action.word}」移出生词本`;
    case "chat.delete":
      return "删掉当前这个对话";
    case "docs.delete":
      return `删掉文档「${action.title.slice(0, 16)}」`;
    case "diary.deleteLast":
      return "删掉最近一条日记";
    case "media.clear":
      return "清空整个音乐库";
    case "data.reset":
      return "清空全部数据、恢复默认设置";
    case "settings.setUpstream":
      return "修改上游地址 / API Key";
    case "moment.post":
      // 心情取新词表的中文名（`emotion-lexicon` 一处定义），别在这儿再抄一份
      return `发一条动态（${moodDisplay(action.mood).label}）：${action.text.slice(0, 18)}`;
    case "letter.write":
      return `写一封信：${action.title.slice(0, 18)}`;
    case "date.add":
      return `记一个日子：${action.title.slice(0, 16)}（${action.at}）`;
    case "todo.add":
      return `记一件待办：${action.text.slice(0, 18)}`;
    case "diary.add":
      return `写一条日记：${action.body.slice(0, 18)}${action.body.length > 18 ? "…" : ""}`;
    case "chat.new":
      return "新建一个对话";
    case "memory.update":
      return `改一条记忆${action.note ? `：${action.note.slice(0, 16)}` : "的标签"}`;
    case "memory.remove":
      return `删掉记忆${action.query ? `「${action.query.slice(0, 14)}」` : "（最近一条）"}`;
    case "reminder.update":
      return `改闹钟/提醒：${action.query.slice(0, 16)}`;
    case "reminder.remove":
      return `删掉闹钟/提醒：${action.query.slice(0, 16)}`;
    case "reminder.done":
      return `把闹钟/提醒标记为完成：${action.query.slice(0, 16)}`;
    case "todo.done":
      return `把待办勾掉：${action.query.slice(0, 16)}`;
    case "todo.remove":
      return `删掉待办：${action.query.slice(0, 16)}`;
    case "date.remove":
      return `删掉日子：${action.query.slice(0, 16)}`;
    case "moment.remove":
      return `删掉动态${action.query ? `「${action.query.slice(0, 14)}」` : "（最近一条）"}`;
    case "letter.remove":
      return `删掉信${action.query ? `「${action.query.slice(0, 14)}」` : "（最近一封）"}`;
    case "tool.call":
      return `调用外部工具「${action.tool}」${action.server ? `（服务器：${action.server.slice(0, 20)}）` : ""}`;
    case "http.call":
      return `调用你配的 HTTP 工具「${action.tool}」${
        action.args && Object.keys(action.args).length ? `（带参数：${Object.keys(action.args).join("、")}）` : ""
      }`;
    // 联网：审批卡片/日志里一眼看得出他"去外面干了什么"
    case "web.search":
      return `去网上搜「${action.query.slice(0, 20)}」`;
    case "web.fetch":
      return `读一个网页：${action.url.slice(0, 60)}`;
    // 主动感知：标题写成人话（审批卡片/日志里一眼看得出他"看了一眼什么"）
    case "sense.time":
      return "看一眼现在的时间";
    case "sense.device":
      return "看一眼电量与网络";
    case "sense.place":
      return "看一眼位置与天气";
    case "sense.notifications":
      return "看一眼最近的通知";
    case "sense.foreground":
      return "看一眼前台在用什么 App";
    case "sense.screen":
      return "看一眼屏幕状态";
  }
}
