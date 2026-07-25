// 连通性 Demo：向所有已配置了环境变量的平台各发送一条测试文本消息，
// 用于验证 openimrobot 与真实机器人后端之间的网络连通性和鉴权是否正常。
//
// 用法：
//   npm run build
//   FEISHU_WEBHOOK_URL=... DINGTALK_WEBHOOK_URL=... node examples/connectivity-demo.mjs
//
// 未设置对应环境变量的平台会被跳过；至少需要配置一个平台才有意义。
// 核心逻辑（resolveConnectivityChecksFromEnv / runConnectivityChecks）在 src/connectivity.ts
// 中实现并有单元测试覆盖（tests/connectivity.test.ts），这里只是薄的 CLI 包装。
import {
  BotManager,
  resolveConnectivityChecksFromEnv,
  runConnectivityChecks,
} from "../dist/index.js";

const checks = resolveConnectivityChecksFromEnv(process.env);

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

const manager = new BotManager();
for (const { name, adapter } of checks) {
  manager.register(name, adapter);
}

const text = `[openimrobot] 连通性测试 ${new Date().toISOString()}`;
const results = await runConnectivityChecks(manager, checks, text);

let hasFailure = false;
for (const result of results) {
  if (result.ok) {
    console.log(`✅ ${result.name}: 发送成功`);
  } else {
    hasFailure = true;
    console.error(`❌ ${result.name}: 发送失败 - ${result.error}`);
  }
}

process.exit(hasFailure ? 1 : 0);
