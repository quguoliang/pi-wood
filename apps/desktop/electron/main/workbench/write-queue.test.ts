import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FileWriteQueue } from "./write-queue.ts";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("FileWriteQueue（按路径写队列，防并发 read-modify-write 丢更新）", () => {
  it("同路径 FIFO 串行：两条并发 read-modify-write 都生效（不丢条目）", async () => {
    const q = new FileWriteQueue();
    const state: string[] = [];
    // 模拟 memory_save：读（旧值快照）→ 异步间隙 → 写（旧值+新条目）。无锁时两条都只会写 1 条。
    const save = (item: string): Promise<void> =>
      q.withLock("memory.json", async () => {
        const snapshot = [...state]; // read
        await delay(5); // 并发窗口
        state.splice(0, state.length, ...snapshot, item); // write：全量覆盖（旧值+新条目）
      });
    await Promise.all([save("a"), save("b")]);
    assert.equal(state.filter((x) => x === "a").length, 1);
    assert.equal(state.filter((x) => x === "b").length, 1);
    assert.equal(state.length, 2);
  });

  it("异路径并行：互不阻塞（完成顺序不受锁影响）", async () => {
    const q = new FileWriteQueue();
    const order: string[] = [];
    const slowA = q.withLock("a.json", async () => {
      await delay(20);
      order.push("a");
    });
    const fastB = q.withLock("b.json", async () => {
      order.push("b");
    });
    await Promise.all([slowA, fastB]);
    assert.deepEqual(order, ["b", "a"]);
  });

  it("临界区抛错：错误上抛给当次调用方，且不阻塞后续", async () => {
    const q = new FileWriteQueue();
    await assert.rejects(
      q.withLock("x.json", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    const r = await q.withLock("x.json", () => "ok");
    assert.equal(r, "ok");
  });

  it("isLocked / drain 语义", async () => {
    const q = new FileWriteQueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = q.withLock("f", () => gate);
    assert.equal(q.isLocked("f"), true);
    release();
    await p;
    await q.drain();
    assert.equal(q.isLocked("f"), false);
  });
});
