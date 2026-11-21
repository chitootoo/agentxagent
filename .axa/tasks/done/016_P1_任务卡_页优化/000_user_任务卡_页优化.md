1. 卡片样式有点混乱, 现在按钮时高时低(受任务正文长短影响), 需要优化
2. 新建任务现在需要跳转到新增页面, 改成任务队列第一个卡片改为+卡片, 点击后展开直接编辑创建
3. 卡片编辑需要支持Frontmatter编辑
4. Frontmatter中的任务状态, 编号, 优先级为冗余字段, 去掉, 以队列名(文件路径包含该信息)为准, 可以使用regex从路径提取.
5. 任务卡的认领按钮改成执行指令按钮, 点击时将让agent执行该任务的指令写入剪贴板, 例如"去{project_path}/.axa/instruction.md领取{id}任务并执行"(你可以优化这个文案, 记得填充变量, 期望是用户将prompt给agent后, 可以正常执行该任务)
6. 卡片编辑样式现在部分字段无法编辑(例如优先级), 需要添加.

## 实现说明

- 卡片布局：`.task-card` 改为纵向 flex，标题与正文摘要固定行高（2 行 / 3 行），`.task-footer` 使用 `margin-top: auto` 吸底，操作按钮在同行卡片中始终对齐。
- 内联创建：删除 `/projects/[id]/new` 页面与 `create-task-form`，在 Backlog 队列首位新增「+ 新建任务」卡片；点击展开同一套编辑表单，可直接填写标题、优先级、标签、Frontmatter 与正文，并选择创建到 Backlog 或 Todo。
- Frontmatter 编辑：编辑表单新增「编辑 Frontmatter」区域，以 YAML 形式读写额外字段；`Task.frontmatter` 通过 Connect 契约暴露，保存时由 core 统一解析与清洗。
- 冗余字段：写入磁盘时不再序列化 `id`、`priority`、`status`；读取时编号与优先级从文件名 regex 提取，状态从所在队列目录决定。修改优先级会同步重命名任务文件。
- 可编辑字段：编辑表单补充优先级、标签与 Frontmatter；优先级变更后任务文件会从如 `001_P1_x.md` 重命名为 `001_P2_x.md`。
- 执行指令：Todo 卡片的「认领」按钮改为「执行指令」，点击后把完整 prompt 写入剪贴板（包含项目路径、任务编号/标题，以及带 `--project` 的 `axa claim` / `axa done` 命令），控制台显示复制成功提示。

## 验证证据

- `pnpm --filter @contagxt/axa-core test`：17 tests passed（新增路径优先于 Frontmatter 冗余字段、优先级改名、Frontmatter 清洗等用例）。
- `pnpm typecheck`：core / proto / cli / console 全部通过。
- `pnpm lint`（Biome）：62 files，无问题。
- 浏览器实测（Next dev + Playwright）：
  - 在 Backlog 首位点击 + 卡片，内联创建 P0 任务并填写 `review_required: true`，生成 `018_P0_UI_验证临时任务.md`，Frontmatter 无 id/priority/status。
  - 编辑该任务把优先级改为 P2、修改 Frontmatter，文件自动重命名为 `018_P2_UI_验证临时任务.md`，保存成功。
  - Todo 卡片点击「执行指令」出现「已复制 #015 的执行指令…」提示。
  - 卡片按钮在同行内垂直对齐；测试任务已通过界面删除。
