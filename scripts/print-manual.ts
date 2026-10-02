/**
 * 把「硬要求 + 说明书」按真实代码打出来，供人审阅。
 * 运行：node --experimental-strip-types scripts/print-manual.ts
 */
import { buildManual } from "../src/lib/manual.ts";

const permissions: Record<string, "allow" | "ask" | "deny"> = {
  switch_page: "allow",
  media_play: "allow",
  diary_write: "allow",
  moment_post: "allow",
  letter_write: "allow",
  memory_write: "allow",
  reminder_set: "allow",
  ui_highlight: "allow",
  state_report: "allow",
  theme_change: "ask",
  persona_change: "ask",
  http_tool: "ask",
};

const titles = [
  { id: "switch_page", title: "切换页面" },
  { id: "media_play", title: "放音乐" },
  { id: "diary_write", title: "写日记" },
  { id: "moment_post", title: "发动态" },
  { id: "letter_write", title: "写信" },
  { id: "memory_write", title: "记住事情" },
  { id: "reminder_set", title: "设提醒/闹钟" },
  { id: "ui_highlight", title: "高亮界面" },
  { id: "state_report", title: "记录自己的状态" },
  { id: "theme_change", title: "改外观" },
  { id: "persona_change", title: "改自己的设定" },
  { id: "http_tool", title: "调用 HTTP 工具" },
  { id: "web_fetch", title: "网页搜索 / 抓取" },
  { id: "workspace_fs", title: "读工作区文件" },
];

console.log(
  buildManual({
    permissions,
    titles,
    displayName: "yan",
    aiName: "小克",
  }),
);
