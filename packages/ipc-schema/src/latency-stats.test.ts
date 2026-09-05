import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LATENCY_BUDGETS,
  LatencyRecorder,
  budgetVerdict,
  clampSamples,
  cpuPercentFromDelta,
  emptyLatencyReport,
  formatLatencyReport,
  isRpcLatencySampled,
  mergeRecorders,
  percentile,
  summarize,
} from "./latency-stats.ts";

describe("percentile（最近秩法，红线统计的唯一算法）", () => {
  it("空数组给 0 而不是 NaN；单元素即该值", () => {
    assert.equal(percentile([], 95), 0);
    assert.equal(percentile([7.5], 50), 7.5);
  });

  it("1..10 升序：p50=5、p95=10、p100=10、p0 夹到第 1 秩", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(ten, 50), 5);
    assert.equal(percentile(ten, 95), 10);
    assert.equal(percentile(ten, 100), 10);
    assert.equal(percentile(ten, 0), 1); // p=0 不外插到「无值」，取第 1 秩
  });

  it("只认升序输入（调用方负责排序），20 个样本的 p95 是第 19 个", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(percentile(twenty, 95), 19);
  });
});

describe("summarize", () => {
  it("乱序输入也能出正确分位数与均值", () => {
    const s = summarize([4, 1, 3, 2]);
    assert.equal(s.count, 4);
    assert.equal(s.max, 4);
    assert.equal(s.mean, 2.5);
    assert.equal(s.p50, 2);
    assert.equal(s.p95, 4);
  });

  it("空窗口保留 dropped/invalid（无样本不许伪装成 0 延迟）", () => {
    const s = summarize([], 7, 2);
    assert.equal(s.count, 0);
    assert.equal(s.p95, 0);
    assert.equal(s.dropped, 7);
    assert.equal(s.invalid, 2);
  });

  it("浮点尾噪归整到 3 位（面板与探针比对时不会因 1e-13 抖动不等）", () => {
    const s = summarize([0.1 + 0.2]);
    assert.equal(s.mean, 0.3);
  });
});

describe("LatencyRecorder（环形窗口 + 脏样本不静默）", () => {
  it("容量 3 记 5 个：窗口只留最后 3 个，被覆盖的计入 dropped", () => {
    const r = new LatencyRecorder(3);
    for (const v of [1, 2, 3, 4, 5]) r.record(v);
    const s = r.snapshot();
    assert.equal(s.count, 3);
    assert.deepEqual(r.values(), [3, 4, 5]);
    assert.equal(s.dropped, 2);
    assert.equal(s.max, 5);
  });

  it("NaN/Infinity/负数一律拒收并计入 invalid，窗口与 dropped 不受污染", () => {
    const r = new LatencyRecorder(4);
    assert.equal(r.record(10), true);
    assert.equal(r.record(Number.NaN), false);
    assert.equal(r.record(Number.POSITIVE_INFINITY), false);
    assert.equal(r.record(-0.5), false); // 跨进程时钟回拨给出的负值
    const s = r.snapshot();
    assert.equal(s.count, 1);
    assert.equal(s.invalid, 3);
    assert.equal(s.dropped, 0);
    assert.equal(s.p95, 10);
  });

  it("reset 清窗口与计数", () => {
    const r = new LatencyRecorder(2);
    r.record(1);
    r.record(2);
    r.record(3);
    r.reset();
    const s = r.snapshot();
    assert.equal(s.count, 0);
    assert.equal(s.dropped, 0);
    assert.equal(s.invalid, 0);
  });

  it("capacity<1 兜成 1（防设置里填 0 把窗口变成黑洞）", () => {
    const r = new LatencyRecorder(0);
    r.record(5);
    assert.equal(r.snapshot().count, 1);
  });
});

describe("mergeRecorders（多对话聚合）", () => {
  it("各窗口样本合并、dropped/invalid 累加、超出合并容量丢最旧", () => {
    const a = new LatencyRecorder(2);
    a.record(1);
    a.record(2);
    const b = new LatencyRecorder(2);
    b.record(3);
    b.record(4);
    b.record(5); // b 覆盖掉 3 → b 窗口 [4,5]
    const merged = mergeRecorders([a, b], 512);
    assert.equal(merged.count, 4); // [1,2] + [4,5]（b 的 3 已被自己窗口覆盖）
    assert.equal(merged.dropped, 1);
    assert.equal(merged.max, 5);
  });

  it("合并窗口按 capacity 截尾保留最近样本", () => {
    const a = new LatencyRecorder(4);
    for (const v of [1, 2, 3, 4]) a.record(v);
    const merged = mergeRecorders([a], 2);
    assert.equal(merged.count, 2);
    assert.equal(merged.max, 4);
  });
});

describe("budgetVerdict（无样本绝不判达标）", () => {
  it("count=0 → 不通过且写明未触发", () => {
    const v = budgetVerdict(emptyLatencyReport().rpcRtt, 40, "rpcRtt");
    assert.equal(v.ok, false);
    assert.match(v.note, /无样本/);
  });

  it("p95 在预算内通过、超预算不通过，note 带 n 与拒收计数", () => {
    const ok = summarize([1, 2, 3]);
    assert.equal(budgetVerdict(ok, 40, "rpcRtt").ok, true);
    const bad = summarize([100, 101, 102]);
    const v = budgetVerdict(bad, 40, "rpcRtt");
    assert.equal(v.ok, false);
    assert.match(v.note, /p95=102ms/);
    assert.match(v.note, /n=3/);
  });
});

describe("RPC 统计的取样域（模型耗时不许混进通道延迟）", () => {
  it("ping/getState 入统计；prompt/steer/start/compact 不入", () => {
    assert.equal(isRpcLatencySampled("ping"), true);
    assert.equal(isRpcLatencySampled("getState"), true);
    assert.equal(isRpcLatencySampled("prompt"), false);
    assert.equal(isRpcLatencySampled("steer"), false);
    assert.equal(isRpcLatencySampled("start"), false);
    assert.equal(isRpcLatencySampled("compact"), false);
    assert.equal(isRpcLatencySampled("nonsense"), false);
  });
});

describe("红线常量与 formatLatencyReport", () => {
  it("预算值与 §7.9 性能红线表逐条对齐（改这里=改红线，必须同步文档）", () => {
    assert.equal(LATENCY_BUDGETS.rpcRttP95Ms, 40);
    assert.equal(LATENCY_BUDGETS.eventHopP95Ms, 20);
    assert.equal(LATENCY_BUDGETS.rendererHopP95Ms, 20);
    assert.equal(LATENCY_BUDGETS.approvalRttP95Ms, 40);
    assert.equal(LATENCY_BUDGETS.firstPaintP95Ms, 100);
    assert.equal(LATENCY_BUDGETS.frameGapP95Ms, 33.3);
    assert.equal(LATENCY_BUDGETS.mainCpuP95Pct, 60);
  });

  it("空报告七项齐全且都是 0 样本", () => {
    const r = emptyLatencyReport();
    assert.deepEqual(Object.keys(r).sort(), [
      "approvalRtt",
      "eventHop",
      "firstPaint",
      "frameGap",
      "hostToolRtt",
      "rendererHop",
      "rpcRtt",
    ]);
    assert.equal(r.rpcRtt.count, 0);
    assert.equal(r.rendererHop.count, 0);
  });

  it("摘要一行含七个指标名，供探针与资源行共用", () => {
    const line = formatLatencyReport(emptyLatencyReport());
    for (const key of ["rpcRtt", "eventHop", "rendererHop", "approvalRtt", "firstPaint", "frameGap", "hostTool"]) {
      assert.ok(line.includes(key), `摘要缺 ${key}：${line}`);
    }
  });
});

describe("cpuPercentFromDelta（主进程 CPU 占单核百分比）", () => {
  it("1 秒用了 50 万微秒 CPU → 50%", () => {
    assert.equal(cpuPercentFromDelta(500_000, 1000), 50);
  });

  it("elapsedMs≤0 或非有限数给 0（除零不产 Infinity 污染直方图）", () => {
    assert.equal(cpuPercentFromDelta(1000, 0), 0);
    assert.equal(cpuPercentFromDelta(1000, Number.NaN), 0);
    assert.equal(cpuPercentFromDelta(Number.NaN, 1000), 0);
  });

  it("多核跑满给 >100，不归一化掩盖（红线按单核判）", () => {
    assert.equal(cpuPercentFromDelta(2_000_000, 1000), 200);
  });
});

describe("clampSamples（渲染层批量上报前的清洗）", () => {
  it("剔 NaN/Infinity/负值", () => {
    assert.deepEqual(clampSamples([1, Number.NaN, -2, 3, Number.POSITIVE_INFINITY]), [1, 3]);
  });

  it("超 cap 保留最近的（窗口语义与 recorder 一致）", () => {
    assert.deepEqual(clampSamples([1, 2, 3, 4, 5], 2), [4, 5]);
  });

  it("非数组/缺省给空数组（IPC 载荷不可信，不许抛）", () => {
    assert.deepEqual(clampSamples(undefined), []);
    assert.deepEqual(clampSamples("nope" as unknown as number[]), []);
  });
});
