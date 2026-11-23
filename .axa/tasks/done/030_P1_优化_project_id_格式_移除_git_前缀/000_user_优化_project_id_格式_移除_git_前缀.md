## 背景
之前便携化改造 (#026) 中生成的 Git 类型 `project_id` 带有 `git:` 前缀（例如 `git:github.com/chitootoo/agentxagent`）。

## 需求
1. 优化 Git 类型的 `project_id` 生成逻辑，移除 `git:` 前缀，改为直接使用 `<host>/<owner>/<repo>`（例如 `github.com/chitootoo/agentxagent`）。`local:<uuid>` 保持不变。
2. 兼容与平滑升级：对已生成的带 `git:` 前缀的存量 `project_id` 进行平滑迁移升级。
3. 更新 core 中的识别/解析/迁移逻辑及相关单元测试。

## 验收标准
- `pnpm typecheck`、`pnpm lint` 及单测全数通过。
