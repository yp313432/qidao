# 栖岛 · 结构地图与欠账台账

> 这份文件回答三个问题：**这 8 万行是什么**、**出问题该去哪一层改**、**还欠着什么**。
> 动工前看一眼，动完更新它。样式那一层的细则在 [`README.md`](./README.md)，这里只讲全局。

---

## 1. 三层世界（2026-11-07 实测）

`src/` 共 **81,732 行 / 379 个文件**，加 `scripts/` 的 29 个检查脚本共 **86,840 行**。

| 区                     |   行数 | 占比 | 是什么                                                                      | 和谁打交道                               |
| ---------------------- | -----: | ---: | --------------------------------------------------------------------------- | ---------------------------------------- |
| `src/lib/`             | 38,016 |  46% | **大脑**：状态、跟模型对话、调工具、记忆、登录门禁                          | 谁也不 import 页面；页面反过来 import 它 |
| `src/components/`      | 24,701 |  30% | **五官手脚**：106 个部件、11 个区（根上 0）                                 | 吃 `lib/` 的数据，吐 JSX                 |
| `src/plugins/`         |  7,304 |   9% | **两个自洽小世界**：`emotion-lifeform`(18 文件)、`memory-universe`(21 文件) | 自成一体，尽量别往里伸手                 |
| `src/styles.css`       |  5,663 |   7% | **旧城**：一张 5,663 行的全局样式表                                         | 全 app                                   |
| `src/routes/`          |  4,253 |   5% | **53 个页面**，平均 80 行/页                                                | 只负责"这个页面摆哪些部件"               |
| `src/routeTree.gen.ts` |  1,327 |   2% | TanStack Router **自动生成** —— 别手动改                                    | —                                        |
| `src/styles/`          |    576 |   1% | **新城**：五层地基（tokens / base / kit / modes×3）                         | 全 app                                   |

**页面很薄（80 行/页）是好事**：说明业务没散落在页面里。重量压在「大脑」和「长相」两处。

### 大脑内部（`src/lib/`）

| 文件                                       |                        行数 | 职责                                                                                |
| ------------------------------------------ | --------------------------: | ----------------------------------------------------------------------------------- |
| `store.ts`                                 |                       2,175 | 全局状态：谁、在哪、聊了什么                                                        |
| `actions.ts`                               |                       1,318 | `runAction()` —— **AI 能做的每件事怎么执行**（最危险的一段）                        |
| `types.ts`                                 |                       1,316 | 全项目的词汇表（`AppAction` 在这里声明）                                            |
| `use-chat.ts`                              |                       1,178 | 聊天的 React 侧粘合                                                                 |
| `action-schema.ts`                         |                       1,061 | `ACTION_SCHEMA` —— 95 个动作的**唯一定义**（提示词清单 / tools / 回填表全由它派生） |
| `action-schema.test.ts`                    |                          新 | 上面那张表的不变量测试（16 条）                                                     |
| `chat-client.ts` / `tool-loop.ts`          |                   856 / 856 | 跟模型来回、决定要不要调工具、把结果喂回去                                          |
| `wake-sync.ts` / `recall.ts`               |                   790 / 668 | 唤醒同步 / 记忆召回                                                                 |
| `prompt.ts`                                |                         551 | 系统提示词怎么拼                                                                    |
| `data/` `auth/` `app-data/` `multiplayer/` | 2,757 / 2,230 / 1,186 / 544 | 迁移与数据、登录门禁、app 数据、联机                                                |
| 根上其余                                   |      124 个文件共 31,299 行 | 功能模块，按名找                                                                    |

### 部件内部（`src/components/`）

**2026-11-07 归位后：根上 0 个文件，11 个区共 106 个文件 24,701 行。**
`play/` 30 个 5,909、`chat/` 9 个 4,922、`views/` 13 个 3,724、`me/` 7 个 3,497、`tools/` 8 个 1,401、
`shared/` 14 个 1,341、`daemons/` 7 个 1,320、`memory/` 5 个 1,264、`shell/` 6 个 649、`ui/` 3 个 348、`overlays/` 4 个 326。

分区口径（放新文件时按这个找）：

| 目录                                           | 放什么                                                        |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `shell/`                                       | 整个 app 的外壳：壳、主题、背景层、导航图标、返回、预览桥     |
| `shared/`                                      | 到处复用的零件：markdown、头像、页头、提示弹窗、开关门禁…     |
| `views/`                                       | **一个整页**的容器（`*-view.tsx`、`play-hub`、`me-sections`） |
| `overlays/`                                    | 浮在页面之上的：闹钟、礼物、信件、聊天通知条                  |
| `daemons/`                                     | 没有界面的后台常驻：提醒、任务、唤醒、播放器宿主、OAuth       |
| `chat/` `play/` `tools/` `memory/` `me/` `ui/` | 按业务域；`ui/` 只放无业务的原子控件                          |

`src/components/me-sections.tsx` 保留为一个 19 行的纯转出出口，外部调用方的 import 路径不用改。

---

## 2. 两条铁律

1. **样式：模式 = 一套变量。** 改观感改 `src/styles/modes/*.css` 里的值，不许新增选择器。细则见 [`README.md`](./README.md)。
2. **结构：页面薄，逻辑进 `lib/`。** 页面只摆部件；有判断、有请求、有状态的东西一律下沉。

---

## 3. 症状 → 改哪里（整个 app 级）

| 症状                                   | 去哪                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| 三个模式都别扭（间距、字号、触控尺寸） | `src/styles/tokens.css`                                           |
| 只有纯色别扭                           | `src/styles/modes/solid.css`                                      |
| 页面布局错位、滚动、底部被遮           | `src/styles/base.css`                                             |
| 某个控件手感（开关、按钮、输入框）     | `src/styles/kit.css`                                              |
| 某个页面长得不对                       | `src/components/…` 里那个部件                                     |
| 他说错话、选错动作、不记得事           | `src/lib/`（先看 `prompt.ts` / `action-schema.ts` / `recall.ts`） |
| 某个动作执行出错                       | `src/lib/actions.ts`                                              |
| 页面打开慢、滚动卡                     | 先查 `styles.css` 里的模糊/滤镜，再查 `lib/store.ts` 的重渲染     |

---

## 4. 欠账台账

按「先修地基，再做 UI」的顺序排。**状态只有两格：待办 / 已还**。

| 编号 | 欠账                                                 | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 验收方式                                                | 状态                        |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| D1   | `styles.css` 旧城                                    | 6,117 行、175 条纯色补丁、34 个 `!important`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `style:guard:update` 逐步收紧基线                       | 待办（阶段 3）              |
| D2   | `me-sections.tsx` 太胖                               | **已拆**：3,532 行 → `me/` 下 7 个文件（最大 `me/me-sections.tsx` 2,863；`me/me-hub.tsx` 392；`me/me-widgets.tsx` 242），4 个 tab 仍共用一份状态，未再细分                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `tsc --noEmit` 过、行数合计与原文一致                   | ✅ 已还（地基-c）           |
| D3   | `components/` 根上 44 文件 10,733 行未分区           | **已归位**：根上 0 个文件；新增 `shell/`(6) `shared/`(14) `views/`(13) `overlays/`(4) `daemons/`(7)，共 106 个文件 24,701 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tsc --noEmit` 过、import 全通                          | ✅ 已还（地基-c）           |
| D4   | 磨砂/液态是空壳                                      | 两个模式加起来只有 1 条覆盖规则                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 阶段 4 用新变量层真正做出来                             | 待办（阶段 4）              |
| D5   | 大脑没有护栏                                         | `action-schema.ts`（95 动作）**已补 16 条不变量测试**；`actions.ts` 的 `runAction()`（1,318 行）仍零测试。`npm test` 修好后第一次真跑：`scripts/` 10 个测试里 **5 个全绿、4 个本地必红（靠 spawn/symlink，沙盒 EPERM）、`grok-pwa-plugin.test.mjs` 有 8 条真失败**（见坑 10）                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `npm test` 应能跑通                                     | **进行中**                  |
| D6   | 守卫只管样式                                         | **已加两条棘轮**：`largestComponentLines`（当前 2,863，目标 ≤400）、`componentsRootFiles`（当前 0，目标 0）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `node scripts/guard-styles.mjs` 只许降                  | ✅ 已还（地基-c）           |
| D7   | 工作区堆了几百个 `_probe*/_shot*/preview-*` 临时文件 | 历史遗留，会让 `git status` 无法阅读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 清空或进 `.gitignore`                                   | 待办                        |
| D8   | 死代码与 lint 噪音                                   | **2026-11-07 清完**：4 个 error 全修（`prefer-const` / `no-empty` / `no-control-regex` / `no-useless-escape`）、没用的 import·变量·函数·类型全删、2 条失效的 `eslint-disable` 删掉、一个没人读的 `restoredFromMirror` 状态删掉 —— 19 个文件 **+17 / −191 行**，`eslint src` 从 43 问题降到 7（0 error）                                                                                                                                                                                                                                                                                                                                                                                                                                   | `eslint src` 的 **error 必须为 0**                      | ✅ 已还（地基-d）           |
| D9   | 切页掉帧（纯色下「对话 ↔ 工具」最明显）              | 根因三条：①`app-shell.tsx:250` 用 `key={pathname}` → **每次切页整棵页面树卸载重挂载**；②对话页 `chat-view.tsx:948` 一次性渲染**全部**消息（无虚拟化），挂载后还要 `scrollTop = scrollHeight` 强制同步布局；③工具页纯色有 4 张**无限旋转**的吊牌（文字在旋转元素里 → 每帧重新栅格化），卡片展开还动 `margin-left`（布局属性）。**P0 已做**：dev 探针 `shell/perf-probe.tsx`（`?perf=1` 开）、吊牌 `animation-delay: 0.45s` 让过首帧、`.tool-card` 展开 `margin-left` → `translate`、`.tool-card`/`.tool-stack` 加 `contain`、消息条目加 `contain: layout`（放 `styles/base.css`，三模式共享）。**P1/P2 待办**：消息 `<li>` 上 `content-visibility: auto` + `contain-intrinsic-size`；主标签 keep-alive（切走不卸载，学 RN `freezeOnBlur`） | 真机看探针的「切页 ms / 最长帧 / 长任务」，改前改后对比 | **进行中**（P0 待真机验证） |

---

## 5. 工作顺序

| 阶段   | 内容                                                                         | 状态                                                               |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 地基-a | 样式五层 + `guard-styles.mjs` + [`README.md`](./README.md)                   | ✅ 完成（零视觉变化）                                              |
| 地基-b | 大脑护栏：`action-schema` 测试 16 条 + 修好 `npm test` 在 Windows 上跑不起来 | ✅ 完成                                                            |
| 地基-c | D2 拆 `me-sections.tsx`、D3 部件归位、D6 守卫棘轮                            | ✅ 完成                                                            |
| 地基-d | D8 死代码与 lint 噪音（4 个 error + 全部无用项）                             | ✅ 完成（19 文件 +17/−191 行，error 0）                            |
| 阶段 2 | 用 `.k-*` 类做八个组件 + `/design/kit` 样板间，手机上定纯色手感              | ← **现在这里**：九个组件与样板间已就位（2026-11-07），等真机看一眼 |
| 性能-a | 切页流畅度 P0（D9：探针 + 工具页装饰让路 + `contain`）                       | 🔄 代码已就位，等真机对比                                          |
| 阶段 3 | 逐页迁移、删 177 条旧覆盖（D1）                                              | 待办                                                               |
| 阶段 4 | 磨砂/液态真正做出来（D4）                                                    | 待办                                                               |

---

## 6. 怎么验证（重要）

**我能在这个环境里跑的**（每次交工都跑）：

```powershell
node node_modules/typescript/bin/tsc --noEmit     # 类型
node node_modules/eslint/bin/eslint.js src         # 规范（src 现在 0 error / 7 warning）
node scripts/guard-styles.mjs                     # 样式守卫
node scripts/guard-styles.test.mjs                # 守卫自己的 7 条用例
node --experimental-strip-types <某个 .test.ts>    # 单测（直接跑文件，进程内）
node scripts/<某个>.test.mjs                       # scripts 下的测试，同理直接跑文件
```

**我跑不了、必须你在本地跑**（沙盒禁止起子进程：`spawn EPERM`）：

```powershell
npm test          # node --test 要起子进程
npm run build     # rolldown 要起子进程
npm run dev       # 真机/浏览器看效果
```

所以**任何"看起来对不对"的判断都要靠你截图**。我这边只能保证"类型没错、守卫没破、单测没红"。

**怎么量"卡不卡"**（D9）：手机上在地址后面加 `?perf=1`（或把 `src/components/shell/perf-probe.tsx` 顶部的 `PERF_FORCE` 改成 `true` 再打包），右上角会出现一块浮层：当前 FPS、最长一帧、长任务次数，以及**点导航到新页画出来用了多少 ms**。默认状态它完全不渲染，对线上没有任何影响。比口径：同一个手机、同一组操作，改前改后各走三遍取中间值。

剩下 7 条 warning 都是**结构性的，不用追**：6 条 `react-refresh/only-export-components`（`chat/drawer-crab`、`play/moments-wall`、`emotion-lifeform/emotion-glow` 一个文件里既导出组件又导出常量，要拆文件才能消，那是重构不是清理）＋ 1 条 `memory-universe/MemoryUniverse.tsx` 的 `useEffect` 缺依赖（补上会改变行为，要单独验证过再说）。

---

## 7. 踩过的坑（别再踩第二遍）

1. **`npm test` 在 Windows 上一直是坏的**（2026-11-07 发现）：`node --test 'scripts/**/*.test.mjs'` 里的单引号，npm 走 `cmd.exe` 执行时**不会被剥掉**，node 收到字面量 `'scripts/**/*.test.mjs'` → `Could not find`。也就是说那 10 个 `scripts/*.test.mjs` **从来没通过 npm test 跑过**。已改成双引号 glob，并顺带让新的测试文件**自动被捡起**（不用再手工往 package.json 里加一行）。
2. **Lightning CSS 压缩会丢掉 `translate: none`**：纯色开关白点因此叠上 Tailwind 的 `translate-x-5`，白点飞出轨道。修法：不要写 `translate: none` 去抵消，改成直接设 `--tw-translate-x`。
3. **`backdrop-filter: blur(0px)` 不等于关掉**，仍然建立合成层 —— 纯色模式要 `--k-backdrop: none` 这种**整条声明**级别的槽位，不能只把半径调成 0。
4. **沙盒里 `playwright` 与 `vite build` 都会 `spawn EPERM`**，别浪费时间重试。
5. 工作区里 `_probe*/_shot*/preview-*` 是历史探针与截图，**不是**本次产生，别误当改动物清点。
6. **别批量去掉 import 里的 `.ts` / `.tsx` 后缀**：`node --experimental-strip-types` 不做扩展名补全，`src/lib/**/*.test.ts` 里 `from "./gate-identity.server.ts"` 去掉后缀就跑不起来。2026-11-07 归位时误伤 42 处，靠 `git archive HEAD src` 取 HEAD 快照逐文件比对才补回。（`git archive HEAD src | tar -x` 在 pwsh 管道下会报 `Unrecognized archive format`，改成 `git archive -o x.zip` 再 `Expand-Archive`。）
7. **搬文件脚本必须两阶段**：先全量读+解析完所有 import，再统一写。边搬边解析时，晚处理的文件已经看不到被搬走的旧路径（2026-11-07 漏改 52 处）。
8. **用正则剥注释要小心 JSX**：`accept="image/*"` 里的 `/*` 会让"配对 `/*…*/`"式剥注释吃掉后面一大片真代码。只剥「整块注释」「整行注释」「`{/* */}`」三种。
9. **这个仓库不是 prettier 干净的**（HEAD 里就有大量不合 `printWidth: 100` 的文件，`format` 脚本从没全跑过）。所以**不要顺手 `prettier --write .` 或对旧文件批量格式化**，会把你的改动埋在几千行重排里。只格式化你新写的文件。
10. **`npm test` 修好之后才知道有历史红灯**：`scripts/grok-pwa-plugin.test.mjs` 有 **8 条真失败**（都是 og:image / og:title 注入的期望值与现在的插件实现不一致 —— 测试要 `og.grok.me/v1/card.png?host=…`，实现发的是 `https://<host>/og.jpg`）。另 4 个测试文件（`brand-check` / `check-auth-invariant` / `with-app-env` / `write-atomic`）靠 `execFile`/`symlinkSync`，**沙盒里必然红**（`spawn EPERM` / `symlink EPERM`，断言表现为 `actual: null`），别误判成回归 —— 要在你自己机器上跑才算数。
11. **删死代码也要断言**：按行号批量删时，每个区段都带上「这一行应该长什么样」的检查；对不上就整体中止，一个文件都不写。另外**同一个文件内必须从下往上删**，否则前面的删除会让后面的行号错位（2026-11-07 一次就踩到，靠断言把 1 处误删挡在 `tsc` 之前）。
12. **`prettier --write src/styles.css` 是禁区**（坑 9 的具体版本，2026-11-07 又踩了一次）：它把 6,104 行的文件重排成 7,134 行，守卫当场报红，而且**不可逆**（原格式没有备份）。补救办法（已验证）：
    1. `cmd /c "git show HEAD:src/styles.css > _head-styles.css"` 取回 HEAD 原始格式；
    2. 把 HEAD 版和工作区版**都**过一遍 prettier，再 `git diff --no-index -U2 _head-pretty.css src/styles.css` —— 格式化差异两两抵消，只剩**真正的语义改动**（当时是 8 处、+39/−6 行）；
    3. 以 HEAD 原始文件为底，用带断言的一次性脚本**重放**这几处改动，然后删掉临时文件。
       一句话：**样式旧城只用手改 + 断言脚本，绝不整体格式化。**
13. **`styles.css` 的行数基线会因为加注释而涨**：守卫 `stylesCssLines` 数的是文件总行数（`scripts/guard-styles.mjs:267`），注释也算。加了注释就 `style:guard:update` 一次，并在台账里写清这笔增量是什么（2026-11-07：6,104 → 6,117，就是分层 `@import` 块 + P0 那几段注释）。色值/覆盖/`!important` 三项会先剥注释再计数，不受注释影响。
