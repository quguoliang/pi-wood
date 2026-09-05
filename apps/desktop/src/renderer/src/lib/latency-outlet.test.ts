import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FLUSH_INTERVAL_MS,
  FRAME_WATCH_IDLE_MS,
  isPlausibleSample,
  localOutletView,
  markSwitchStart,
  noteEventArrival,
  noteSwitchPainted,
  shouldWatchFrames,
  takeBatch,
} from "./latency-outlet.ts";

/**
 * 只测纯函数与「未启动即 no-op」的退化路径（node --test 下没有 window/document）。
 * rAF 循环本身要真浏览器才能跑，由 --ui-latency-probe 在带窗形态下验。
 */

describe("shouldWatchFrames（帧表只在有活动时跑，不留常驻 60fps 循环）", () => {
  it("刚活动过 → 继续看；空闲超过阈值 → 停表", () => {
    assert.equal(shouldWatchFrames(1000, 900, true), true);
    assert.equal(shouldWatchFrames(1000, 1000 - FRAME_WATCH_IDLE_MS, true), false, "恰好到点即停");
    assert.equal(shouldWatchFrames(1000, 1000 - FRAME_WATCH_IDLE_MS - 1, true), false);
  });

  it("窗口不可见一律停表（rAF 被节流，测出来的「掉帧」不是渲染慢）", () => {
    assert.equal(shouldWatchFrames(1000, 1000, false), false);
  });
});

describe("isPlausibleSample（离群与脏值不进统计）", () => {
  it("正常毫秒可入；负值/NaN/Infinity/≥5s 离群值拒收", () => {
    assert.equal(isPlausibleSample(0), true);
    assert.equal(isPlausibleSample(12.5), true);
    assert.equal(isPlausibleSample(-1), false, "跨进程时钟回拨给负值");
    assert.equal(isPlausibleSample(Number.NaN), false);
    assert.equal(isPlausibleSample(Number.POSITIVE_INFINITY), false);
    assert.equal(isPlausibleSample(5000), false, "窗口挂起/休眠唤醒不是渲染延迟");
  });
});

describe("takeBatch（批量上报：截最近一批并清空缓冲）", () => {
  it("取走后缓冲归零，防同一批重复上报", () => {
    const buf = [1, 2, 3];
    assert.deepEqual(takeBatch(buf), [1, 2, 3]);
    assert.deepEqual(buf, []);
    assert.deepEqual(takeBatch(buf), [], "空缓冲不产批次");
  });

  it("超上限只留最近的（与主进程窗口语义一致）", () => {
    assert.deepEqual(takeBatch([1, 2, 3, 4, 5], 2), [4, 5]);
  });
});

describe("未启动时的退化（node --test 无 window：全部 no-op，不抛）", () => {
  it("四个入口函数在 started=false 下安全返回", () => {
    assert.doesNotThrow(() => noteEventArrival(123));
    assert.doesNotThrow(() => markSwitchStart());
    assert.doesNotThrow(() => noteSwitchPainted());
    const v = localOutletView();
    assert.equal(v.started, false, "没 startLatencyOutlet 就不该采任何样本");
    assert.equal(v.hop, 0);
    assert.equal(v.paint, 0);
    assert.equal(v.gap, 0);
  });

  it("周期常量与主进程约定一致（改这里要同步 LATENCY_BUDGETS 的注释）", () => {
    assert.equal(FLUSH_INTERVAL_MS, 2000);
    assert.equal(FRAME_WATCH_IDLE_MS, 600);
  });
});
