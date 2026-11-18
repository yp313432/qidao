/**
 * `lib/dismiss-stack.ts` 的不变量：返回键先关最上面那一层。
 *
 * 为什么不测 React hook 部分：hook 只是"open 时压栈、关闭时弹出"的一层糖，
 * 真正会出 bug 的是顺序 —— 那是纯函数，直接测。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dismissDepth, dismissTop, pushDismiss } from "./dismiss-stack.ts";

describe("dismiss-stack", () => {
  it("空栈时没人接这一下（调用方该去退页）", () => {
    assert.equal(dismissTop(), false);
  });

  it("后开的先关（LIFO）", () => {
    const calls: string[] = [];
    const popA = pushDismiss(() => calls.push("A"));
    const popB = pushDismiss(() => calls.push("B"));

    assert.equal(dismissTop(), true);
    assert.deepEqual(calls, ["B"], "最上面那层该先关");
    assert.equal(dismissTop(), true);
    assert.deepEqual(calls, ["B", "A"]);

    assert.equal(dismissTop(), false, "全关完就该轮到退页了");
    popA();
    popB();
  });

  it("自己弹出之后不会被重复关闭", () => {
    const calls: string[] = [];
    const pop = pushDismiss(() => calls.push("X"));
    pop();
    assert.equal(dismissTop(), false);
    assert.deepEqual(calls, []);
    pop(); // 再弹一次也不该炸
    assert.equal(dismissDepth(), 0);
  });

  it("弹出中间一层不会带走别的层", () => {
    const calls: string[] = [];
    const popA = pushDismiss(() => calls.push("A"));
    const popB = pushDismiss(() => calls.push("B"));
    const popC = pushDismiss(() => calls.push("C"));

    popB();
    assert.equal(dismissDepth(), 2);
    assert.equal(dismissTop(), true);
    assert.deepEqual(calls, ["C"]);
    assert.equal(dismissTop(), true);
    assert.deepEqual(calls, ["C", "A"]);

    popA();
    popC();
    assert.equal(dismissDepth(), 0);
  });
});
