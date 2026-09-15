# Calm Buy

一个面向全品类的微信购买决策助手。它先拆清真实需求，再结合可核验信息给出「可以买 / 先验证 / 不建议买当前这个 / 没必要买」。目标是减少后悔，不是劝退，也不是导购。

## 当前能力

- 原生微信小程序：首页、对话、结果、冷静记录和“我的”
- 按决策成本动态使用 1–6 轮追问
- DeepSeek 结构化分析，服务端 Schema 与业务规则兜底
- 非快消首轮与最终轮联网检索：豆包 Global 优先，Tavily 回退
- 来源职责与独立主体分级；需求清晰度、信息可信度分开展示
- 高风险购买边界：医疗/药品、投资/博彩、违法或受管制商品不提供购买判断
- 48 小时主动复盘，7/30 天被动长期复盘
- 可选匿名指标：不上传商品名、预算和对话，支持凭本机删除凭证清除
- 无购买按钮、无电商候选直链、不转载来源不明图片
- 无模型或搜索能力时保留草稿并进入基础判断

## 本地服务

```bash
cd server
cp .env.example .env
npm install
npm start
```

至少配置 `DEEPSEEK_API_KEY`。联网搜索配置与优先级见 `server/.env.example`。密钥只能存在于服务端或云函数环境变量中。

本地服务默认运行于 `http://127.0.0.1:8787`。将 `miniprogram/config.js` 的 `USE_LOCAL_API` 临时设为 `true` 后，可在微信开发者工具中联调；真机默认调用云函数 `analyze`。

## 云函数发布前配置

1. 执行 `node scripts/sync-cloud-function.js`，同步服务端共享模块。
2. 在云函数环境变量配置 DeepSeek、搜索与 `RATE_LIMIT_SALT`。
3. 在微信公众平台创建一次性订阅消息模板：
   - 将模板 ID 同时写入云函数 `REMINDER_TEMPLATE_ID` 与 `miniprogram/config.js` 的 `SUBSCRIBE_TEMPLATE_ID`。
   - 按实际模板字段配置 `REMINDER_THING_KEY`、`REMINDER_TIME_KEY`。
4. 创建数据库集合：`calm_buy_usage`、`calm_buy_telemetry`、`calm_buy_reminders`。
5. 为用量和提醒集合按 `expiresAt` 配置 TTL；匿名事件按产品决策长期保留，直到用户主动删除。
6. 上传并部署 `cloudfunctions/analyze`，确认定时触发器与 `subscribeMessage.send` 权限生效。

## 验证

```bash
cd server && npm test
cd ..
node tests/run-mocks.js
node --test tests/client-adapter.test.js
```

测试覆盖服务端契约、来源可信度、云函数接线、匿名数据删除、4 个演示路径、80 个跨品类普通案例、高风险边界与提示词攻击。

## 文档

- `docs/PRD-v2.md`：当前产品与发布基线
- `docs/PRD.md`：v1 历史基线，已归档
- `docs/UI-DESIGN-SYSTEM.md`：小程序 UI 规范
- `任务计划书.md`：原始执行计划
