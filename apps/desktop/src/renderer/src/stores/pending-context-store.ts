import { create } from "zustand";

/**
 * 「添加到对话」待发送片段（T9 选中引用，Cursor/Trae 同款交互）：
 * - 编辑器/终端选中后经「添加到对话」浮标投递到这里，composer 芯片条渲染；
 * - 点击芯片回跳文件面板对应行（复用 requestFile → revealLineInCenter 链路）；
 * - 发送时由 use-composer-controller 把片段展开为带 `path:起-止` 头的代码块拼进消息，
 *   agent 侧零协议改动；发送成功即清空。
 * - 按 `path:start-end` 去重；上限 8 个，防止 composer 塞爆。
 */
export interface PendingSnippet {
  /** 去重键：`path:start-end` */
  id: string;
  path: string;
  name: string;
  start: number;
  end: number;
  snippet: string;
}

interface PendingContextState {
  items: PendingSnippet[];
  add: (snippet: Omit<PendingSnippet, "id">) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_PENDING = 8;

export const usePendingContextStore = create<PendingContextState>((set, get) => ({
  items: [],
  add: (snippet) => {
    const id = `${snippet.path}:${snippet.start}-${snippet.end}`;
    if (get().items.some((item) => item.id === id)) return false;
    set((state) => ({
      items: [
        ...state.items,
        {
          ...snippet,
          name: snippet.name || snippet.path.split(/[\\/]/).pop() || snippet.path,
          id,
        },
      ].slice(-MAX_PENDING),
    }));
    return true;
  },
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set({ items: [] }),
}));
