---
title: 任务卡增加验收是否需要人工review选项
created_at: 2026-11-05T07:45:02.288Z
updated_at: 2026-11-05T08:58:22.975Z
claimed_by: TraeCode
claimed_at: 2026-11-05T08:41:53.670Z
created_by: console
completed_at: 2026-11-05T08:58:22.975Z
completed_by: TraeCode
---

如题, 增加该选项, 默认为不需要. 不需要review的话, 完成任务直接commit代码. 需要review的话任务标志为待验收, 任务卡上展示待验示标志. 用户可以在console或agent对话窗口进行验收通过.

## 实现说明

- 新增 `review` 状态（待验收）与 `review_required` 核心字段。状态机：`doing → (review_required ? review : done) → done`。
- 新增目录 `.axa/tasks/review/`，由 `ensureTaskDirs` 在首次操作时自动创建。
- 新增 `acceptTask`：把 review 任务移入 done，记录 `accepted_by` / `accepted_at`。
- CLI：`axa accept <id>`；`axa create --review`；`axa done` 在移入 review 时显示 ⏳ 提示。
- Proto：`TaskStatus.REVIEW`、`Task.review_required`、`Project.review_count`、`AcceptTask` RPC。
- Console：Review 列（紫色）、卡片上“待验收”徽标 + “验收通过”按钮、新建/编辑表单的“验收需要人工 Review”复选框。
- 文档：`defaultInstruction` / `SKILL.md` / `.axa/instruction.md` 同步更新工作流与 commit 规则。
- TDD：core 新增 8 条 review 工作流测试（默认值、持久化、完成分支、验收、非 review 拒绝、开关切换、项目计数）。

## 验证证据

- Core 单测：`pnpm test` → 25 passed（含 8 条新增 review 流程）。
- 全量校验：`pnpm build`（含 console next build）通过；`pnpm lint` 0 issues；`pnpm -r typecheck` 全部通过。
- CLI 端到端（`/tmp/axa-e2e` 临时项目，已清理）：
  - `axa create "..." --review` → frontmatter 写入 `review_required: true`；
  - `axa done` → 任务进入 `.axa/tasks/review/`，输出 `⏳ Finished ... → review（待人工验收...）`；
  - `axa accept` → 任务进入 `.axa/tasks/done/`，输出 `✓ Accepted ... → done`；
  - 未开启 review 的任务 `axa done` 直接进入 done。
- Console 浏览器验证（`http://localhost:3000/projects/axa-e2e`）：
  - Review 列存在且计数正确；卡片显示紫色“待验收”徽标与“验收通过”按钮；
  - 点击“验收通过”后提示“已验收通过 #003”，Review 列计数归零，Done 列出现该任务；
  - 新建任务表单的“验收需要人工 Review”复选框可见、可勾选、无报错。
