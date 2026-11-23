---
agent: codebuddy_26-11-22_15:21:07.141
secretary_notified: done:001
---

## 背景与问题

#026 将全局注册表 `~/.axa/config.json` 的项目主键改为便携 id（`git:<host>/<owner>/<repo>` 或 `local:<uuid>`），但存量条目的 name-based id（如 `agentxagent`、`militutu`）只在进入项目目录执行 `syncRegisteredProjectPath()` 时才升级。CLI / Console / 秘书在仅加载配置时仍看到旧 id，缺乏自动迁移。

## 改动

- `packages/core/src/config.ts`：
  - 新增 `isPortableProjectId()` 识别新格式主键（`git:` / `local:` 前缀）。
  - 新增 `upgradeLegacyProjectIds()`：对 name-based 旧 id 且项目目录仍存在的条目，调用 `resolveProjectIdentity()` 解析便携 id（有 git remote 用 git id，否则用项目 `.axa/config.json` 的 local uuid），升级 `project.id` 并同步 `defaultProjectId`；新 id 已被其他条目占用时跳过以避免冲突。
  - `readConfig()` 校验后执行迁移，有变更时原子写回；已是便携 id 直接跳过，保证幂等。项目目录缺失或无法解析的条目原样保留，不丢失存量数据。
- `packages/core/src/core.test.ts`：新增 `legacy config migration` 5 个单测——加载即升级并持久化、幂等（内容与文件字节均不变）、便携 id 不变、缺失项目保留、有 git remote 时升级为 git id。

## 验证

- `pnpm test`：47 passed（原 42 + 新增 5）。
- `pnpm typecheck`：全部 5 个包通过。
- `pnpm exec biome check`：改动文件通过；编辑器 lint 诊断 0。
- `pnpm --filter @contagxt/axa-core build` 成功，CLI/秘书使用的 dist 已更新。
- 真实 `~/.axa/config.json` 中 `militutu` 条目路径已不存在，按设计保留旧 id 不删除；当前项目已是 `git:github.com/chitootoo/agentxagent`，不再触发迁移。

## 备注

- 迁移只改变项目主键 id 的语义（name-based → portable），JSON 顶层结构 `version` / `projects` / `defaultProjectId` 保持兼容，既有消费者无需修改。
- 未提交 git：工作区原本存在大量未提交/未跟踪改动，本次仅做最小增量修改。
