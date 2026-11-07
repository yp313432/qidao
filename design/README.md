# 样式分层规则（改 UI 之前先读这一页）

> 全局结构、行数地图、欠账台账、验证方式 → [`ARCHITECTURE.md`](./ARCHITECTURE.md)。
> 本页只管**样式这一层**的规矩。

这份文件是一份**约定**，不是建议。`scripts/guard-styles.mjs` 会在
`npm run build` / `npm run test` 里强制执行它。

---

## 一句话

> **模式 = 一套变量。改效果改值，不写新选择器。**

`src/styles.css` 之所以长到 6000 行，不是因为功能多，是因为每修一个"这里再小 2px"
就多一条 `[data-material="solid"] .某个卡片 { ... }`。177 条覆盖互相叠，
谁也不知道哪条在生效 —— 于是只能继续加 `!important`。

现在把"值"和"规则"拆开：**皮肤只有一套变量，改一个值全线生效。**

---

## 五层，各管一件事

| 层   | 文件                                                                    | 能写什么                                                              | 不能写什么                                    |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| 尺度 | `src/styles/tokens.css`                                                 | 间距、字号、行高、动效时长/曲线、层级、语义色映射、**材质槽位默认值** | 色值字面量、`[data-material]`                 |
| 骨架 | `src/styles/base.css`                                                   | flex/滚动/安全区/最小触控尺寸                                         | 颜色、圆角、字号、阴影、`[data-material]`     |
| 组件 | `src/styles/kit.css`                                                    | 组件的结构样式，**所有值都必须 `var(--k-*)`**                         | 色值字面量、`[data-material]`、`!important`   |
| 皮肤 | `src/styles/modes/solid.css`<br>`modes/frost.css`<br>`modes/liquid.css` | **只有** `[data-material="…"] { --k-*: 值 }`                          | 类名/元素选择器、`padding` 这类样式、`@media` |
| 旧账 | `src/styles.css`                                                        | 现有内容                                                              | **只许变小，不许变大**（行数被棘轮锁住）      |

`src/styles.css` 顶部按 tokens → base → kit → modes 的顺序 `@import`。
modes 放最后：它靠"后写覆盖"生效，不靠特异性 —— 所以永远不需要 `!important`。

---

## 定位表：出问题改哪里

先判断**是哪种问题**，再动手。改错层就是又一条补丁。

| 你看到的现象                                       | 改这里                                 |
| -------------------------------------------------- | -------------------------------------- |
| 所有页面都别扭（内边距、字号节奏、动效太慢/太快）  | `tokens.css`                           |
| 只在**纯色**下别扭（线不够重、阴影糊、字不搭）     | `modes/solid.css`                      |
| 只在**磨砂**下别扭                                 | `modes/frost.css`                      |
| 只在**液态**下别扭                                 | `modes/liquid.css`                     |
| 某一个组件在三种模式下都不对（开关、列表行、按钮） | `kit.css`                              |
| 某个**页面**布局不对（不是控件，是排版）           | 该页面自己的样式，或 `base.css`        |
| 换配色（米/蓝/绿/粉）                              | `src/styles.css` 的 `[data-palette=…]` |
| 换明暗主题（dawn/dusk/ink）                        | `src/styles.css` 的 `[data-theme=…]`   |

补一条：**颜色永远不在这里写死**。颜色只从 `--aster-*`（主题/调色板）派生，
所以你在 `modes/*.css` 里写 `var(--aster-ink)`，四套调色板 + 三套主题自动全对。

---

## 三种模式是三个产品，不是同一套东西的三档透明度

用户 2026-11-07 定的：**纯色 / 半磨砂 / 液态互不通，各自有各自的风格。**
所以别做"为了统一而统一"的改动 —— 三种模式共享的只有**结构**和**尺度**。

|      | 纯色（工程蓝图）                 | 半磨砂                     | 液态玻璃                  |
| ---- | -------------------------------- | -------------------------- | ------------------------- |
| 字   | 等宽（IBM Plex Mono 打头）       | DM Sans                    | DM Sans                   |
| 线   | 2px 实墨线                       | 1px 亮边（白 26%）         | 1px 更亮（白 30%）        |
| 圆角 | 2px（图纸感）                    | 16px                       | 20px                      |
| 阴影 | 硬位移 `4px 4px 0`               | 柔和扩散                   | 极淡                      |
| 按下 | 整块下沉 3px、影子收成 `1px 1px` | 只变影子                   | 只变影子                  |
| 模糊 | **`none`**（不建合成层）         | `blur(20px) saturate(1.5)` | `blur(5px) saturate(1.7)` |
| 开关 | 实墨轨道 + 纸色点，直角          | 强调色轨道 + 白点，胶囊    | 同左，位移更慢            |

纯色的 `--k-backdrop: none` 是刻意的：`blur(0px)` **不会关掉效果**，
它照样建合成层，几十张卡片叠着就是掉帧。要"没有"就必须是 `none`。

---

## 加一个新样式，按这个顺序想

1. **这是个数字吗？**（间距/字号/时长/圆角…）→ 加进 `tokens.css` 的尺度表，别就地写 `13px`。
2. **三种模式要不一样吗？**→ 是：加一个 `--k-*` 槽位（tokens 给默认值），三个 `modes/*.css` 各给一份值。
3. **是组件的结构吗？**→ 写进 `kit.css`，只用 `var(--k-*)`。
4. **是某个页面的排版吗？**→ 写在该页面自己的样式里，并且**不要**带 `[data-material]`。

反面例子（会被守卫拦下）：

```css
/* ✗ 补丁：改了纯色的一个卡片，别的地方没改，下次还要再来一条 */
[data-material="solid"] .tool-card {
  padding: 6px 10px;
  box-shadow: none;
}

/* ✓ 改槽位：三种模式共用同一份组件规则，只是值不同 */
[data-material="solid"] {
  --k-card-radius: 2px;
  --k-card-shadow: 4px 4px 0 var(--aster-ink);
}
```

---

## 守卫怎么用

```bash
npm run style:guard          # 检查（build 和 test 会自动跑）
npm run style:guard:update   # 清掉旧账后，把基线收紧
```

失败时它会说清楚是**哪类问题**：

- **硬规则**（新模式文件写法错了、色值写进了分层文件、样式文件没人 `@import`）→ 必须改代码。
- **棘轮**（旧文件的历史计数涨了）→ 说明你又在旧文件里加东西了：要么挪到新层，
  要么先 `--update` 之前想清楚 —— 基线一更新，"变的更乱"就变成合法了。

历史基线（`scripts/style-baseline.json`，2026-11-07 首次生成）：
色值字面量 590、`[data-material]` 覆盖 175、`!important` 34、`styles.css` 6104 行。
**这四个数只许降。** 目标是 0 / 0 / 0 / 1500 行以下。

---

## 组件类清单（`kit.css` ↔ `src/components/ui-kit/`）

| 类                                    | 用途              | 替代掉                             |
| ------------------------------------- | ----------------- | ---------------------------------- |
| `.k-page` `.k-head`                   | 页面骨架 + 标题区 | `PageHeader` 那批临时类            |
| `.k-card`                             | 容器卡片          | `.tool-card` / `.paper-card`       |
| `.k-row` `.k-row__idx/__title/__meta` | 列表行（主力）    | `.tool-card` 里的手写结构          |
| `.k-chip`                             | 标签/状态         | 手写 `rounded-full px-2 py-0.5`    |
| `.k-switch` `.k-switch__knob`         | 开关              | `ui/switch.tsx` 里的 Tailwind 位移 |
| `.k-btn` `--primary/--dashed/--block` | 按钮              | 各页面自己拼的按钮                 |
| `.k-input`                            | 输入框            | 同左                               |
| `.k-empty`                            | 空态              | 四处不同的空态写法                 |
| `.k-navbar` `.k-navbar__item`         | 底部导航          | `.glass-nav-bar` 那套              |

迁移顺序：**先建组件 → 再逐页替换 → 最后删旧规则**（并 `style:guard:update` 收紧基线）。
一天一页，每页都要在真机/浏览器里看过再算完成。

### 已经存在的封装（2026-11-07）

`src/components/ui-kit/` 下九个组件已经写好，全部只拼 `.k-*` 类，不写颜色：

| 组件      | 对应类                                     |
| --------- | ------------------------------------------ |
| `KHead`   | `.k-head` `.k-head__title` `.k-head__meta` |
| `KCard`   | `.k-card`                                  |
| `KRow`    | `.k-row` + `__idx` `__title` `__meta`      |
| `KChip`   | `.k-chip`（`tone="outline"` 走描边款）     |
| `KSwitch` | `.k-switch` `.k-switch__knob`              |
| `KButton` | `.k-btn` + `variant` / `block`             |
| `KInput`  | `.k-input`                                 |
| `KEmpty`  | `.k-empty`                                 |
| `KNavbar` | `.k-navbar` `.k-navbar__item`              |

统一从 `@/components/ui-kit` 引。**样板间在 `/design/kit`**：能当场切换材质与纸色，
手机上点一遍就知道手感对不对 —— 改观感之前先去那一页看一眼，别凭想象调。
