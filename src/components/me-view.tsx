import { MeHub } from "@/components/me-sections";

/**
 * 「我的」首页。
 *
 * 这里**只留入口** —— 头像/名字卡 + 5 张二级入口卡
 * （AI 概览 / 我的空间 / 模型与用量 / 数据与记忆 / 系统）。
 *
 * 区块本身已经搬到 `me-sections.tsx`：
 *   首页外壳 = MeHub，第二层四组 = MePage（/space · /usage · /data · /system）
 * 这样两边的 JSX 只有一份，改一处两边一致 ✅
 */
export function MeView() {
  return <MeHub />;
}
