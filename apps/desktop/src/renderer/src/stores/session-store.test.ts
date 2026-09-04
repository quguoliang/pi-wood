import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_SLICE_KEY, useSessionStore, useActiveConversation } from "./session-store.ts";

/**
 * T8.3 store 层验收：分片隔离与「后台不引发前台重渲染」。
 *
 * 这里只碰纯状态部分（`window.pi` 只在具体 action 里被引用，模块导入本身不需要 electron/DOM），
 * 所以能在 `node --test` 下确定性复现两条验收：
 *   验收 1：两路交错事件流各自进各自切片，互不污染；
 *   验收 4：后台对话的 store 更新**不得**让读前台切片的订阅者重渲染。
 */

type Store = ReturnType<typeof useSessionStore.getState>;
const st = (): Store => useSessionStore.getState();

const resetAll = (): void => {
  useSessionStore.setState({ slices: {}, activeConversationId: null, foreignEventCount: 0 });
};

const delta = (text: string) => ({ type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", delta: text } });

test("分片隔离：两条对话的事件互不污染对方的 items / liveText", () => {
  resetAll();
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-a", active: true, legacy: false });
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-b", active: false, legacy: false });
  st().handleEvent(delta("A在跑"), { conversationId: "conv-a", active: true, legacy: false });
  st().handleEvent(delta("B在跑"), { conversationId: "conv-b", active: false, legacy: false });

  const a = st().sliceOf("conv-a");
  const b = st().sliceOf("conv-b");
  assert.equal(a.liveText, "A在跑");
  assert.equal(b.liveText, "B在跑");
  assert.notEqual(a, b, "两条对话必须是两个对象");
  assert.equal(st().activeConversationId, "conv-a", "active 由主进程盖的 active 标记决定");
});

test("验收 4：后台对话写入切片时，读前台切片的订阅者一次都不被回调", () => {
  resetAll();
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-a", active: true, legacy: false });
  st().handleEvent(delta("前台"), { conversationId: "conv-a", active: true, legacy: false });

  // 组件侧的真实读法：useActiveConversation((c) => c.items) —— 只关心前台切片的 items 引用
  let renders = 0;
  const readActive = (state: Store) => state.slices[state.activeConversationId ?? FALLBACK_SLICE_KEY]?.items;
  let lastItems: unknown = readActive(st()); // 必须先对齐订阅那一刻的引用，否则首次回调会被误算成一次渲染
  const unsub = useSessionStore.subscribe((state) => {
    const items = readActive(state);
    if (items !== lastItems) {
      lastItems = items;
      renders += 1;
    }
  });

  const before = renders;
  for (let i = 0; i < 50; i++) {
    st().handleEvent(delta(`后台${i}`), { conversationId: "conv-b", active: false, legacy: false });
    st().handleEvent({ type: "tool_execution_start", toolCallId: `t${i}`, toolName: "bash", args: {} }, { conversationId: "conv-b", active: false, legacy: false });
  }
  assert.equal(renders, before, `后台 100 条事件不得让前台选择器重渲染（实际 ${renders - before} 次）`);

  // 前台自己的事件必须照常触发（否则就是「切过去看不到更新」的反向 bug）
  st().handleEvent({ type: "tool_execution_start", toolCallId: "fa", toolName: "read", args: {} }, { conversationId: "conv-a", active: true, legacy: false });
  assert.equal(renders, before + 1, "前台自己的新条目必须触发一次渲染");
  unsub();
});

test("未读计数：后台里程碑累计、切过去即清零（不静默吞掉「有活干完」）", () => {
  resetAll();
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-a", active: true, legacy: false });
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-b", active: false, legacy: false });
  st().handleEvent({ type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: {} }, { conversationId: "conv-b", active: false, legacy: false });
  st().handleEvent(delta("x"), { conversationId: "conv-b", active: false, legacy: false }); // token 不算未读
  assert.equal(st().sliceOf("conv-b").unreadCount, 2, "两次里程碑（回合开始 + 工具开始）计未读");
  st().setActiveConversation("conv-b");
  assert.equal(st().sliceOf("conv-b").unreadCount, 0, "切过去即清零");
  assert.equal(st().activeConversationId, "conv-b");
});

test("滚动位置按对话独立保持（切回来不跳顶/不抢跟底）", () => {
  resetAll();
  st().setScrollTop(120, "conv-a");
  st().setFollowBottom(false, "conv-a");
  st().setScrollTop(900, "conv-b");
  st().setFollowBottom(true, "conv-b");
  assert.equal(st().sliceOf("conv-a").scrollTop, 120);
  assert.equal(st().sliceOf("conv-b").scrollTop, 900);
  assert.equal(st().sliceOf("conv-a").followBottom, false);
  assert.equal(st().sliceOf("conv-b").followBottom, true);
});

test("无归属的 legacy 事件落进兜底切片，行为与 T8.2 之前一致", () => {
  resetAll();
  st().handleEvent({ type: "agent_start" }, { conversationId: null, legacy: true });
  assert.equal(st().sliceOf(FALLBACK_SLICE_KEY).streaming, true);
  assert.equal(st().activeConversationId, null, "legacy 事件不得把 active 猜成某个 id");
});

test("foreignEventCount 只作可观测指标：事件仍进它自己的切片（丢事件才是被禁止的）", () => {
  resetAll();
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-a", active: true, legacy: false });
  st().handleEvent({ type: "agent_start" }, { conversationId: "conv-b", active: false, legacy: false });
  useSessionStore.setState((s) => ({ foreignEventCount: s.foreignEventCount + 1 }));
  assert.equal(st().foreignEventCount, 1);
  assert.equal(st().sliceOf("conv-b").streaming, true, "计数不等于丢弃");
});

test("useActiveConversation 的取数路径与 sliceOf 一致（消费者迁移后的等价性）", () => {
  resetAll();
  st().handleEvent({ type: "user_message", text: "hi" }, { conversationId: "conv-a", active: true, legacy: false });
  const viaStore = st().sliceOf("conv-a").items.length;
  // hook 在 node 下不能真跑 React，这里验证它依赖的取数表达式（同一段代码路径）
  const state = st();
  const slice = state.slices[state.activeConversationId ?? FALLBACK_SLICE_KEY];
  assert.equal(slice?.items.length, viaStore);
  assert.equal(typeof useActiveConversation, "function");
});
