import type { AdapterCapabilities, AdapterFeatureToggles } from "../types.js";

/**
 * 把"协议层面能不能"（`AdapterCapabilities`）和"这个实例要不要启用"（构造参数里的 `features`）
 * 合并成最终生效的开关状态。所有 Adapter 的开关都应该走这一个函数，而不是各自手写合并逻辑，
 * 这样"未显式开启则默认关闭"和"开启了 capabilities 不支持的开关就立即报错"这两条规则
 * 在所有平台上是同一套语义，不会出现有的 Adapter 静默忽略、有的 Adapter 运行时才报错。
 */
export function resolveFeatureToggles(
  platform: string,
  capabilities: Pick<AdapterCapabilities, "streamingOutput">,
  requested: AdapterFeatureToggles | undefined,
): Readonly<Required<AdapterFeatureToggles>> {
  const streamingOutput = requested?.streamingOutput ?? false;
  if (streamingOutput && !capabilities.streamingOutput) {
    throw new Error(
      `[${platform}] 该 Adapter 不支持 streamingOutput（capabilities.streamingOutput 为 false），请去掉该开关配置`,
    );
  }
  return { streamingOutput };
}
