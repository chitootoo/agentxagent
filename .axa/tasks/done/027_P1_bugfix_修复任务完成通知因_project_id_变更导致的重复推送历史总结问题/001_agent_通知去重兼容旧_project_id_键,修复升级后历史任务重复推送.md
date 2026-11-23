---
agent: codebuddy_26-11-22_14:49:36.397
secretary_notified: done:001
---

## 根因

`syncTaskUpdates()` 判断任务更新是否已通知时，只认 `notified[projectId:taskId]` 与旧版裸键 `notified[taskId]`。任务 #026 将项目标识从 `agentxagent` 升级为 `git:github.com/chitootoo/agentxagent` 后，历史标记 `agentxagent:024` / `agentxagent:025` 无法命中，导致已通知的 #024/#025 被误判为未通知并再次推送汇总。

## 改动

- 新增 `packages/core/src/notification.ts`：`hasReportedTaskUpdate(notified, projectId, taskId, updateKey)`。命中以下任一且指纹一致即视为已通知：裸 `taskId`、`projectId:taskId`、任意以 `:taskId` 结尾的历史 `projectId:taskId` 键。用后缀匹配而非猜测旧 id，可覆盖多次/任意 project_id 迁移（含 id 自带冒号的情况）。
- `packages/core/src/index.ts` 导出该函数。
- `packages/secretary/src/agent.ts` 的 `syncTaskUpdates()` 改用该函数做去重，写入仍用当前 `projectId:taskId` 键；旧键保留，不破坏向下兼容。
- `packages/core/src/core.test.ts` 新增 `task update notification dedupe` 6 个单测：当前键、裸 taskId、旧 project id、含冒号的旧 project id、避免混淆其他 task（`:240`/`:1024` 不误命中 `:024`）、指纹变化时仍需重新推送。

## 验证

- `pnpm typecheck`：全部 5 个包通过。
- `pnpm test`：42 passed（原 36 + 新增 6）。
- `pnpm exec biome check` 改动文件：通过，无修复项；编辑器 lint 诊断 0。
- 已执行 `pnpm --filter @contagxt/axa-core build` 更新 dist 类型声明，供 secretary 解析新导出。

## 备注

- 未改动 `~/.axa/secretary-chat.json` 中已产生的历史重复消息；修复面向后续同步，不清理 Boss 现有聊天记录。
- 未提交 git：工作区原本存在大量未提交/未跟踪改动，本次仅在既有改动上做最小增量修改。
