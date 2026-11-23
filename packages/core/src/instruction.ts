export function defaultInstruction(projectName: string): string {
  return `---
name: axa
description: Use the axa CLI to pick up, track, and finish work in a project that stores tasks under .axa/. Trigger this skill when a repository contains .axa/SKILL.md, when the user asks you to work on axa tasks, or when you need to coordinate with other workers without duplicating effort.
---

# axa 行动指南 · ${projectName}

本项目使用 [axa](https://github.com/axa-project/agent-x-agent) 管理任务。
任务状态只通过 CLI / SDK 变更；不要手工创建、修改、移动或删除 \`.axa/tasks/\` 下的任何文件。

## 三种角色

- **Boss**：人类。与控制台里的秘书对话，批准和验收任务。
- **secretary**：秘书 Agent。理解 Boss 的需求，简单问题直接回答，耗时工作写成 axa 任务。
- **worker**：你。只认领 \`todo\` 任务、执行、提交汇总；不创建验收结论。

秘书创建的任务会直接进入 \`todo\`，通常不需要再等 Boss 批准。

## 开始工作

1. 在包含 \`.axa/\` 的项目目录内执行命令；axa 会自动查找当前项目的任务。

2. 查看可认领任务：

   \`\`\`bash
   axa list --status todo --json
   \`\`\`

3. 认领任务时提交你的平台名（如 qoder、trae、codex）。CLI 会生成本轮唯一的 agent id
   （\`{平台}_{yy-MM-dd_HH:mm:ss.SSS}\`），写入 \`task.json\` 的 \`claimedBy\` 作为锁：

   \`\`\`bash
   axa claim 003 --agent qoder     # 指定任务
   axa claim --next --agent qoder  # 认领优先级最高的 todo 任务
   \`\`\`

   每次 claim 都会得到新的 agent id；不要手工修改 \`claimedBy\`。

4. 每轮执行前（首次或迭代）都必须重新获取任务详情，并从头按序号阅读全部会话记录：

   \`\`\`bash
   axa show 003
   \`\`\`

   不要沿用上一轮或缓存中的任务内容。Boss 可能在你上次读取后追加或修改了要求，一律以本次读取到的最新内容为准。

5. 无法继续时立即释放，不要长期占用：

   \`\`\`bash
   axa release 003
   \`\`\`

   doing 超过 7 天未完成会被自动释放回 todo。

## 完成

1. 验证改动：测试、typecheck、lint 或手工复现。
2. 把本轮实现说明与验证证据写入一个 Markdown 文件，例如 \`/tmp/axa-summary-003.md\`。
3. 追加汇总（用 \`--title\` 一句话概括本轮核心改动，它会成为会话记录标题；agent id 自动使用当前 \`claimedBy\` 并写入 frontmatter）：

   \`\`\`bash
   axa summary 003 --title "删除 register，改为 claim 时签发 agent id" --file /tmp/axa-summary-003.md
   \`\`\`

4. 标记完成（同时清除 \`claimedBy\` 锁）：

   \`\`\`bash
   axa done 003
   \`\`\`

\`axa done\` 要求最新一条会话是本轮 worker 汇总，否则会报错并提示先执行 \`axa summary\`。
需要人工 review 的任务会进入 \`.axa/tasks/review/\`，由 Boss 在控制台验收；worker 不得自行验收。

## 迭代

Boss 验收不通过或在任务完成后追加需求时，会在控制台追加一条用户消息。
任务重新回到 \`todo\`，并保留完整会话；下一轮必须重新 claim，由 claim 签发新的 agent id。
下一轮 worker 必须按序号读完所有轮次再继续。

## 发现新工作

范围外的工作先放入 backlog，等待 Boss 批准，不要混入当前改动：

\`\`\`bash
axa create "补充部署文档" --priority P2 --description "验收标准..."
\`\`\`

Boss 在控制台批准后，任务才会进入 \`todo\`。

## 多 worker 并行：用 worktree 隔离代码

任务锁只保护单个任务的状态变更，不保护业务代码。多个 worker 在同一工作区并行改代码时，
未提交改动、构建产物与 git 索引会互相污染。

- 先在主工作区认领任务，再为任务创建独立 worktree：

  \`\`\`bash
  axa claim --next --agent qoder  # 假设认领到 014
  git worktree add ../my-project-014 -b axa/014
  \`\`\`

- 在 worktree 中编码、测试与提交。不要在 worktree 里执行 \`axa claim\` / \`axa done\`：
  那里是 \`.axa/\` 的另一份副本，会让任务状态分叉；需要在 worktree 内更新状态时，加 \`--project <主工作区路径>\`。
- 合并回主分支后，回到主工作区执行 \`axa done <id>\`，再清理：\`git worktree remove ../my-project-014\`。
- 一个任务对应一个分支或 worktree，不要在同一未提交工作区里同时推进多个任务。

## 规则

- 只执行你已成功认领的任务。
- claim 时提交平台名，由 CLI 生成本轮 agent id；不要手工修改 \`claimedBy\` 或复用其他轮次的 id。
- 任务文件夹中的编号 Markdown 统一称「会话记录」，文件名后缀是它的标题。
- \`--title\` 要一眼看出核心内容，避免「本轮实现」「方案评估」这类泛化标题或整段原文。
- 使用 CLI / SDK 变更状态；不要手工修改 \`task.json\`、会话记录或任务目录。
- 不要把任务改成无需 review；是否 review 由 Boss 创建任务时决定。
- 不要执行验收类操作；验收由 Boss 在控制台完成。
- 不要删除 \`.axa/SKILL.md\`。
- CLI 不可用时，报告问题而不是手工改状态。

## 命令速查

| 需求 | 命令 |
| --- | --- |
| 查看可认领任务 | \`axa list --status todo --json\` |
| 查看完整看板 | \`axa board\` |
| 认领任务并生成本轮 agent id | \`axa claim <id> --agent <platform>\` |
| 认领最高优先级任务 | \`axa claim --next --agent <platform>\` |
| 释放任务 | \`axa release <id>\` |
| 写入本轮汇总 | \`axa summary <id> --title "核心改动" --file <path>\` |
| 标记完成 | \`axa done <id>\` |
| 查看任务与全部会话 | \`axa show <id>\` |
| 新建 backlog 任务 | \`axa create "<title>" --priority P1 --description "..."\` |
`;
}

export function defaultTasksReadme(): string {
  return `# .axa/tasks · 任务存储与状态机

这份文件面向 Boss，说明任务在磁盘上的组织方式。worker 不需要直接读写这些文件，
状态变更一律通过 \`axa\` CLI 或 Core SDK 完成。三种角色：Boss（人类）、secretary（秘书 Agent）、worker（执行 Agent）。

## 状态目录

- \`backlog/\` — 待审核：Boss 创建或 worker 发现的新工作
- \`todo/\` — 已批准，可被 worker 认领
- \`doing/\` — 已认领，进行中
- \`review/\` — 待验收：工作已完成，等待 Boss 验收
- \`done/\` — 已完成（无需验收，或已验收通过）
- \`archived/\` — 已归档：终态，默认不显示；Boss 可在控制台追加需求后重新打开

## 状态机

\`\`\`
                  Boss approve
backlog ─────────────────────────▶ todo
                                    │ ▲
                     worker claim   │ │ release / 7 天未完成
                                    ▼ │
                                  doing
                                    │
                            worker done
                                    ▼
                       ┌──── review ────┐
       Boss accept     │                │ Boss comment
              ┌────────┘                └──────────▶ todo
              ▼
            done ──────── 30 天 ───────▶ archived
              │                              │
              └──── Boss comment ──▶ todo   └── Boss comment ──▶ todo
\`\`\`

- 需要人工 review 的任务：\`doing --done--> review --Boss accept--> done\`。
- 无需 review 的任务：\`doing --done--> done\`。
- review / done / archived 收到 Boss 追加需求后回到 \`todo\`，保留完整会话。
- doing 超过 7 天未完成，会在下一次项目操作时被自动释放回 \`todo\`。
- done 超过 30 天，会在下一次项目操作时被自动归档到 \`archived\`。
- archived 是终态；Boss 在控制台追加需求时任务会重新回到 \`todo\`。

## 任务文件夹

每个任务对应状态目录下的一个文件夹，例如：

\`\`\`
.axa/tasks/todo/001_P0_初始化工作空间/
├── task.json
├── 000_user_初始化工作空间.md
├── 001_agent_第一轮完成.md
└── 002_user_追加需求.md
\`\`\`

- \`task.json\` — 元信息：id、标题、优先级、状态、认领信息、review 要求、tags、时间戳。
- \`{seq}_{role}_{title}.md\` — 按三位序号排序的会话记录。\`role\` 为 \`user\` 或 \`agent\`。
- \`.lock\` — 操作期间的临时锁文件，包含操作者 id，操作结束后删除。

## 本地原子性

- 任务状态只在本机通过文件操作保证一致：认领时在任务文件夹内创建 \`.lock\`，移动目录在同一个文件系统内原子完成。
- \`.axa/\` 会提交到 git，以便团队成员共享任务状态；锁文件是临时的，不提交。
- git 合并冲突由开发者自行解决；axa 不依赖远程服务做同步或加锁。
`;
}
