---
name: pi-wood Desktop Conversation Workspace
description: A quiet, factual desktop Agent workbench centered on project-bound conversation and execution.
colors:
  workbench-ink: "#17181b"
  panel-graphite: "#1c1e22"
  composer-slate: "#202226"
  hover-graphite: "#24262b"
  active-graphite: "#2b2e34"
  control-hover: "#2d3035"
  chip-graphite: "#292b30"
  menu-graphite: "#292b2f"
  text-primary: "rgb(255 255 255 / 90%)"
  text-secondary: "rgb(255 255 255 / 67%)"
  text-muted: "rgb(255 255 255 / 56%)"
  hairline: "rgb(255 255 255 / 12%)"
  hairline-strong: "rgb(255 255 255 / 18%)"
  action-blue: "#4d8dff"
  ready-green: "#72b58b"
  permission-amber: "#d9a45b"
  error-coral: "#f07b78"
  submit-porcelain: "#e3e4e6"
  submit-ink: "#1a1b1e"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.68
  input:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  icon: "5px"
  control: "7px"
  action: "8px"
  menu: "12px"
  container: "14px"
  pill: "99px"
spacing:
  xs: "3px"
  sm: "7px"
  md: "9px"
  lg: "12px"
  xl: "14px"
  xxl: "24px"
components:
  composer-shell:
    backgroundColor: "{colors.composer-slate}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.container}"
    width: "780px"
  composer-control:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "29px"
    padding: "0 7px"
  composer-control-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    height: "29px"
    padding: "0 7px"
  submit-action:
    backgroundColor: "{colors.submit-porcelain}"
    textColor: "{colors.submit-ink}"
    rounded: "{rounded.action}"
    size: "30px"
  attachment-chip:
    backgroundColor: "{colors.chip-graphite}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 5px 0 8px"
  quick-prompt:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    height: "31px"
    padding: "0 11px"
---

# Design System: pi-wood Desktop Conversation Workspace

## Overview

**Creative North Star: "安静的操作台 / The Quiet Operations Desk"**

pi-wood 的 renderer 首页采用 Operate 模式：它首先是一个可信、克制的桌面 Agent 工作台，而不是展示页。视觉表达通过中性深色层级、紧凑控件、清楚的运行状态和稳定的主轴完成；对话是主内容，工具与配置只在需要时展开。

首页的视觉承诺是“事实先于装饰”。项目、权限、上下文、模型、思考级别和生成状态必须来自当前项目与 Pi runtime；界面不预演不存在的模型、额度、分支或权限能力。空态帮助用户开始，会话态帮助用户持续操作，两者共享同一条居中的对话轴。

**Key Characteristics:**

- 深色中性、低彩度、以层级和细边界组织信息。
- 高密度但不拥挤；标签、图标和状态只保留操作所需信息。
- 空态标题与宽 Composer 居中；进入会话后消息区占据主空间，Composer 固定在底部。
- 所有首页可见能力都对应真实 Pi IPC 或当前 renderer 状态。

## Colors

以近黑蓝灰作为连续工作台，颜色只用于操作、就绪、权限与错误等有语义的状态。

### Primary

- **Action Blue:** 只用于焦点、上下文进度与确实可执行的强调动作；不要把它当装饰色铺满界面。

### Secondary

- **Ready Green:** 只表达引擎已就绪或操作成功。
- **Permission Amber:** 只表达权限选择与需要注意的执行边界。
- **Error Coral:** 只表达失败、拒绝或可恢复的错误。

### Neutral

- **Workbench Ink:** renderer 首页和消息主区的最底层背景。
- **Panel Graphite:** 相邻面板、用户消息与基础输入表面的共同中性色。
- **Composer Slate:** Composer 外壳与键盘提示的集中操作表面。
- **Hover Graphite / Active Graphite:** 用于悬停、选中与更高一级的局部层级。
- **Primary / Secondary / Muted Text:** 三级文本对比；正文、说明和非关键元数据不得混用同一亮度。
- **Hairline / Strong Hairline:** 默认与强调边界；两者都保持细薄，不形成厚重卡片墙。
- **Submit Porcelain:** 发送与中断共用的高对比动作表面，强调“当前唯一主动作”。

### Named Rules

**The Factual Color Rule.** 状态色只能表示 renderer 或 Pi runtime 已经知道的事实，不能暗示尚未连接、尚未统计或不存在的能力。

**The Quiet Accent Rule.** 蓝色与状态色只占少量界面；常态结构由中性层级承担。

## Typography

**Display Font:** Inter（回退到 macOS 系统中文无衬线）  
**Body Font:** Inter（回退到 macOS 系统中文无衬线）  
**Label/Mono Font:** SF Mono（回退到 Menlo、Consolas）

**Character:** 字体系统接近原生桌面工具：正文平静、标签紧凑、运行信息精确。层级主要依赖字号、字重与明度，不使用大面积全大写或营销式展示字。

### Hierarchy

- **Display:** 仅用于首页空态问题句；窄屏下降为 24px，但仍保持居中和克制。
- **Body:** 用于消息正文，限制为约 72ch，保证长任务对话的可读性。
- **Input:** 用于 Composer 主输入，较正文略大，支持多行并随内容增长。
- **Label:** 用于控件、附件、快捷任务和菜单辅助信息。
- **Mono:** 用于 token 数量、快捷键与工具性元数据，不用于大段普通说明。

### Named Rules

**The Working Scale Rule.** 首页只保留一个展示级标题，其余内容停留在桌面操作尺度；不要用超大字制造虚假的主次。

## Layout

首页保持单一居中对话轴。消息列和会话态 Composer 的最大宽度为 780px；消息主区左右留白使用随窗口变化的 clamp，窄于 900px 时收敛为 18px。助手消息正文最大约 72ch，用户消息靠右并限制气泡宽度。

空态时，会话主容器垂直居中，标题、说明和 Composer 形成一个整体；空态内容宽度为 720px，Composer 宽度不超过视口减 48px。存在消息、流式缓冲或生成状态后，消息列表成为可滚动的弹性主区，Composer 回到底部，不改变对话主轴。

Composer 内部从上到下分为项目上下文行、可选附件条、输入区与控制行。左侧控制是添加和真实权限，右侧依次是真实上下文、动态模型、动态思考级别以及发送/中断；控件顺序是操作语义，不应为了视觉对称调换。

窄于 720px 时隐藏部分次要控件文字而保留图标和可访问名称，弹出菜单贴合可用边缘；不要把桌面 Composer 拆成第二套移动导航。

### Named Rules

**The One Conversation Axis Rule.** 空态、消息和 Composer 始终共享同一居中轴线，状态切换不能让输入器横向跳动。

**The Bottom-While-Working Rule.** 有会话内容时，消息区占主空间且 Composer 沉底；无内容时才将启动组合居中。

## Elevation & Depth

系统以 1px 边界和中性色调分层为主，阴影只属于需要从工作台中临时浮起的表面。Composer 使用柔和的低幅环境阴影以稳定输入焦点；弹出菜单使用更强的深色阴影；消息、按钮和常驻面板保持平面化。

### Shadow Vocabulary

- **Composer Ambient:** `0 16px 42px rgb(0 0 0 / 20%)`，只用于 Composer 外壳。
- **Menu Lift:** `0 18px 50px rgb(0 0 0 / 42%)`，只用于 Composer 的临时菜单。
- **Ready Glow:** `0 0 8px color-mix(in srgb, var(--ok) 60%, transparent)`，只用于真实就绪点。

### Named Rules

**The Flat-by-Default Rule.** 常驻表面使用色调与发丝边界分层；只有临时浮层和主要输入器可以使用阴影。

## Shapes

形状语言由小半径控件和中等半径容器组成：图标内控件使用 5px，常规 Composer 控件使用 7px，动作与 chips 使用 7–8px，菜单使用 12px，Composer 主容器使用 14px。面板与表面边界统一为 1px；除进度轨、状态点和滚动条外，不使用胶囊形轮廓。

Lucide 图标统一使用 1.5 stroke，并保持在 11–16px 的紧凑桌面尺度。图标只表达已有动作或状态，不混用 emoji、填充插画或不同图标体系。

### Named Rules

**The Nested Radius Rule.** 子控件半径必须小于其所在容器，避免所有元素都像独立卡片。

**The Hairline Boundary Rule.** 面板分隔、Composer、chips 和菜单使用 1px 边界；不得用粗描边制造层级。

## Components

### Conversation Home

- **Empty state:** 标题与说明居中，文案直接引导“描述目标、添加相关文件”，下方 Composer 与快捷任务保持同一 720px 轴线。
- **Working state:** 虚拟化消息列表占据可滚动主区；流式输出使用细窄光标反馈，不引入独立 loading 大卡片。
- **Messages:** 助手消息平铺阅读，用户消息使用低对比中性气泡，工具调用使用 1px 边界的紧凑状态行。

### Composer

**Character:** 一个项目绑定、事实驱动的操作台，而不是通用聊天输入框。

- **Container:** 14px 主半径、1px 边界与轻环境阴影；空态宽 720px，会话态遵循 780px 对话轴。
- **Project context:** 顶部 38px 行显示当前项目名称与真实 engine ready 状态；路径过长时省略，不伪造分支或 workspace 信息。
- **Attachments:** 最多显示为横向可滚动 chips；名称截断但完整路径保留在 title，移除按钮有独立可访问名称。
- **Input:** 无内层边框，最小 64px，随内容增长到 176px；未选择项目时禁用并说明原因。
- **Controls:** 左侧添加和权限，右侧上下文、模型、思考与提交。disabled、hover、active 必须保持可辨认。

### Composer Menus

- **Shape:** 12px 半径、1px 强边界、6px 内边距与 Menu Lift 阴影。
- **Behavior:** 从触发器附近向上展开，Escape 关闭后焦点返回触发器；首个可用菜单项自动获得焦点。
- **Truth source:** 权限保存到真实 settings；上下文与 compact、模型列表与选择、思考级别都来自对应 Pi IPC。没有数据时显示明确空态，不用示例值填充。

### Submission

- **Ready:** 使用高对比 Submit Porcelain 方形动作按钮与上箭头。
- **Disabled:** 保持相同尺寸，以更暗表面和低对比图标表达不可用。
- **Streaming:** 同一位置切换为 stop 图标并调用真实 abort；发送和中断不能同时出现。
- **Keyboard:** Enter 发送，Shift+Enter 换行；Alt+Enter 仅在生成时排队，且当前实现不允许排队消息携带附件。

### Icons

- **System:** 仅使用共享 `Icon` 包装器输出的 Lucide 图标。
- **Stroke:** 所有首页图标统一 1.5 stroke；常规图标 14–15px，小型附属 chevron 约 11px，提交图标 16px。
- **Accessibility:** 装饰图标保持隐藏，图标按钮通过 `aria-label` 或可见文字命名。

## Do's and Don'ts

### Do:

- **Do** 保持空态居中、会话态 Composer 沉底，并让二者共享同一对话轴。
- **Do** 将项目上下文、附件、权限、上下文用量、模型、思考级别与生成状态绑定到真实 renderer 状态和 Pi IPC。
- **Do** 使用 1px 边界、7–8px 控件半径、12px 菜单半径和 14px Composer 主容器半径。
- **Do** 使用 Lucide 1.5 stroke，并为纯图标按钮提供可访问名称和可见焦点。
- **Do** 在数据不可用时禁用控件或显示诚实空态，例如“发送第一条消息后显示真实上下文用量”。

### Don't:

- **Don't** 虚构模型、额度、分支、上下文用量、权限结果或尚未接入的工具能力。
- **Don't** 把 Composer 控件重排成对称装饰；左侧输入来源与权限、右侧 runtime 与提交的语义分组必须保留。
- **Don't** 用渐变、玻璃卡片、强霓虹或大面积状态色破坏中性工作台。
- **Don't** 为每条消息增加卡片、头像和阴影；消息内容是主角，工具卡按需出现。
- **Don't** 在首页混入 emoji、填充图标或非 Lucide 图标体系。
