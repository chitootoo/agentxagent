# AgentxAgent · axa

**Agent Of Agent** — 一个本地优先、以文件为真相源的多 Agent 任务协作中心。

axa 把任务写成人类和 Agent 都能直接阅读的 Markdown 文件，放在项目的 `.axa/` 目录里。人类用命令行或网页控制台观察、审批和接管；Agent 用同一条 CLI 原子地认领任务，避免重复劳动。

```
backlog ──approve──▶ todo ──claim──▶ doing ──done──▶ done
                        ▲               │
                        └────release────┘
```

## 设计原则

- **本地优先**：所有核心数据都在磁盘上，不依赖任何在线服务。
- **文件即真相**：`.axa/` 中的 Markdown + YAML frontmatter 是权威数据源。
- **配置优先于数据库**：项目注册表保存在 `~/.axa/config.json`；SQLite 只记录控制台的轻量活动日志。
- **可被人和 Agent 同时使用**：同一套 CLI、同一份任务文件、同一套状态机。
- **并发安全**：项目级文件锁 + 原子写入，保证多个 Agent 不会同时认领同一个任务。

## 快速开始

要求 Node.js ≥ 22 和 pnpm ≥ 10。

```bash
pnpm install
pnpm build

# 在当前项目初始化 .axa/ 并注册到本地项目列表
pnpm axa init . --name my-project

# 创建任务（默认进入 backlog，等待人工批准）
pnpm axa create "实现登录页" --priority P0 --description "验收：表单校验、错误提示、移动端可用。"

# 人工审批后，Agent 原子认领
pnpm axa approve 001
pnpm axa claim 001 --agent my-agent

# 完成后归档
pnpm axa done 001 --agent my-agent
```

启动网页控制台：

```bash
pnpm dev
# 打开 http://localhost:3000
```

控制台与 CLI 读取同一份 `.axa/` 数据。在控制台注册或审批任务，会在终端与看板上同时反映。

## 安装 CLI

在仓库内可以直接使用 `pnpm axa <command>`。如需全局命令：

```bash
pnpm --filter @contagxt/axa-cli build
cd packages/cli
pnpm link --global
axa --help
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `axa init [path] --name <name>` | 初始化 `.axa/` 并注册项目 |
| `axa projects list/add/remove/use` | 管理已注册项目与默认项目 |
| `axa create <title> -p P0 -d "..."` | 创建任务，默认进入 backlog |
| `axa list [--status todo] [--json]` | 列出任务；`--json` 适合 Agent 解析 |
| `axa board` | 按状态分组展示任务 |
| `axa show <id>` | 查看任务 frontmatter 与正文 |
| `axa approve <id>` | 人工审批 backlog → todo |
| `axa claim [id] --next --agent <name>` | 认领 todo → doing，可自动选择最高优先级 |
| `axa release <id>` | 释放认领，doing → todo |
| `axa done <id> --agent <name>` | 标记完成，doing → done |
| `axa reclaim --older-than 24h` | 回收超时未完成的任务 |

所有写操作都支持 `--project <path|id>` 指定目标项目；省略时依次使用当前目录、默认项目。Agent 身份可用 `--agent` 或环境变量 `AXA_AGENT` 提供。

## `.axa/` 契约

```
.axa/
├── instruction.md          # 给 Agent 的长期行动指南
└── tasks/
    ├── backlog/            # 待审核
    ├── todo/               # 已批准，可认领
    ├── doing/              # 进行中
    └── done/               # 已完成
```

任务文件名固定为 `[编号][优先级][核心描述].md`：

```
001_P0_初始化Pnpm工作空间.md
002_P1_实现任务看板.md
```

优先级为 `P0`（阻塞/最高）、`P1`（重要）、`P2`（优化/长期）。编号由 axa 自动分配并补零到三位。

每个任务文件由 YAML frontmatter 和 Markdown 正文组成：

```markdown
---
id: "001"
title: 初始化Pnpm工作空间
priority: P0
status: doing
created_at: 2026-11-04T14:05:02.835Z
updated_at: 2026-11-04T14:05:06.768Z
claimed_by: my-agent
claimed_at: 2026-11-04T14:05:06.494Z
created_by: Haoda
---

目标、边界与验收标准写在正文里。
```

目录状态与 `status` 字段在每次写入时保持同步，目录是状态判定的事实来源。手写的 Markdown 任务即使缺少 frontmatter 也能被读取，axa 会从文件名和文件时间推导元数据。

## 网页控制台

技术栈：Next.js App Router、React 19、Connect RPC、protobuf-es、Drizzle ORM + better-sqlite3。

- `/` — 多项目总览、注册项目、任务进度
- `/projects/[id]` — 看板与任务操作（审批、认领、释放、完成、回收超时）
- `/projects/[id]/new` — 任务创建器
- `/activity` — 控制台操作时间线

前端通过 Connect Web transport 调用 `/api`，服务端直接复用 `@contagxt/axa-core`，因此控制台与 CLI 的行为完全一致。活动日志位于 `~/.axa/console.db`（可用 `AXA_CONSOLE_DB` 覆盖），只用于审计展示，不参与任务状态判定。

### 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `AXA_HOME` | `~/.axa` | 项目注册表与默认数据库目录 |
| `AXA_AGENT` | — | CLI 默认 Agent 身份 |
| `AXA_CONSOLE_DB` | `~/.axa/console.db` | 控制台活动日志路径 |

## 仓库结构

```
packages/
├── proto/     # protobuf 定义、buf 配置、生成的 TaskService
├── core/      # 文件布局、状态机、锁、回收与项目注册表
├── cli/       # axa 命令
└── console/   # Next.js 控制台与 Connect RPC 服务端
skills/
└── SKILL.md   # 给 AI Agent 的标准操作技能
.axa/          # 本项目自己的任务（dogfooding）
```

## 开发

```bash
pnpm build        # 构建 proto/core/cli 并产出 Next 生产包
pnpm test         # Core 单元测试（含并发认领竞争）
pnpm typecheck    # 全 workspace 类型检查
pnpm lint         # Biome 检查
pnpm lint:fix     # Biome 自动修复
pnpm proto:generate
```

## 路线图

当前仓库的 `.axa/tasks/backlog/` 记录着下一步计划，包括任务依赖关系、评论与完整事件日志、控制台实时刷新与通知。用 `axa board` 查看最新状态。

## License

MIT
