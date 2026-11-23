---
agent: codebuddy_26-11-22_15:29:29.646
secretary_notified: done:001
---

## 任务两部分处理

1. **存量数据自动平滑升级**：已由前一任务 028 完成——`readConfig()` 加载时检测 name-based 旧 id，对仍存在的项目用 `resolveProjectIdentity()` 升级为 portable id、同步 `defaultProjectId` 并原子写回，幂等且保留缺失项目。本轮复查确认生效，未重复改动。
2. **Console 项目 ID 路由 404**：本轮修复。

## 404 根因

所有指向项目的深链都把原始 `projectId` 直接拼进 URL path。升级为 `git:github.com/chitootoo/agentxagent` 后，id 中的 `/` 被当作路径分隔符，一个动态段被拆成多段，`/projects/[id]` 无法匹配而 404。

## 改动

- `packages/core/src/deep-link.ts`：新增 `projectLink()` / `taskLink()`，对 projectId（及 taskId）做 `encodeURIComponent`；core 导出，秘书 `summarizeTask()` 的汇总链接改用 `taskLink`。
- `packages/console/src/lib/project-link.ts`：浏览器安全版本的同逻辑工具（避免客户端组件从 core 导入时把 Node 内置模块打进 bundle），并注明与 core 保持一致。
- Console 4 个组件共 6 处链接改为工具函数：`inbox-view.tsx`（创建后跳转、会话行）、`projects-view.tsx`（项目卡片）、`task-conversation.tsx`（删除后跳转、返回列表）、`secretary-chat.tsx`（查看任务按钮）。
- `app-shell.tsx` 的会话聚焦正则由 `[^/]+` 改为 `.+`，兼容含斜杠或编码后的项目段。
- 读取侧未加 `decodeURIComponent`：Next.js App Router 会自动解码 `params`，额外解码会双重解码；Connect RPC 的 `projectId` 走请求体，继续传原始 id。

## 验证

- `pnpm test`：50 passed（新增 3 个深链编码单测：git id、task 链接、local id）。
- `pnpm typecheck`：全部 5 个包通过。
- `pnpm exec biome check`：11 个改动文件通过。
- `pnpm --filter @contagxt/axa-console build`：成功，路由清单包含 `/projects/[id]` 与 `/projects/[id]/tasks/[taskId]`。

## 备注

- 过程中首次构建发现客户端组件直接从 `@contagxt/axa-core` 导入会使 Turbopack 无法解析 `child_process` / `fs/promises`；已改为 Console 本地纯函数模块后构建通过。
- 未提交 git：工作区原本存在大量未提交/未跟踪改动，本次仅做最小增量修改。
