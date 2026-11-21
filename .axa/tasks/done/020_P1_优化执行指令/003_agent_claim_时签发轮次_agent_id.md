---
agent: qoder-calm-wolf-4eac
---

## 方案评估

用户方案可行，采纳并补充三点：

1. `summary` / `done` / `release` 不再要求环境变量，CLI 自动读取 task.json 的 `claimedBy` 作为本轮身份，避免 Agent 回传 id。
2. `done` 完成时同样清除 `claimedBy`，并把原值写入 `extra.completed_by`，锁语义完整。
3. 汇总 Markdown 写入 frontmatter，会话解析器同步剥离，避免控制台把 frontmatter 当正文。

另做两点小调整：platform name 做 slug 清洗；`list --claimed-by` 改为平台前缀匹配。

## 本轮实现

### 身份与锁

- 新增 `buildAgentId(platform)`：生成 `{platform}_{yy-MM-dd_HH:mm:ss.SSS}`，platform 统一小写并清洗为 `[a-z0-9-]`。
- `axa claim <id> --agent <platform>` 时由 core 生成本轮 id 写入 `claimedBy`，返回值与 CLI 输出都会显示。
- 删除 `axa register` 命令、`AXA_AGENT` 环境变量、`resolveAgent()` / `sessionAgent()`。
- `summary` / `done` / `release` 自动使用当前 `claimedBy`；显式传入其他 actor 仍会被拒绝。
- `done`、`release`、超时释放都会清除 `claimedBy` / `claimedAt`；`done` 把原 agent id 记入 `extra.completed_by`。
- `list --claimed-by <platform>` 支持 `qoder` 匹配 `qoder_26-11-20_...`。

### 轮次归属

- `ConversationEntry` 新增 `agent`；proto 增加 `ConversationEntry.agent = 7` 并重新生成。
- Agent 汇总文件写入 YAML frontmatter：

  ```markdown
  ---
  agent: qoder_26-11-20_22:59:59.203
  ---
  ```

- 会话解析器读取并剥离 frontmatter，控制台每个 Agent 气泡显示该轮真实 agent id；历史旧消息无 frontmatter 时显示 `Agent`。
- 同一任务多轮 claim 会得到不同 id，测试已覆盖两轮归属互不串扰。

### 指令与文档

- `packages/core/src/instruction.ts` 与 `.axa/SKILL.md`：删除 register/export，claim 改为 `--agent <platform>`，补充“每轮重新 claim、id 由 CLI 签发”。
- 控制台“复制执行指令”同步为 5 条 bullet，不再包含 register。
- README：更新快速开始、命令表、Agent 身份说明、task.json 示例、环境变量表。

## 验证

- `pnpm test`：30 个 core 测试全部通过，新增断言覆盖：
  - claimedBy 格式 `^worker-a_\d{2}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.\d{3}$`
  - 两轮 agent id 不同，汇总文件 frontmatter 分别记录当轮 id
  - 完成后 `claimedBy` 清空、`completed_by` 保留
- `pnpm typecheck`：core / proto / cli / console 全部通过。
- `pnpm lint`：71 个文件通过。
- `pnpm build`：生产构建通过。
- 临时项目端到端冒烟：

  ```text
  ✓ Claimed 001 Smoke identity
    Agent: qoder_26-11-20_22:59:59.203
  ✓ Recorded 001_agent_本轮实现.md for 001
  ⏳ Finished 001 Smoke identity → review
  claimedBy= undefined completed_by= qoder_26-11-20_22:59:59.203
  ```

## 备注

- 本任务第一轮遗留的 `claimedBy: qoder-calm-wolf-4eac` 按旧格式继续使用；本轮 summary 会把它写入 frontmatter，`done` 后清除。
- 历史任务文件未迁移，属于不可追溯的旧数据；新产生的每轮都有 agent 归属。
