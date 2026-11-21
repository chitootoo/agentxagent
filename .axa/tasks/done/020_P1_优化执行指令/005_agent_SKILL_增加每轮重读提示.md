---
agent: qoder_26-11-20_23:20:03.283
---

## 本轮实现

按新需求，在 SKILL.md 的“开始工作”流程中增加每轮重新获取任务详情的强制提示：

- [.axa/SKILL.md](file:///home/wenghaoda/tmp/chitootoo/agentxagent/.axa/SKILL.md#L31-L37)
- [packages/core/src/instruction.ts](file:///home/wenghaoda/tmp/chitootoo/agentxagent/packages/core/src/instruction.ts#L32-L38)（新建项目时生成的 SKILL.md 模板）

新增第 4 步：每轮执行前（首次或迭代）都必须重新获取任务详情，并从头按序号阅读全部会话记录，例如运行 `axa show 003`。不要沿用上一轮或缓存中的任务内容；用户可能在上次读取后追加或修改要求，一律以本次读取到的最新内容为准。

这样首次执行和迭代执行都会先重新拉取任务详情，避免用户追加/修改要求后 Agent 仍按旧内容执行。

## 验证

- `pnpm lint`：通过，71 个文件无问题。
- `pnpm typecheck`：core / proto / cli / console 全部通过。
- 本轮本身按新流程执行：先 `axa comment` 记录新增需求，任务回到 todo；再用 `axa claim 020 --agent qoder` 生成本轮 agent id `qoder_26-11-20_23:20:03.283`；重新读取任务详情与会话后实施。
