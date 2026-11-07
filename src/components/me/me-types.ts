/**
 * 「我的」四个 tab 的名字。
 *
 * 为什么单独一个文件：外壳（me-page）和区块（me-sections）都要用它，
 * 放在任何一边都会让两边互相 import 成环。
 */

export type MeTab = "space" | "usage" | "data" | "system";
