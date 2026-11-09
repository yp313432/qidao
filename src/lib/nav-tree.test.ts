/**
 * `lib/nav-tree.ts` 的不变量 —— 为什么值得测：
 *
 * App 里"返回键该去哪儿"有两个入口：**页内返回钮**（`PageHeader` / `PlayHeader` /
 * `moments-wall`）和**安卓系统返回**（`shell/app-back.tsx`）。两边都问这一份层级表，
 * 所以这张表错一格，两处一起错。
 *
 * 2026-11 用户 m08548 加了第二种世界：
 *   "由于咱们这个 没有底部导航栏了，所以你记得做好适配，还有返回键啥的。"
 *
 * 液态没有底部 tab，工具 / 玩乐 / 我的三个顶级页都是**被抽屉推进来的**，
 * 所以它们的返回目标不是"没有上一级"，而是对话页 `/`；而纯色那边它们仍然是首页，
 * 返回钮不该出现。这两条互相矛盾，只能靠 `liquid` 参数区分 —— 边界钉在这里。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backLabelOf, hasBackButton, parentOf, systemBackTarget } from "./nav-tree.ts";

describe("parentOf：纯色（有底部导航）", () => {
  it("四个顶级页都没有上一级", () => {
    for (const p of ["/", "/tools", "/play", "/me"]) {
      assert.equal(parentOf(p), null);
    }
  });

  it("二级页回到它所属的顶级页", () => {
    assert.equal(parentOf("/memory"), "/usage");
    assert.equal(parentOf("/play/space"), "/play");
  });

  it("三级页按 TERTIARY_PARENT 走", () => {
    assert.equal(parentOf("/chat-settings"), "/me");
    assert.equal(parentOf("/env"), "/about");
  });
});

describe("parentOf：液态（没有底部导航）", () => {
  it("对话页仍然没有上一级", () => {
    assert.equal(parentOf("/", true), null);
  });

  it("工具 / 玩乐 / 我的都是被抽屉推进来的 —— 返回对话页", () => {
    assert.equal(parentOf("/tools", true), "/");
    assert.equal(parentOf("/play", true), "/");
    assert.equal(parentOf("/me", true), "/");
  });

  it("二级 / 三级页也是回对话页（液态没有 tab 层级）", () => {
    /*
      用户 m08765 真机："然后就设置三级页，点进去，返回之后还卡出来一个原来的这个
      界面"、"还有那几个原来侧边栏的工具，点进去又退出也卡这个原来的玩乐的界面"。
      原因就是这两行之前按纯色那张表往回走（/profile → /me、/play/space → /play）。
      液态撤了底部 tab，所有页都是从对话页推进来的 —— 往回走只有一站。
    */
    assert.equal(parentOf("/profile", true), "/");
    assert.equal(parentOf("/memory", true), "/");
    assert.equal(parentOf("/play/space", true), "/");
    assert.equal(parentOf("/env", true), "/");
  });

  it("末尾斜杠 / 查询串不影响判断", () => {
    assert.equal(parentOf("/tools/", true), "/");
    assert.equal(parentOf("/tools?x=1", true), "/");
  });
});

describe("hasBackButton / backLabelOf", () => {
  it("纯色顶级页没有返回钮，液态有", () => {
    assert.equal(hasBackButton("/tools"), false);
    assert.equal(hasBackButton("/tools", true), true);
  });

  it("返回对话页的标签念作「返回对话」", () => {
    assert.equal(backLabelOf("/tools", true), "返回对话");
  });
});

describe("systemBackTarget", () => {
  it("对话页按系统返回 = 退出 App", () => {
    assert.equal(systemBackTarget("/"), "exit");
  });

  it("液态下的顶级页退回对话页，而不是退出", () => {
    assert.equal(systemBackTarget("/tools", true), "/");
    assert.equal(systemBackTarget("/me", true), "/");
  });
});
