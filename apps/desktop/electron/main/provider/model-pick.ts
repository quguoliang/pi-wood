/**
 * 辅助类一次性小任务（目标模式进度审计 T7.5、会话辅助 T7.9）的模型选择（纯函数、可单测）。
 * 优先级：显式小模型(smallModel) > 会话默认模型(defaultModel) > 可用模型列表首个。
 * 选出的 {provider,id} 必须存在于当前可用模型目录，否则跳过该项（换项目/删 Key 后防失效配置）。
 */

export interface ModelRef {
  provider: string;
  id: string;
}

export function pickAuxModel(
  models: readonly ModelRef[],
  smallModel?: ModelRef | null,
  defaultModel?: ModelRef | null,
): ModelRef | undefined {
  const usable = (m?: ModelRef | null): ModelRef | undefined =>
    m && models.some((x) => x.provider === m.provider && x.id === m.id) ? { provider: m.provider, id: m.id } : undefined;
  return (
    usable(smallModel) ??
    usable(defaultModel) ??
    (models[0] ? { provider: models[0].provider, id: models[0].id } : undefined)
  );
}
