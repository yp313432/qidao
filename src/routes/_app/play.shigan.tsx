import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/play/shigan` —— **老地址，保留成跳转**。
 *
 * 2026-10 时感收进了「插件」（`/play/plugins/shigan`）。
 * 但手机上可能还留着旧书签、用户也可能记得这个路径 —— 所以这里不删，直接跳过去。
 *
 * 为什么用 `replace`：跳转不该往历史里压一层，否则返回时会回到这个"中转页"，
 * 用户会看到"点了返回却还在原地"（这是 App 优先级那条例矩的同一件事）。
 */
export const Route = createFileRoute("/_app/play/shigan")({
  beforeLoad: () => {
    throw redirect({ to: "/play/plugins/shigan", replace: true });
  },
});
