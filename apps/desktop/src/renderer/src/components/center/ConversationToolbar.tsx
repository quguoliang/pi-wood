import { useSessionStore } from "../../stores/session-store";
import { Icon } from "../ui/Icon";

export function ConversationToolbar({ environmentOpen, onEnvironmentToggle }: { environmentOpen: boolean; onEnvironmentToggle: () => void }): React.JSX.Element {
  const activeProject = useSessionStore((state) => state.activeProject);
  const engineReady = useSessionStore((state) => state.engineReady);
  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop() ?? "工作台";

  return (
    <header className="conversation-toolbar">
      <div className="conversation-title"><strong>{projectName}</strong></div>
      <div className="engine-state"><i className={engineReady ? "ready" : ""} /><span>Pi 引擎 · {engineReady ? "就绪" : "等待项目"}</span></div>
      <span className="spacer" />
      <nav className="conversation-controls" aria-label="工作区操作">
        <button className={`toolbar-control ${environmentOpen ? "active" : ""}`} type="button" onClick={onEnvironmentToggle} aria-label="显示或隐藏运行时信息" title="运行时信息"><Icon name="panelTop" /></button>
        <button className="toolbar-control" type="button" onClick={() => window.dispatchEvent(new CustomEvent("piwood:toggle-inspector"))} aria-label="显示或隐藏右侧工作台" title="右侧工作台"><Icon name="panelRight" /></button>
      </nav>
    </header>
  );
}
