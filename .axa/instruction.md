# axa 行动指南 · AgentxAgent

这个项目使用 [axa](https://github.com/axa-project/agent-x-agent) 管理任务。
任务状态存放在 `.axa/tasks/` 中，由 CLI 与 Core SDK 维护；不要手工移动任务文件。

## 任务目录

- `.axa/tasks/backlog/` — 待审核，尚未批准执行
- `.axa/tasks/todo/` — 已批准，可认领
- `.axa/tasks/doing/` — 已认领，进行中
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

6. 发现新工作时，先放入 backlog 等待人工批准：

   ```bash
   axa create "补充部署文档" --priority P2 --description "..." --agent your-agent-name
   ```

## 规则

- 只执行你已成功认领的任务。
- 不要手工修改 `status`、`claimed_by` 或移动目录；使用 CLI / SDK。
- 任务完成后在正文补充实现说明和验证证据，再执行 `axa done`。
- 不要删除 `.axa/instruction.md`。
- 多个 Agent 可以并行工作，但全局文件锁只保护状态变更，不保护业务代码。
