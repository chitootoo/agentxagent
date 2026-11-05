# AgentxAgent · axa

**Agent Of Agent** — 一个本地优先、以文件为真相源的多 Agent 任务协作中心。

axa 把每个任务保存成 `.axa/` 下的一个文件夹：`task.json` 记录元信息，`000_user_*.md`、`001_agent_*.md` 等 Markdown 文件按轮次记录完整会话。人类用命令行或网页控制台观察、审批、验收和追加需求；Agent 用同一条 CLI 原子地认领任务，避免重复劳动。

```
backlog ──approve──▶ todo ──claim──▶ doing ──summary+done──▶ review ──accept──▶ done
                        ▲               │                       │
                        └────release────┘                       │
                        └────────── comment（追加需求）───────────┘
```

## 设计原则

- **本地优先**：所有核心数据都在磁盘上，不依赖任何在线服务。
- **文件即真相**：`.axa/` 中的任务文件夹（JSON 元信息 + 轮次 Markdown）是权威数据源。
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

# 创建任务（默认进入 backlog，等待人工批准；默认需要人工 review）
pnpm axa create "实现登录页" --priority P0 --description "验收：表单校验、错误提示、移动端可用。"

# 人工审批后，Agent 原子认领
pnpm axa approve 001
pnpm axa claim 001 --agent my-agent

# 完成后提交本轮汇总，再进入 review
pnpm axa summary 001 --agent my-agent -m "已实现表单校验与错误提示，pnpm test 通过。"
pnpm axa done 001 --agent my-agent

# 人工验收
pnpm axa accept 001 --agent human
```

如果验收后发现不足，直接追加需求，任务会重新回到 `todo`：

```bash
pnpm axa comment 001 --agent human -m "补充移动端 375px 下的截图与回归测试。"
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
| `axa create <title> -p P0 -d "..."` | 创建任务（默认 backlog + 需要 review）；`--no-review` 跳过验收 |
| `axa list [--status todo] [--json]` | 列出任务；`--json` 适合 Agent 解析 |
| `axa board` | 按状态分组展示任务 |
| `axa show <id>` | 查看任务元信息与完整会话 |
| `axa approve <id>` | 人工审批 backlog → todo |
| `axa claim [id] --next --agent <name>` | 认领 todo → doing，可自动选择最高优先级 |
| `axa summary <id> -m "..." --agent <name>` | Agent 写入本轮汇总；review 前必需 |
| `axa comment <id> -m "..."` | 用户追加需求；review/done 任务重新回到 todo |
| `axa release <id>` | 释放认领，doing → todo |
| `axa done <id> --agent <name>` | 标记完成，doing → review（或 `--no-review` 任务 → done） |
| `axa accept <id>` | 人工验收 review → done |
| `axa reclaim --older-than 24h` | 回收超时未完成的任务 |

所有写操作都支持 `--project <path|id>` 指定目标项目；省略时依次使用当前目录、默认项目。Agent 身份可用 `--agent` 或环境变量 `AXA_AGENT` 提供。

### 多 Agent 并行

`.axa/` 的锁只保护任务状态，不保护源码。多个 Agent 并行时，先在主工作区认领任务，再为每个任务创建独立的 git worktree / 分支，在 worktree 内编码与提交；合并后在主工作区执行 `axa done`，不要在两个工作树里各改一份任务状态。详见 `.axa/instruction.md` 与 `skills/SKILL.md`。

## `.axa/` 契约

```
.axa/
├── instruction.md              # 给 Agent 的长期行动指南
└── tasks/
    ├── backlog/                # 待审核
    ├── todo/                   # 已批准，可认领
    ├── doing/                  # 进行中
    ├── review/                 # 待人工验收
    └── done/                   # 已完成
```

每个任务是状态目录下的一个文件夹，名称为 `[编号]_[优先级]_[核心描述]`：

```
.axa/tasks/doing/001_P0_初始化Pnpm工作空间/
├── task.json
├── 000_user_初始化Pnpm工作空间.md
├── 001_agent_完成工作空间与构建脚本.md
└── 002_user_补充离线安装配置.md
```

优先级为 `P0`（阻塞/最高）、`P1`（重要）、`P2`（优化/长期）。编号由 axa 自动分配并补零到三位。

`task.json` 保存元信息；目录是任务状态的事实来源：

```json
{
  "version": 1,
  "id": "001",
  "title": "初始化Pnpm工作空间",
  "priority": "P0",
  "status": "doing",
  "reviewRequired": true,
  "createdAt": "2026-11-04T14:05:02.835Z",
  "updatedAt": "2026-11-04T14:05:06.768Z",
  "claimedBy": "my-agent",
  "claimedAt": "2026-11-04T14:05:06.494Z",
  "tags": [],
  "extra": { "created_by": "Haoda" }
}
```

会话文件命名为 `{seq}_{role}_{title}.md`：三位序号用于排序，`role` 为 `user` 或 `agent`，`title` 是该片段的关键内容。初始需求是 `000_user_*.md`；每轮完成前 Agent 必须通过 `axa summary` 追加 `*_agent_*.md`，axa core 检测到最新一条是 Agent 汇总后才允许进入 `review`。用户追加需求会生成新的 `*_user_*.md` 并把任务重新放回 `todo`，因此下一轮 Agent 能拿到完整上下文。

默认所有新任务都需要人工 review。旧格式的单文件任务仍可读取，并在下一次写入时自动迁移为文件夹。

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

当前仓库的 `.axa/tasks/backlog/` 记录着下一步计划，包括任务依赖关系、完整事件日志、控制台实时刷新与通知。用 `axa board` 查看最新状态。

## License

MIT
