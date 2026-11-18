/**
 * `lib/nav-tree.ts` 的不变量 —— 为什么值得测：
 *
 * App 里"返回键该去哪儿"有两个入口：**页内返回钮**（`PageHeader` / `PlayHeader` /
 * `moments-wall`）和**安卓系统返回**（`shell/app-back.tsx`）。两边都问这一份层级表，
 * 所以这张表错一格，两处一起错。
 *
 * ── 2026-11-18：两张表合成一张（用户 m00516）───────────────────
 *
 * 原话："这两个模式的层级逻辑是一样的。" —— 以前这里有一半的测试是靠 `liquid`
 * 参数区分两套层级（纯色 `/tools` 没有上一级、液态 `/tools` 回对话页），
 * 于是"切个主题，返回目标就变了"。现在只有一张表、一个函数，
 * 下面最后一条 `parentOf.length === 1` 就是钉住这件事的钉子：
 * **谁再想加回主题参数，这条测试先红。**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PARENT_OF, backLabelOf, hasBackButton, parentOf, systemBackTarget } from "./nav-tree.ts";

describe("parentOf：一级只有对话页", () => {
  it("对话页没有上一级", () => {
    assert.equal(parentOf("/"), null);
  });

  it("从侧边栏推进来的列表页，上一级都是对话页（两种主题一样）", () => {
    for (const p of [
      "/tools",
      "/me",
      "/pet",
      "/play/space",
      "/play/tools",
      "/play/listen",
      "/play/learn",
      "/play/garden",
      "/play/plugins",
      "/play/games",
    ]) {
      assert.equal(parentOf(p), "/", `${p} 的上一级该是对话页`);
    }
  });
});

describe("parentOf：三级页只退到它所属的二级列表", () => {
  it("工具编辑器 → 工具列表", () => {
    assert.equal(parentOf("/tools/mcp"), "/tools");
    assert.equal(parentOf("/tools/http"), "/tools");
    assert.equal(parentOf("/tools/docs"), "/tools");
  });

  it("具体插件 → 插件目录", () => {
    assert.equal(parentOf("/play/plugins/kimo"), "/play/plugins");
    assert.equal(parentOf("/play/plugins/edit"), "/play/plugins");
  });

  it("播放页 / 加歌 → 音乐列表", () => {
    assert.equal(parentOf("/play/player"), "/play/listen");
    assert.equal(parentOf("/play/add"), "/play/listen");
  });

  it("花园里的房间 → 花园（池塘里的竹篮退池塘、转盘的塔罗退转盘）", () => {
    assert.equal(parentOf("/play/garden/qi"), "/play/garden");
    assert.equal(parentOf("/play/garden/stagno"), "/play/garden");
    assert.equal(parentOf("/play/garden/cesta"), "/play/garden/stagno");
    assert.equal(parentOf("/play/garden/tarot"), "/play/garden/tavolo");
  });

  it("动态空间的三间房退回动态目录，不是一路跳回对话页（用户 m08921）", () => {
    assert.equal(parentOf("/play/space/moments"), "/play/space");
    assert.equal(parentOf("/play/space/diary"), "/play/space");
    assert.equal(parentOf("/play/space/letters"), "/play/space");
  });

  it("小日子底下的房间 → 小日子（入口在 tools-view，父级不是工具 tab）", () => {
    assert.equal(parentOf("/play/days"), "/play/tools");
    assert.equal(parentOf("/play/todo"), "/play/tools");
    assert.equal(parentOf("/play/tools/alarms"), "/play/tools");
    assert.equal(parentOf("/play/tools/tasks"), "/play/tools");
  });

  it("小游戏 → 小游戏列表", () => {
    assert.equal(parentOf("/play/games/gobang"), "/play/games");
    assert.equal(parentOf("/play/games/truth"), "/play/games");
  });
});

describe("parentOf：「我的」这一支（用户 m00624 真机返回到一半跳回对话页）", () => {
  it("五个板块与设置八项都退回「我的」", () => {
    for (const p of [
      "/core",
      "/space",
      "/usage",
      "/data",
      "/system",
      "/profile",
      "/chat-settings",
      "/notify",
      "/voice-settings",
      "/privacy",
      "/about",
    ]) {
      assert.equal(parentOf(p), "/me", `${p} 的上一级该是「我的」`);
    }
  });

  it("四级页退回它所属的板块 / 设置项", () => {
    assert.equal(parentOf("/permissions"), "/core");
    assert.equal(parentOf("/worldbook"), "/core");
    assert.equal(parentOf("/memories"), "/core");
    assert.equal(parentOf("/memory"), "/usage");
    assert.equal(parentOf("/alarms"), "/system");
    assert.equal(parentOf("/tasks"), "/system");
    assert.equal(parentOf("/env"), "/about");
  });
});

describe("parentOf：兜底与健壮性", () => {
  it("没登记的页退回对话页（一级只有对话页）", () => {
    assert.equal(parentOf("/some-new-page"), "/");
    assert.equal(parentOf("/play/whatever/new"), "/");
  });

  it("末尾斜杠 / 查询串不影响判断", () => {
    assert.equal(parentOf("/tools/"), "/");
    assert.equal(parentOf("/tools?x=1"), "/");
    assert.equal(parentOf("/play/space/diary/?a=1"), "/play/space");
  });

  it("显式表的每一层都能一路退到对话页，且没有环", () => {
    for (const start of Object.keys(PARENT_OF)) {
      let cur: string | null = parentOf(start);
      const seen = new Set<string>([start]);
      let guard = 0;
      while (cur !== null) {
        assert.ok(!seen.has(cur), `${start} 的祖先链有环：${[...seen, cur].join(" → ")}`);
        seen.add(cur);
        assert.ok(++guard < 16, `${start} 的祖先链太长`);
        cur = parentOf(cur);
      }
      assert.ok(seen.has("/"), `${start} 最终该退到 /，实际退到 ${[...seen].join(" → ")}`);
    }
  });

  it("两张表 / 两种主题共用一份函数 —— 不许再加主题参数", () => {
    // 加了参数这里就是 2，说明又分叉了
    assert.equal(parentOf.length, 1);
  });
});

describe("hasBackButton / backLabelOf", () => {
  it("对话页没有返回钮，其余页都有", () => {
    assert.equal(hasBackButton("/"), false);
    assert.equal(hasBackButton("/tools"), true);
    assert.equal(hasBackButton("/me"), true);
    assert.equal(hasBackButton("/memory"), true);
  });

  it("退回对话页念作「返回对话」，退回二级列表按名字念", () => {
    assert.equal(backLabelOf("/tools"), "返回对话");
    assert.equal(backLabelOf("/play/space/diary"), "返回动态空间");
    assert.equal(backLabelOf("/play/games/gobang"), "返回小游戏");
    assert.equal(backLabelOf("/memory"), "返回模型与用量");
  });

  it("设置里点进去的页念作「返回设置」（两种主题同一句）", () => {
    assert.equal(backLabelOf("/profile"), "返回设置");
    assert.equal(backLabelOf("/notify"), "返回设置");
    assert.equal(backLabelOf("/chat-settings"), "返回设置");
  });
});

describe("systemBackTarget", () => {
  it("对话页按系统返回 = 退出 App", () => {
    assert.equal(systemBackTarget("/"), "exit");
  });

  it("其它顶级页退回对话页，而不是退出", () => {
    assert.equal(systemBackTarget("/tools"), "/");
    assert.equal(systemBackTarget("/me"), "/");
  });

  it("其余页跟页内返回钮同一个目标（一条链，不跳级）", () => {
    assert.equal(systemBackTarget("/play/garden/qi"), "/play/garden");
    assert.equal(systemBackTarget("/memory"), "/usage");
    assert.equal(systemBackTarget("/pet"), "/");
    assert.equal(systemBackTarget("/tools/mcp"), "/tools");
  });
});
