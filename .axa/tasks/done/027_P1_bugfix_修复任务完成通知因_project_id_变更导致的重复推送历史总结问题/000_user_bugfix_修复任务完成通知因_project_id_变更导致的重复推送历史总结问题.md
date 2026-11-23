**现象**：
任务 #026 完成时，秘书除了推送 #026 的完成汇总，还重复推送了已完成的历史任务 #024 和 #025 的汇总结果。

**可能原因**：
#026 引入了 project_id 升级/变更（如由 `agentxagent` 升级为 `git:github.com/chitootoo/agentxagent`），导致 notified 状态中的键（如 `projectId:taskId`）无法匹配升级前的 notified 标记，使得已通知过的旧任务被误判断为未通知，再次触发总结推送。

**验收标准**：
1. 排查并修复 notified 状态记录与 project_id 升级/迁移时的兼容逻辑，确保历史已通知的任务不会重复推送。
2. typecheck 及相关单测通过。
