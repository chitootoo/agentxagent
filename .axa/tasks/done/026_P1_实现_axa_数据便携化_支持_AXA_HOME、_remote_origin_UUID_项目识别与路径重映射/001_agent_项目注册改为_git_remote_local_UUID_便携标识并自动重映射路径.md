---
agent: trae_26-11-22_14:10:36.598
---

## 改动
- 新增 `packages/core/src/project-id.ts`：优先用 `git remote get-url origin` 生成 `git:<host>/<owner>/<repo>`（SSH/HTTPS 归一化）；无 remote 时在项目 `.axa/config.json` 持久化 `local:<uuid>`；后续出现 remote 自动升级 id 并返回旧 id 供迁移。
- `packages/core/src/config.ts`：注册表改以 project id 匹配，支持 id 升级迁移、路径重映射与去重；`resolveCliProject` 在进入项目时自动同步路径；`AXA_HOME` 支持 `~` 展开。
- `packages/console/drizzle.config.ts`：默认数据库路径同样遵循 `AXA_HOME`。

## 验证
- `pnpm --filter @contagxt/axa-core test`：36 passed（新增本地 id 稳定、SSH/HTTPS 归一化、local→git 升级、移动目录重映射、AXA_HOME 切换）。
- `pnpm typecheck`、`pnpm lint` 通过。
- CLI 端到端：无 remote 注册为 `local:<uuid>`；添加 remote 后重新注册升级为 `git:github.com/acme/portable-demo`，注册表仅一条记录。
