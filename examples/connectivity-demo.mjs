// 连通性 Demo：向所有已配置了环境变量的平台各发送一条测试文本消息，
// 用于验证 openimrobot 与真实机器人后端之间的网络连通性和鉴权是否正常。
//
// 用法：
//   npm run build
//   FEISHU_WEBHOOK_URL=... DINGTALK_WEBHOOK_URL=... node examples/connectivity-demo.mjs
//
// 未设置对应环境变量的平台会被跳过；至少需要配置一个平台才有意义。
import {
  BotManager,
  FeishuCustomBotAdapter,
  DingTalkCustomBotAdapter,
  WeComCustomBotAdapter,
  TelegramBotAdapter,
} from "../dist/index.js";

const manager = new BotManager();
const checks = [];

if (process.env.FEISHU_WEBHOOK_URL) {
  manager.register(
    "feishu",
    new FeishuCustomBotAdapter({
      webhookUrl: process.env.FEISHU_WEBHOOK_URL,
      secret: process.env.FEISHU_BOT_SECRET,
    }),
  );
  checks.push({ name: "feishu", target: "_" });
}

if (process.env.DINGTALK_WEBHOOK_URL) {
  manager.register(
    "dingtalk",
    new DingTalkCustomBotAdapter({
      webhookUrl: process.env.DINGTALK_WEBHOOK_URL,
      secret: process.env.DINGTALK_BOT_SECRET,
    }),
  );
  checks.push({ name: "dingtalk", target: "_" });
}

if (process.env.WECOM_WEBHOOK_URL) {
  manager.register(
    "wecom",
    new WeComCustomBotAdapter({ webhookUrl: process.env.WECOM_WEBHOOK_URL }),
  );
  checks.push({ name: "wecom", target: "_" });
}

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  manager.register(
    "telegram",
    new TelegramBotAdapter({ token: process.env.TELEGRAM_BOT_TOKEN }),
  );
  checks.push({ name: "telegram", target: process.env.TELEGRAM_CHAT_ID });
}

if (checks.length === 0) {
  console.error(
    "未检测到任何平台的环境变量配置，无法运行连通性 Demo。\n" +
      "请至少设置以下一组变量之一：\n" +
      "  FEISHU_WEBHOOK_URL（可选 FEISHU_BOT_SECRET）\n" +
      "  DINGTALK_WEBHOOK_URL（可选 DINGTALK_BOT_SECRET）\n" +
      "  WECOM_WEBHOOK_URL\n" +
      "  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID",
  );
  process.exit(1);
}

const text = `[openimrobot] 连通性测试 ${new Date().toISOString()}`;
let hasFailure = false;

for (const { name, target } of checks) {
  try {
    await manager.sendText(name, target, text);
    console.log(`✅ ${name}: 发送成功`);
  } catch (error) {
    hasFailure = true;
    console.error(`❌ ${name}: 发送失败 -`, error instanceof Error ? error.message : error);
  }
}

process.exit(hasFailure ? 1 : 0);
