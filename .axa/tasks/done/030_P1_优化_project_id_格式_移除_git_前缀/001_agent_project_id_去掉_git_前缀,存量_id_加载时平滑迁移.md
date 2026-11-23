---
agent: codebuddy_26-11-22_15:35:02.026
secretary_notified: done:001
---

## 改动

- `packages/core/src/project-id.ts`：
  - `normalizeGitRemoteUrl()` 生成的 Git 类型 id 去掉 `git:` 前缀，改为 `<host>/<owner>/<repo>`（如 `github.com/chitootoo/agentxagent`）；`local:<uuid>` 保持不变。
  - 新增并导出 `isPortableProjectId()`：识别 `local:` 与 `<host>/<owner>/<repo>`，旧 `git:` 前缀及 name-based id 判为非便携。
  - `resolveProjectIdentity()` 在无 git remote 时也升级存量 `git:` 前缀的项目本地 id：剥掉前缀写回 `.axa/config.json`，并返回 `previousId` 供注册表迁移。
- `packages/core/src/config.ts`：`upgradeLegacyProjectIds()` 对注册表中 `git:` 前缀的旧 id 直接剥前缀升级（不依赖项目目录是否存在），同步 `defaultProjectId`；name-based id 仍按 `resolveProjectIdentity()` 推导。识别逻辑改为复用 core 的 `isPortableProjectId()`，消除重复。
- `packages/core/src/index.ts`：导出 `isPortableProjectId`。
- `packages/core/src/core.test.ts`：所有 Git id 期望值更新为新格式；新增 3 个测试——格式识别、无 remote 时存量 `git:` 本地 id 升级并写回、全局注册表旧前缀 id 在项目目录缺失时仍能迁移。
- `notification.ts` / `deep-link.ts` / `console/src/lib/project-link.ts`：文档注释中的示例 id 同步为新格式。

## 验证

- `pnpm typecheck`：全部 5 个包通过。
- `pnpm lint`（biome check .）：86 个文件通过。
- `pnpm test`：53 passed（新增 3 个）。
- `pnpm --filter @contagxt/axa-core build` 成功，CLI/秘书使用的 dist 已更新。

## 备注

- 平滑迁移是加载时自动完成的：真实 `~/.axa/config.json` 与项目 `.axa/config.json` 中现存的 `git:` 前缀 id，会在下次读取时自动升级为无前缀格式，无需手工改文件。
- 未提交 git：工作区原本存在大量未提交/未跟踪改动，本次仅做最小增量修改。
