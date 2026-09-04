/**
 * 按文件路径的写队列（T8.7 步骤 3）
 *
 * 多对话并发后，read-modify-write 型资源（memory project.json、settings、快照索引）可能被
 * 两条对话同时读旧值、各自覆盖 → 丢更新。本模块把**同一文件**的读改写临界区串行化
 * （per-path FIFO），不同路径并行不受影响；调用方把整个「读→改→写」包进临界区即可。
 *
 * 语义与 Pi SDK 的 `withFileMutationQueue` 同思路。critical section 内抛错不阻塞后续
 * （队列照常推进），错误原样上抛给当次调用方。
 */
export class FileWriteQueue {
  private chains = new Map<string, Promise<unknown>>();

  /** 在 `path` 的串行临界区里执行 fn；同路径调用按 FIFO 串行，异路径并行 */
  async withLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(path) ?? Promise.resolve();
    const run = prev.then(fn, fn); // 前序失败也继续推进（错误由各自的 promise 携带）
    // 链上挂一个吞错占位，避免 unhandled rejection 断链；真正错误由 run 抛给调用方。
    // 表项不主动回收：受锁路径全集很小（memory×2 / settings×1 / 快照索引×每项目），无界增长不成立。
    this.chains.set(
      path,
      run.catch(() => undefined),
    );
    return run;
  }

  /** 当前某个路径是否有排队中的临界区（单测/诊断用） */
  isLocked(path: string): boolean {
    return this.chains.has(path);
  }

  /** 等待全部临界区排空（单测收尾用） */
  async drain(): Promise<void> {
    await Promise.all([...this.chains.values()]);
    this.chains.clear();
  }
}

/** 进程级共享单例（memory / settings / 快照索引共用同一把 per-path 锁表） */
export const fileWriteQueue = new FileWriteQueue();
