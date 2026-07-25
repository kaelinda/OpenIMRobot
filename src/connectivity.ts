import type { BaseBotAdapter } from "./core/base-adapter.js";
import type { BotManager } from "./core/bot-manager.js";
import { FeishuCustomBotAdapter } from "./adapters/feishu/custom-bot.js";
import { DingTalkCustomBotAdapter } from "./adapters/dingtalk/custom-bot.js";
import { WeComCustomBotAdapter } from "./adapters/wecom/custom-bot.js";
import { TelegramBotAdapter } from "./adapters/telegram/bot.js";

/** 运行连通性检查所需的最小环境变量子集，便于测试构造与真实 process.env 解耦 */
export type ConnectivityEnv = Partial<
  Record<
    | "FEISHU_WEBHOOK_URL"
    | "FEISHU_BOT_SECRET"
    | "DINGTALK_WEBHOOK_URL"
    | "DINGTALK_BOT_SECRET"
    | "WECOM_WEBHOOK_URL"
    | "TELEGRAM_BOT_TOKEN"
    | "TELEGRAM_CHAT_ID",
    string
  >
>;

export interface ConnectivityCheckSpec {
  /** 注册到 BotManager 的实例名，同时也是结果报告中的平台标识 */
  name: string;
  /** sendText 的目标（chat_id 等），Webhook 型自定义机器人固定群不需要，传占位符 "_" */
  target: string;
  adapter: BaseBotAdapter;
}

/**
 * 根据环境变量解析出需要执行连通性检查的平台列表；未配置对应变量的平台不会出现在结果中。
 * Telegram 需要同时配置 Token 与 ChatId 才纳入检查（sendText 需要明确的 target）。
 */
export function resolveConnectivityChecksFromEnv(
  env: ConnectivityEnv,
): ConnectivityCheckSpec[] {
  const checks: ConnectivityCheckSpec[] = [];

  if (env.FEISHU_WEBHOOK_URL) {
    checks.push({
      name: "feishu",
      target: "_",
      adapter: new FeishuCustomBotAdapter({
        webhookUrl: env.FEISHU_WEBHOOK_URL,
        secret: env.FEISHU_BOT_SECRET,
      }),
    });
  }

  if (env.DINGTALK_WEBHOOK_URL) {
    checks.push({
      name: "dingtalk",
      target: "_",
      adapter: new DingTalkCustomBotAdapter({
        webhookUrl: env.DINGTALK_WEBHOOK_URL,
        secret: env.DINGTALK_BOT_SECRET,
      }),
    });
  }

  if (env.WECOM_WEBHOOK_URL) {
    checks.push({
      name: "wecom",
      target: "_",
      adapter: new WeComCustomBotAdapter({ webhookUrl: env.WECOM_WEBHOOK_URL }),
    });
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    checks.push({
      name: "telegram",
      target: env.TELEGRAM_CHAT_ID,
      adapter: new TelegramBotAdapter({ token: env.TELEGRAM_BOT_TOKEN }),
    });
  }

  return checks;
}

export interface ConnectivityCheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * 依次向每个 check 对应的平台发送一条测试文本消息，单个平台失败不影响其余平台继续执行。
 */
export async function runConnectivityChecks(
  manager: BotManager,
  checks: ConnectivityCheckSpec[],
  text: string,
): Promise<ConnectivityCheckResult[]> {
  const results: ConnectivityCheckResult[] = [];
  for (const { name, target } of checks) {
    try {
      await manager.sendText(name, target, text);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
