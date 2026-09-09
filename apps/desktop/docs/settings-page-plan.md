# 设置从 Modal 改为全窗口页面 —— 实施规划

> 目标：把 `SettingsModal`（shadcn Dialog 弹窗）重构为参考 Codex 桌面版设置页的**全窗口设置页面**：
> 左侧栏 = 返回入口 + 设置大项导航（分组），右侧 = 当前大项的标题 + 分组卡片式配置详情。
> 打开设置即进入页面，返回后底层工作区布局/会话状态完全无损。

## 1. 现状盘点（代码事实）

| 项 | 现状 |
|---|---|
| 外壳 | `components/center/SettingsModal.tsx`，`Dialog` + 固定 `h-[560px]`，左 `w-44` 导航 + 右滚动区 |
| 大项 | 12 个扁平 tab：providers / model / approval / theme / ui / ext / plugins / subagent / memory / usage / archive / worktree |
| 内联 section | providers、model、approval、theme、ui、ext 六个约 250 行内联 JSX + 数据逻辑（`window.pi.providerList/settingsGet/engineModels/...`） |
| 独立面板 | PluginsPanel / SubagentPermissionsPanel / MemorySettingsPanel / UsageSettingsPanel / ArchiveSettingsPanel / WorktreeSettingsPanel —— 已是自包含组件，可直接复用 |
| 入口 | ① LeftPane 底部「设置」按钮 → `onOpenSettings`；② 全局事件 `piwood:open-settings`（CommandPalette 等）；App.tsx `settingsOpen` state 条件渲染 |
| 反馈 | 保存成功提示是左导航底部一行小字（`saved` state + 2s 定时清除），项目已有 sonner `Toaster` |
| 窗口 chrome | 无全宽顶栏；macOS 红绿灯（WindowLights）/ Windows 控件（WinWindowControls）悬浮在内容之上，拖拽带靠 `app-drag` 类 |

## 2. 方案选型

**推荐：App 层「不透明覆盖层页面」，不引入路由库。**

- 应用目前零路由，所有浮层都是 state/事件驱动；为一个设置页引入 react-router 不成比例。
- 实现：App.tsx 中 `settingsOpen && <SettingsPage onClose={...} />`，`SettingsPage` 以
  `absolute inset-0 z-40 bg-surface-app` 覆盖整个窗口（挂在 `AppShell` 外层 div 内、`WindowLights/WinWindowControls` 之前，保证红绿灯/窗口控件仍悬浮可点）。
- 底层 `AppShell` 三栏**不卸载**：面板尺寸、折叠态、正在流式输出的会话全部原地保留，返回零成本。
- 关闭语义：Esc / 「返回应用」按钮，均走 `onClose`。

## 3. 信息架构：12 扁平 tab → 分组导航

参考图二的「个人 / 集成 / 编码」分组，建议（组名与归属可再调）：

- **通用**：主题、界面
- **模型**：模型源（密钥）、默认模型、审批策略、用量
- **Agent**：子代理、记忆、工作树、归档
- **扩展**：扩展与包、插件

导航项加图标（`Icon` 组件已有 settings/package/brain 等，缺的补 lucide 映射）。
选中态持久化：`settings.ui.lastSection`（settings-store 已有 `ui` 段，扩展一个字段即可），下次打开回到上次大项。

## 4. 页面布局与视觉规格

```
┌─────────────────────────────────────────────────────┐
│ (红绿灯避让区)                    [app-drag 拖拽带]  │
│ ┌─ 左栏 w-60 ─  ┌──────── 右内容区（滚动）────────┐ │
│ │ ← 返回应用   │  │  模型源            (h1 24px)   │ │
│ │ 🔍 搜索设置… │  │                                 │ │
│ │ 通用         │  │  ┌─ 卡片：rounded-xl border ─┐  │ │
│ │  ⚙ 主题     │  │  │ 行：标题+描述   [控件]    │  │ │
│ │  ▦ 界面     │  │  │ ── 分隔线 ──              │  │ │
│ │ 模型         │  │  │ 行：…          [Switch]  │  │ │
│ │  ⛾ 模型源 ● │  │  └───────────────────────────┘  │ │
│ │  …          │  │  卡片之间 space-y-6，max-w-3xl   │ │
│ └─────────────┘  └─────────────────────────────────┘ │
─────────────────────────────────────────────────────┘
```

- 行规范：`py-3.5 px-5`，左侧标题（14px medium）+ 描述（12px muted），右侧控件（Select/Switch/Button）垂直居中；行间 `border-b border-border/50`。
- 右内容区顶部 h1 = 当前大项名，随导航切换（可加 120ms 淡入）。
- 左栏顶部「← 返回应用」；搜索框第一期可占位隐藏（P2 再做过滤）。
- 背景：页面底色 `bg-surface-app`，左栏 `bg-surface-chrome`（沿用现有分层令牌，不新增颜色）。
- 窄窗（<900px）：左栏收成图标栏（w-14，仅图标 + tooltip）。

## 5. 组件拆分与文件变更

**新增**（`components/settings/`）：

| 文件 | 职责 |
|---|---|
| `SettingsPage.tsx` | 覆盖层外壳：左导航 + 右内容 + Esc/返回 + 拖拽带；持有 `section` state |
| `SettingsNav.tsx` | 分组导航（数据驱动：`sections` 常量含 group/icon/label） |
| `settings-sections.ts` | 大项注册表（id/label/group/component），导航与内容区共用 |
| `sections/ProvidersSection.tsx` | 密钥列表（自 SettingsModal 迁出，含 providerList/providerSetKey 逻辑） |
| `sections/ModelSection.tsx` | 默认模型 + 辅助小模型（engineReady 依赖逻辑迁出） |
| `sections/ApprovalSection.tsx` | 四档审批 Select |
| `sections/ThemeSection.tsx` | 主题 Select |
| `sections/UiSection.tsx` | 四个 Switch |
| `sections/ExtSection.tsx` | 扩展/Skills/Prompt/包安装 |
| `components/settings/SettingRow.tsx` | 通用「标题+描述+控件」行组件（卡片由若干 Row 组成） |

**修改**：

- `App.tsx`：`settingsOpen` 渲染目标从 `SettingsModal` 换成 `SettingsPage`（事件协议 `piwood:open-settings` 不变，CommandPalette/LeftPane 零改动）。
- `stores/settings-store.ts`：`ui` 段加 `lastSection?: string`（含默认值与 merge 兼容）。

**删除**：`components/center/SettingsModal.tsx`（迁移完成、比对无差异后移除）。

**不动**：六个已独立的面板组件（作为对应大项的内容直接挂入，外层包统一标题/卡片样式）；`PackageMarket` 弹窗本期不动（列后续）。

## 6. 行为与交互细节

1. **数据加载改按需**：现在外壳 `useEffect` 一次性拉 providerList/extensions/resources/packages/settingsGet 全集；拆分后各 Section 自己拉自己（providers 列表只在模型源页拉，模型列表只在默认模型页且 `engineReady` 时拉）。省 IPC、避免切页陈旧。
2. **保存反馈统一 sonner toast**：废弃左栏底部小字 `saved`；`flash()` → `toast.success(...)`。
3. **Esc 关闭**：页面级 keydown 监听（`e.key === "Escape"` → onClose），与 Dialog 现行为一致；注意 Dialog 原有焦点陷阱逻辑不再需要。
4. **动画**：进入 `animate-in fade-in-0 duration-200`（或 GSAP 与折叠同族 power2.out），尊重 `prefers-reduced-motion`；内容区切页 120ms 淡入。
5. **窗口拖拽**：页面顶部 12px 带 `app-drag`，左右导航/内容容器 `app-no-drag`——与 AppShell 现有约定一致，否则 mac 红绿灯区域和移窗会出问题（AppShell 注释里踩过：可拖区按 DOM 顺序累积，SettingsPage 必须渲染在 WindowLights 之前）。
6. **密钥输入**：保持 `type="password"` + 占位「已配置（输入可覆盖）」语义不变。

## 7. 实施阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| T-A 骨架 | SettingsPage 覆盖层 + 分组导航 + 返回/Esc + 拖拽带 + 空内容区 | 打开/关闭不扰动底层布局；红绿灯与 Windows 控件可点；页面可拖窗 |
| T-B 迁移 | 6 个内联 Section 拆出 + SettingRow 卡片化 + 6 个既有面板挂入 + toast 替换 | 12 大项功能与旧 modal 全量对齐（保存密钥/默认模型/审批/主题/UI 开关/扩展重载/包安装） |
| T-C 打磨 | lastSection 持久化、切页淡入、窄窗图标栏、（可选）导航搜索过滤 | typecheck 通过；手动走查截图存 `docs/proofs/` |

风险点：① `ModelSection` 的模型列表依赖引擎就绪，迁移时保持 `engineReady` 守卫；② `ExtSection` 包安装是长任务（2 分钟），输出区 `pkgOutput` 状态留在 Section 内、切页会丢——如要保留可提升到 SettingsPage 层，T-B 决策。

## 8. 实施结果（2026-09-09，T-A/B/C 已完成）

- 已落地：`components/settings/`（SettingsPage / SettingsNav / SettingRow / settings-sections 注册表 + 6 个新 Section）、`settings.ui.lastSection` 持久化、包安装状态提升到页面层、旧 `SettingsModal.tsx` 移除、审批策略改行式「当前/选用」。
- 审批策略从 Select 改为行式「选用」按钮（更贴参考稿），保存即生效语义不变。

### 已知小项（待后续处理）

1. **既有 6 个面板内部样式未卡片化**：插件/子代理/记忆/用量/归档/工作树直接挂入新页面，内部仍是各自旧风格（未统一为 SettingCard 行式）；功能完整，样式统一留到下一轮走查。
2. **绿键平铺菜单悬浮在设置页之上（预期行为）**：WindowLights 的平铺菜单为 z-40，高于设置页 z-20——macOS 长按绿键呼出的「移动与调整大小」菜单会盖在设置页上层，属窗口控制优先的正确层级，无需修复；如未来出现遮挡困扰，再评估给设置页让位逻辑。
