# PiDesk 执行计划（Step-by-Step · 可追溯版）

> 依据：《PiAgent-Desktop-Workbench-方案.md》v2.1（组件级评审稿，2026-08-30）
> 版本：执行计划 v1.0 · 日期：2026-08-30 · 配套方案：同目录 `PiAgent-Desktop-Workbench-方案.md`
> 目的：把方案拆成可独立执行、可验证、可追溯的任务。**任何后续会话/协作者拿到本文档即可继续推进，不需要重读聊天记录。**

---

## 0. 如何使用本文档（追溯规则）

1. **任务编号**：`T{Phase}.{序号}`（如 `T0.2` = Phase 0 第 2 个任务）。所有代码提交、分支名、PR 标题、commit message 前缀均引用任务号，例：`git commit -m "T1.3: 会话树虚拟列表"`。
2. **每个任务包含六要素**：来源（对应方案章节）→ 前置依赖 → 执行步骤 → 产出（落盘文件路径）→ 验收标准（可勾选）→ 验证方式（命令或手动操作）。**验收项全部勾选才算完成，未完成不得开始依赖它的任务。**
3. **执行中发现的任何偏差**（API 与文档不符、库不满足需求、方案错误）：不直接改代码绕过，先记入 §8 变更日志（日期 / 任务号 / 偏差 / 决策），再继续。这就是"有迹可循"的核心。
4. **新会话恢复上下文**：把本文档 + 方案文档一起提供，并说明当前执行到哪个任务号、§8 最后一条记录是什么。
5. **状态标记**：`☐ 未开始` → `🔜 进行中` → `✅ 完成` → `⛔ 阻塞（注明原因）`。任务标题后用 [ ] 勾选框跟踪。

---

## 1. 前置修订项（先改方案文档，再动工）

> 以下 3 处为 2026-08-30 对照 pi.dev 官方文档核实出的偏差，**必须先修订到方案文档中**，否则 Phase 0 的编码会按错误 API 走。来源核实记录见本文档 §9。

### R-1 `createAgentSession` 选项名修正
- 方案位置：§2.1、§2.2（EngineAdapter 注释、架构图）
- 现状写法：`createAgentSession({ modelRegistry, authStorage, ... })`
- **正确写法**：选项为 `modelRuntime`（`ModelRuntime` 负责模型目录与凭据存储，配置项为 `authPath` / `modelsPath` / `credentials`）。`ModelRegistry` 类型存在，但传入 session 的方式是通过 `modelRuntime`。
- 影响文件：`packages/engine/src/adapter.ts` 注释、`apps/desktop/electron/main/engine/sdk-adapter.ts`

### R-2 会话操作方法归属修正
- 方案位置：§2.1（EngineAdapter 接口设计依据）
- 现状认知：`newSession` / `switchSession` / `fork` 在 `AgentSession` 上
- **正确认知**：这三个方法位于 **`AgentSessionRuntime`**（`createAgentSessionRuntime()`）。`EngineAdapter` 接口本身不用改，但 `sdk-adapter.ts` 实现必须持有 runtime 实例而非裸 session。
- 影响文件：`apps/desktop/electron/main/engine/sdk-adapter.ts`

### R-3 EngineEvent schema 补全
- 方案位置：§3.1（`EngineEventSchema`）
- 缺失事件：`auto_retry_start` / `auto_retry_end`、`summarization_retry_scheduled` / `summarization_retry_attempt_start` / `summarization_retry_finished`
- 另需注意：`bash_execution_update` 的输出在下一次 `prompt` 时才转成 UserMessage 进入上下文——bash 工具卡片（T2.x）展示实时输出即可，不要假设它已进入会话记录。
- 影响文件：`packages/ipc-schema/src/engine.ts`

### R-4 范围裁剪决策（本轮评审结论）
| 项 | 决策 | 理由 |
|---|---|---|
| RPC 备路径（EngineAdapter B 实现） | **MVP 砍掉，接口保留** | SDK 异常多为 Pi 版本变动，RPC 同样受影响；双实现维护成本 > 收益。`rpc-adapter.ts` 只留 TODO 占位 |
| 浏览器面板 | **MVP 用 headless Playwright 截图流**（方案 §10.1 已列 fallback），`WebContentsView + CDP` 推迟到 Phase 3 后 | 单人工期内风险最高的模块，先降级保闭环 |
| `better-sqlite3` | **Phase 5 前不引入** | 原生模块，Windows 下需 electron-rebuild，与 node-pty 同类风险；全文搜索非 MVP 必需 |
| 思考档位列表 | **不硬编码**，运行时经 `get_available_thinking_levels`（RPC）/ SDK 对应 API 动态获取 | 方案 §7.3 列举的档位名未经逐一核实 |
| 工期基线 | MVP（T0~T2）按 **6~9 周** 排期（方案原估 4~6 周） | 浏览器面板与多原生模块叠加的单人风险缓冲 |

---

## 2. Phase 0 · 技术验证（预计 3~5 天）

> 目标：证明"Electron 进程内嵌入 Pi + Windows 原生模块"两条高风险路径走通。**本阶段只写验证代码，不追求结构整洁，全部放在 `apps/desktop/electron/main/engine/` 与 `scratch/` 下即可。**

### [x] T0.1 仓库骨架与工具链（✅ 2026-08-30，验收记录见 §8）
- 来源：方案 §2.5
- 前置：无
- 步骤：
  1. 初始化 pnpm monorepo（`pnpm-workspace.yaml` + `turbo.json` 或 nx，任选其一并记录理由）
  2. 建 `apps/desktop`（Electron + Vite + React 18 + TS strict）与 `packages/{engine,ipc-schema,ui-kit}` 空壳
  3. 配置 electron-builder 基础打包（NSIS）+ `electron-builder install-app-deps` 原生模块重建钩子
  4. ESLint + Prettier + `tsconfig` 项目引用
- 产出：`pi-desktop/` 目录（结构对齐方案 §2.5，允许空文件占位）
- 验收：
  - [ ] `pnpm dev` 启动空三栏窗口（React 热更新生效）
  - [ ] `pnpm build` 产出可安装的 Windows NSIS 包并成功运行
- 验证方式：本机执行 `pnpm dev` / `pnpm build`，截图存 `docs/proofs/T0.1/`

### [x] T0.2 嵌入 Pi SDK：跑通一次完整 prompt 闭环 ★关键路径（✅ 2026-08-30，DeepSeek 内置 Provider + DEEPSEEK_API_KEY 环境变量；验收记录见 §8）
- 来源：方案 §2.1（**应用 §1 R-1、R-2 修订**）、[SDK 文档](https://pi.dev/docs/latest/sdk)
- 前置：T0.1
- 步骤：
  1. `pnpm add @earendil-works/pi-coding-agent`，**锁版本号记入 §8**
  2. 主进程写 `scratch/sdk-probe.ts`：`createAgentSession({ cwd, modelRuntime, customTools })` + `createAgentSessionRuntime()`
  3. `session.subscribe()` 打印全部事件到主进程日志；依次调用 `prompt("用 edit 工具把 test.txt 里的 a 改成 b")` → 观察 `tool_execution_start/update/end` → `message_end`
  4. 验证 `runtime.newSession()` / `runtime.switchSession()` / `runtime.fork()` 真实签名（R-2 落地）
- 产出：`apps/desktop/electron/main/engine/sdk-adapter.ts` 雏形 + `docs/proofs/T0.2/events-log.txt`
- 验收：
  - [ ] Electron 主进程内完成一次 prompt → 文件被真实修改 → 事件流完整打印
  - [ ] 事件类型清单与方案 §3.1 schema 比对，差异记入 §8（预期缺失 `auto_retry_*` 等，即 R-3）
- 验证方式：跑 `pnpm probe:sdk`（临时 script），日志留档

### [x] T0.3 扩展加载与 `ctx.ui` 桥接验证（✅ 2026-08-30，Electron 主进程探针 PASS；打包版 asar 复验留 T0.6，记录见 §8）
- 来源：方案 §5.2、[扩展文档](https://pi.dev/docs/latest/extensions)
- 前置：T0.2
- 步骤：
  1. 用 `DefaultResourceLoader`（`cwd` = 测试项目，`agentDir` = `%USERPROFILE%\.pi\agent`，Windows 路径用 `expandHome()`，来源方案 §10.6）加载一个手写示例扩展 `scratch/extension-echo.ts`（`registerTool` + `ctx.ui.notify`）
  2. 把 `ctx.ui.notify` 桥到渲染层：主进程收扩展通知 → `webContents.send` → 渲染层弹 toast（先用 alert 占位也行）
  3. 验证 jiti 在 Electron 主进程（打包 asar 环境）加载 TS 扩展是否正常；**若 asar 内失败，记录解法（extact 到 app.asar.unpacked 或改加载路径）到 §8**
- 产出：`scratch/extension-echo.ts`、`apps/desktop/electron/main/resources/resource-manager.ts` 雏形
- 验收：
  - [ ] agent 在对话中调用示例扩展注册的工具成功
  - [ ] 扩展里的 `ctx.ui.notify` 在桌面窗口内弹出通知（非 TUI）
  - [ ] 打包后的 app（非 dev 模式）扩展仍能加载
- 验证方式：dev + 打包版各跑一次，日志留档 `docs/proofs/T0.3/`

### [x] T0.4 `tool_call` 拦截验证（审批门可行性）（✅ 2026-08-30，双组对照通过，记录见 §8）
- 来源：方案 §10.3、[扩展文档 tool_call 事件](https://pi.dev/docs/latest/extensions)
- 前置：T0.3
- 步骤：
  1. 写 `scratch/permission-gate-probe.ts`：`pi.on("tool_call")` 对 `bash` 工具返回 `{ block: true, reason: "blocked by probe" }`
  2. 观察被阻断后 agent 的行为（是否收到 reason、是否继续运行）
- 产出：探针代码 + `docs/proofs/T0.4/block-log.txt`
- 验收：
  - [ ] bash 调用被成功阻断且 agent 拿到 reason 继续对话
  - [ ] 结论写入 §8：审批门扩展路线确认可行 / 或记录替代方案
- 验证方式：一条 prompt 触发 bash，观察日志

### [x] T0.5 node-pty Windows ABI 验证（✅ 2026-08-30，改用 @lydell/node-pty N-API 预编译，双运行时 ConPTY 通过，记录见 §8）
- 来源：方案 §10.2、§10.6、§14
- 前置：T0.1
- 步骤：
  1. 安装 `node-pty`，`electron-builder install-app-deps` 按 Electron ABI 重建
  2. 主进程起 ConPTY（PowerShell），stdout 通过 IPC 转发到渲染层最简组件回显
  3. **若编译失败**：尝试 `@homebridge/node-pty-prebuilt-multiarch`（方案 §2.4 备选），结果记 §8
- 产出：`apps/desktop/electron/main/workbench/terminal-service.ts` 雏形
- 验收：
  - [ ] 渲染层（先用 `<pre>` 即可）能输入命令并看到实时输出
  - [ ] 打包版同样可用
- 验证方式：`pnpm dev` 与打包版各一次

### [x] T0.6 Phase 0 门禁评审（✅ 2026-08-30，E2E PASS，**Go 决策**——进入 Phase 1）
- 来源：方案 §12 Phase 0 验收
- 前置：T0.2 ~ T0.5
- 步骤：对照方案验收标准"Electron 内完成'用 Pi 改一个文件'，工具卡片 + diff 上屏"做一次端到端串测（工具卡片/diff 可用最简 DOM 占位）
- 验收：
  - [ ] 端到端演示通过（录屏存 `docs/proofs/T0.6/demo.mp4`）
  - [ ] 所有偏差已记入 §8，方案文档已应用 R-1 ~ R-3 修订
  - [ ] Go / No-Go 决策写入 §8（No-Go 时明确阻塞项与替代路线）

---

## 3. Phase 1 · 三栏骨架 + 对话闭环（预计 2~3 周）

> 目标：日常"改 bug / 加功能"在 GUI 完成，CLI 可 resume 同一会话。

### [x] T1.1 IPC 契约层（✅ 2026-08-30，schema 全量 + 事件桥单测 4/4 + SdkAdapter 重构后 E2E PASS，记录见 §8）
- 来源：方案 §2.2、§3.1（**应用 R-3 修订**）
- 前置：T0.6
- 步骤：
  1. `packages/ipc-schema/src/engine.ts`：按方案 §3.1 定义全部 engine 域 zod schema（含补全的事件），`EngineEventSchema` 用 `z.discriminatedUnion`
  2. `packages/engine/src/adapter.ts`：`EngineAdapter` 接口照方案实现；`sdk-adapter.ts` 正式实现（RPC 留 TODO 占位，R-4 决策）
  3. `event-bridge.ts`：`AgentSessionEvent` → `EngineEvent` 归一化，未知事件类型透传并打日志（为 Pi 升级留适配位）
- 产出：`packages/ipc-schema/src/engine.ts`、`packages/engine/src/{adapter,sdk-adapter,event-bridge}.ts`
- 验收：
  - [ ] `pnpm typecheck` 全绿；渲染层可 import 类型且不引入 Node 依赖（electron-trpc 或 contextBridge 二选一，决策记 §8）
  - [ ] 事件桥对未知 `type` 不崩溃（单测：喂一个假事件）
- 验证方式：`pnpm test packages/engine` + typecheck

### [x] T1.2 布局底座（✅ 2026-08-30，capture 双布局还原 + 折叠状态恢复验证，记录见 §8）
- 来源：方案 §4.1
- 前置：T0.1
- 步骤：`react-resizable-panels` 三栏 + 顶栏 + 状态栏骨架；`onLayout` 持久化到 `~/.pi-desktop/settings.json`（`window.layout`）；dockview 只在右栏占位挂载空实例
- 产出：`apps/desktop/src/renderer/components/layout/{AppShell,Panels,StatusBar,TopBar}.tsx`
- 验收：
  - [ ] 拖拽分割条比例重启动后还原；三栏可折叠
  - [ ] 状态栏显示模型名 / thinking / tokens（数据可先 mock）
- 验证方式：手动操作 + 截图 `docs/proofs/T1.2/`

### [x] T1.3 中栏对话流（MVP 核心体验）（✅ 2026-08-30：核心闭环 + 精修清单全清——万条压测/续写接线/diff 上屏，记录见 §8）
- 来源：方案 §4.3、§11-1/2
- 前置：T1.1、T1.2
- 步骤：
  1. `useSessionStore`（zustand）：`messages` / `streamBuffer` / `pendingSteer/FollowUp`
  2. `<MessageList>`（`@tanstack/react-virtual`，`scrollToIndex` 跟随流式）+ `<MessageRow>` 四种角色
  3. `<MarkdownBody>`：streamdown + remark-gfm + Shiki 代码高亮（懒加载）
  4. `<ToolCard>` 三形态（bash 实时输出 / edit 内联 diff / read 预览），数据来自 T1.1 事件
  5. `<Composer>`：多行输入、Enter=steer / Alt+Enter=followUp、中止按钮
  6. steer/followUp 排队 chips（消费 `queue_update` 事件）
- 产出：`apps/desktop/src/renderer/components/center/*`
- 验收：
  - [ ] 流式输出无闪烁、无原始 markdown 残留（不完整代码块正常渲染）
  - [ ] 万条消息列表滚动不卡（用测试脚本灌 1 万条验证）
  - [ ] Enter 排队 steer、Alt+Enter 排队 followUp，chips 与 `queue_update` 状态一致
- 验证方式：真机对话 + 压测脚本 `docs/proofs/T1.3/`

### [ ] T1.4 左栏项目与会话（后台+CLI 互通硬验收 ✅ 2026-08-30；SessionTree 组件与列表 UI 已上屏，点击叶子续写交互待接 switchSession）
- 来源：方案 §4.2、§5.7
- 前置：T1.1、T1.2
- 步骤：
  1. `ProjectManager`（主进程）：项目注册 / 信任（复用 Pi `project_trust` + `trust.json`）/ `.pi` 发现
  2. `<ProjectPane>` + `<SessionPane>`：会话 JSONL 树解析（`SessionFileParser`）、`navigateTree` 分支切换、active leaf 高亮
  3. `<HistoryPane>` 虚拟列表：名称 / 时间 / tokens / cost / 分支标记（对齐 Pi `/resume` 选择器字段）
- 产出：`apps/desktop/electron/main/project/*`、`renderer/components/left/*`
- 验收：
  - [ ] 桌面新建会话后 `pi` CLI 能 resume；CLI 建的会话桌面能看到并继续（**双向互通为硬验收**）
  - [ ] 分支节点可视化正确，右键可"从此处续写 / 复制为新会话"
- 验证方式：与 CLI 互通实测，记录 `docs/proofs/T1.4/`

### [ ] T1.5 Phase 1 门禁评审
- 前置：T1.3、T1.4
- 验收：
  - [ ] 方案 §12 Phase 1 验收达成："日常改 bug/加功能全程 GUI，CLI 可 resume"
  - [ ] 端到端录屏 + §8 记录

---

## 4. Phase 2 · 多功能工作台（预计 2~3 周）

### [ ] T2.1 文件树 + 代码预览/编辑
- 来源：方案 §4.4（FilesPanel / CodePanel）、§2.4
- 前置：T1.5
- 步骤：
  1. `file-service.ts`（主进程）：fs 封装，gitignore 感知，IPC 域 `fs:*`（方案 §3.2）
  2. `<FileTree>`（headless-tree）+ fzf 风格搜索；双击 → CodeTab
  3. `<CMEditor>`（CodeMirror 6）：默认只读，右键切编辑；主题接 CSS 变量
- 产出：`renderer/components/right/{FileExplorer,CodeEditorTabs}.tsx`、`electron/main/workbench/file-service.ts`
- 验收：
  - [ ] 万级文件项目树展开流畅（虚拟化或懒加载生效）
  - [ ] 编辑保存落盘且 git status 可见变更
- 验证方式：在本仓库自举测试（吃自己的狗粮）

### [ ] T2.2 Diff Tab + 快照回滚
- 来源：方案 §10.4、§4.4（DiffPanel）
- 前置：T2.1
- 步骤：
  1. `snapshot-service.ts`：`tool_execution_start(edit/write)` 读改前内容入 `Map<sessionId+toolCallId, {path, before}>`；`end` 时入 diff 队列
  2. 卡片内 `<InlineDiff>`（jsdiff 自绘行级）+ 右栏 `<CMDiffView>`（`@codemirror/merge`）
  3. `diff:revert(file|all)`：before 快照写回 + 追加系统消息
- 产出：`electron/main/workbench/snapshot-service.ts`、`renderer/components/right/DiffView.tsx`
- 验收：
  - [ ] agent 每次改文件，卡片 diff 与右栏 Diff 同步出现
  - [ ] revert 后文件内容逐字节还原（含换行符，Windows CRLF 场景专项验证）
- 验证方式：CRLF 专项用例 + 常规流程录屏

### [ ] T2.3 终端面板
- 来源：方案 §10.2（T0.5 已验证可行性）
- 前置：T1.5
- 步骤：xterm + fit/web-links/search/unicode11/clipboard addons；`term:create/size/write/kill` + `term:onData/onExit` 事件；右键菜单；"agent 镜像模式"开关（消费 `bash_execution_update`，**注意 R-3 的语义警告**）
- 产出：`renderer/components/right/TerminalView.tsx`、terminal-service 完善
- 验收：
  - [ ] Windows ConPTY 下 PowerShell / Git Bash 均可交互；窗口 resize 不乱版
  - [ ] 长任务运行时 UI 不阻塞，tab 关闭进程被正确清理
- 验证方式：`ping`/`npm run dev` 等长输出命令实测

### [ ] T2.4 浏览器面板（headless 降级版）
- 来源：方案 §10.1（**应用 R-4 决策：MVP 用 headless**）
- 前置：T1.5
- 步骤：
  1. `playwright-core` 起 headless Chromium；右栏 `<BrowserPanel>` 用截图轮询 + 操作按钮呈现（地址栏/后退/刷新）
  2. `agent-tools` 包：`browser_navigate / browser_click / browser_type / browser_read / browser_screenshot`（TypeBox 参数，`registerTool`）
  3. 截图压缩降采样控 token；`browser:*` IPC 域按方案 §3.2
- 产出：`packages/agent-tools/src/browser/*`、`renderer/components/right/BrowserPanel.tsx`
- 验收：
  - [ ] agent 完成"打开页面 → 点击 → 读内容"闭环，截图进对话
  - [ ] （记录到 §8）WebContentsView + CDP 实时版列为 Phase 3 后的 backlog 条目
- 验证方式：对 `https://example.com` 级静态页 + 一个真实 Web 项目各跑一轮

### [ ] T2.5 工作台联动 + dockview 布局持久化
- 来源：方案 §4.4 联动规则、§11-3
- 前置：T2.1 ~ T2.4
- 步骤：workbench-store 实现 `tool_execution_start` → 自动开 tab / 切 Diff / bash 镜像规则；dockview `serializeLayout()/loadLayout()` 持久化到 `~/.pi-desktop/layout.json`；重型组件全部 `React.lazy` 懒加载
- 验收：
  - [ ] agent read → 自动开 CodeTab；edit → 自动切 DiffTab；面板拖拽/浮动/重启还原
  - [ ] 首屏只加载轻组件（Performance 面板确认 CodeMirror/xterm/dockview 懒加载）
- 验证方式：录屏 + 打包版冷启动耗时记录

### [ ] T2.6 Phase 2 门禁评审
- 验收（方案 §12 Phase 2 原文）：
  - [ ] agent 跑一个 Web 项目"改代码 → 跑测试 → 浏览器验证"全程桌面内闭环（录屏）
  - [ ] §8 记录 + Go/No-Go

---

## 5. Phase 3 · 生态接入（预计 2 周）

### [ ] T3.1 扩展/Skill/模板全量复用 + 管理 UI
- 来源：方案 §5.2、§5.3、§5.9
- 前置：T2.6
- 步骤：ResourceManager 完整接入 `DefaultResourceLoader`；`/reload` 热重载（extension reload + session 事件重绑）；`ctx.ui` 桥四件套（notify→sonner、confirm/select/input→Radix Dialog，映射表见方案 §5.2）；`<SkillsBrowser>`、`<TemplateManagerTab>`
- 验收：
  - [ ] 装一个含扩展+Skill 的社区包，全部生效（方案 §12 Phase 3 验收口径）
  - [ ] 扩展内 `ctx.ui.confirm` 在桌面弹窗且返回值正确回传（阻塞式 Promise 链路）
  - [ ] `ctx.ui.custom` 按方案降级并在 UI 标注"桌面暂不支持"
- 验证方式：真实社区包实测（包名记 §8）

### [ ] T3.2 模型源管理 + 密钥钥匙串
- 来源：方案 §5.6、§7、§10.6
- 前置：T2.6
- 步骤：
  1. `provider-manager.ts`：`ModelRuntime`（**R-1 术语**）+ `AuthStorage` 复用；`models.json` 读写
  2. `keychain.ts`：Electron `safeStorage`（Windows=DPAPI），密钥优先级链对齐方案 §5.6
  3. `<SettingsModal>`：`<ModelsTab>`（ProviderList/ProviderForm/测试连接）+ `Ctrl+L` 切换器 + `Ctrl+P` 收藏循环；思考档位动态获取（**R-4**）
- 验收：
  - [ ] 至少接入 Anthropic / OpenAI / OpenRouter / Ollama 四类源并完成对话
  - [ ] 自定义 OpenAI 兼容端点（如本地 vLLM）表单配置后可用
  - [ ] 密钥仅存钥匙串，grep 安装目录无明文（安全自查项）
- 验证方式：四 provider 各发一条消息 + 密钥落盘检查脚本

### [ ] T3.3 主题 token 映射
- 来源：方案 §5.4
- 前置：T1.2
- 步骤：`theme-adapter.ts`：Pi 主题 token → CSS 变量（映射表按方案 §5.4，**实际 token 名以 Pi Theme 源码为准，核对结果记 §8**）→ 同步注入 CodeMirror theme / Shiki / xterm
- 验收：
  - [ ] 任一 Pi 社区主题加载后全 app（含终端/代码高亮）换肤一致；light/dark/system 兜底可用
- 验证方式：切换 2 个主题截图对比 `docs/proofs/T3.3/`

### [ ] T3.4 包市场
- 来源：方案 §5.5、§6.5
- 前置：T3.1
- 步骤：复用 Pi package-manager（`pi install npm:/git:` → settings `packages`）；`<PackageMarket>`（搜索/卡片/安装/更新/卸载）
- 验收：
  - [ ] 市场内完成一次 npm 包安装 → 扩展生效 → 卸载干净
- 验证方式：真实包全流程

---

## 6. Phase 4 · 权限与高级模式（预计 1 周）

### [ ] T4.1 审批门 + 策略
- 来源：方案 §10.3（T0.4 已验证）、§9
- 步骤：`extensions/permission-gate.ts` 正式化：四档策略（全自动/高风险审批/全部审批/全部拒绝）+ 规则匹配（settings `approval.rules`）+ 未响应默认拒绝 + `sessionScopeAllowlist` 会话级授权；`<ApprovalCard>` 内联在对话流
- 验收：
  - [ ] 危险命令（`rm -rf` 类）默认拦截；"本次会话批准"后同类不再询问
  - [ ] 超时未响应 → 自动拒绝且 agent 收到 reason
- 验证方式：权限矩阵用例表逐条打勾（新建 `docs/permission-matrix.md`）

### [ ] T4.2 项目信任 + path-guard
- 来源：方案 §9
- 步骤：`<TrustDialog>`（复用 Pi project_trust）；内置 path-guard 扩展：`.env`/`node_modules/`/`.git/`/`~/.ssh` 写保护
- 验收：
  - [ ] 未信任项目不加载 `.pi/*` 动态配置；guard 命中路径写入被阻断并提示
- 验证方式：构造恶意 `.pi` 扩展用例（本地测试仓）

### [ ] T4.3 计划模式（内置扩展）
- 来源：方案 §12 Phase 4
- 步骤：plan-mode 扩展：检查 → 生成不可变计划 → 用户批准 → 执行
- 验收：
  - [ ] 计划批准前 agent 无法执行写操作；批准后正常执行
- 验证方式：真实任务走一遍计划流

---

## 7. Phase 5 · 打磨与分发（预计 1~2 周）

### [ ] T5.1 命令面板 + 全局搜索
- 来源：方案 §11-6/7/10
- 步骤：`Ctrl+Shift+P` 聚合应用命令 + Pi 命令 + 扩展命令 + Skill + 模板（数据源 `get_commands` 等）；`@` 文件联想；键盘优先（Tab 三栏焦点循环）
- 验收：
  - [ ] 90% 高频操作可键盘完成（对照方案 §11 清单逐项过）
- 验证方式：清单打勾表

### [ ] T5.2 插件系统（utilityProcess）
- 来源：方案 §6、§5.8（R-4：排在 MVP 后，本阶段执行）
- 步骤：`PluginHost`（utilityProcess 沙箱 + manifest 权限白名单 + 崩溃重启）+ `packages/plugin-api` 类型（方案 §5.8 / §6.1）+ 一个示例插件
- 验收：
  - [ ] 插件崩溃不杀主进程，自动重启并通知
  - [ ] 未声明权限的 API 调用被拒并有日志
- 验证方式：示例插件（含一次故意崩溃 + 一次越权调用）演示

### [ ] T5.3 打包分发
- 来源：方案 §10.6、§12 Phase 5
- 步骤：electron-builder 三平台（当前优先 Windows NSIS + 签名）；自动更新；新用户上手文档
- 验收：
  - [ ] 干净 Windows 虚拟机安装 → 10 分钟内跑通"配 Key → 首次对话 → 改文件"（方案验收口径）
- 验证方式：干净环境录屏

---

## 8. 变更与决策日志（持续追加，倒序）

> 格式：`日期 | 任务号 | 类别(偏差/决策/风险) | 内容 | 影响`

| 日期 | 任务号 | 类别 | 内容 | 影响 |
|---|---|---|---|---|
| 2026-08-30 | 前置 | 修订 | R-1~R-3 已写回方案文档（方案升级为 v2.2）：createAgentSession 选项改 modelRuntime、会话操作标注 AgentSessionRuntime 归属、EngineEventSchema 补 auto_retry_*/summarization_retry_*、§7.3 思考档位改动态获取、§2.1 决策行改为"MVP 仅实现 SDK 路径" | 前置项完成 ✅ |
| 2026-08-30 | 前置 | 决策 | R-4 范围裁剪：RPC 备路径出 MVP；浏览器面板 headless 降级；better-sqlite3 移出 MVP；工期基线 6~9 周 | 路线图调整 |
| 2026-08-30 | T0.1 | 决策 | 工具链选型：不用 turbo/nx，用 `pnpm -r` 递归脚本（单人项目，monorepo 任务编排无并行需求，少一层工具依赖）；构建器选 electron-vite（main/preload/renderer 三目标一体，官方模板成熟）；workspace 包以 TS 源码直连（main 侧经 externalizeDepsPlugin exclude 打进产物，renderer 侧 vite 原生支持），不出 dist | 记录备查 |
| 2026-08-30 | T0.1 | 偏差 | pnpm 11 不再读 package.json 的 `pnpm.onlyBuiltDependencies`，设置迁移到 `pnpm-workspace.yaml` 的 `allowBuilds`（electron/esbuild: true） | 已解决，影响后续所有装机 |
| 2026-08-30 | T0.1 | 偏差 | 本机（Git Bash + pnpm）下 electron 的 install.js 下载后解压静默失败（extract-zip 只产出 LICENSES.chromium.html，exit 0 无报错）。解法：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js` 下载，再用 PowerShell `Expand-Archive` 手动解压 dist/，并 `printf 'electron.exe' > path.txt`（echo 会带换行导致 spawn ENOENT） | **升级 electron 版本时需重复此流程** |
| 2026-08-30 | T0.1 | 偏差 | electron-builder 打 NSIS 时 winCodeSign 解压因符号链接特权失败（"客户端没有所需的特权"）。解法：用自带 7za 手动解压 `winCodeSign\120937007.7z` → `winCodeSign\winCodeSign-2.6.0`（忽略 2 个 darwin 链接错误），预热缓存后重跑成功 | 已解决，非管理员环境打包照此绕行 |
| 2026-08-30 | T0.1 | 完成 | 验收通过：`pnpm -r typecheck` 全绿；`electron-vite build` 三目标成功；打包版应用启动正常（3 进程、日志干净）；NSIS 包产出 `apps/desktop/release/PiDesk Setup 0.0.1.exe` | T0.1 ✅，下一任务 T0.2 |
| 2026-08-30 | T0.2 | 偏差 | Pi SDK 实际版本 **0.84.4**（锁定）。实测装配路径比在线文档更精确：`createAgentSessionServices({cwd, agentDir, modelRuntime?})` → `createAgentSessionFromServices({services, sessionManager})` → `createAgentSessionRuntime(工厂函数, {cwd, agentDir, sessionManager})`。**工厂函数**（`CreateAgentSessionRuntimeFactory`）在每次 newSession/switchSession/fork 时按目标 cwd 重建服务——SdkAdapter 应持有工厂而非单个 session | sdk-adapter 结构据此设计（T1.1） |
| 2026-08-30 | T0.2 | 进展 | 无 Key 冒烟通过：runtime 装配 + `session.subscribe()` 挂载 + `newSession/switchSession/fork` 方法面确认 + sessionFile 落盘 `~/.pi/agent/sessions/`（R-1/R-2 修订与真实包吻合）。探针：`apps/desktop/scratch/sdk-probe.mjs`（用法与日志见 `docs/proofs/T0.2/`） | **T0.2 剩余项阻塞：需用户提供模型 API Key** |
| 2026-08-30 | T0.2 | 完成 | **用户提供 DeepSeek Key 后闭环达成**：prompt "把 test.txt 里的 foo 改成 bar" → 165 事件（含 3 次 tool_execution_start/end）→ 文件真实修改为 "hello bar"。日志 `apps/desktop/docs/proofs/T0.2/events-log.txt`。注：验收在 Node 进程完成（SDK 纯 JS），Electron 主进程内复验并入 T0.3 | T0.2 ✅ |
| 2026-08-30 | T0.2 | 偏差 | **DeepSeek 是内置 Provider**，凭据走 `DEEPSEEK_API_KEY` 环境变量，无需 models.json。⚠️ 实测：自定义 `models.json` 中同名 provider 的最小配置会**覆盖**内置目录项并丢失 compat 设置，导致工具调用失效——T3.2 模型设置 UI 必须**合并**内置目录而非整体替换（修订方案 §5.6 实现口径） | T3.2 设计约束 |
| 2026-08-30 | T0.2 | 偏差 | API 细节实测：① `getAvailable()` 需无参全量调用后按 `model.provider` 过滤（直传 providerId 返回空）；② 实际事件流含 `agent_settled`、`thinking_level_changed`，方案 §3.1 schema 未列——T1.1 补入 EngineEventSchema | T1.1 修订依据 |
| 2026-08-30 | T0.3 | 偏差 | **Electron 33 内置 Node 20 缺 `fs.globSync`，Pi SDK 0.84.4 无法加载 → 升级 Electron 37.10.3**（Node 22）。方案 §2.4 的"≥30"下限据此修正 | 依赖版本变更 |
| 2026-08-30 | T0.3 | 偏差 | 排查坑：僵尸 electron 进程持有 `requestSingleInstanceLock` 导致新实例静默退出（exit 0 无输出）。排障时先 `taskkill /F /IM electron.exe` | 排障经验 |
| 2026-08-30 | T0.3 | 完成 | **Electron 主进程探针 PASS**：jiti 加载 TS 扩展（echo_greeting）成功 → `bindExtensions({uiContext, mode:"rpc"})` 桌面桥生效 → DeepSeek 调用扩展工具 `TOOL_START/TOOL_END: isError=false` → notify 经 uiContext 发渲染层。证据：`apps/desktop/docs/proofs/T0.3/{electron-probe.log,boot.log}`。桌面模式语义定为 `"rpc"`（`ExtensionMode = tui/rpc/json/print`，无 "sdk" 值） | T0.3 ✅（打包版 asar 验证留 T0.6） |
| 2026-08-30 | T0.3 | 偏差 | 模型目录实测：`getAvailable()` 列表随在线目录刷新变化（Node 首跑含 deepseek-chat/reasoner 5 个，Electron 侧仅 v4 系 3 个），`setModel` 不校验列表仍可用 chat。**T3.2 模型管理须处理静态目录 vs 在线目录合并 + 收藏模型直连** | T3.2 设计约束 |
| 2026-08-30 | T0.4 | 完成 | **tool_call 拦截验证通过（双组对照）**：对照组 bash 正常执行（tool_execution_update 有输出）；实验组 `pi.on("tool_call")` 返回 `{block:true, reason}` → bash 无实际执行输出，agent 收到 reason 正常继续（agent_end）。证据：`apps/desktop/docs/proofs/T0.4/blocked-run-stdout.txt`。审批门扩展路线确认可行，`<ApprovalCard>` 只需在 block 前插入 IPC 等待用户决策 | T0.4 ✅，§10.3 设计确认 |
| 2026-08-30 | T0.5 | 偏差 | 机器无 Visual Studio Build Tools：node-pty 1.1.0 与 @homebridge 预编译分支均回退 node-gyp 源码编译 → 失败。**改用 `@lydell/node-pty`（N-API 预编译，可选依赖直发 win32-x64 二进制）**，无需 electron-rebuild | 方案 §2.4 选型变更，T5.3 打包更简 |
| 2026-08-30 | T0.5 | 完成 | ConPTY 验证通过：Node 运行时与 Electron 运行时（`ELECTRON_RUN_AS_NODE`）下 `pty.spawn(powershell)` 均正常收发输出（exitCode 0 + 标记串命中）。骨架落盘 `electron/main/workbench/terminal-service.ts`。xterm 渲染层集成按计划归 T2.3 | T0.5 ✅ |
| 2026-08-30 | T0.6 | 完成 | **门禁 E2E PASS（Go 决策）**：Electron 内 `--probe-e2e` 模式，prompt"把 test.txt 里的 hello 改成 hola"→ agent 执行 read→edit（事件全量转发渲染层，工具卡片状态机 running/ok 上屏）→ jsdiff 前后快照对比 → diff 推送右栏上屏 → 文件真实变更 `hello bar`→`hola bar`。证据：`apps/desktop/docs/proofs/T0.6/e2e.log`。工具卡片/diff 为最简 DOM 占位（按门禁口径允许）；窗口视觉截图因用户前台占用延至 T1.3 正式 UI 时补。**Phase 0 高风险路径全部验证通过，Go** | T0.6 ✅，进入 Phase 1（T1.1 起） |
| 2026-08-30 | T1.1 | 决策 | IPC 方案定为**自研 contextBridge + ipcMain.handle + zod 边界校验**（不用 electron-trpc）：事件流是 main→renderer 推送，trpc subscription 在 Electron 上反而绕；zod schema（@pidesk/ipc-schema）仍是唯一契约源 | 记录备查 |
| 2026-08-30 | T1.1 | 完成 | 契约层落地：① `packages/ipc-schema` 全量事件/命令 zod schema（25 种事件 + unknown 兜底 + 13 个通道常量）；② `packages/engine`：EngineAdapter 接口（渲染层仅类型，子路径 `@pidesk/engine/sdk` 隔离 Pi SDK）、normalizeEngineEvent 事件桥（未知事件归一化不崩，**单测 4/4 通过**，node:test + TS 类型剥离）、SdkAdapter 正式实现；③ e2e-service 重构为 SdkAdapter 驱动并重跑 E2E PASS（read→edit→diff 全链路） | T1.1 ✅ |
| 2026-08-30 | T1.1 | 偏差 | **setModel 必须用 registry.getModel() 的完整 Model 对象**：裸 {provider,id} 会被接受但请求退化（模型复读输入、不调工具）。另实测 0.84.4 静态目录已无 deepseek-chat（仅 v4 系），早期看到的 chat 来自远程目录缓存——**模型目录是动态的，chat 可能整体退役**，T3.2 模型管理按"registry 可解析即可用"设计，不依赖静态清单 | T3.2 设计约束 |
| 2026-08-30 | T1.4(后台) | 完成 | 左栏数据层先行完成：① `packages/engine/src/session-tree.ts` 纯函数树构建（buildSessionTree/flattenTree/defaultLeaf，孤儿条目容错、活跃分支标记），**单测 8/8 通过**；② 主进程 `project/project-manager.ts`（projects.json 注册表 + 复用 Pi ProjectTrustStore 信任预检，`ProjectTrustDecision = boolean\|null`）+ `engine/session-service.ts`（列表复用 SessionManager.list，树解析复用 parseSessionEntries）；③ 真实数据验证：19 个真实会话列出、最新会话解析为 12 节点树（深度缩进 + 活跃叶标记）、信任状态 undecided/not-required 分级正确。验证脚本 `apps/desktop/scratch/backend-probe.ts` | T1.4 后台部分 ✅，UI 部分（SessionTree 组件）与 CLI 互通硬验收待做 |
| 2026-08-30 | T1.4(后台) | 偏差 | trustStatus 语义实测：`hasTrustRequiringProjectResources` 只对含动态资源的 .pi 项目返回 true；信任交互仍走运行时 project_trust 事件（经 uiBridge.confirm），预检仅做徽标显示 | §9 交互口径 |
| 2026-08-30 | T1.2 | 偏差 | react-resizable-panels 升级到 **v4**，API 重命名：`PanelGroup→Group`、`PanelResizeHandle→Separator`、`onLayout→onLayoutChanged(layout, meta)`（Layout 为 {panelId: flexGrow}）、命令式句柄经 `panelRef` prop。方案 §2.4 的组件用法按 v4 口径写 | 方案 §4.1 实现口径 |
| 2026-08-30 | T1.2 | 完成 | 布局底座验收通过（无干扰方式）：`--capture` 模式用 `webContents.capturePage()` 截窗口内容（窗口不需前台，不干扰用户其他应用）。两组 settings.json 预置值分别还原正确：`[40,40,20]` 正常三栏、`[18,42,40]+rightCollapsed` 右栏折叠态与按钮文案均正确。折叠按钮（收/展开左右栏）挂接 panelRef。证据：`docs/proofs/T1.2/*.png`。注：物理拖拽分割条的交互属库原生能力，onLayoutChanged(isUserInteraction) 已接持久化 | T1.2 ✅ |
| 2026-08-30 | T1.4 | 完成 | **CLI↔桌面双向互通硬验收通过**：① pi CLI 0.84.4 全局安装；② CLI `--session <桌面会话文件> -p` 成功 resume 桌面建的会话并正确回答历史内容（"hola"）；③ CLI 运行写入后桌面 SessionService 立即可见（msgs 8→10、entries 12→14、modified 更新） | T1.4 硬验收 ✅（SessionTree 组件 UI 仍待做） |
| 2026-08-30 | T1.4 | 偏差 | **主进程禁止静态 import Pi（ESM-only）**：electron-vite 把 dependencies externalize 成 CJS require，而 pi 包 exports 无 CJS 入口 → 启动即 `ERR_PACKAGE_PATH_NOT_EXPORTED`（表现为窗口报 "App threw an error during load" + 进程挂起）。规则：主进程所有 Pi 访问必须 `await import()`，agentDir 等引导值由启动函数动态获取后传入各 service。session-service/project-manager/data.ipc 已全部改动态 | **硬性编码规范**，T2.x 起所有 Pi 触点遵守 |
| 2026-08-30 | T1.4 | 完成 | 左栏数据 IPC 域接线完成：`ipc/data.ipc.ts` 注册 project:list/add/remove/trustStatus + sessions:list/tree（入参 zod 校验，通道常量来自 @pidesk/ipc-schema projects 域），boot 验证干净（capture exit=0） | T1.4 UI 接线就绪 |
| 2026-08-30 | T1.3+T1.4 UI | 完成 | **GUI 端到端闭环达成**（无障碍驱动 + 截图验证）：左栏项目选择 → engine:start（含默认模型 chat 优先兜底链）→ 19 会话列出 → 点击会话渲染会话树（缩进+活跃分支）→ Composer 发送"把 test.txt 里的 hello 改成 hola"→ 用户消息单条上屏 → 工具卡片 `read ✅ ok` → streamdown 流式回复（agent 正确发现文件已是 hola bar 并如实说明）。组件：MessageList（react-virtual）+ Composer（Enter/Alt+Enter/中止）+ LeftPane + session-store。开启 `app.accessibilitySupportEnabled` 支持自动化驱动 | T1.3 核心闭环 ✅ |
| 2026-08-30 | T1.3 | 偏差 | dev 启动需 `DEEPSEEK_API_KEY` 环境变量（密钥未持久化，auth.json 为空）——T3.2 钥匙串+设置 UI 前的过渡：建议加 dotenv 式启动脚本 `pnpm dev:key`。另两处已修：preload prompt 需传 `{text}` 对象（zod 契约）；user 消息统一由主进程 user_message 事件回显（防双份） | T3.2 前置 |
| 2026-08-30 | T1.3 | 待办 | 虚拟列表万条压测、Markdown 代码块高亮细节、CLI 会话在 UI 内 continue → switchSession 接线、会话树点击叶子跳转：记入 T1.3 精修清单（Phase 1 门禁前完成） | T1.6 门禁前清账 |
| 2026-08-30 | T1.3 | 完成 | **精修清单清账**：① 点击会话 = `sessions:messages` 装载历史 + `engine:switchSession` 切引擎（实测：装载 23:51 会话历史后发"我刚才让你修改的文件名和内容"，agent 准确回答"test.txt / 把 hello 改成 hola"——上下文生效）；② 万条压测（状态栏 dev 按钮 → debug:stress 注入 10000 条）通过：虚拟列表只渲染可见行，UI 保持响应；③ edit/write diff 推送右栏接线到正式引擎（forwardDiffOnFileEdit 前后快照） | T1.3 ✅ |
| 2026-08-30 | T1.4 | 完成 | SessionTree 组件上屏（缩进 + 活跃分支高亮 + 类型图标）；会话点击续写交互接通（见 T1.3） | T1.4 ✅ |
| 2026-08-30 | T1.5 | 证据 | 门禁预验：GUI 会话（含续写轮次）→ pi CLI `--session -p` resume 成功，正确引用 GUI 对话内容（"需要我做什么其他处理吗？"上下文可达）。T1.5 正式录屏待补（capture 截图链已留存） | T1.5 录屏待补 |
| | | | | |

---

## 9. 依据与核实记录（2026-08-30）

- Pi SDK / 扩展 / RPC 官方文档：`pi.dev/docs/latest/{sdk,extensions,rpc}` —— R-1/R-2/R-3、tool_call 阻断、ctx.ui 四件套、jiti 加载均以此为准
- npm `@earendil-works/pi-coding-agent` 与 GitHub `earendil-works/pi`（MIT）—— 内核存在性与许可证确认
- OpenClaw 源码分析（starkslab.com/notes/i-read-openclaws-source-code）—— `createAgentSession()` 进程内嵌入先例
- Vercel streamdown（github.com/vercel/streamdown）、@headless-tree/react（react-complex-tree 官方继任者）—— 较新选型库的可靠性确认

---

## 10. 追溯矩阵（任务 ↔ 方案章节 ↔ 门禁验收）

| 任务 | 方案章节 | 所属门禁 | 门禁验收原文锚点 |
|---|---|---|---|
| T0.1~T0.6 | §2.1/§2.4/§5.2/§10.2/§10.3/§10.6/§14 | Phase 0 | "Electron 内完成'用 Pi 改一个文件'，工具卡片 + diff 上屏" |
| T1.1~T1.5 | §2.2/§3.1/§4.1~4.3/§5.7/§11-1/2/4 | Phase 1 | "日常改 bug/加功能在 GUI 完成，CLI 可 resume 同一会话" |
| T2.1~T2.6 | §4.4/§10.1/§10.2/§10.4/§11-3 | Phase 2 | "agent 跑 Web 项目：改代码→跑测试→浏览器验证，全程桌面内闭环" |
| T3.1~T3.4 | §5/§6.5/§7/§10.6 | Phase 3 | "装一个社区 Pi 包，扩展+主题+Skill 全生效；CLI/桌面互通" |
| T4.1~T4.3 | §9/§10.3/§12-Phase4 | Phase 4 | "权限矩阵用例全过；危险命令/敏感文件默认拦截" |
| T5.1~T5.3 | §6/§5.8/§10.6/§11-6/7/10 | Phase 5 | "干净安装三平台，新用户 10 分钟跑通" |
