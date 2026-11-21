## 本轮实现

优化控制台「复制执行指令」按钮生成的 Prompt（[instruction.ts](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/console/src/lib/instruction.ts)）：

- 去掉 `axa claim` / `axa summary` / `axa done` 上的 `--project <root>` 参数。axa 默认按当前目录的 `.axa/tasks` 定位任务，无需显式传项目路径。
- 步骤改为 Markdown bullet list，一句一步：读 `SKILL.md` → 注册 `AXA_AGENT` → `claim` 并读完会话 → `summary` → `done`。
- 保留项目根目录下的 `.axa/SKILL.md` 绝对路径，方便 Agent 在任意工作目录下找到项目约定。

生成结果示例（任务 #020）：

```text
请按 axa 工作流执行任务 #020「优化执行指令」：
- 阅读 /home/wenghaoda/tmp/chitootoo/agentxagent/.axa/SKILL.md，了解任务约定与状态机；
- 运行 `axa register qoder`，并 `export AXA_AGENT=<输出的 id>`；
- 运行 `axa claim 020` 认领任务，按序号读完任务目录中的全部会话记录；
- 完成后把本轮实现说明与验证证据写入 Markdown 文件，运行 `axa summary 020 --file <汇总文件>`；
- 最后运行 `axa done 020` 标记完成。
```

## 验证

- `pnpm --filter @contagxt/axa-console typecheck`：通过（tsc --noEmit 无报错）。
- `pnpm exec biome check packages/console/src/lib/instruction.ts`：通过（Checked 1 file, No fixes applied）。
- 用 tsx 直接调用 `taskExecutionPrompt` 输出上方示例，确认不再出现 `--project`，且步骤为 bullet list。

## 备注

未改动 `packages/core/src/instruction.ts` 中 worktree 章节的 `--project <主工作区路径>` 说明：worktree 内存在另一份 `.axa/`，那里的 `--project` 是必要的，与本次控制的普通任务场景不同。
