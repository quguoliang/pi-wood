import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accentForThinking,
  approvalAccent,
  hueOf,
  thinkingAccent,
  thinkingAccentFallback,
  thinkingLabels,
} from "./composer-levels.ts";

/** 权限档位的四个取值，与 ComposerControls.tsx 的 `ApprovalMode` 一致（对方在 JSX 文件里，只对照键） */
const ALL_APPROVAL_MODES = ["auto", "highRisk", "allAsk", "denyAll"] as const;

/** 思考级别的规范顺序，由弱到强 */
const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** 色相强度序：越危险／越耗算力越靠后 */
const HUE_RANK: Record<string, number> = {
  "muted-foreground": 0,
  primary: 1,
  warning: 2,
  destructive: 3,
};

const isTextColor = (v: string): boolean => /^text-[a-z-]+(\/\d+)?$/.test(v);

test("权限：四个档位都有颜色映射（既不缺键也不留多余键）", () => {
  assert.deepEqual(Object.keys(approvalAccent).sort(), [...ALL_APPROVAL_MODES].sort());
});

test("权限：四个档位两两不同色 —— 「不同级别不同展示色」是需求本身，撞色即失效", () => {
  const hues = ALL_APPROVAL_MODES.map((m) => approvalAccent[m]);
  assert.equal(new Set(hues).size, hues.length, `权限四档出现撞色：${hues.join(" / ")}`);
});

test("权限：色相按危险度降序（auto 红 → highRisk 琥珀 → allAsk 蓝 → denyAll 绿）", () => {
  assert.equal(hueOf(approvalAccent.auto), "destructive");
  assert.equal(hueOf(approvalAccent.highRisk), "warning");
  assert.equal(hueOf(approvalAccent.allAsk), "primary");
  assert.equal(hueOf(approvalAccent.denyAll), "success");
});

test("思考：标签清单与颜色清单不漂移（引擎新增一档而忘补颜色 → 此处红，而不是静默变灰）", () => {
  assert.deepEqual(Object.keys(thinkingAccent).sort(), [...THINKING_ORDER].sort());
  assert.deepEqual(Object.keys(thinkingLabels).sort(), [...THINKING_ORDER].sort());
  for (const level of Object.keys(thinkingLabels)) {
    assert.ok(thinkingAccent[level], `级别 ${level} 缺颜色映射`);
  }
});

test("思考：七个档位两两不同色", () => {
  const hues = THINKING_ORDER.map((l) => thinkingAccent[l]);
  assert.equal(new Set(hues).size, hues.length, `思考档位出现撞色：${hues.join(" / ")}`);
});

test("思考：强度单调 —— 灰 → 蓝 → 琥珀 → 红，不退档且两端正确", () => {
  const ranks = THINKING_ORDER.map((l) => {
    const hue = hueOf(thinkingAccent[l]);
    const rank = HUE_RANK[hue];
    assert.notEqual(rank, undefined, `级别 ${l} 的色相 ${hue} 不在强度序里，ramp 被改乱了`);
    return rank as number;
  });
  assert.equal(ranks[0], HUE_RANK["muted-foreground"], "最低档应为中性灰");
  assert.equal(ranks[ranks.length - 1], HUE_RANK.destructive, "最高档应为红");
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] >= ranks[i - 1], `强度在第 ${i} 档回退：${ranks.join(",")}`);
  }
});

test("所有映射值都是合法的 Tailwind 文本色类（含透明度档）", () => {
  for (const [k, v] of Object.entries({ ...approvalAccent, ...thinkingAccent })) {
    assert.ok(isTextColor(v), `${k} 的颜色类 ${v} 形态异常（必须写成完整字面量，不能模板拼接）`);
  }
  assert.ok(isTextColor(thinkingAccentFallback));
});

test("accentForThinking：已知级别取本档色，未知／缺失一律回落中性灰", () => {
  assert.equal(accentForThinking("high"), thinkingAccent.high);
  assert.equal(accentForThinking("max"), thinkingAccent.max);
  // 未知档位（引擎将来新增、本模块未收录）不得借用别的档位的颜色
  assert.equal(accentForThinking("ultra"), thinkingAccentFallback);
  assert.equal(accentForThinking(undefined), thinkingAccentFallback);
  assert.equal(accentForThinking(null), thinkingAccentFallback);
  assert.equal(accentForThinking(""), thinkingAccentFallback);
});

test("hueOf：剥掉 text- 前缀与透明度后缀", () => {
  assert.equal(hueOf("text-primary/60"), "primary");
  assert.equal(hueOf("text-muted-foreground"), "muted-foreground");
  assert.equal(hueOf("text-muted-foreground/50"), "muted-foreground");
});
