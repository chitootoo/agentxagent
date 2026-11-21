在axa相关指引中添加使用worktree以避免多任务执行产生冲突.

## 实现说明

- `packages/core/src/instruction.ts`：`axa init` 生成 `.axa/instruction.md` 的模板新增「多任务并行：用 worktree 隔离代码」章节，并在规则中要求并行任务使用独立 worktree。
- `.axa/instruction.md`：同步更新本项目指引，与模板保持一致。
- `skills/SKILL.md`：新增 "Isolate parallel work with worktrees" 章节，明确在主工作区认领/完成、在 worktree 内编码提交，避免在 worktree 内执行 `axa claim`/`axa done` 导致状态分叉。
- `README.md`：新增「多 Agent 并行」小节，指向上述指引。

## 验证证据

- 用 `node --import tsx` 渲染 `defaultInstruction("AgentxAgent")`，与 `.axa/instruction.md` diff 无差异。
- `pnpm --filter @contagxt/axa-core test`：15 tests passed。
- `pnpm --filter @contagxt/axa-core typecheck`：通过。
- `biome check packages/core/src/instruction.ts`：无问题。
