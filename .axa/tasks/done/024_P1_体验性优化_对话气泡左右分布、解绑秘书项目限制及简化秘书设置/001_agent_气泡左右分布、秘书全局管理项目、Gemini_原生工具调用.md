---
agent: trae_26-11-22_09:10:07.276
---

# 体验性优化：气泡左右分布、秘书全局管理项目、简化设置

## 改动

1. **对话气泡左右分布**：`secretary-chat.tsx` 的 `chat-line` 类名由 `from-${role}`（`from-boss`/`from-secretary` 无对应样式）改为 `from-user`/`from-agent`，Boss 气泡居右、秘书气泡居左，复用现有 `.from-user` 样式。
2. **解除秘书项目绑定**：
   - `packages/secretary`：`SecretarySettings`、`PublicSecretarySettings`、`SecretaryState`、`SendBossMessageInput`、`UpdateSecretarySettingsInput` 移除 `projectId`；`SecretaryChatMessage` 新增 `projectId` 仅用于任务深链。
   - `agent.ts`：移除 `resolveProject` 与默认项目持久化；system prompt 列出全部已纳管项目并要求按上下文推断、歧义时询问；新增 `list_projects` 工具；`create_task` 新增 `project` 参数；`list_tasks`/`get_task` 支持项目参数且可跨项目查询；worker 进度同步遍历所有项目，`notified` 键改为 `projectId:taskId` 并兼容旧键。
   - proto：移除 `SecretarySettings`/`SecretaryState`/`GetSecretaryStateRequest`/`SendBossMessageRequest`/`UpdateSecretarySettingsRequest` 的 `project_id`，`SecretaryMessage` 新增 `project_id`；重新生成。
   - Console：聊天头部去掉项目下拉框，设置页去掉「默认项目」；消息任务链接使用 `message.projectId`。
3. **设置页去掉角色说明**：删除「角色分工」面板及 `.role-list` 样式；新增 Gemini 原生端点预设与提示。
4. **说明处理方式**：system prompt 要求每次回复最后一行明确「本次由我直接处理」或「已创建任务 #编号（项目名），由 worker 执行」。
5. **修复 Gemini thought_signature 400**：Gemini 改走 pi-ai 原生 `googleGenerativeAIApi()`（`api: google-generative-ai`），baseUrl 归一化为 `https://generativelanguage.googleapis.com/v1beta`；非 Gemini 模型继续使用 OpenAI 兼容分支。本机 `~/.axa/secretary.json` 已改为原生端点并移除 `projectId`。

## 验证

- `pnpm build:packages` 通过（含 secretary dts）。
- `pnpm typecheck` 全部包通过。
- `pnpm lint` 通过（82 files）。
- `pnpm test`：31 tests passed。
- `pnpm --filter @contagxt/axa-console build` 通过。
- 真实 Gemini（`gemini-3.5-flash`，经 15236 代理）通过接口发送「列出所有项目及 doing 数量」，秘书调用 `list_projects` 后正常返回两个项目汇总，未再出现 thought_signature 400，并以「本次由我直接处理。」结尾。
- 浏览器验证：Boss 气泡 `justify-content: flex-end` 居右，秘书气泡默认居左；聊天头部无项目下拉框，仅保留「设置」。
