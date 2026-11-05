# axa 行动指南 · AgentxAgent

这个项目使用 [axa](https://github.com/axa-project/agent-x-agent) 管理任务。
任务状态存放在 `.axa/tasks/` 中，由 CLI 与 Core SDK 维护；不要手工移动任务文件。

## 任务目录

- `.axa/tasks/backlog/` — 待审核，尚未批准执行
- `.axa/tasks/todo/` — 已批准，可认领
- `.axa/tasks/doing/` — 已认领，进行中
- `.axa/tasks/review/` — 待验收：工作已完成，等待人工验收
- `.axa/tasks/done/` — 已完成

每个任务是状态目录下的一个文件夹，例如 `.axa/tasks/todo/001_P0_初始化工作空间/`。
优先级：`P0` 最高、`P1` 重要、`P2` 优化。

任务文件夹内包含：

- `task.json` — 元信息（标题、优先级、创建时间、认领信息、tags 等）
- `000_user_<标题>.md` — 初始需求
- `001_agent_<标题>.md`、`002_user_<标题>.md` … — 后续轮次的 Agent 汇总与用户追加需求

所有会话文件按三位序号排序，后续 Agent 必须先读取完整会话，再继续执行。

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

3. 打开返回的任务文件夹，按序号阅读全部 `*_user_*.md` / `*_agent_*.md` 会话记录与 `task.json`，
   理解本轮目标与验收标准后开始工作。
4. 遇到阻塞时释放任务：

   ```bash
   axa release 003
   ```

5. 完成并通过验证后，先把本轮汇总写入会话，再标记完成：

   ```bash
   axa summary 003 --agent your-agent-name \
     -m "## 本轮完成\n\n实现说明与验证证据（命令、结果）。"
   axa done 003 --agent your-agent-name
   ```

   任务默认需要人工 review：`axa done` 会把任务移入 `.axa/tasks/review/` 待验收，
   由人类确认后执行 `axa accept 003` 才算完成。没有提交汇总文件时，`axa done` 会拒绝进入 review。
   创建任务时加 `--no-review` 可跳过 review，直接进入 `done`。

6. 用户验收不通过时，会通过 `axa comment 003 -m "..."` 追加需求，任务重新回到 `todo`；
   下一轮 Agent 应继续读取完整会话后执行。

7. 发现新工作时，先放入 backlog 等待人工批准：

   ```bash
   axa create "补充部署文档" --priority P2 --description "..." --agent your-agent-name
   axa create "调整线上配置" --priority P1 --no-review --description "..." --agent your-agent-name
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
- 不要手工修改 `task.json` 中的状态 / 认领信息，也不要手工移动任务文件夹；使用 CLI / SDK。
- 每轮完成后必须先用 `axa summary` 写入实现说明和验证证据，再执行 `axa done`。
- 默认需要人工 review；只有 `--no-review` 的任务完成后直接提交代码。需要 review 的任务等待人类验收（`axa accept`），Agent 不得自行验收。
- 不要删除 `.axa/instruction.md`。
- 多个 Agent 可以并行工作，但全局文件锁只保护状态变更，不保护业务代码；并行任务请使用独立 worktree。
