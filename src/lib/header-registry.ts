/**
 * **"这一页自己画了页头"的登记处**（用户 m03470 要的"全站返回键统一"）。
 *
 * 为什么要它：液态世界的返回键原来是 app-shell 在页面外面统一渲染的一颗
 * （`.lq-back`，绝对定位）。它**不在滚动内容里**，所以标题随页面滚走、箭头钉住不动，
 * 下滑时必然叠在一起（用户 m03354 原话："这个我的会被划上去，但是返回键却不会被划上去，
 * 就导致它会跟下面有重叠"）。对齐也只能靠给各个页头补 `padding-left` 硬凑，
 * 页面一多就凑不齐（"工具界面也是没对齐，基本上都有这种情况"）。
 *
 * 现在反过来：**页头组件自己画那颗箭头**（跟标题同一个 `<header>`，天然同一行、一起滚）。
 * app-shell 只在"这一页根本没画页头"时兜底补一颗。
 *
 * 用计数器而不是布尔：页头在切页瞬间会短暂出现两个（旧页卸载、新页挂载），
 * 布尔会在中间那一帧闪一下兜底箭头。
 */
let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function registerPageHeader(): () => void {
  mounted += 1;
  emit();
  return () => {
    mounted -= 1;
    emit();
  };
}

export function hasPageHeader(): boolean {
  return mounted > 0;
}

export function subscribePageHeader(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
