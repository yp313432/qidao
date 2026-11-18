/**
 * **弹层关闭栈** —— 安卓返回键的第一优先级。
 *
 * 任务书 3.3 第 5 条（用户 m00516 拍板同一条）：
 *   弹窗、抽屉、设置层的关闭行为**单独处理**：返回先关最上面那一层，
 *   没有弹层了才按层级退页。
 *
 * 以前的行为（`shell/app-back.tsx` 的注释自认过）：不管开没开抽屉/弹层，
 * 系统返回都直接退页 —— 侧边栏开着时按一下返回，抽屉还在、页面已经退了一层，
 * 看起来就像"返回跳级"。
 *
 * 做法：谁打开就往栈里压一张便条（返回时调用它自己的关闭函数），
 * 关掉就弹出去。栈是**模块级变量**：这是瞬时交互状态，不该进持久化 store
 * （跟 `lib/drawer-request.ts` 同一套思路）。
 *
 * ⚠️ 顺序 = 压栈顺序（后开的在上）。嵌套弹层（动作闸门里再套一个输入框）
 *    目前不存在；真出现时按"最后压进来的是最上层"处理，够用但不算精密。
 */
import { useEffect, useRef } from "react";

type Dismiss = () => void;
type Entry = { dismiss: Dismiss };

const stack: Entry[] = [];

/** 压入一层。返回值 = 弹出去（组件卸载时必须调用，否则返回键会去关一个不存在的层）。 */
export function pushDismiss(dismiss: Dismiss): () => void {
  const entry: Entry = { dismiss };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * 关掉最上面那一层。
 * 返回 true = 有人接了这一下（调用方别再退页）；false = 没有弹层，可以退页。
 *
 * 先把便条撕掉再叫它关：React 的状态更新要等这一轮渲染才落地，
 * 不撕的话连按两下返回会把同一层关两次、第二下就被吞了。
 */
export function dismissTop(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.dismiss();
  return true;
}

/** 现在开着几层（测试 + 调试用；业务代码不该依赖它）。 */
export function dismissDepth(): number {
  return stack.length;
}

/**
 * 组件里用这个：`open` 为真时把自己压栈，关闭/卸载自动弹出。
 *
 * 传进来的 `onDismiss` 每次渲染都更新（用 ref 接管），所以闭包里读到的是
 * 最新的状态，不会拿到第一次打开时的旧值。
 */
export function useDismissable(open: boolean, onDismiss: Dismiss): void {
  const ref = useRef(onDismiss);
  ref.current = onDismiss;
  useEffect(() => {
    if (!open) return undefined;
    return pushDismiss(() => ref.current());
  }, [open]);
}
