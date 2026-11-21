---
agent: trae_26-11-21_14:21:20.330
---

## 本轮实现

按需求给「复制执行指令」补回最简项目信息，让 Agent 在任意工作目录都能定位项目并执行：

- [instruction.ts](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/console/src/lib/instruction.ts) 的 `taskExecutionPrompt` 重新接收 `projectPath`，输出一句话：

  ```text
  在项目 /home/wenghaoda/tmp/chitootoo/agentxagent 下阅读 .axa/SKILL.md，执行任务 #020「优化执行指令」。
  ```

  只带项目根目录，不再罗列 claim / summary / done 等命令。

- 调用方 [task-conversation.tsx](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/console/src/components/task-conversation.tsx#L203-L213) 恢复校验项目路径，并传回 `project.path`。

## 验证

- `pnpm --filter @contagxt/axa-console typecheck`：通过。
- `pnpm exec biome check packages/console/src/lib/instruction.ts packages/console/src/components/task-conversation.tsx`：通过（Checked 2 files, No fixes applied）。
- 用 tsx 调用 `taskExecutionPrompt` 实际输出：

  ```text
  在项目 /home/wenghaoda/tmp/chitootoo/agentxagent 下阅读 .axa/SKILL.md，执行任务 #020「优化执行指令」。
  ```
