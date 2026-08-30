/** preload 暴露的 window.pi 全局类型（唯一声明处） */
export {};

declare global {
  interface Window {
    pi: {
      ping(): Promise<{ pong: boolean; electron: string; node: string }>;
      onUiNotify(cb: (data: { message: string; type: string }) => void): () => void;
      onProbeLog(cb: (line: string) => void): () => void;
      onEngineEvent(cb: (event: Record<string, unknown>) => void): () => void;
      onDiff(cb: (data: { file: string; patch: string }) => void): () => void;
      onE2EDone(cb: (data: { ok: boolean; error?: string }) => void): () => void;
      prompt(text: string): Promise<void>;
      settingsGet(): Promise<Record<string, unknown>>;
      settingsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
      engineStart(projectDir: string): Promise<boolean>;
      engineSteer(text: string): Promise<void>;
      engineFollowUp(text: string): Promise<void>;
      engineAbort(): Promise<void>;
      engineNewSession(): Promise<void>;
      engineModels(): Promise<Array<{ provider: string; id: string }>>;
      projectList(): Promise<unknown>;
      projectAdd(path: string): Promise<unknown>;
      projectPick(): Promise<string | undefined>;
      projectTrust(path: string): Promise<string>;
      sessionsList(path: string): Promise<unknown>;
      sessionsTree(file: string): Promise<unknown>;
      sessionsMessages(file: string): Promise<unknown>;
      engineSwitchSession(file: string): Promise<boolean>;
      debugStress(count: number): Promise<number>;
      debugCapture(file: string): Promise<boolean>;
    };
  }
}
