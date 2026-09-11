import { PromptSuggestion } from "@pi-wood/ui-kit";
import { ComposerControls } from "./ComposerControls";
import { ProjectPicker } from "./ProjectPicker";
import { GitBranchChip } from "./GitBranchChip";
import { Icon } from "../ui/Icon";
import { greeting } from "../../lib/time";
import { isLargePaste } from "../../lib/utils";
import { useComposerController, type ComposerController } from "../../hooks/use-composer-controller";
import { useGoalStore } from "../../stores/goal-store";
import { usePendingContextStore } from "../../stores/pending-context-store";
import { openWorkbenchFile } from "../../stores/workbench-store";

const quickPrompts = [
  "检查这个项目当前的状态和主要问题",
  "运行现有测试并修复失败项",
  "审查当前未提交的代码变更",
  "解释这个项目的结构和核心流程",
];

/** 输入框本体：透明，承载附件条/片段芯片与文本框，落在亮灰输入卡内。 */
function ComposerInput({ c }: { c: ComposerController }): React.JSX.Element {
  const snippets = usePendingContextStore((s) => s.items);
  const removeSnippet = usePendingContextStore((s) => s.remove);
  return (
    <div>
      {(c.attachments.length > 0 || snippets.length > 0) && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pt-2.5" aria-label="已添加的上下文">
          {c.attachments.map((item) => (
            <span key={item.path} title={item.path} className="flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 text-xs text-muted-foreground">
              <Icon name={item.kind === "image" ? "image" : "file"} className="size-3.5" />
              <span className="truncate">{item.name}</span>
              <button type="button" onClick={() => c.removeAttachment(item.path)} aria-label={`移除 ${item.name}`} className="grid size-4 place-items-center rounded text-muted-foreground transition-[background-color,color,transform] motion-safe:active:scale-[0.9] hover:bg-accent hover:text-foreground">
                <Icon name="x" className="size-3" />
              </button>
            </span>
          ))}
          {/* 「添加到对话」片段芯片：点击回跳文件面板对应行，× 移除 */}
          {snippets.map((s) => (
            <span
              key={s.id}
              title={`${s.path}:${s.start}-${s.end}（点击在文件面板中打开）`}
              className="flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs text-foreground"
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5"
                onClick={() => openWorkbenchFile(s.path, s.start)}
                aria-label={`打开 ${s.name}`}
              >
                <Icon name="file" className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {s.name}
                  <span className="ml-1 font-mono text-muted-foreground">{s.start}-{s.end}</span>
                </span>
              </button>
              <button type="button" onClick={() => removeSnippet(s.id)} aria-label={`移除 ${s.name} 片段`} className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-[background-color,color,transform] motion-safe:active:scale-[0.9] hover:bg-accent hover:text-foreground">
                <Icon name="x" className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
        {/*
          刻意不给 disabled:opacity-60：切对话的 1~2s 里 canCompose 会短暂为 false，
          整块输入框闪暗再亮回来（与模型名闪回占位同源，用户报障「底部闪动」）。
          禁用语义保留（不可输入 + cursor-not-allowed），只是不再做视觉降档。
        */}
        <textarea
          ref={c.textareaRef}
          value={c.input}
          onChange={(event) => c.setInput(event.target.value)}
          onKeyDown={c.onKeyDown}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (text && isLargePaste(text)) {
              event.preventDefault();
              void c.addPastedText(text);
            }
          }}
          placeholder={c.canCompose ? "描述任务，或添加文件作为上下文" : "选择项目，或直接开始对话"}
          rows={1}
          disabled={!c.canCompose}
          className="block max-h-44 min-h-[40px] w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
    </div>
  );
}

/** 亮灰输入卡（主层）：输入框 + 底部操作栏，二者同处一块、不拆分。 */
function InputCard({ c, raised }: { c: ComposerController; raised: boolean }): React.JSX.Element {
  const goalArm = useGoalStore((s) => s.arm);
  const setArm = useGoalStore((s) => s.setArm);
  return (
    <div
      className={
        "relative z-10 rounded-2xl border border-white/10 bg-[var(--composer-bg)] p-1.5 shadow-[0_22px_50px_-22px_rgba(0,0,0,0.85)]" +
        (raised ? " -mt-7" : "")
      }
    >
      <ComposerInput c={c} />
      <ComposerControls
        engineReady={c.engineReady}
        streaming={c.streaming}
        aborting={c.aborting}
        canSend={c.canSend}
        approvalMode={c.approvalMode}
        runtime={c.runtime ?? {}}
        models={c.models}
        providerNames={c.providerNames}
        thinkingLevels={c.thinkingLevels}
        onPickFiles={() => void c.pickFiles()}
        onOpenPalette={() => window.dispatchEvent(new Event("piwood:open-command-palette"))}
        onApprovalChange={(mode) => void c.changeApproval(mode)}
        onModelChange={(model) => void c.changeModel(model)}
        onThinkingChange={(level) => void c.changeThinking(level)}
        onCompact={c.compact}
        onSend={() => void c.send("prompt")}
        onAbort={() => void c.abort()}
        goalArm={goalArm}
        onToggleGoal={() => setArm(!goalArm)}
      />
    </div>
  );
}

/**
 * 叠拼主体：
 * - 顶部芯片条 = 独立浅灰面，位于下层（z-0），底部多留 pb-7 供输入卡压住；
 * - 输入卡 = 亮灰主层（z-10），用 -mt-7 负向外叠到芯片条下半部之上，只露出上方芯片。
 */
function ComposerBody({ c, header }: { c: ComposerController; header?: React.ReactNode }): React.JSX.Element {
  if (!header) return <InputCard c={c} raised={false} />;
  return (
    <div className="relative">
      <div className="z-0 mx-4 flex items-center gap-1 rounded-t-2xl bg-[var(--composer-chip-bg)] px-2.5 pb-8 pt-2">
        {header}
      </div>
      <InputCard c={c} raised />
    </div>
  );
}

/** 空态：垂直居中 + 时间问候 + 叠拼卡片 + 快捷提示。首屏低频，用克制的错峰淡入。 */
function OnboardingComposer({ c }: { c: ComposerController }): React.JSX.Element {
  const enter = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out [animation-fill-mode:both]";
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-8">
      <div className="w-full max-w-[var(--pk-chat-width,48rem)]">
        <h1 className={`mb-8 text-center text-[27px] font-semibold leading-tight tracking-tight ${enter}`}>
          {greeting()}
          <span className="text-muted-foreground">有什么想让我帮忙的？</span>
        </h1>

        <div className={enter} style={{ animationDelay: "80ms" }}>
          <ComposerBody
            c={c}
            header={
              <>
                <ProjectPicker activeProject={c.activeProject} />
                <GitBranchChip git={c.runtime?.git} />
              </>
            }
          />
        </div>

        {c.error && <div role="alert" className="mt-2 text-center text-xs text-destructive">{c.error}</div>}
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="常用任务">
          {quickPrompts.map((prompt, i) => (
            <div key={prompt} className={enter} style={{ animationDelay: `${160 + i * 45}ms` }}>
              <PromptSuggestion onClick={() => { c.setInput(prompt); requestAnimationFrame(() => c.textareaRef.current?.focus()); }}>
                {prompt}
              </PromptSuggestion>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 对话态：底部停靠，隐藏头部芯片，只留亮灰输入卡主体。 */
function DockedComposer({ c }: { c: ComposerController }): React.JSX.Element {
  return (
    <section className="shrink-0 px-8 pb-4 pt-2" aria-label="发送消息">
      <div className="mx-auto w-full max-w-[var(--pk-chat-width,48rem)]">
        <ComposerBody c={c} />
        {c.error && <div role="alert" className="mt-1.5 text-center text-xs text-destructive">{c.error}</div>}
      </div>
    </section>
  );
}

export function Composer(): React.JSX.Element {
  const c = useComposerController();
  return c.hasConversation ? <DockedComposer c={c} /> : <OnboardingComposer c={c} />;
}
