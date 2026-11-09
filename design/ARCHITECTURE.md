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
| D1   | `styles.css` 旧城                                    | **5,407 行、99 条纯色补丁、32 个 `!important`**（2026-11-07：工具页删掉 613 行 / 69 条纯色覆盖、2 个 `!important`；对话页气泡换壳又删掉旧浮签 92 行 / 7 条覆盖）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `style:guard:update` 逐步收紧基线                       | **进行中（阶段 3）**        |
| D2   | `me-sections.tsx` 太胖                               | **已拆**：3,532 行 → `me/` 下 7 个文件。2026-11-07 结构 B 又把 `systemSections` 的 5 个 `<Group>` 抽成 `sysGroups.chat/notify/weather/voice/dev` 供新 tab 复用，并删掉「认识的日子」KFold（21 行）与 hidden 的「AI 权限」Section（35 行）→ 最大部件 **2,752 行**；账号与资料另起 `me/profile-page.tsx` 不塞进来                                                                                                                                                                                                                                                                                                                                                                                                                           | `tsc --noEmit` 过、行数合计与原文一致                   | ✅ 已还（地基-c + 结构 B）  |
| D3   | `components/` 根上 44 文件 10,733 行未分区           | **已归位**：根上 0 个文件；新增 `shell/`(6) `shared/`(14) `views/`(13) `overlays/`(4) `daemons/`(7)，共 106 个文件 24,701 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tsc --noEmit` 过、import 全通                          | ✅ 已还（地基-c）           |
| D4   | 磨砂/液态是空壳                                      | 两个模式加起来只有 1 条覆盖规则                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 阶段 4 用新变量层真正做出来                             | 待办（阶段 4）              |
| D5   | 大脑没有护栏                                         | `action-schema.ts`（95 动作）**已补 16 条不变量测试**；`actions.ts` 的 `runAction()`（1,318 行）仍零测试。`npm test` 修好后第一次真跑：`scripts/` 10 个测试里 **5 个全绿、4 个本地必红（靠 spawn/symlink，沙盒 EPERM）、`grok-pwa-plugin.test.mjs` 有 8 条真失败**（见坑 10）                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `npm test` 应能跑通                                     | **进行中**                  |
| D6   | 守卫只管样式                                         | **已加两条棘轮**：`largestComponentLines`（当前 2,863，目标 ≤400）、`componentsRootFiles`（当前 0，目标 0）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `node scripts/guard-styles.mjs` 只许降                  | ✅ 已还（地基-c）           |
| D7   | 工作区堆了几百个 `_probe*/_shot*/preview-*` 临时文件 | 历史遗留，会让 `git status` 无法阅读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 清空或进 `.gitignore`                                   | 待办                        |
| D8   | 死代码与 lint 噪音                                   | **2026-11-07 清完**：4 个 error 全修（`prefer-const` / `no-empty` / `no-control-regex` / `no-useless-escape`）、没用的 import·变量·函数·类型全删、2 条失效的 `eslint-disable` 删掉、一个没人读的 `restoredFromMirror` 状态删掉 —— 19 个文件 **+17 / −191 行**，`eslint src` 从 43 问题降到 7（0 error）                                                                                                                                                                                                                                                                                                                                                                                                                                   | `eslint src` 的 **error 必须为 0**                      | ✅ 已还（地基-d）           |
| D9   | 切页掉帧（纯色下「对话 ↔ 工具」最明显）              | 根因三条：①`app-shell.tsx:250` 用 `key={pathname}` → **每次切页整棵页面树卸载重挂载**；②对话页 `chat-view.tsx:948` 一次性渲染**全部**消息（无虚拟化），挂载后还要 `scrollTop = scrollHeight` 强制同步布局；③工具页纯色有 4 张**无限旋转**的吊牌（文字在旋转元素里 → 每帧重新栅格化），卡片展开还动 `margin-left`（布局属性）。**P0 已做**：dev 探针 `shell/perf-probe.tsx`（`?perf=1` 开）、吊牌 `animation-delay: 0.45s` 让过首帧、`.tool-card` 展开 `margin-left` → `translate`、`.tool-card`/`.tool-stack` 加 `contain`、消息条目加 `contain: layout`（放 `styles/base.css`，三模式共享）。**P1/P2 待办**：消息 `<li>` 上 `content-visibility: auto` + `contain-intrinsic-size`；主标签 keep-alive（切走不卸载，学 RN `freezeOnBlur`） | 真机看探针的「切页 ms / 最长帧 / 长任务」，改前改后对比 | **进行中**（P0 待真机验证） |

---

## 5. 工作顺序

| 阶段   | 内容                                                                                                                 | 状态                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 地基-a | 样式五层 + `guard-styles.mjs` + [`README.md`](./README.md)                                                           | ✅ 完成（零视觉变化）                                                                                                                                                                                                                                                                                                                                                    |
| 地基-b | 大脑护栏：`action-schema` 测试 16 条 + 修好 `npm test` 在 Windows 上跑不起来                                         | ✅ 完成                                                                                                                                                                                                                                                                                                                                                                  |
| 地基-c | D2 拆 `me-sections.tsx`、D3 部件归位、D6 守卫棘轮                                                                    | ✅ 完成                                                                                                                                                                                                                                                                                                                                                                  |
| 地基-d | D8 死代码与 lint 噪音（4 个 error + 全部无用项）                                                                     | ✅ 完成（19 文件 +17/−191 行，error 0）                                                                                                                                                                                                                                                                                                                                  |
| 阶段 2 | 用 `.k-*` 类做八个组件 + `/design/kit` 样板间，手机上定纯色手感                                                      | ← **现在这里**：九个组件与样板间已就位（2026-11-07），等真机看一眼                                                                                                                                                                                                                                                                                                       |
| 性能-a | 切页流畅度 P0（D9：探针 + 工具页装饰让路 + `contain`）                                                               | 🔄 代码已就位，等真机对比                                                                                                                                                                                                                                                                                                                                                |
| 阶段 3 | 逐页迁移、删旧覆盖（D1）                                                                                             | 🔄 进行中：工具页 ✅ + 外观页已重写（待装包验收）+ 对话页气泡已换壳 + 「我的」首页与账号与资料 ✅ + 五个小部件整体换 kit、卡里第二层框全部拆掉（`me-sections.tsx` 降到 2,430 行）                                                                                                                                                                                        |
| 预览-a | 对话页预览 `/design/preview/chat`（假数据平行跑，定稿再动真页面）                                                    | ✅ 已定稿并搬进真页面（气泡；输入条下一片）                                                                                                                                                                                                                                                                                                                              |
| 外观-a | `/space` 重写成「外观」（`spaceSections` 整段换标准件，加 `KFold/KOpt/KSlider`）                                     | ✅ 代码完成、四道闸门全绿；等装包验收（样张 `design/appearance-page.html`）                                                                                                                                                                                                                                                                                              |
| 结构B  | 「我的」二级导航重组：首页 3 组 8 卡 + 6 个设置页（账号与资料 / 对话 / 主动与通知 / 语音 / 隐私与数据 / 关于与高级） | 🔄 首页 ✅、账号与资料 ✅（只剩「认识的日子」）；5 个设置页已「铺开」并**按语义拆成多张纸卡**（对话 3 张 / 主动与通知 5 张 / 语音 3 张 / 隐私与数据 2 张 / 关于与高级 = 用量三节 + 开发与纠错 1 张）；按 m03526「只许一层框」把卡里第二层边框与底色全部拆掉、圆角统一跟材质走（坑 23）。文案瘦身待用户逐条点。样张 `design/me-home-v2.html`、体检表 `design/me-audit.md` |
| 阶段 4 | 磨砂/液态真正做出来（D4）                                                                                            | 待办                                                                                                                                                                                                                                                                                                                                                                     |

---

## 5.1 一页怎么迁移（阶段 3 的固定动作）

这是"每次改动都是一个整体"的操作手册：**只碰这一页 + 缺什么补进 kit**，别的页面一行不动。

1. **先数账**：在 `src/styles.css` 里 `grep '\[data-material="solid"\] \.工具页前缀'`，看这一页背了多少条旧覆盖（工具页当时是 83 条 `.tool-*` 规则 / 613 行）。
2. **换骨架**：页面外壳换成 `.k-page` / `.k-head` / `.k-tabs` / `.k-list` / `.k-card` / `.k-row`；**逻辑、文案、注释一个字不改**，只换结构。
3. **缺什么补进 kit**，顺序永远是：先查 `kit.css` 有没有 → 没有就加 `.k-*` 类 + 在 `tokens.css`/`modes/*.css` 里加 `--k-*` 槽位。**页面里不许写颜色、字号、圆角、阴影字面量。**
4. **纯色专属装饰：能删就删**（装饰越少越流畅）。要留的，只允许变成「kit 里的一档变量」，不许回来写选择器。
5. **删旧规则**：用带断言的一次性脚本删（按行区间断言首行/末行/下一节注释都对得上才写盘），删完断言 `src` 里再没有这个前缀的类名引用。参考工具页那次：`styles.css` 6,117 → 5,504 行。
6. **四道闸门全绿**：`tsc --noEmit` → `eslint src`（error 必须 0）→ `node scripts/guard-styles.mjs`（有下降就 `--update` 收紧并在台账记一笔）→ `prettier --write` **只格式化这次新写/改写的文件**（`src/styles.css` 永远不格式化，见坑 12）。
7. **真机看一眼**：先开 `/design/kit` 对表（同一套标准件该长一样），再开实际页面看手感；要看数字就加 `?perf=1` 看「切页 ms / 最长帧 / 长任务」。

## 5.2 先预览，再动真页面（"平行跑"）

用户 2026-11-07 的原话："我要知道改完是啥样啊，不能改好了不行又退……那之前的对话界面不是白做了吗。"
所以重版式先挂**临时预览路由**，不动真页面：

| 预览页                 | 对应的真页面      | 状态                                       |
| ---------------------- | ----------------- | ------------------------------------------ |
| `/design/kit`          | 通用件样板间      | 常驻（这是设计系统的对表页，不删）         |
| `/design/preview/chat` | `/`（`ChatView`） | 临时。定稿后把版式搬进真对话页，删这个文件 |

规矩：

1. 预览页里**只准用 `.k-*` 类 + `K*` 组件 + 假数据**，不碰 store 的写操作（读设置可以）；
2. 真页面在验收通过前**一行不改**；不行就删预览文件，成本为零（业内叫 strangler / feature flag）；
3. 预览页验收通过后：按 §5.1 的七步把版式搬进去，删预览路由，同步删 `src/routeTree.gen.ts` 里对应的 8 处（重跑 dev 会自动删）。

**已迁移**：`/tools` 工具页（2026-11-07）—— 四个标签页共 4 个文件重写、新增共享可展开卡片 `src/components/tools/tool-card.tsx`、`kit.css` 补了标签条/小节/展开卡/键值行/状态字/终端块/长文/折叠说明/图标按钮共 9 组类，`tokens.css` 加 4 个槽位，`modes/solid.css` 加 2 个槽位（标签选中的实墨块）。纯色吊牌那套（绳子/流苏/干叶/纸胶带 + 无限摆动）整块删除。

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
13. **同样的坑对大 `.tsx` 也成立**（2026-11-07 第二次踩：`chat-view.tsx`）：本来只改了 6 处气泡外壳，顺手 `prettier --write` 就变成 640/616 行的 diff，改动被埋掉、以后 blame 也没法看。补救同一个套路：`cmd /c "git show HEAD:src/components/chat/chat-view.tsx > _cv_head.tsx"` 取回原格式，用带断言（每条替换必须命中恰好 1 处，否则中止不写盘）的脚本把语义改动**重放**上去 → diff 收回 **26/30 行**，改动一眼能审。判断标准很简单：**这个文件在 HEAD 里是不是 prettier 干净的？不是就别 --write 它。**
14. **`styles.css` 的行数基线会因为加注释而涨**：守卫 `stylesCssLines` 数的是文件总行数（`scripts/guard-styles.mjs:267`），注释也算。加了注释就 `style:guard:update` 一次，并在台账里写清这笔增量是什么（2026-11-07：6,104 → 6,117，就是分层 `@import` 块 + P0 那几段注释）。色值/覆盖/`!important` 三项会先剥注释再计数，不受注释影响。
15. **"进程内用 `@tailwindcss/node` 编译一次、看规则在不在产物里"这条路走不通**（2026-11-07 试了两种写法都失败，别再花时间）：
    - `import { compile } from "@tailwindcss/node"` → `await c.build([...])` **返回的不是字符串**，而是 `{ base, content }` 形状的对象（换候选集也返回同一个），`out.includes()` 直接 `TypeError`；
    - `import { compile } from "tailwindcss"` → 抛 `Error: No \`loadStylesheet\` function provided to \`compile\``（`src/styles.css`里那串相对`@import`需要`@tailwindcss/node` 提供解析器）。
等价可用的替身：①`lightningcss`的`transform({ filename, code, minify: true })`过一遍`src/styles/kit.css`（能抓语法错，还能顺带确认它没丢掉某条声明）；②`tsc --noEmit`+`eslint src`+`guard-styles.mjs`三道闸门；③真要看"样式到底生效没有"，在用户本机 dev server 上`Invoke-WebRequest`拉`/src/styles.css` 检规则（前面几轮都是这么验的）。
16. **守卫的"最大部件文件"棘轮会把人逼向正确做法**（2026-11-07）：重写外观页时手写六张可展开卡，`me-sections.tsx` 一下涨到 2877 行、超了 2863 的棘轮。正确的反应不是调高基线，而是把重复结构抽成标准件 —— 抽出 `KFold` 后回落到 2787 行，且以后每页都能用。**棘轮报红时先问"是不是该抽组件了"，别第一时间 `--update`。**
17. **新建路由时先看 `src/routeTree.gen.ts` 有没有已经被重新生成**（2026-11-07）：沙盒里跑不了 vite，一直靠带断言脚本手工补 7 处/路由。但**只要用户自己的 dev server 开着**（`--host 0.0.0.0:8080`），文件一落地插件就会自动重生成整个 `routeTree.gen.ts`。所以正确顺序是：先建 route 文件 → 等一两秒 → `Select-String routeTree.gen.ts` 查一眼 → 已经有了就**别手工补**（手补会与插件生成的内容打架）。
18. **`.NET` 的 `[System.IO.File]::ReadAllText` 不认 PowerShell 的 `cd`**：`cd grok-workspace-1` 之后传相对路径，.NET 仍按**进程启动目录**解析，会报 `Could not find a part of the path 'C:\...\ds-workspace\src\...'`。用 .NET API 读写文件时一律传绝对路径，或者干脆用 `Join-Path` 拼 `$root`。
19. **改「我的」这种巨型组件时，先把它按"块"切开再做分派**（2026-11-07 结构 B）：`systemSections` 里塞了 5 个 `<Group>`（聊天/通知/天气定位/语音/开发与纠错，共 1348 行）。做法不是原地加 `if`，而是先用带断言脚本把这 5 块抽成 `sysGroups.chat / notify / weather / voice / dev` 五个常量，再让新 tab 各取所需 —— 一步就拿到 5 个页面的内容，`me-sections.tsx` 反而从 2785 掉到 2752。**先切块，再拼页。**
20. **棘轮报红时，先想"这块是不是自己就该单独一个文件"，往往一步就能还回去**（2026-11-07 第二批）：结构 B 的第一批（把五个小部件整体换成 kit、给 sysGroups 加可折叠元数据）让 `me-sections.tsx` 从 2752 涨到 2842，撞了棘轮。没有 `--update`，而是把**外观页整段**（337 行 + `MATERIALS`/`PALETTES`/派生值 + `openFold`/`bgUnlocked` 两个 state）搬进 `src/components/me/space-page.tsx`，自己 `useApp` 拿 `settings`/`patchSettings` —— 搬完 2842 → **2470**，比原来的基线还低 282 行，顺手收紧基线锁住。判据：这一块**只依赖 `settings` + `patch`**（不依赖组件里那几十个语音/通知状态）就搬得动，搬不动才考虑抽 hook。
21. **守卫那条 `styles.css 行数` 是"文件总行数"，写长注释也会顶红**（2026-11-07 又踩）：字体那档的来龙去脉写了 14 行注释、两条字体栈又各自折成两行，`styles.css` 从 5413 涨到 5432 → 红线。正确的还法不是删知识，而是**把知识搬到不计数的层**：字体栈搬进 `src/styles/tokens.css` 的 `--k-stack-serif/kai/mono`（tokens 不计 styles.css 行数），`styles.css` 里只留三条引用 + 一行指路注释 → 5407（比基线还少 6）。**结论：解释写在 tokens/kit/modes 或 `design/`，别写在旧城里。**
22. **`prettier --write` 一个正在重构的大 `.tsx` 之前，先量"它会不会把我没碰的地方也改了"**：`me-sections.tsx` 这次改完有 1134 行 diff，看着吓人，其实是 sysGroups 整体缩进变了。判断办法固定两条：①`git show HEAD:<path>` 那版是不是 prettier 干净的（干净才谈得上"我只动了自己那段"）；②把当前文件复制一份 `prettier --write` 后 `git diff --no-index --numstat` 看差多少行、`@@` 落在哪些区间 —— 全落在我改的区间里才允许写回。别嫌麻烦，坑 12 就是这么来的。
23. **"卡里不许再画框"——一层能表达就别加第二层**（2026-11-07 用户原话："你不要留那个圆形了…外面一层框，里面一层框，尽量就用一层能解决就OK了"）：
    - 病根有两个，都要治：①**外层又套一层卡**，`kit.css` 的 `.k-card .k-sub` 会把卡里的 `.k-sub` 降级成只有标题 → 新拆的分类卡全被压回"一整块"，看着就是"外面一个方块、里面还是原样"；②**卡肚子里的小 div 又画了边框/底色**（旧代码爱用 `rounded-2xl bg-chip` / `border border-line bg-surface`，半径 16px 比纸卡 8px 还圆，一眼不是一套）。
    - 整治口径：容器 div 一律**去边框、去底色**，只留间距（`flex flex-col gap-2`）；`.k-inset` 从"一块淡墨小卡"改成**无框无底的一段竖排内容**（它只负责分组和间距）。**控件不算在内** —— 输入框、按钮、开关、标签必须看得出能点，它们该有自己的边。
    - 圆角：`rounded-2xl`/`rounded-3xl` 一律改成 `rounded-[var(--k-card-radius)]`，跟着材质变量走（纯色 8px / 磨砂 16px / 液态 20px），不再出现"纸卡 8px、里头小块 16px"的错配。
    - 一次性整治脚本记得**同一文件重复跑要幂等**（命中 0 次就跳过），否则第二次跑会因断言失败中止。
24. **删解释话时先问「这句在不在替用户做决定」**（2026-11-07 用户 m03805："解释性的话都不留了"）：
    状态回显（"关掉就完全安静"）和排障提示（"网页版没有后台任务"）属于**功能信息**，不是营销话术，
    删了会让人以为坏了。判据只有一条：删掉之后界面会不会骗人？会就留，但压到一行。
25. **文案批量删除只能靠"精确多行原文 + 命中 1 次断言"**：这次删了 20 多段解释话，中途有一次
    `<button type="button" onClick={` 这种前缀命中 2 处，脚本按断言中止才没写坏（后来靠更长的上下文才唯一定位）。
    **断言失败是保护，不要为了跑通把 expect 放宽。**

26. **从 ISO 字符串里抠「墙上时间」= 把 UTC 当本地时间显示**（2026-11-07 用户报的"现在 7:30，轨迹里写 11:30"）：情绪事件的 `at` 其实是端上 `Date.now()` 写的、epoch 完全正确（`src/lib/actions.ts` 的 `emotion.report` → `addEmotionEvent`），错的是显示层 —— `emotion-glow.tsx` 的 `formatClock` / `clockMinutes` 用 `/T(\d{2}):(\d{2})/` 从 `new Date(at).toISOString()` 里抠数字，那串是 UTC。改法：`Date.parse(iso)` + `Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false})`（本机时区）。**当初之所以抠字符串是为了躲 SSR/hydration 不一致** —— 所以改之前先确认这一页是不是客户端挂载（`"use client"`）的，是就安全；不是就得加 `mounted` 门闩。
27. **画折线前先判"这批数据有没有起伏"，别用固定 0~100 刻度**（2026-11-07 用户："轨迹那条线有时候很乱"）：情绪强度常年落在 55~65，按 0~100 映射就是一条贴底的直线，再叠加贝塞尔过冲就甩出"竖尾巴"。两条一起治：①y 轴取**当日极值**自适应（`margin = max(4, (high-low)*0.1)`、`yRange = max(8, …)`）；②把控制点 y **夹在两端点之间**（`clampY`），数据平的时候曲线就平，不许过冲出画面。另：条数不能靠"只存 60 条"来省空间 —— 存储放宽到 400 条、由展示层做**同情绪 10 分钟合并 + 每次 30 条的分页**（`mergeBursts` / `TRACK_PAGE`）。

28. **二级页的左右留白只能由外壳给一次**（2026-11-07 用户 m04469 第 3 条："从对话往后 push 的二级页直接贴到两侧"）：所有走 `MePage` 的设置页都没有 `.k-page`（它给左右 16px），而 `/space` `/permissions` `/worldbook` 这些整页手写的页面自己带了 `k-page` —— 于是两套留白并存。修法：`me-page.tsx` 里统一包一层 `<div className="k-page">`，内层页面（`SpacePage` 等）**去掉自己的 k-page**，只保留 `k-list`/`k-nav-space`，否则会双份 16px。
29. **列表的"选中态"不能靠 `.glass-active`**（2026-11-07 用户 m04469 第 1 条："当前会话没框，没选中的反而有框，反了吧"）：`.glass-active` 是 `--aster-glass-highlight` 42% 的玻璃高光，**纯色材质下那层几乎透明**；而每一行又都写了 `bg-chip + border-line`，于是「有框的都是没选中的」。正确写法：整列底透明、`border-transparent` 常驻（避免切换时行高跳），**只有选中的那条**才 `border-line bg-chip`。
30. **浮层要能被"键盘弹起"关掉**（2026-11-07 用户 m04469 第 2 条："点开加号选文件，再点输入框要打字，卡片只能点空白才消失"）：`useDismissOutside` 只处理"点外面"。补两个触发：①`<textarea onFocus={closeAll}>`（碰输入框的意图就是打字）；②`window.visualViewport` 的 `resize`（输入框已聚焦、键盘从别处再弹起时，只有它能收到信号）。
31. **三级页的返回目标要跟着它所在的分组走，下线页留 redirect 别删路由**（2026-11-07 用户 m04469 第 4 条：环境自检退出时"闪了一下系统页"）：`nav-tree.ts` 里 `"/env": "/system"` 是结构 B 之前写的，`开发与纠错` 搬进 `/about` 之后这条就成了"退出先落回一张已下线的页"。改 `": /about"`；同时 `/system` `/usage` `/data` 三个空壳用 `beforeLoad: () => { throw redirect({ to, replace: true }) }` 转场（AI 的界面动作和旧链接还会指过来，直接删路由就是白屏）。

32. **安卓的「横幅通知」（heads-up）由**渠道重要性**决定，不是通知本身**（2026-11-07 用户 m04650："横幅通知只触发过一次，不怎么弹"）：Capacitor LocalNotifications 自建的那个 `default` 渠道用的是 `IMPORTANCE_DEFAULT`（`node_modules/@capacitor/local-notifications/android/.../LocalNotificationManager.kt` 里 `val importance = ...IMPORTANCE_DEFAULT`）—— 8.0 以后**只有 IMPORTANCE_HIGH 的渠道才会在屏幕顶部弹横幅**，DEFAULT 只静静落进通知栏。而且**渠道建好后重要性改不动**（系统规定：名字/描述能改，重要性归用户），所以不能"修"那个 default 渠道 —— 只能新建一个 `importance: 5` 的渠道（现在是 `"qidao"` / 「他的消息」）并在 `schedule()` 里显式带 `channelId`。注意：**渠道建失败就不要带 channelId**（插件文档：渠道不存在则这条通知不发），宁可没横幅也不能连通知栏都进不去。
33. **"通知只弹过一次"这类问题先查接线范围，再查系统层**（同一个 m04650）：App 内横幅原来只有 `task-daemon` 里"他自己排的唤醒"那一条路会调 `pushChatNotice`，你发完消息切走、回复到了这条路上**一句话都没有**。统一成一个入口 `lib/announce.ts` 的 `announceAssistantMessage()`，两条路都用它（判据只有两条：人在不在对话页、正文是不是空的）。

34. **两张"会塌的主卡"必须共用一个外壳组件，头像尺寸跟卡片高度是绑定的**（2026-11-07 用户 m04868："这个头像是不是不对，怎么变这么小…两个卡片用一样的就行，因为是一类"）：上一轮把封面高度从 300 压到 210 时顺手把头像 80 缩成 72，比例就散了；另一张（`core-view.tsx`）还是 80 —— 两张同类卡片自己长。现在抽成 `src/components/me/identity-card.tsx`（页面只传头像/名字/称呼/说明块 + refs），几何常量也一次定死：头像 104、收起 28、名字槽位 240、头像上沿 34、名字上沿 154、说明块 190。⚠️ **改高度必同步重算头像**：`AV0 / HEAD_H ≈ 0.5` 是这张卡的视觉比例。
35. **"居中"被旁边的符号拽偏，是因为它们同在一个 flex 行里**（同一个 m04868："名字在头像下面不居中，看着会显歪"）：居中的是"名字 + ♀"这个整体，一宽一窄就把名字推歪。修法：名字单独占一行、父级 `justify-content:center`，符号用 `position:absolute; inset-inline-start:100%; margin-inline-start:8px` 挂到名字右边 —— **不占布局宽度**，名字才是真居中。⚠️ 垂直居中必须用 `transform: translateY(-50%)` 而不是 `translate: 0 -50%`：`.k-gender:active` 会写 `translate`（按下位移），两者是不同属性，用 transform 才不会在按下的瞬间跳回原位。

36. **外部工具要并进原生 `tools` 数组，而不是继续写成提示词里的文字清单**（2026-11-07 用户 m05030："先做 0 和 1"）：
    P0 之前 MCP / 自配接口的每个工具都由 `lib/prompt.ts` 的 `toolCatalog()` 压成一行文字塞进系统提示词 —— 模型得从散文里猜参数结构、每轮重发（几个服务器一两千 token）、没法并行、名字一改就靠猜。
    现在：`lib/external-tools.ts` 把 `st.mcp`（只 `enabled`）与 `st.httpTools` 翻成标准 function 定义（名字 `mcp_<服务器>_<工具>` / `http_<工具>`，只留 `[a-z0-9_]`、≤60 字符、撞名补 `_2`），`use-chat.ts` 把 `[...actionToolsFor(kinds), ...extTools]` 一起发给上游，`tool-loop.ts` 的 `runOneAction()` 先用 `matchExternalTool()` 认名字、直接构造 `{kind:"tool.call"|"http.call"}` 交给闸门。
    ⚠️ 三条硬约束：①**参数 schema 要原样透传**（MCP 的 `inputSchema` 是任意 JSON Schema，收窄会丢 `enum`/`additionalProperties`，所以 `chat-client.ts` 的 `actionTools` 类型故意放宽成 `parameters: unknown`）；②`external-tools.ts` **模块顶层不许 import store**（要动态 `await import()`），否则纯 node 的验收脚本会被 zustand/DOM 拖死；③旧文本协议**保留作降级**（上游不认 tools 时才走），并且提示词里要明确"不要写 tool.call 动作块"，否则模型两种通道混用、白多一次往返。
37. **同一工具反复失败时给"换路"提示，而不是直接停手**（P1，同一个 m05030）：`noteUnknownRepeats()` 处理的是"名字根本不存在"→ **硬终止**；但"工具存在、这次没成"（少参数/被拒/对方 500/要授权）属于**可修复失败**，停了等于活没干。所以在结果尾巴钉一句「这个工具这一轮已经失败第 N 次了，别把同样的参数再发一遍 —— 换参数、换工具，或者直接告诉用户卡在哪」。判定口径：`pending` / `skipped` **不算失败**（那是"还没结果"，不是"做错了"），算进去会让模型误以为自己错了、转头去道歉。同时把 `TOOL_LOOP_MAX` 从 12 抬到 16（"查一下 → 记进记忆 → 改个设置 → 写进日记 → 设提醒"就是五步，任一步返工就顶到 12）。

38. **一次请求的 `tools` 条数有硬上限，必须自己算预算**（2026-11-07 用户 m05306"参考市面常规要求做限制"）：OpenAI Chat Completions 与 Gemini 的 function calling 都写明**一次最多 128 个工具**（Anthropic 没写死条数，但官方建议工具定义别占太多上下文），超了整轮 400 —— 模型那边表现是"完全没回话"，用户看到的是突然变哑巴，最难查。
    现在 `lib/external-tools.ts` 有 `MAX_TOOLS_PER_REQUEST = 120`（留 8 个余量），`use-chat.ts` 发请求前算 `buildExternalTools(120 − builtinTools.length)`：**内置动作必须全发，外部工具是"锦上添花"，先让位**（内置里有 `emotion.report` 这类必用项）。被丢掉几个记在 `externalToolsSkipped()`。
    同时把工具描述的 300 字硬编码收敛成 `MAX_DESC_CHARS = 240`：MCP 服务端给的 description 可能是一整段 markdown，几十个工具每轮重发就是长期税。
    ⚠️ 预算逻辑做成纯函数 `buildExternalToolDefs(mcp, httpTools, limit)` 才测得了 —— `buildExternalTools()` 要动态 import store（zustand），在 `node --test` 里跑不起来。

39. **工具结果要截断，而且要"告诉模型被截断了"**（同一个 m05306）：工具结果是普通消息，会一直躺在历史里，MCP 返回几百 KB JSON 或抓回一整篇文章就能把上下文挤掉、每轮重发还费钱。
    `lib/tool-loop.ts` 的 `MAX_TOOL_RESULT_CHARS = 8000` + `clipToolResult()`：只在**回给模型的那一份**上切，尾巴写明"共 N 字，这里只给前 8000 字，需要完整就换更窄的参数再调"—— 不说的话模型会拿半截 JSON 继续推断，还错得很自信。⚠️ 界面的 `notice`/`result` **保持全文**（"模型看不到"和"用户看不到"是两件事，别一起砍）。

40. **工具通道一改，系统提示词要跟着改，否则两份定义会走散**（用户 m05332："改了之后之前的系统注入提示词，是不是也要更新一下" —— 是要）：
    必须同步的三处：①`lib/prompt.ts` 里 `NATIVE_ACTIONS` 那段 JSDoc 原本写着"MCP/HTTP 仍走正文动作块"，P0 之后已经过时；②`NATIVE_ACTIONS` 正文补两条新事实（"这次的工具可能只是其中一部分，不许编工具名"、"结果可能被截断，换更窄的参数再调"）；③`lib/manual.ts` 的 `SENSE_POINTER` / `WEB_POINTER` 原先把参数用散文（甚至 JSON 示例）复述了一遍 —— 那是**同一份定义的两套呈现**，改成"参数名与类型以这次给你的工具定义为准"，只留判断规则（什么时候用、失败怎么讲）。
    ⚠️ 情绪那段（`EMOTION_POINTER`）故意保留 JSON 示例：它是唯一允许"写在正文动作块里"的动作（按需注入时可能没进 tools），删了模型就不知道字段名。

- **41. 别人的工具调用 JSON 会漏进气泡**（2026-11-07 用户 m05479，接 Gemini 时实测）：
  模型（或中转）可能把 functionCall **当正文文本**吐出来 ——
  `[{"name":"default_api:emotion_report","arguments":{…}}]`。
  它既不含 ` `qidao `围栏、也不含` "kind" `，所以 ` takeActions() `认不出、` stripActions() `也砍不掉，用户就看到一坨 JSON。
补丁 =` lib/foreign-calls.ts `：配平扫描 ` name + arguments `（也认 Gemini 的 ` functionCall ` 形态）、
名字换算成我们的 kind（` default_api:emotion_report `→` emotion.report `）、
**流式没配平就先把尾巴藏起来**；` takeActions() ` 第 ④ 层执行它、` stripActions() ` 第 ⑤ 层抹掉它。
  教训：凡是"让模型在正文里表达结构化意图"的通道，都要有**反向识别 + 兜底隐藏**两层。

- **42. 主动消息"人机感"的根因是提示词里塞了环境描写**（2026-11-07 用户 m05528）：
  `lib/awake.ts` 的 clue note 原本写着「天在暗下来，花园里安静下来了」「夜里了，院子里只剩虫声」，
  原样进了「你注意到：」→ 模型照着复述 → 每条主动消息都是同一种布景句。
  修法不是换措辞，而是**只给事实标签**（清晨/上午/傍晚）+ 提示词里明令禁止写天气天光，
  并把"他最近说过的话"喂回去防重复；两条通道（前台 `awake.ts` / 后台 `wake-prompt.ts`）口径必须一致。
  另：主动通道现在也读**同一份**世界书与人设（原来 `worldAlways: []`，等于换了个脑子）。

- **43. 主动通道必须共用同一份 system prompt，否则就是"两种人格"**（2026-11-07 用户 m05637：
  "自由活动还有定时啥的反正跟自动唤醒有关的都按着一套来，我不想看到出现两种人格"）：
  原来有三套写法 —— 前台 `lib/awake.ts` 自己拼 guidance、定时/自由活动走
  `lib/wake-prompt.ts` 的 `buildProactiveInstruction()`、手机后台那段 JS 用 App 推下去的
  `cfg_prompt_normal/force`（`buildWakePrompt()`）。三套人设/语气/规矩都不一样。
  现在收成 `lib/proactive.ts` 两个函数：
  · `proactiveSystem()` = **正文那套** `systemPrompt()`（人设/风格/工具/世界书/权限说明书一个字不改）
  · `proactiveEvent()` = 这一轮发生的事（几点、隔了多久、上一句谁说的、心情、他最近说过什么、
  记得她什么、这次的由头）+ 输出规矩（禁写环境、禁提系统与时间、允许沉默 `<silent>`）
  **分工的理由**：正文每轮重算 system 会打死前缀缓存，而且时间和"隔了多久"每轮都变 ——
  所以 system 稳定、事件每轮变（主流 agent 也是这个分工）。
  手机后台那段的模板正文 = `proactiveSystem()` + 带 `{{TIME}}`/`{{ELAPSED}}` 占位符的
  `proactiveEvent()`；后台只做"替换时间 + 当 role:system 发出去"。

- **44. 后台 runner 的沉默标记要两种都认**（2026-11-07，坑 43 的连带）：
  `public/runners/wake.js` 的 `cleanReply()` 原来只认 `SKIP`；App 内那条路统一说"只输出
  `<silent>`"之后，后台认不出就会把字面量 `<silent>` 当正文发出去。
  现在两种都认（`SKIP` / `<silent>` / `[silent]`）。
  教训：**跨进程共享的"协议字符串"改一处就要把另一头的解析一起改** —— 它不在 TypeScript 的
  类型检查范围里，只能靠人记。

- **45. 「闹钟」和「通知」是两种东西，混着做就会出现"到点什么都没发生"**（2026-11-07
  用户 m05769："现在的闹钟只能在 app 点开的时候响，其他时候不想（响）"）：
  原来 `lib/notify.ts` 的 `scheduleNative()` 只是往系统排了一条**定时通知** ——
  App 不在前台时它会插一条通知，但不响、不震、不亮屏；睡着了的人永远不会知道。
  正解是 `AlarmManager.setAlarmClock()`（不是 `setExact`）：
  · Doze 下照样准时，状态栏会显示"下一个闹钟"（对用户是明示，也是系统的承诺）
  · PendingIntent 到点触发 `.AlarmReceiver` → `.AlarmActivity`（全屏）
  · **闹钟类应用有后台启动 Activity 的豁免** —— 这是全屏页能弹到锁屏上面的前提，
  普通通知的 `setFullScreenIntent` 只是兜底（安卓 14 起该权限对新装应用默认不授予）
  配套三条：铃声 `AudioAttributes.USAGE_ALARM`（否则静音/勿扰按媒体音量压掉）、
  `MediaPlayer.setLooping(true)`、自己拿 `WakeLock`（`setTurnScreenOn` 只点亮那一下）。
  另外**别复用聊天的通知渠道**：渠道重要性建后不可改，聊天渠道不该带闹铃音/勿扰穿透。

- **46. 原生侧没有"列出我排了哪些 PendingIntent"的 API**（同上）：想让"删闹钟"生效，
  只能靠 JS 侧记一份表（`qidao:alarms-scheduled`）并把差分 `removed` 传下去；
  反过来在原生侧对 10 万个 requestCode 用 `FLAG_NO_CREATE` 去试探 = 十万次 binder 调用，
  主线程直接卡死。

- **47. 一个闹钟响两遍的坑**：原生接管之后，App 内 `reminder-daemon` 的 `check()`
  不能再弹自己的全屏响铃（`setRinging`），否则同一时刻两层都弹。
  用模块级 `nativeAlarmReady` 做让位开关 —— **不能放 React state**，
  因为 `check()` 跑在 `setInterval` 里闭包读的是旧值。

- **48. 「零权限」到底能做什么，边界要写在代码里**（2026-11 用户 m05769，做 P2a 那一层）：
  这一层全靠**把请求交给系统**（`Intent`）—— 开 App、系统分享、剪贴板、地图、日历。
  能「叫得出来」，但**进不去**：点不了别人 App 里的按钮、读不到它的字（那要无障碍/Shizuku）。
  三个具体边界：剪贴板**读**在 Android 10+ 只允许前台；写日历是 `ACTION_INSERT`
  打开系统新建页，**用户按保存才真写**；开 App 只等于点了下桌面图标。

- **49. 新增一个动作组要同步改四处**（漏一处 tsc 或界面就少一块）：
  ① `src/lib/action-schema.ts`：`ACTION_GROUPS` + `ACTION_SCHEMA`（`MissingActionKind` 会兜住漏写）
  ② `src/lib/action-meta.ts`：`ACTION_PERMISSION`（kind → 权限 id）+ `actionTitle()` 的 switch
  （那个 switch 没有 default，漏了会 `TS2366`）
  ③ `src/lib/permissions.ts`：`GroupId` 联合 + `GROUPS` + `PERMISSIONS`（权限项要真的存在，
  否则 `ACTION_PERMISSION` 指向一个不存在的 id，去重面板里就永远问不到）
  ④ `src/lib/tool-select.ts`：**零 import 的副本**（`GroupId` / `ALL_GROUPS` / `GROUP_KEYWORDS`）
  —— 关键词是「按需注册」的唯一依据，不写这一组的词，这组的工具永远发不出去。

- **50. 占位权限不能在真实现之后继续留着**：`sys_clipboard` / `sys_calendar` 原本是
  「封装成 App 后」的占位（`status: "system"`）。零权限层做出来之后，它们被
  `clipboard` / `calendar_write` 两个真项取代 —— 否则权限页会同时出现「能用」和「等一下再说」
  两套说法，用户不知道该信哪个。

- **51. 原生代码只有 CI 能编译，所以「常量凭记忆写」是必踩的坑**（2026-11-07 #264 构建失败）：
  我在 `AlarmReceiver` 里写了 `Intent.FLAG_ACTIVITY_REQUIRE_NON_BACKGROUND` —— **没有这个常量**，
  CI 的 `:app:compileReleaseJavaWithJavac` 一条 `error: cannot find symbol` 就整批挂掉
  （`tsc`/eslint/守卫全绿也没用，它们根本看不到 `.java`）。
  两条硬规矩：① 写任何 `Xxx.CONST` 之前先确认它在 SDK 里真实存在（不确定就不写）；
  ② 后台启动 Activity 的豁免**不是靠 flag 申请的** —— 只要定时来自 `setAlarmClock()`，
  系统就放行；能显式声明的是 `ActivityOptions.setPendingIntentBackgroundActivityStartMode`（API 34+，
  只作用于 PendingIntent 发送方）。

- **52. 沙盒里看 CI 日志的办法**（PowerShell / curl 的 TLS 在沙盒里握手失败，
  报 `SEC_E_NO_CREDENTIALS`；`Invoke-RestMethod` 报「基础连接已经关闭」）：
  只有 **node 的 openssl** 能握手。用 node 写 `http.request({method:"CONNECT"})` 打通
  `127.0.0.1:10808` 代理，再 `tls.connect` 到 `api.github.com:443`；日志接口是 302 →
  `results-receiver.actions.githubusercontent.com`，返回 **chunked** 编码，要自己 dechunk
  才是合法 zip。定位顺序：`/runs` → `/runs/{id}/jobs`（看哪一步红）→ 下载 logs zip →
  在那个步骤的 txt 里 grep `error:`。

- **53. Java 的 lambda 只能捕获 final / effectively final 的局部变量**（2026-11-07 #265 构建失败）：
  `AlarmActivity` 里写了 `String text = getIntent().getStringExtra("text"); if (text == null || …) text = "闹钟";`
  然后把 `text` 用在了 `setOnClickListener(v -> snooze(text))` 里 → 编译报
  `local variables referenced from a lambda expression must be final or effectively final`。
  正解是一次赋值（`final String text = raw == null || raw.isEmpty() ? "闹钟" : raw;`），
  不要"先声明再补默认值"。顺带记住：javac 的 attr 阶段和 flow 阶段是分开报的，
  一次只看到一条错，说明**后面可能还藏着**，改完要整文件再读一遍。

- **54. 老城的 `[data-material]` 覆盖层会压过 kit 自己的选择器**（2026-11 用户 m06419）：
  `src/styles.css` 里 `[data-material="solid"] .paper-card button { color: var(--aster-ink) }`
  特异性 (0,2,1)，压过 `.data-pill` 的 (0,1,0) → 纯色模式下模型选择/推理等级弹层里
  **选中那行是墨底 + 墨字，整行看不见**。修法是把那条规则限定成
  `… button:not(.data-pill):not([data-pill])`。
  教训：光看组件代码看不出来 —— 命中要算特异性；这类"底色改了、字没跟着反白"的
  症状先去看 `styles.css` 里有没有 `[data-material=…] .paper-card` 一类的后代规则。

- **55. 折线图的 x 轴必须和排序用同一把尺子**（`emotion-lifeform/components/app/panels.tsx`）：
  事件按 `Date.parse(timestamp)` 排序，x 却用"当天第几分钟"（`clockMinutes`）→
  跨天时 x 从最右跳回最左，折线折返成带白点的尖刺；只有一个点时
  `M x y L x FLOOR Z` 又是一根零宽竖线。
  现在：x 用 epoch（`SPARK_WINDOW_MS = 26h` 窗口内）、同 x 相距 <1px 的点合并、
  少于 2 个点不画面积。**凡是"按时间排序却按时间轴画"的图，两个地方都得取同一个量。**

- **56. 分段回复要边流边切，不能收尾再切开**（用户 m06419 第 3 条）：
  原来流式期间只渲染 `firstSegment(content)`，收尾时才把整条换成多段 →
  用户看到的是"一整条消息，过一两秒突然裂成几条"。
  现在 `<SegmentBubbles>`（`src/components/chat/segment-bubbles.tsx`）在流式期间就用
  `splitSegments` 同一函数切，写完的段当场定格、最后一段继续长；收尾的 `partsFor`
  用同一份旋钮，所以不会重排。JSX 抽出去也是为了 `chat-view.tsx` 的行数棘轮。

- **57. 材质从三档收成两档（2026-11 用户 m06619 / m06627）**：
  半磨砂 `frost` 下线，只留 **纯色（唯一在线）** 与 **液态（未上线，方向是零模糊的极透）**。
  要动的四处，漏一处就会在"升级过的老用户"手机上行出现裸样式（那套变量已经删了，
  `data-material="frost"` 找不到任何 `--k-*`，卡片透明、线全丢）：
  ① `src/lib/types.ts` 的 `MaterialId`；② `src/lib/store.ts` 的默认值与
  **存档边界** `merge()` 里的 `normalizeMaterial()`；③ `src/styles/modes/frost.css`
  与 `src/styles.css` 里那份 `[data-material="frost"]` 变量块（一并删掉 `@import`）；
  ④ 切换器（外观页那一栏直接撤掉 —— 只剩一档的单选就是凑数控件）。

- **58. 判断材质只准走 `src/lib/material.ts`**：`isSolid()` / `materialOf()` /
  `normalizeMaterial()`。之前 15 个组件各写一遍
  `(settings.material ?? "frost") === "solid"` —— 加一档就要改十几处，
  漏一处就是"液态下还在走纸卡分支"。另外守卫里加了一条硬规则：
  `modes/solid.css` 里出现 `[data-material="liquid"]` 直接失败（反之亦然），
  **两档的皮肤不许互相照顾**，这是它们"互不干扰"的机械保证。

- **59. 液态玻璃的旧实现别照抄**：`modes/liquid.css` 里封存的还是 `blur(5px) + 白 6%`
  那版；用户 m06627 要的是"非常透，直接没有一点模糊"。真正开工时按新方向重写这一档，
  不要拿旧变量当基准微调。
