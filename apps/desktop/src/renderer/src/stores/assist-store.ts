import { create } from "zustand";

/**
 * T7.9 会话辅助 store：暂存主进程回推的一次 recap + 建议追问。
 * 用「捕获时的会话信号」关联失效：出现新消息（items 变长）或切换会话即隐藏，无需显式清除。
 */
interface AssistState {
  recap: string;
  suggestions: string[];
  /** 生成时所属会话 id */
  session: string;
  /** 生成时主会话 items 长度，作为"是否仍是最新一轮"的关联标记 */
  forItemsLen: number;
  dismissed: boolean;
  set(data: { recap: string; suggestions: string[]; session: string; forItemsLen: number }): void;
  dismiss(): void;
}

const EMPTY: Pick<AssistState, "recap" | "suggestions" | "session" | "forItemsLen" | "dismissed"> = {
  recap: "",
  suggestions: [],
  session: "",
  forItemsLen: -1,
  dismissed: false,
};

export const useAssistStore = create<AssistState>((set) => ({
  ...EMPTY,
  set: (data) => set({ ...data, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
}));
