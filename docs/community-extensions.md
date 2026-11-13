# 社区 MCP、Termux、Skills 与网页入口

## 远程 MCP

工具 → MCP：可手动填写 Streamable HTTP / SSE 地址，也可展开“导入社区 MCP 配置”，粘贴服务提供的 `mcpServers` JSON。保存后点测试连接，拿到工具清单再让 AI 使用。安卓 App 使用原生流式网络；浏览器版仍受对方 CORS 设置约束。OAuth 沿用现有授权入口。

支持会话复用、分页工具发现、JSON / SSE 响应及异步 202 结果。一次连接测试最多 20 秒，工具调用最多 90 秒；会话过期只对 400/404 重连重试。服务必须提供真正的 MCP 端点，仓库主页不能当作地址。

## 在已有 Termux 中运行本地 MCP

配置包含 `command / args / env / cwd` 时，栖岛会保留配置并使用本机桥接地址。导入本身不会执行这些命令。

1. 在工具 → MCP 导入配置。
2. 展开“用已有 Termux 运行本地 MCP”，下载 `qidao-mcp-bridge.mjs` 和导出的 `qidao-mcp.json`。
3. 在 Termux 安装对应的 Node.js、Python、uv 和服务依赖。仅安装 Termux 不代表解释器和依赖已齐全；并非所有桌面依赖都兼容 Android。
4. 文件位于手机 Download 目录时运行：

```sh
termux-setup-storage
pkg install nodejs
node ~/storage/downloads/qidao-mcp-bridge.mjs ~/storage/downloads/qidao-mcp.json
```

5. 保持 Termux 运行，回栖岛点测试连接。修改配置或新增服务后重新导出并重启桥接。

桥接仅监听 `127.0.0.1:8767`，用配置中的随机令牌鉴权；服务命令仅来自用户下载并运行的配置文件，不接受 HTTP 传入任意启动命令。配置包含你填写的环境变量，保留在自己设备中。关闭/过期会话会终止对应子进程组。

Termux 是 Android 上的终端环境。多数纯 Node/Python MCP 可在依赖齐全时运行；若依赖 Ubuntu/glibc 或其他桌面组件，可能还需要 PRoot 发行版或在电脑/服务器运行。这里没有内置 Linux 镜像，也没有自动授权调用 Termux 私有目录。

## Skills

工具 → Skills 支持 Markdown、ZIP、公开 GitHub 仓库/目录导入。压缩包里要有 `SKILL.md`，可附带脚本、说明和二进制资源；文件随包保存并纳入现有存档。

启用后 AI 看见名称和说明，通过现有工具权限通道按需读取正文或包内文本文件；停用后不能继续读取。导入不执行脚本，也不自动安装 Python/Node 依赖。当前提供读取能力，执行脚本需要另接具备相应能力的工具。

限制：ZIP 最大 16MB，解压总内容最大 8MB，单个文件最大 1MB、最多 128 个文件；拒绝路径穿越、符号链接、加密文件和损坏校验。公开 GitHub API 有速率限制，大仓库建议下载具体 Skill 的 ZIP。

## 第三方网页与代码插件

玩乐 → 插件 → 添加，普通网页默认独立打开：Android 使用 Custom Tabs，网页端使用新标签。它不依赖网站允许 iframe，也保留浏览器的登录体验；明确支持嵌入的小应用可以手动选择嵌入。

直接打开网页不会赋予其读取聊天、密钥或操作 App 的能力。内置插件继续随 App 构建；本轮没有实现 Operit ToolPkg、VS Code 扩展或 Chrome 扩展的通用加载器。此类社区代码插件需要明确的包格式、宿主 API 和执行生命周期，不能通过粘贴网页地址获得。

## 验证

`scripts/verify-community.mjs` 覆盖远程协议、原生事件流、真实 stdio 子进程、ZIP 和配置；`scripts/verify-community-ui.mjs` 覆盖真实页面上的 MCP 握手、Skill 持久化/读取/停用及第三方网页独立打开。CI 同时执行类型检查、安卓前端构建和原生 Java 编译。自动测试不等同于用户手机上的 Termux 真机验证。

## 让 AI 使用已有 Termux

“工具 → MCP → 让 AI 操作 Termux → 添加 Termux 控制”会添加一个独立的终端 MCP。
首次下载桥接脚本和配置（安卓使用系统文件保存界面，请选 Download 目录），在已有 Termux 安装 Node.js 并启动脚本，然后回 App 测试连接。
桥接未运行时，AI 无法启动 Termux 或绕过安卓应用沙箱；无需为了连接先安装 Ubuntu。
连接后可以说“检查 Termux 环境，帮我安装这个 MCP 缺少的依赖”。

终端提供 environment、execute、status、cancel 四个工具，仍通过已有 `tool.call` / MCP 权限闸门。
execute 返回任务 ID，AI 必须读取 status 的 stdout、stderr、退出码和状态后才能判断成功。
status 可等待最多20秒以减少轮询；命令默认超时2分钟、最大10分钟，最多同时4个任务。
输出仅保留每个流最后64KiB，明确标记截断；不支持输入密码、交互式安装或终端模拟。
安装等耗时任务可以继续查询状态，直到完成；根据实际 command_not_found、permission_denied、cwd_unavailable、timeout 等错误排查。
删除/覆盖/敏感操作须先向用户说明并得到明确同意，不得利用终端绕过 App 的权限。
桥接仅监听本机，要求配置中的独立随机令牌并拒绝带 Origin 的网页请求，且只有显式导出 `terminalEnabled: true` 才开放终端。
关闭会话或桥接会停止相应任务；禁用/删除 App 里的终端后重新导出配置并重启桥接，可撤销终端入口。
运行不兼容 Android 的 Linux 二进制时仍可能需要 proot Linux；依赖能否安装取决于社区服务本身。

## 模型请求的错误诊断

模型错误单独显示错误类别、建议、HTTP 状态、服务商错误码/类型、request_id（服务商有返回时）和原文，且不作为助手正文送入下一轮历史。
已知密钥及 Bearer 令牌脱敏；参数、认证、思考协议等确定性错误不自动重试，只有限流、服务异常、超时等可重试错误最多重试一次。
有正文后断流仍保留正文，并显示诊断；执行过工具后不会为了重试而重复执行整轮工具。

DeepSeek 思考模式携带 tools 时要求所有保留的历史 assistant 回传 reasoning_content，即使该轮没有 tool_calls。
历史组装、提示词组装和同轮工具结果回灌均保留真实思考内容；仍遵守仅保存最近40条思考记录的存储上限，不伪造空思考来掩盖问题。
旧版本已经清理掉的思考无法恢复，遇到该协议错误时提示新建对话。
依据：https://api-docs.deepseek.com/guides/thinking_mode/
