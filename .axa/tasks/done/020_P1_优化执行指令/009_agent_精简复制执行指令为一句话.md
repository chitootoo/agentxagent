---
agent: trae_26-11-20_23:56:59.026
---

## 本轮实现

按本轮需求把控制台「复制执行指令」压缩为一句话，不再解释具体命令（命令细节由 SKILL.md 负责）：

- [instruction.ts](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/console/src/lib/instruction.ts) 中 `taskExecutionPrompt` 只返回：

  ```text
  阅读 .axa/SKILL.md，执行任务 #020「优化执行指令」。
  ```

- 同时删除不再需要的 `projectPath` 参数（原先只为拼 SKILL.md 绝对路径），调用方 [task-conversation.tsx](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/console/src/components/task-conversation.tsx#L203-L213) 同步改为只校验 `task` 是否已加载。

## 验证

- `pnpm --filter @contagxt/axa-console typecheck`：通过。
- `pnpm exec biome check packages/console/src/lib/instruction.ts packages/console/src/components/task-conversation.tsx`：通过（Checked 2 files, No fixes applied）。
- 用 tsx 直接调用 `taskExecutionPrompt` 输出：

  ```text
  阅读 .axa/SKILL.md，执行任务 #020「优化执行指令」。
  阅读 .axa/SKILL.md，执行任务 #003「构建 Axa 命令行工具」。
  ```
