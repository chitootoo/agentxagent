# AgentxAgent · axa

**Boss × Secretary × Worker** — 一个本地优先、以文件为真相源的三角色任务协作中心。

axa 把三种角色固定下来：

- **Boss**：人类。与控制台里的秘书对话，提出需求、批准和验收任务。
- **secretary**：项目内置的秘书 Agent（基于 [pi](https://github.com/earendil-works/pi)）。理解 Boss 的需求，简单问题直接回答；耗时工作创建成 axa 任务，worker 完成后向 Boss 汇总。
- **worker**：执行 Agent。通过 CLI 认领任务、写代码、跑测试、提交本轮汇总。

axa 把每个任务保存成 `.axa/tasks/` 下的一个文件夹：`task.json` 记录元信息，`000_user_*.md`、`001_agent_*.md` 等 Markdown 文件按轮次记录完整会话。Boss 在网页控制台与秘书对话、审批和验收；worker 通过 CLI 原子认领任务、提交汇总，避免重复劳动。

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

```

worker 侧的认领、执行与提交汇总流程见 [worker 行动指南](packages/core/src/prompts/worker-skill.md)。

启动网页控制台：

```bash
pnpm dev
# 打开 http://localhost:5000（手机访问见下文 Tailscale 章节）
```

控制台与 CLI 读取同一份 `.axa/` 数据。控制台代表 Boss 身份，首个页面是 Boss 与秘书的聊天窗口；批准、验收、追加需求和释放超时任务在「任务」页完成。

### 配置秘书

打开控制台右上角的「秘书 → 设置」，填入任意 OpenAI 兼容端点的信息：

| 字段       | 示例                                                        |
| -------- | --------------------------------------------------------- |
| Base URL | `https://api.openai.com/v1`、`https://api.deepseek.com/v1` |
| 模型       | `gpt-4.1`、`deepseek-chat`                                 |
| API Key  | 你的密钥                                                      |

设置保存在本机 `~/.contagxt/axa/secretary/secretary.json`。对话记录保存在 `~/.contagxt/axa/secretary/secretary-chat.json`。配置完成后，Boss 可以直接问项目状态、拆任务；秘书会把耗时工作写成 `todo` 任务交给 worker，并在 worker 完成后自动汇总。

秘书自身通过 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/main/packages/agent) 运行，工具只有 `create_task`、`list_tasks`、`get_task`，不会直接修改源码。

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

前端通过 Connect Web transport 调用 `/api`，服务端直接复用 `@contagxt/axa-core`，因此控制台与 CLI 的行为完全一致。活动日志（真相源）位于 `~/.contagxt/axa/activity.jsonl`；控制台只把它同步到系统临时目录下的 SQLite 缓存（可用 `AXA_CONSOLE_DB` 覆盖），缓存可随时重建，不参与任务状态判定。

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

| 变量                | 默认值                               | 作用                  |
| ----------------- | --------------------------------- | ------------------- |
| `AXA_HOME`        | `~/.contagxt/axa`                 | 项目注册表、活动日志与秘书数据目录    |
| `AXA_CONSOLE_DB`  | 系统临时目录 `axa-console/<hash>/console.db` | 控制台活动日志 SQLite 缓存   |
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

## License

MIT
