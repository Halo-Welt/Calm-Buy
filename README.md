# Calm Buy

一款反导购微信小程序：先拆清真实需求，再给出「劝停 / 先验证 / 可以买 / 建议替代」判决。

## 当前进度

- [x] Phase 0：原生微信小程序脚手架与 5 个页面路由
- [x] Phase 1：首页、对话、结果卡、冷静清单、关于页
- [x] Phase 2（Mock）：固定问题状态机、需求确认、可选评测、4 类演示判决
- [x] Phase 3：Node API、DeepSeek 接入、Schema 校验与服务端规则过滤
- [ ] Phase 4：真机文案与体验打磨
- [ ] Phase 5：提测

配置 DeepSeek Key 后，可完整体验「输入 → 4–6 轮第一性原理追问 → 确认根本需求 → 判决与替代路径」。未配置 Key 或服务不可用时，自动降级为低置信度基础判断。

## 启动分析服务

```bash
cd server
cp .env.example .env
npm install
npm start
```

在 `server/.env` 中填写：

```bash
DEEPSEEK_API_KEY=你的Key
```

API Key 只允许保存在 `server/.env`，不得写入小程序、聊天记录或提交到仓库。默认服务地址为 `http://127.0.0.1:8787`，微信开发者工具已关闭开发阶段的域名校验；真机使用前必须部署到 HTTPS 域名并配置小程序 request 合法域名。

当前为 DeepSeek-only 模式，不具备实时网页搜索能力。结果会明确标注“未联网核验”，不展示实时价格、评测来源或商品直链。

## 本地运行

1. 安装并打开微信开发者工具。
2. 选择「导入项目」。
3. 项目目录选择本仓库根目录 `Calm-Buy`。
4. AppID 可使用测试号；`project.config.json` 默认配置为游客模式。
5. 编译后从首页输入任意商品。

## 验证演示规则

本机安装 Node.js 后运行：

```bash
node tests/run-mocks.js
cd server && npm test
```

脚本会验证 4 个必过用例：

- A：身份驱动 → 劝停且无替代
- B：床上看片 → 不买当前眼镜，给试用/投影替代
- C：否定需求确认 → 低置信度、先冷却
- D：明确清洁需求 + 评测 → 可以买

## 后续接入 LLM

服务端环境变量示例位于 `server/.env.example`。真实 API Key 只能放在服务端环境变量中，禁止写入小程序代码或提交到仓库。

计划中的最小接口为 `POST /api/analyze/step`。在服务端完成前，小程序始终使用本地 Mock，不会因无网络或无 Key 白屏。

## 文档

- `任务计划书.md`：原始执行计划
- `docs/PRD.md`：正式产品需求文档
- `docs/UI-DESIGN-SYSTEM.md`：小程序 UI 设计规范
