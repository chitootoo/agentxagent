# .axa/tasks · 任务存储与状态机

这份文件面向 Boss，说明任务在磁盘上的组织方式。worker 不需要直接读写这些文件，
状态变更一律通过 `axa` CLI 或 Core SDK 完成。三种角色：Boss（人类）、secretary（秘书 Agent）、worker（执行 Agent）。

## 状态目录

- `backlog/` — 待审核：Boss 创建或 worker 发现的新工作
- `todo/` — 已批准，可被 worker 认领
- `doing/` — 已认领，进行中
- `review/` — 待验收：工作已完成，等待 Boss 验收
- `done/` — 已完成（无需验收，或已验收通过）
- `archived/` — 已归档：终态，默认不显示；Boss 可在控制台追加需求后重新打开

## 状态机

- 需要人工 review 的任务：`doing --done--> review --Boss accept--> done`。
- 无需 review 的任务：`doing --done--> done`。
- review / done / archived 收到 Boss 追加需求后回到 `todo`，保留完整会话。
- doing 超过 7 天未完成，会在下一次项目操作时被自动释放回 `todo`。
- done 超过 30 天，会在下一次项目操作时被自动归档到 `archived`。
- archived 是终态；Boss 在控制台追加需求时任务会重新回到 `todo`。

## 任务文件夹

每个任务对应状态目录下的一个文件夹，例如：

```
.axa/tasks/todo/001_P0_初始化工作空间/
├── task.json
├── 000_user_初始化工作空间.md
├── 001_agent_第一轮完成.md
└── 002_user_追加需求.md
```

- `task.json` — 元信息：id、标题、优先级、状态、认领信息、review 要求、tags、时间戳。
- `{seq}_{role}_{title}.md` — 按三位序号排序的会话记录。`role` 为 `user` 或 `agent`。
- `.lock` — 操作期间的临时锁文件，包含操作者 id，操作结束后删除。

## 本地原子性

- 任务状态只在本机通过文件操作保证一致：认领时在任务文件夹内创建 `.lock`，移动目录在同一个文件系统内原子完成。
- `.axa/` 会提交到 git，以便团队成员共享任务状态；锁文件是临时的，不提交。
- git 合并冲突由开发者自行解决；axa 不依赖远程服务做同步或加锁。
