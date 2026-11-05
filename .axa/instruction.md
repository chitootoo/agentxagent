# axa 行动指南 · AgentxAgent

这个项目使用 [axa](https://github.com/axa-project/agent-x-agent) 管理任务。
任务状态存放在 `.axa/tasks/` 中，由 CLI 与 Core SDK 维护；不要手工移动任务文件。

## 任务目录

- `.axa/tasks/backlog/` — 待审核，尚未批准执行
- `.axa/tasks/todo/` — 已批准，可认领
- `.axa/tasks/doing/` — 已认领，进行中
- `.axa/tasks/review/` — 待验收：工作已完成，等待人工验收
- `.axa/tasks/done/` — 已完成

任务文件名格式：`[编号][优先级][核心描述].md`，例如 `001_P0_初始化工作空间.md`。
优先级：`P0` 最高、`P1` 重要、`P2` 优化。

## Agent 工作流

1. 查看当前项目与任务：

   ```bash
   axa list --json
   ```

2. 选择一个 `todo` 任务并通过 CLI 认领，避免与其他 Agent 冲突：

   ```bash
   axa claim 003 --agent your-agent-name
   # 或者认领当前优先级最高的任务
   axa claim --next --agent your-agent-name
   ```

3. 打开返回的 `.axa/tasks/doing/*.md` 文件，阅读目标与验收标准后开始工作。
4. 遇到阻塞时释放任务：

   ```bash
   axa release 003
   ```

5. 完成并通过验证后标记完成：

   ```bash
   axa done 003 --agent your-agent-name
   ```

   任务卡带有 `review_required: true`（验收需要人工 review）时，`axa done` 会把任务移入
   `.axa/tasks/review/` 待验收，由人类确认后执行 `axa accept 003` 才算完成；
   未开启该选项的任务直接进入 `done`，完成后应直接提交代码。

6. 发现新工作时，先放入 backlog 等待人工批准；需要人工验收的任务加 `--review`：

   ```bash
   axa create "补充部署文档" --priority P2 --description "..." --agent your-agent-name
   axa create "调整线上配置" --priority P1 --review --description "..." --agent your-agent-name
   ```

## 多任务并行：用 worktree 隔离代码

全局文件锁只保护 `.axa/` 的状态变更，不保护业务代码。多个 Agent 在同一工作区并行改代码时，
未提交改动、构建产物与 git 索引会互相污染。

- 先在主工作区认领任务，再为任务创建独立 worktree：

  ```bash
  axa claim --next --agent your-agent-name   # 假设认领到 014
  git worktree add ../my-project-014 -b axa/014
  ```

- 在 worktree 中编码、测试与提交。不要在 worktree 里执行 `axa claim` / `axa done`：
  那里是 `.axa/` 的另一份副本，会让任务状态分叉；需要在 worktree 内更新状态时，加 `--project <主工作区路径>`。
- 合并回主分支后，回到主工作区执行 `axa done <id>`，再清理：`git worktree remove ../my-project-014`。
- 一个任务对应一个分支或 worktree，不要在同一未提交工作区里同时推进多个任务。

## 规则

- 只执行你已成功认领的任务。
- 不要手工修改 `status`、`claimed_by` 或移动目录；使用 CLI / SDK。
- 任务完成后在正文补充实现说明和验证证据，再执行 `axa done`。
- 不需要人工 review 的任务，完成后直接提交代码；需要 review 的任务等待人类验收（`axa accept`），Agent 不得自行验收。
- 不要删除 `.axa/instruction.md`。
- 多个 Agent 可以并行工作，但全局文件锁只保护状态变更，不保护业务代码；并行任务请使用独立 worktree。
