---
agent: qoder_26-11-20_23:29:04.065
---

# 019 美化 UI

按 unslop 的方法做了一轮“减法 + 统一”优化，保留原有暖纸/深绿/珊瑚品牌方向，不改变任何功能与信息结构。

## 审计发现

- 大面积 radial 渐变、发光与彩色进度条，视觉噪音偏多。
- 英文大写微标签（LOCAL TASK HUB / AUDIT TRAIL / REGISTER / PROJECTS）与中文界面混排。
- 字重 650/700 偏多，卡片 hover 位移、胶囊描边过密。
- 状态色不统一：Review 使用紫色，其余状态各有偏差。
- 侧栏品牌标识 `a×a` 在窄宽度下折行，出现多余字符。
- 移动端收件箱与项目页误用全屏聊天布局，标题贴边、缺少安全区内边距。

## 设计方向

安静的本地台账：暖纸底色、深墨文字、单一 ember 强调色；边框用发丝线，圆角分级（16/12/8），阴影只保留极轻的悬浮感。层级靠留白、字号与字重，而不是渐变和装饰图标。

## 主要改动

- `packages/console/src/app/globals.css`
  - 重写设计令牌：暖纸/墨色/深绿侧栏/ember 强调色，统一状态色（Review 改为 ember）。
  - 移除 radial 渐变、光晕、渐变进度条与卡片 hover 位移；进度条改为细实线。
  - 统一 4px 间距节奏、发丝边框、嵌套圆角；正文 400/500，标题最高 600。
  - 收件箱筛选改为分段控件；会话列表改为中性头像 + 状态色字形；状态改为文字 + 圆点。
  - 聊天气泡收敛到 12px 圆角，状态卡改为左侧色条；抽屉 16px 圆角。
  - 时间线图标按动作语义着色；补齐 prefers-reduced-motion；删除未使用的看板/旧卡片样式。
  - 修复移动端布局：仅会话页使用全屏 chat 布局；收件箱/项目页恢复 16px 内边距与安全区顶部间距，长上下文行在窄屏只保留优先级/状态。
- `packages/console/src/components/icons.tsx`
  - 线宽 1.8 → 1.6；删除装饰性 SparkIcon，新增 Pencil/FileText/Archive 图标。
- `components/app-shell.tsx`
  - 侧栏导航去掉英文小字说明；品牌副标题改“本地任务中枢”；“Workspace”改“工作区”。
- `components/projects-view.tsx`、`components/activity-view.tsx`、`components/inbox-view.tsx`
  - 去掉英文 eyebrow 与 SparkIcon；空状态改用对应语义图标。
  - 项目状态与计数全部中文化；活动时间线按动作使用不同图标。
- `components/task-conversation.tsx`、`lib/task-meta.ts`、`components/task-editor.tsx`、`components/task-form-sheet.tsx`
  - 状态标签统一为“待审核 / 待认领 / 进行中 / 待验收 / 已完成 / 已归档”。
  - 清理 Todo/Done/Backlog/review 等英文残留文案。
- `app/layout.tsx`：themeColor 同步为新底色。

## 验证

- `pnpm typecheck` 通过（core / proto / cli / console）。
- `pnpm lint`（biome check）通过，71 个文件无问题。
- `pnpm build` 通过。
- 浏览器实测：收件箱、项目列表、项目详情、任务会话、动态页；桌面 1440px 与移动端 390px。
- 截图：`/tmp/axa-shot/after-inbox.png`、`after-projects.png`、`after-activity.png`、`after-chat.png`、`final-mobile.png`、`final-chat-mobile.png`。

## 备注

- 功能、路由、接口与数据流均未改动。
- 本任务需要人工验收，完成后进入 review。
