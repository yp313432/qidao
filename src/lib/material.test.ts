/**
 * `lib/material.ts` 的不变量 —— 为什么值得测：
 *
 * 材质从三档收成两档（半磨砂 2026-11 下线，用户 m06619）。风险全在**老存档**：
 * 已经存过 `material: "frost"` 的手机，那套变量块已经被删了，
 * 一旦让 `"frost"` 活到 `applyAppearance()`，`data-material="frost"` 找不到任何变量，
 * 页面会变成裸样式（卡片透明、线全丢）—— 而这种事故只会出现在"升级过的老用户"身上，
 * 开发机上永远看不到。所以在这里把边界钉死：
 *
 *   ① 已下线的、认不出来的、空值 → 一律落回 `solid`（绝不放行到 DOM）
 *   ② `liquid` 是唯一被保留的第二档（未上线，但类型与皮肤文件先留着）
 *   ③ `isSolid` 与 `materialOf` 的判断必须一致（组件里只走这两个入口）
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MATERIALS, isSolid, materialOf, normalizeMaterial } from "./material.ts";

describe("normalizeMaterial", () => {
  it("老档里的 frost 落回纯色", () => {
    assert.equal(normalizeMaterial("frost"), "solid");
  });

  it("纯色与液态原样返回", () => {
    assert.equal(normalizeMaterial("solid"), "solid");
    assert.equal(normalizeMaterial("liquid"), "liquid");
  });

  it("认不出来的值、空值、非字符串都落回纯色", () => {
    for (const raw of [undefined, null, "", "glass", 0, {}, []]) {
      assert.equal(normalizeMaterial(raw), "solid");
    }
  });
});

describe("materialOf / isSolid", () => {
  it("settings 还没加载（undefined）时是纯色", () => {
    assert.equal(materialOf(undefined), "solid");
    assert.equal(isSolid(undefined), true);
  });

  it("老档 settings 里的 frost 也判成纯色", () => {
    assert.equal(materialOf({ material: "frost" as never }), "solid");
    assert.equal(isSolid({ material: "frost" as never }), true);
  });

  it("液态时 isSolid 为假（两档必须是互斥的两个分支）", () => {
    assert.equal(materialOf({ material: "liquid" }), "liquid");
    assert.equal(isSolid({ material: "liquid" }), false);
  });
});

describe("MATERIALS", () => {
  it("只剩两档，且不含已下线的 frost", () => {
    assert.deepEqual([...MATERIALS], ["solid", "liquid"]);
  });
});
