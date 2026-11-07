/**
 * 「我的」二级页的名字。
 *
 * 为什么单独一个文件：外壳（me-page）和区块（me-sections）都要用它，
 * 放在任何一边都会让两边互相 import 成环。
 *
 * 2026-11-07 按结构 B 重排：原来的 4 个 tab（我的空间 / 模型与用量 / 数据 / 系统）
 * 拆成更细的 6 页 —— 外观 / 对话 / 主动与通知 / 语音 / 隐私与数据 / 关于与高级。
 * `usage` / `data` / `system` 三个旧值先留着（旧路由还能深链接进来），
 * 新页面都跑通之后整块删掉。
 */
export type MeTab =
  "space" | "chat" | "active" | "voice" | "privacy" | "about" | "usage" | "data" | "system";
