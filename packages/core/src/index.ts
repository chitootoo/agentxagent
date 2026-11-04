export type { RegisterProjectInput } from "./config.js";
export {
  getAxaHome,
  getConfigPath,
  getRegisteredProject,
  listRegisteredProjects,
  readConfig,
  registerProject,
  removeRegisteredProject,
  resolveCliProject,
  setDefaultProject,
} from "./config.js";
export type { AxaErrorCode } from "./errors.js";
export { AxaError, isAxaError } from "./errors.js";
export {
  buildTaskFilename,
  canonicalTaskId,
  humanizeDescription,
  parseTaskDocument,
  parseTaskFilename,
  serializeTaskDocument,
  slugifyTitle,
} from "./frontmatter.js";
export { defaultInstruction } from "./instruction.js";
export {
  findProjectRoot,
  isAxaProject,
  projectAxaDir,
  readProjectInfo,
  resolveProjectRoot,
  statusDir,
  toAbsolutePath,
} from "./paths.js";
export {
  approveTask,
  claimTask,
  completeTask,
  createTask,
  ensureProject,
  getTask,
  initProject,
  listTasks,
  readTaskFile,
  reclaimStaleTasks,
  releaseTask,
  resolveProject,
  scanTasks,
  writeTaskBody,
} from "./tasks.js";
export type {
  AxaConfig,
  ClaimTaskInput,
  CreateTaskInput,
  InitProjectOptions,
  ListProjectsResult,
  ListTasksOptions,
  ProjectConfig,
  ProjectInfo,
  ReclaimStaleResult,
  Task,
  TaskIssue,
  TaskPriority,
  TaskStatus,
} from "./types.js";
export { TASK_PRIORITIES, TASK_STATUSES } from "./types.js";
