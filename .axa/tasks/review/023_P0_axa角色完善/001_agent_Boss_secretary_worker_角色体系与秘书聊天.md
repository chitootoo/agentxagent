---
agent: trae_26-11-22_00:12:34.318
---

完成 axa 角色体系完善：

1. 术语与命名
- 全文统一为 Boss（人类）、secretary（秘书 Agent）、worker（执行 Agent）。
- README、`.axa/SKILL.md`、`.axa/tasks/README.md`、默认初始化指令、控制台文案与元数据同步更新。
- 控制台品牌改为 `axa · Boss · secretary · worker`，产品描述改为三角色协作中枢；技术包名与 `axa` CLI 保持不变，避免破坏兼容性。

2. 新增 secretary Agent
- 新增 `packages/secretary`，基于 `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`（1.6.0）。
- 设置保存在 `~/.axa/secretary.json`，会话保存在 `~/.axa/secretary-chat.json`。
- 支持任意 OpenAI 兼容端点（Base URL / 模型 / API Key）。
- 工具：`create_task`、`list_tasks`、`get_task`；耗时任务直接创建为 `todo`，由 worker 认领。
- 简单问题直接回复；worker 进入 doing/review/done 后由秘书自动汇总并回写聊天。
- Boss 发消息立即返回，秘书在后台队列处理；轮询页面可同时看到新消息与输入中状态，不阻塞后续对话。
- 服务重启后遗留的 pending 消息会自动标记为失败。

3. Proto 与 Console
- 新增 `axa/v1/secretary.proto` 与 `SecretaryService`（GetSecretaryState / SendBossMessage / UpdateSecretarySettings / ClearSecretaryChat）。
- 控制台首个 Tab 改为 Boss ↔ secretary 聊天页 `/`，「任务」列表移到 `/tasks`，项目/动态导航保留。
- 新增 `/secretary/settings`：模型预设、Base URL、模型名、API Key、默认项目、角色说明。
- 聊天 UI 支持优化发送、打字状态、任务跳转、清空对话、未配置模型提示。

4. 验证
- `pnpm lint`、`pnpm typecheck`、`pnpm test`（31 通过）、`pnpm build` 全部通过。
- 用本地 mock OpenAI 服务完成 smoke test：普通回复、工具调用创建任务、worker 完成后秘书自动汇总均通过。
- 浏览器端到端验证：首页聊天可发送并收到回复；设置页字段正常；任务页导航正常。
