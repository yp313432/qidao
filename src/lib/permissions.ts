import type { PermissionMode } from "./types";

/**
 * AI 权限目录 —— 全站唯一的权限真源。
 *
 * 分级（risk）：
 *   L0 只读感知      → 默认可放开
 *   L1 无害操作      → 默认每次询问
 *   L2 写入内容      → 默认每次询问
 *   L3 破坏性        → 即使设为「允许」也要再确认一次
 *   L4 密钥/隐私外传 → 永久不交给模型
 *
 * status：
 *   ready     已经真的能用
 *   partial   部分能用（界面里会说明差什么）
 *   todo      还没实现，但偏好可以先存着
 *   system    网页版拿不到，封装成 App 后才有
 *   forbidden 永不授权
 */

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export type PermStatus = "ready" | "partial" | "todo" | "system" | "forbidden" | "needs_ai";
export type GroupId =
  | "sense"
  | "ui"
  | "write"
  | "media"
  | "play"
  | "learn"
  | "tools"
  | "danger"
  | "system";

export type PermissionDef = {
  id: string;
  title: string;
  hint: string;
  risk: RiskLevel;
  status: PermStatus;
  group: GroupId;
};

export const GROUPS: { id: GroupId; title: string; note: string }[] = [
  { id: "sense", title: "感知 · 他能知道什么", note: "只读，不改变任何东西。" },
  { id: "ui", title: "界面与外观", note: "他能动你眼前的界面。" },
  { id: "write", title: "内容写入", note: "他会往你的资料里写东西。" },
  { id: "media", title: "媒体", note: "音乐与朗读。" },
  { id: "play", title: "玩乐与陪伴", note: "陪玩、出题、记分。" },
  { id: "learn", title: "学习", note: "出题批改、生词本、阅读材料。" },
  { id: "tools", title: "外部工具", note: "另一条通道：走 MCP / HTTP 去调外面的东西。" },
  {
    id: "danger",
    title: "破坏性与高危",
    note: "L3 即使设成「允许」也会再问你一次；L4 永久禁止交给模型。",
  },
  { id: "system", title: "系统级（封装成 App 后）", note: "网页版拿不到，先占位。" },
];

export const PERMISSIONS: PermissionDef[] = [
  // ---------------- 感知（L0） ----------------
  { id: "read_context", title: "知道我在干什么", hint: "当前页面、正在听的歌、在玩什么", risk: "L0", status: "ready", group: "sense" },
  { id: "read_trail", title: "最近的活动轨迹", hint: "刚才这一段时间你干了什么", risk: "L0", status: "ready", group: "sense" },
  { id: "read_history", title: "完整对话历史", hint: "不只最近几条，能回溯和检索", risk: "L0", status: "ready", group: "sense" },
  { id: "read_docs", title: "文档库", hint: "你存过哪些笔记", risk: "L0", status: "ready", group: "sense" },
  { id: "read_diary", title: "日记", hint: "你的情绪记录（较敏感）", risk: "L0", status: "ready", group: "sense" },
  { id: "read_thinking", title: "思考档案", hint: "他自己过去的推理记录", risk: "L0", status: "ready", group: "sense" },
  { id: "read_music", title: "音乐库与听歌统计", hint: "你有什么歌、常听什么（不含文件内容）", risk: "L0", status: "ready", group: "sense" },
  { id: "read_games", title: "游戏战绩", hint: "五子棋输赢、下了几手", risk: "L0", status: "ready", group: "sense" },
  { id: "read_learn", title: "学习进度", hint: "看过哪些词、看了多少次", risk: "L0", status: "ready", group: "sense" },
  { id: "read_device", title: "设备与环境", hint: "时区、语言、屏幕、在线状态", risk: "L0", status: "ready", group: "sense" },
  { id: "read_settings", title: "当前设置", hint: "主题、模型、字体等", risk: "L0", status: "ready", group: "sense" },

  // ---------------- 界面与外观（L1） ----------------
  { id: "navigate", title: "切换页面", hint: "它可以带你跳到某个页面", risk: "L1", status: "ready", group: "ui" },
  { id: "appearance", title: "改外观", hint: "主题、字体、文字颜色", risk: "L1", status: "ready", group: "ui" },
  { id: "highlight", title: "高亮 / 聚焦元素", hint: "「看这里」，手把手引导", risk: "L1", status: "ready", group: "ui" },
  { id: "open_panel", title: "打开弹窗 / 面板", hint: "帮你打开歌词面板、对话列表", risk: "L1", status: "ready", group: "ui" },
  { id: "scroll_to", title: "滚动定位", hint: "滚到某条消息、某段歌词", risk: "L1", status: "ready", group: "ui" },
  { id: "switch_model", title: "切模型与回复风格", hint: "改他自己的行为方式", risk: "L1", status: "ready", group: "ui" },
  { id: "state_report", title: "给自己记一笔状态", hint: "每轮回复时顺手记下心情/精力/想念（只存本机，用来画波浪线）", risk: "L0", status: "ready", group: "ui" },
  /**
   * 定位属于**感知**（他"看得到"），不是"动手"，所以放 sense 组。
   * 用户问："定位权限是不是也没列出来" —— 对，之前确实不在列表里：
   * 它原来只是「我的 → 定位」里的一个设置，AI 权限页看不到。
   * 现在两处都能管：设置里那个开关是"要不要去拿"，这里是"要不要给他看"。
   */
  { id: "see_location", title: "知道你在哪", hint: "把当前位置的地名放进「此刻的情况」（会发给你接的那家 AI）", risk: "L2", status: "ready", group: "sense" },
  { id: "toggle_feature", title: "开关界面功能", hint: "思考链显示、朗读、提醒等", risk: "L1", status: "ready", group: "ui" },
  { id: "rename_chat", title: "重命名 / 置顶对话", hint: "帮你整理对话", risk: "L1", status: "ready", group: "ui" },

  // ---------------- 内容写入（L2） ----------------
  { id: "diary", title: "写日记", hint: "往你的日记里加一条", risk: "L2", status: "ready", group: "write" },
  { id: "chat", title: "新建对话", hint: "开一个新话题", risk: "L2", status: "ready", group: "write" },
  { id: "docs_write", title: "新建 / 编辑文档", hint: "帮你写笔记", risk: "L2", status: "ready", group: "write" },
  { id: "archive_chat", title: "把对话存成文档", hint: "归档一段对话", risk: "L2", status: "ready", group: "write" },
  { id: "learn_card", title: "生成学习卡片", hint: "给你加生词进词库", risk: "L2", status: "ready", group: "write" },
  { id: "reminder", title: "创建提醒 / 闹钟", hint: "到点提醒或全屏响铃（可设一次或每天）", risk: "L2", status: "ready", group: "write" },
  { id: "memory", title: "长期记忆", hint: "记住你的偏好与项目上下文（只存本机）", risk: "L2", status: "ready", group: "write" },
  { id: "persona", title: "修改他自己的人设", hint: "改他自己的名字与自述", risk: "L2", status: "ready", group: "write" },
  { id: "moment_post", title: "发布动态", hint: "在「动态空间」里发一条此刻的心情", risk: "L2", status: "ready", group: "write" },
  { id: "letter_write", title: "写信给我", hint: "写一封新的信；我下次进前端时会跳出拆信动画", risk: "L2", status: "ready", group: "write" },
  { id: "date_add", title: "记住一个重要日子", hint: "生日、纪念日、约好的那天 —— 他记下来并帮你倒数", risk: "L2", status: "ready", group: "write" },
  { id: "todo_add", title: "帮我记一件待办", hint: "在「小日子 → 待办」里加一条", risk: "L2", status: "ready", group: "write" },

  // ---------------- 媒体（L1-L2） ----------------
  { id: "media", title: "播放 / 暂停", hint: "控制当前音乐（全局播放，切页不停）", risk: "L1", status: "ready", group: "media" },
  { id: "media_track", title: "切歌", hint: "上一首 / 下一首", risk: "L1", status: "ready", group: "media" },
  { id: "media_volume", title: "调音量", hint: "音量大小", risk: "L1", status: "ready", group: "media" },
  { id: "media_seek", title: "跳到某个时间点", hint: "「从 1:20 开始放」", risk: "L1", status: "ready", group: "media" },
  { id: "media_search", title: "搜索 / 筛选音乐", hint: "在他的能力范围内找歌", risk: "L1", status: "ready", group: "media" },
  { id: "tts", title: "朗读文本", hint: "用系统语音念给你听", risk: "L1", status: "ready", group: "media" },
  { id: "ambience", title: "播放氛围音", hint: "白噪音、垫音那类", risk: "L1", status: "ready", group: "media" },
  { id: "media_import", title: "导入音乐到库里", hint: "从 http(s) 直链下载一首歌", risk: "L2", status: "ready", group: "media" },

  // ---------------- 玩乐与陪伴 ----------------
  { id: "gobang_read", title: "读棋局状态", hint: "第几手、谁占优", risk: "L0", status: "ready", group: "play" },
  { id: "gobang_play", title: "陪你下五子棋", hint: "他来执子，可以随时开新局", risk: "L1", status: "ready", group: "play" },
  { id: "truth_pick", title: "出真心话题目", hint: "替你抽一张", risk: "L1", status: "ready", group: "play" },
  { id: "play_banter", title: "陪玩时实时反应", hint: "边玩边吐槽、给提示（要在对话里聊）", risk: "L1", status: "needs_ai", group: "play" },
  { id: "score", title: "记分 / 战绩", hint: "帮你记一笔输赢", risk: "L2", status: "ready", group: "play" },

  // ---------------- 学习 ----------------
  { id: "pick_reading", title: "挑阅读材料", hint: "从内置文章里替你选一篇", risk: "L1", status: "ready", group: "learn" },
  { id: "read_aloud", title: "朗读单词", hint: "发音示范（系统语音）", risk: "L1", status: "ready", group: "learn" },
  { id: "quiz", title: "出题 / 批改", hint: "考你、给你判分（要 AI 出题）", risk: "L2", status: "needs_ai", group: "learn" },
  { id: "wordbook", title: "增删生词本", hint: "加词、移词", risk: "L2", status: "ready", group: "learn" },

  // ---------------- 外部工具 ----------------
  { id: "http_tools", title: "调用 HTTP 工具", hint: "你自己配的那些接口", risk: "L2", status: "partial", group: "tools" },
  { id: "mcp_tools", title: "调用 MCP 工具", hint: "你配的 MCP 服务器（如 Horizon）", risk: "L2", status: "partial", group: "tools" },
  { id: "web_search", title: "网页搜索 / 抓取", hint: "去外面查资料", risk: "L2", status: "todo", group: "tools" },
  { id: "own_api", title: "调用你自己的 API / 代理", hint: "你的自建服务", risk: "L2", status: "todo", group: "tools" },
  { id: "scheduled_job", title: "定时任务", hint: "让他按时自己开口（App 活着时真的会说；关着靠通知兜底）", risk: "L2", status: "partial", group: "tools" },

  // ---------------- 破坏性与高危 ----------------
  { id: "delete_chat", title: "删除对话", hint: "删掉一个对话及其思考链", risk: "L3", status: "ready", group: "danger" },
  { id: "delete_doc", title: "删除文档", hint: "删掉一条笔记", risk: "L3", status: "ready", group: "danger" },
  { id: "delete_diary", title: "删除日记", hint: "删掉一条情绪记录", risk: "L3", status: "ready", group: "danger" },
  { id: "clear_music", title: "清空音乐库", hint: "移除全部本地音乐", risk: "L3", status: "ready", group: "danger" },
  { id: "reset_all", title: "重置设置 / 清空数据", hint: "把一切恢复原样", risk: "L3", status: "ready", group: "danger" },
  { id: "send_as_me", title: "以你的名义对外发消息", hint: "要先有对外通道（邮件 / 接口）", risk: "L3", status: "needs_ai", group: "danger" },
  { id: "edit_upstream", title: "改上游地址或 API Key", hint: "密钥类操作", risk: "L4", status: "forbidden", group: "danger" },
  { id: "export_data", title: "导出 / 外传你的数据", hint: "把你的内容送出去", risk: "L4", status: "forbidden", group: "danger" },
  { id: "upload_files", title: "上传你的文件", hint: "音乐、图片等原始文件", risk: "L4", status: "forbidden", group: "danger" },

  // ---------------- 系统级（封装后） ----------------
  { id: "sys_notify", title: "后台系统通知", hint: "App 关着也能提醒你", risk: "L2", status: "system", group: "system" },
  { id: "sys_alarm", title: "闹钟 / 定时任务", hint: "操作系统级的定时", risk: "L2", status: "system", group: "system" },
  { id: "sys_files", title: "读写本地文件 / 相册", hint: "需要原生权限", risk: "L2", status: "system", group: "system" },
  { id: "sys_clipboard", title: "剪贴板", hint: "读取或写入剪贴板", risk: "L2", status: "system", group: "system" },
  { id: "sys_background", title: "后台播放 / 锁屏控制", hint: "退出页面还在放", risk: "L1", status: "system", group: "system" },
  { id: "sys_calendar", title: "日历 / 联系人", hint: "比较敏感，单独确认", risk: "L3", status: "system", group: "system" },
];

export const PERMISSION_MAP: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.id, p]),
);

export function permissionDef(id: string): PermissionDef | undefined {
  return PERMISSION_MAP[id];
}

/** 默认：只读放开，其余先问，L4 直接拒绝。 */
export function defaultPermissions(): Record<string, PermissionMode> {
  const out: Record<string, PermissionMode> = {};
  for (const p of PERMISSIONS) {
    out[p.id] = p.risk === "L0" ? "allow" : p.risk === "L4" ? "deny" : "ask";
  }
  return out;
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  L0: "只读",
  L1: "无害",
  L2: "写入",
  L3: "破坏性",
  L4: "禁止",
};

export const STATUS_LABEL: Record<PermStatus, string> = {
  ready: "已可用",
  partial: "部分",
  todo: "待实现",
  system: "封装后",
  forbidden: "禁止授权",
  needs_ai: "接AI后",
};

export function permissionsOf(group: GroupId): PermissionDef[] {
  return PERMISSIONS.filter((p) => p.group === group);
}

/** 统计各档数量，给入口行显示摘要用。 */
export function permissionSummary(
  modes: Record<string, PermissionMode> | undefined,
): { allow: number; ask: number; deny: number; total: number } {
  let allow = 0;
  let ask = 0;
  let deny = 0;
  for (const p of PERMISSIONS) {
    const m = modes?.[p.id] ?? (p.risk === "L0" ? "allow" : "ask");
    if (m === "allow") allow += 1;
    else if (m === "deny") deny += 1;
    else ask += 1;
  }
  return { allow, ask, deny, total: PERMISSIONS.length };
}
