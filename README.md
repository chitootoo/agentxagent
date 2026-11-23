# AgentxAgent · axa

**Boss × Secretary × Worker** — 一个本地优先、以文件为真相源的三角色任务协作中心。

axa 把三种角色固定下来：

- **Boss**：人类。与控制台里的秘书对话，提出需求、批准和验收任务。
- **secretary**：项目内置的秘书 Agent（基于 [pi](https://github.com/earendil-works/pi)）。理解 Boss 的需求，简单问题直接回答；耗时工作创建成 axa 任务，worker 完成后向 Boss 汇总。
- **worker**：执行 Agent。通过 CLI 认领任务、写代码、跑测试、提交本轮汇总。

axa 把每个任务保存成 `.axa/tasks/` 下的一个文件夹：`task.json` 记录元信息，`000_user_*.md`、`001_agent_*.md` 等 Markdown 文件按轮次记录完整会话。Boss 在网页控制台与秘书对话、审批和验收；worker 通过 CLI 原子认领任务、提交汇总，避免重复劳动。

```
                  Boss approve
backlog ─────────────────────────▶ todo
                                    │ ▲
                     worker claim   │ │ release / 7 天未完成
                                    ▼ │
                                  doing
                                    │
                            worker done
                                    ▼
                       ┌──── review ────┐
       Boss accept     │                │ Boss comment
              ┌────────┘                └──────────▶ todo
              ▼
            done ──────── 30 天 ───────▶ archived
              │                              │
              └──── Boss comment ──▶ todo   └── Boss comment ──▶ todo
```

## 设计原则

- **本地优先**：所有核心数据都在磁盘上，不依赖任何在线服务。
- **文件即真相**：`.axa/` 中的任务文件夹（JSON 元信息 + 轮次 Markdown）是权威数据源。
- **本地原子性**：只在本机通过项目内文件保证状态一致，不依赖远程服务或 git 同步。
- **角色分工**：Boss 与秘书对话，秘书负责判断与汇总；worker 只认领、执行、提交汇总。
- **并发安全**：每个任务文件夹内的 `.lock` 文件 + 原子重命名，保证多个 worker 不会同时认领同一个任务。

## 快速开始

要求 Node.js ≥ 22 和 pnpm ≥ 10。

```bash
pnpm install
pnpm build

# 在当前项目初始化 .axa/ 并注册到本地项目列表
pnpm axa init . --name my-project

# 创建任务：进入 backlog，等待 Boss 在控制台批准
pnpm axa create "实现登录页" --priority P0 --description "验收：表单校验、错误提示、移动端可用。"

# 认领任务并生成本轮唯一的 agent id
pnpm axa claim 001 --agent qoder
# 或认领优先级最高的 todo 任务
pnpm axa claim --next --agent qoder

# 把本轮汇总写成 Markdown 文件，再提交并标记完成
pnpm axa summary 001 --title "登录页支持手机号校验" --file /tmp/axa-summary-001.md
pnpm axa done 001
```

需要人工 review 的任务会进入 `review`，由 Boss 在控制台验收。验收不通过时，在控制台追加需求，任务回到 `todo` 并保留完整会话：

```bash
pnpm axa comment 001 --title "补充手机号格式校验" --file /tmp/axa-requirement-001.md
```

启动网页控制台：

```bash
pnpm dev
# 打开 http://localhost:5000（手机访问见下文 Tailscale 章节）
```

控制台与 CLI 读取同一份 `.axa/` 数据。控制台代表 Boss 身份，首个页面是 Boss 与秘书的聊天窗口；批准、验收、追加需求和释放超时任务在「任务」页完成。

### 配置秘书

打开控制台右上角的「秘书 → 设置」，填入任意 OpenAI 兼容端点的信息：

| 字段 | 示例 |
| --- | --- |
| Base URL | `https://api.openai.com/v1`、`https://api.deepseek.com/v1` |
| 模型 | `gpt-4.1`、`deepseek-chat` |
| API Key | 你的密钥 |

设置保存在本机 `~/.axa/secretary.json`。对话记录保存在 `~/.axa/secretary-chat.json`。配置完成后，Boss 可以直接问项目状态、拆任务；秘书会把耗时工作写成 `todo` 任务交给 worker，并在 worker 完成后自动汇总。

秘书自身通过 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/main/packages/agent) 运行，工具只有 `create_task`、`list_tasks`、`get_task`，不会直接修改源码。

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
| `axa create <title> --priority P0 -d "..."` | 创建 backlog 任务，等待 Boss 批准 |
| `axa list [--status todo] [--priority P0] [--json]` | 列出任务；默认不包含 archived |
| `axa board` | 按状态分组展示活动任务 |
| `axa show <id>` | 查看任务元信息与完整会话 |
| `axa claim [id] --agent <platform> --next` | 认领 todo → doing 并生成本轮 agent id，可自动选择最高优先级 |
| `axa summary <id> --title "核心改动" --file <path>` | 提交本轮 worker 汇总；`done` 前必需 |
| `axa comment <id> --title "核心需求" --file <path>` | Boss 追加需求；review/done/archived 任务回到 todo |
| `axa release <id>` | 释放自己认领的任务，doing → todo |
| `axa release --stale [--older-than 7d]` | 释放超时未完成的任务 |
| `axa done <id>` | 标记完成，doing → review（或无需 review 时 → done） |

所有写操作都支持 `--project <path|id>` 指定目标项目；省略时依次使用当前目录、默认项目。

`--json` 只保留在 worker 需要解析的只读命令（`list`、`show`、`claim`）上；`create`、`summary`、`comment`、`release`、`done` 等写命令只输出人类可读结果，减少参数噪音。

### worker 身份

worker id 只在 claim 时签发，用于防止多个 worker 同时处理同一个任务，不需要注册或环境变量：

```bash
axa claim 001 --agent qoder
# ✓ Claimed 001 实现登录页
#   Agent: qoder_25-11-20_22:15:03.123
```

CLI 把 `{平台}_{yy-MM-dd_HH:mm:ss.SSS}` 写入 `task.json` 的 `claimedBy` 作为锁。每个任务每一轮执行都会重新 claim，因此每轮都有唯一的 agent id。`summary` 会自动使用当前 `claimedBy`，并把 agent id 写入汇总文件的 frontmatter；`done`、`release` 和超时释放都会清除 `claimedBy`，完成时再把 agent id 记入 `completed_by`。`--claimed-by <platform>` 支持按平台前缀筛选。

### 多 worker 并行

任务锁只保护任务状态，不保护源码。多个 worker 并行时，先在主工作区认领任务，再为每个任务创建独立的 git worktree / 分支，在 worktree 内编码与提交；合并后回到主工作区执行 `axa done`，不要在两个工作树里各改一份任务状态。详见 `.axa/SKILL.md`。

## `.axa/` 契约

```
.axa/
├── SKILL.md                    # 给 worker 的行动指南
└── tasks/
    ├── README.md               # 任务存储与状态机说明（面向 Boss）
    ├── backlog/                # 待审核
    ├── todo/                   # 已批准，可认领
    ├── doing/                  # 进行中
    ├── review/                 # 待 Boss 验收
    ├── done/                   # 已完成
    └── archived/               # 已归档，终态，默认隐藏
```

每个任务是状态目录下的一个文件夹，名称为 `[编号]_[优先级]_[核心描述]`：

```
.axa/tasks/doing/001_P0_初始化Pnpm工作空间/
├── task.json
├── .lock
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
  "claimedBy": "qoder_25-11-20_22:15:03.123",
  "claimedAt": "2026-11-04T14:05:06.494Z",
  "tags": [],
  "extra": { "created_by": "Boss" }
}
```

会话记录（conversation entry，任务文件夹中的编号 Markdown）命名为 `{seq}_{role}_{title}.md`：三位序号用于排序，`role` 为 `user` 或 `agent`，`title` 是这一条记录的核心内容。初始需求是 `000_user_*.md`；每轮完成前 worker 必须通过 `axa summary --title "核心改动" --file` 追加 `*_agent_*.md`，`title` 会直接成为文件名后缀，应能一眼看出核心内容，避免“本轮实现”“方案评估”等泛化标题或整段原文。`axa done` 检测到最新一条不是 worker 汇总时会拒绝完成并提示先执行 `axa summary`。Boss 追加需求会生成新的 `*_user_*.md` 并把任务重新放回 `todo`，因此下一轮 worker 能拿到完整上下文。

### 状态与时间规则

- `backlog → todo`：仅 Boss 在控制台批准。
- `todo → doing`：worker 通过 `axa claim` 原子认领，任务文件夹内出现带认领者 id 的 `.lock`，命令结束后删除。
- `doing → todo`：认领者执行 `axa release`，或认领超过 7 天被自动释放。
- `doing → review`：worker 提交本轮汇总后执行 `axa done`。
- `review → done`：Boss 在控制台验收。
- `review / done / archived + 追加需求 → todo`：保留完整会话，进入下一轮。
- `done → archived`：完成超过 30 天，在下一次项目操作时自动归档。
- `archived` 是终态；Boss 仍可在控制台追加需求重新打开。

超时释放与自动归档是惰性触发的：只在 `axa claim` 或控制台加载任务列表时执行，不需要常驻进程。

### 本地原子性与 git

- 任务状态只在本机通过文件操作保证一致：认领时在任务文件夹内创建 `.lock`，状态变更通过同一文件系统内的原子重命名完成。
- `.lock` 位于任务文件夹内部，会随文件夹移动，不需要中心化锁目录。
- `.axa/` 需要提交到 git，以便团队共享任务状态；只有临时的 `.lock` 和控制台 SQLite 被忽略。
- git 合并冲突由开发者自行解决；axa 不依赖远程服务做同步或加锁。

## 网页控制台

技术栈：Next.js App Router、React 19、Connect RPC、protobuf-es、Drizzle ORM + better-sqlite3。

控制台按移动端 IM 会话组织：首屏是 Boss 与秘书的对话，任务列表是 worker 的会话列表，任务详情是会话详情。

- `/` — Boss 与秘书的对话窗口（简单问答 + 任务创建与汇总）
- `/tasks` — 全项目任务收件箱，按状态筛选、按最近更新排序
- `/secretary/settings` — 秘书模型信息与项目绑定
- `/projects` — 项目纳管与进度概览
- `/projects/[id]` — 单项目会话列表
- `/projects/[id]/tasks/[taskId]` — 会话详情、Markdown 气泡、追加需求与情境操作
- `/activity` — 控制台操作时间线

控制台代表 Boss 身份：首屏是 Boss 与秘书的聊天窗口；「任务」页负责审批、验收、追加需求和释放超时任务。任务详情底部固定输入框，上方根据状态显示“批准任务 / 复制执行指令 / 提交验收 / 验收通过 / 释放”等操作；低频操作（编辑、删除、复制指令、刷新）收在右上角菜单。任务元信息默认折叠，点击顶部摘要展开。

前端通过 Connect Web transport 调用 `/api`，服务端直接复用 `@contagxt/axa-core`，因此控制台与 CLI 的行为完全一致。活动日志位于 `~/.axa/console.db`（可用 `AXA_CONSOLE_DB` 覆盖），只用于审计展示，不参与任务状态判定。

移动端特性：

- 底部 Tab（消息 / 项目 / 动态），会话详情页隐藏 Tab 给输入框留出安全区
- 可见标签页每 5 秒自动刷新，列表支持下拉刷新
- `viewport-fit=cover`、安全区内边距、44px 触控目标、16px 输入框（避免 iOS 聚焦缩放）
- PWA manifest：可“添加到主屏幕”当作独立应用使用

### 手机访问（Tailscale）

控制台默认监听 `0.0.0.0:5000`，同一局域网可直接用主机 IP 访问。跨网络推荐使用 Tailscale，只在 tailnet 内访问，不要用 Funnel 暴露到公网：

```bash
# 主机与手机都加入同一个 tailnet
tailscale up

# 启动控制台（默认已绑定 0.0.0.0）
pnpm dev

# 在主机上把 5000 端口挂到 MagicDNS 的 HTTPS 域名
tailscale serve --bg http://127.0.0.1:5000
```

随后在手机访问 `https://<主机名>.<tailnet>.ts.net/`。首次使用时需在 Tailscale 管理台启用 MagicDNS 与 HTTPS Certificates。`tailscale serve` 负责 TLS 和身份边界，控制台本身不需要额外鉴权；**不要**执行 `tailscale funnel`，控制台包含删除任务等破坏性操作。

MagicDNS 域名通常有多级子域（如 `haoda-wins.dwelf-halfmoon.ts.net`），开发模式默认放行 `**.ts.net`、`localhost` 和 `127.0.0.1`。注意 `*.ts.net` 只匹配一级子域，会导致 HMR 被拦截、页面停在骨架屏。使用自定义域名时通过 `AXA_DEV_ORIGINS` 覆盖（逗号分隔）：

```bash
AXA_DEV_ORIGINS="axa.example.com,**.ts.net" pnpm dev
```

如果控制台运行在 WSL 中、Tailscale 安装在 Windows 上，在 Windows 上执行 `tailscale serve --bg http://127.0.0.1:5000`（WSL 的 localhost 转发会把它接到 WSL 内的控制台）。80 端口常被 IIS 占用，HTTPS 默认使用 443；需要 HTTP 时显式指定空闲端口，例如 `tailscale serve --bg --http=8443 http://127.0.0.1:5000`。

只想本机访问时使用 `pnpm dev:local` / `pnpm start:local`（仅绑定 `127.0.0.1`）。

macOS / iOS Safari 可“分享 → 添加到主屏幕”，Android Chrome 可“安装应用”，获得无地址栏的全屏体验。

### 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `AXA_HOME` | `~/.axa` | 项目注册表与默认数据库目录 |
| `AXA_CONSOLE_DB` | `~/.axa/console.db` | 控制台活动日志路径 |
| `AXA_DEV_ORIGINS` | `**.ts.net, localhost, 127.0.0.1` | 控制台开发模式允许的跨域来源，逗号分隔 |

## 仓库结构

```
packages/
├── proto/     # protobuf 定义、buf 配置、生成的 TaskService
├── core/      # 文件布局、状态机、任务锁、惰性维护与项目注册表
├── cli/       # axa 命令
└── console/   # Next.js 控制台与 Connect RPC 服务端
.axa/          # 本项目自己的任务、SKILL.md 与 tasks/README.md（dogfooding）
```

## 开发

```bash
pnpm build        # 构建 proto/core/cli 并产出 Next 生产包
pnpm test         # Core 单元测试（含并发认领、超时释放与归档）
pnpm typecheck    # 全 workspace 类型检查
pnpm lint         # Biome 检查
pnpm lint:fix     # Biome 自动修复
pnpm proto:generate
```

## 路线图

当前仓库的 `.axa/tasks/backlog/` 记录着下一步计划，包括任务依赖关系、完整事件日志、控制台实时刷新与通知。用 `axa board` 查看最新状态。

## License

MIT
