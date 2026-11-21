已实现任务迭代与任务文件夹模型（分支 axa/018，已合入 main，commit 1ac59c1）。

## 核心改动
- 任务存储由单文件改为文件夹：`tasks/<status>/<id>_<prio>_<slug>/`，内含 `task.json` 元信息与按序号排列的会话 Markdown，文件名格式 `{seq}_{role}_{title}.md`（如 `000_user_支持任务迭代.md`）。
- 旧版单文件任务保持可读，并在下次写入时自动迁移为文件夹。
- `axa summary <id>` 写入 agent 轮次汇总；`reviewRequired` 任务在 `axa done` 前必须存在最新 agent 汇总，否则拒绝进入 review。
- `axa comment <id>` 追加用户需求；review/done 任务会重新打开为 todo，清空认领与完成/验收字段，保留完整会话。
- 默认改为需要人工验收（review），`axa create --no-review` 可跳过；工作台选项由“验收需要人工 Review”改为“无需review”，默认不勾选。
- Proto/Connect 新增 `ConversationEntry`、`AppendTaskMessage`；工作台任务卡展示会话时间线并支持追加需求。
- 同步更新 README、skills/SKILL.md、`.axa/instruction.md` 与 core 指令文案。

## 验证
- `pnpm typecheck`、`pnpm test`（25 项）、`pnpm lint`、`pnpm build` 全部通过。
- CLI 端到端：create → claim → 无汇总 done 被拒 → summary → done(review) → comment 回到 todo。
- 工作台 headless Chrome 验证：会话记录展示、追加需求可用、“无需review”默认未勾选；AppendTaskMessage RPC 实测通过。
