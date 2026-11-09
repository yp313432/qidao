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

  it("六个功能的列表页是二级 —— 上一级是对话页", () => {
    for (const p of [
      "/tools",
      "/play/space",
      "/play/days",
      "/play/garden",
      "/play/plugins",
      "/play/listen",
    ]) {
      assert.equal(parentOf(p, true), "/", `${p} 的上一级该是对话页`);
    }
  });

  it("三级页只退到它所属的二级列表，绝不一步跳回对话页（用户 m09110）", () => {
    // 工具编辑器 → 工具列表
    assert.equal(parentOf("/tools/mcp", true), "/tools");
    assert.equal(parentOf("/tools/http", true), "/tools");
    assert.equal(parentOf("/tools/docs", true), "/tools");
    // 具体插件 / 插件编辑器 → 插件目录
    assert.equal(parentOf("/play/plugins/kimo", true), "/play/plugins");
    assert.equal(parentOf("/play/plugins/edit", true), "/play/plugins");
    // 播放页 / 加歌 → 音乐列表
    assert.equal(parentOf("/play/player", true), "/play/listen");
    assert.equal(parentOf("/play/add", true), "/play/listen");
    // 花园里的房间 → 花园（池塘里的竹篮退池塘、转盘的塔罗退转盘）
    assert.equal(parentOf("/play/garden/qi", true), "/play/garden");
    assert.equal(parentOf("/play/garden/cesta", true), "/play/garden/stagno");
    assert.equal(parentOf("/play/garden/tarot", true), "/play/garden/tavolo");
  });

  it("动态空间的三个三级页退回二级目录，不是一路跳回对话页", () => {
    /*
      用户 m08921："动态点进去、日记点进去、信点进去保持不变，那个叫三级。"
      二级目录（/play/space）底下的这三页是唯一的例外 —— 退回来落在目录上，
      三级页本身维持原样（不挂液态度量）。
    */
    assert.equal(parentOf("/play/space/moments", true), "/play/space");
    assert.equal(parentOf("/play/space/diary", true), "/play/space");
    assert.equal(parentOf("/play/space/letters", true), "/play/space");
    // 纯色那张表一点没动
    assert.equal(parentOf("/play/space/moments"), "/play/space");
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

  it("设置的三级页念作「返回设置」（回到的是设置层，不是对话页）", () => {
    assert.equal(backLabelOf("/profile", true), "返回设置");
    assert.equal(backLabelOf("/notify", true), "返回设置");
    // 纯色那边仍然是回「我的」
    assert.equal(backLabelOf("/profile"), "返回我的");
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
