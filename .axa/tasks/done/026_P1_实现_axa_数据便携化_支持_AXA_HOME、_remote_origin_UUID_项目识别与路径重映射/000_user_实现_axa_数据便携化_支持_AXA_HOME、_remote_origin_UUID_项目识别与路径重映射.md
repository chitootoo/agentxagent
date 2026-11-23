# axa 数据便携化改造方案

## 需求背景
使 axa 数据支持 U 盘随身携带及跨电脑使用，可在不同机器上无感恢复工作环境与项目关联。

## 详细要求
1. **支持 `AXA_HOME` 环境变量**：
   - 数据存储路径优先使用 `process.env.AXA_HOME`，未指定时降级回默认的 `~/.axa`。
   - 确保全局配置、任务记录及会话日志存放在指定的 `AXA_HOME` 中。

2. **`project_id` 识别机制**：
   - **优先使用**：项目的 `git remote get-url origin`（支持 SSH / HTTPS URL 归一化格式）。
   - **降级策略（无 remote 情况）**：
     - 若尚未添加 remote 或不是 Git 仓库，自动生成唯一的本地标识（如在项目 `.axa/config.json` 中写入自动生成的 UUID，格式如 `uuid:...` 或 `local:<hash>`）。
     - 当未来项目添加了 Git remote origin 时，自动提升升级为 remote origin URL，并自动迁移现有 ID 映射。

3. **物理路径与 `project_id` 的自动重映射**：
   - 全局数据库/配置文件中仅以 `project_id` 标识项目，不依赖跨机器变更的物理绝对路径。
   - 启动或操作项目时，若检测到该 `project_id` 的当前物理路径与缓存路径不一致，自动更新本地路径映射映射关系。

4. **测试与验证**：
   - 补充或更新相关单元测试与集成测试，验证 `AXA_HOME` 切换以及无 remote / 有 remote 项目的自动识别与路径重映射流程。
