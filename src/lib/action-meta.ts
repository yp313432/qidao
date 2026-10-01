import type { AppAction, PermissionId } from "@/lib/types";

/** 每类动作落在哪项权限上（权限清单见 lib/permissions.ts）。 */
export const ACTION_PERMISSION: Record<AppAction["kind"], PermissionId> = {
  navigate: "navigate",
  "media.play": "media",
  "media.pause": "media",
  "media.next": "media_track",
  "media.prev": "media_track",
  "media.volume": "media_volume",
  "media.seek": "media_seek",
  "media.playTrack": "media_search",
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
  "workspace.note": "changelog",
  "moment.post": "moment_post",
  "letter.write": "letter_write",
  "date.add": "date_add",
  "todo.add": "todo_add",
  "diary.add": "diary",
  "chat.new": "chat",
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
    case "workspace.note":
      return `记一条改动：${action.title.slice(0, 20)}`;
    case "moment.post":
      return `发一条动态：${action.text.slice(0, 18)}`;
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
  }
}
