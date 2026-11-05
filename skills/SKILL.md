---
name: axa
description: Use the axa CLI to pick up, track, and finish work in a project that stores tasks under .axa/. Trigger this skill when a repository contains .axa/instruction.md, when the user asks you to work on axa tasks, or when you need to coordinate with other agents without duplicating effort.
---

# axa · Agent Of Agent

axa is a local-first task hub. Every task is a folder under `.axa/tasks/`, and the state directory that contains it determines its status. Each task folder holds `task.json` metadata plus ordered `{seq}_{role}_{title}.md` conversation files (`user` requirements and `agent` round summaries).

```
.axa/tasks/backlog/  waiting for human approval
.axa/tasks/todo/     approved, free to claim
.axa/tasks/doing/    claimed, someone is working on it
.axa/tasks/review/   work finished, waiting for human acceptance (review_required tasks)
.axa/tasks/done/     finished
```

Never move, rename, or hand-edit task files to change state. Use the CLI so locks, timestamps, and frontmatter stay consistent.

## Start every session

```bash
axa list --json --status todo
```

Read `.axa/instruction.md` if it exists. It contains project-specific rules that override general advice.

## Claim before you work

Claiming is atomic across processes: exactly one agent wins.

```bash
axa claim --next --agent <your-agent-name>
# or a specific task
axa claim 003 --agent <your-agent-name>
```

`claim --next` picks the highest-priority todo task, oldest first. The command prints the path to the task folder. Read `task.json` and every conversation file in seq order before writing code: the goal, constraints, acceptance criteria, and any follow-up requirements are there.

If you cannot start the task, put it back:

```bash
axa release 003 --agent <your-agent-name>
```

Do not keep a claimed task idle. If you stop working for a long time, release it so the scheduler can reclaim it.

## Isolate parallel work with worktrees

The axa lock only protects `.axa/` state changes, never source files. When several agents work at
once, uncommitted changes, build output, and the git index collide in a shared working tree.

- Claim first in the main working tree (the canonical `.axa/`), then put the code work on its own
  branch in a separate git worktree:

  ```bash
  axa claim --next --agent <your-agent-name>   # claim returns e.g. 014
  git worktree add ../my-project-014 -b axa/014
  ```

- Code, test, and commit inside the worktree. Do not run `axa claim` / `axa done` there: it holds a
  second copy of `.axa/` and would fork the task state. To update state from the worktree, pass
  `--project <main-worktree-path>`.
- After merging the branch back, run `axa done <id>` from the main working tree, then clean up with
  `git worktree remove ../my-project-014`.
- One task per branch or worktree. Never push two tasks through the same uncommitted working tree.

## Finish with evidence

Before completing:

1. Verify the change (tests, typecheck, lint, or a manual reproduction).
2. Append this round's implementation note and verification evidence as an agent message:

```bash
axa summary 003 --agent <your-agent-name> -m "## 本轮完成

实现说明；pnpm test / typecheck 结果。"
```

3. Mark it done:

```bash
axa done 003 --agent <your-agent-name>
```

Tasks require human review by default. `axa done` refuses to move a review-required task forward
until the latest conversation entry is an agent summary, then places it in `review/`. A human
accepts with `axa accept <id>` (in the console or via chat). Never accept on a human's behalf.
Tasks created with `--no-review` land directly in `done/`; commit the finished code right away.

If a human rejects the result, they append a requirement with `axa comment <id> -m "..."`. The task
reopens to `todo/`, keeps the full conversation, and the next agent must read all rounds before
continuing.

## Discover new work

Anything you find that is out of scope goes to the backlog, never silently into your current change:

```bash
axa create "支持任务依赖关系" --priority P2 \
  --description "验收：claim 时校验 dependsOn，看板展示阻塞状态。" \
  --agent <your-agent-name>
```

A human approves backlog items with `axa approve <id>`. Only work on tasks that are in `todo` (and that you claimed).

## Rules

- Only work on a task you successfully claimed.
- Use `--json` for machine-readable output; logs and tables are for humans.
- Pass `--agent` (or set `AXA_AGENT`) on every mutation so the audit trail is useful.
- Another agent may be editing a different task at the same time. The lock only guards `.axa/` state changes, not shared source files — use a per-task branch or worktree for parallel work.
- Never delete `.axa/instruction.md`.
- If the CLI is unavailable, look for `.axa/instruction.md` and report the problem instead of editing state manually.

## Commands at a glance

| Need | Command |
| --- | --- |
| See available work | `axa list --status todo --json` |
| See everything | `axa board` |
| Claim highest priority | `axa claim --next --agent me` |
| Release | `axa release <id> --agent me` |
| Write a round summary | `axa summary <id> -m "..." --agent me` |
| Complete | `axa done <id> --agent me` |
| Accept a review task | `axa accept <id> --agent me` |
| Read a task and its conversation | `axa show <id>` |
| Add backlog item | `axa create "<title>" --priority P1 --description "..."` |
| Skip human acceptance | add `--no-review` to `axa create` |
| Append a user requirement | `axa comment <id> -m "..."` |
| Recover abandoned work | `axa reclaim --older-than 24h` |
