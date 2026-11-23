import {
  type ConversationEntry,
  createTask,
  enqueueInboxNote,
  getTask,
  hasInboxNote,
  type InboxNote,
  type ListProjectsResult,
  listInboxNotes,
  listRegisteredProjects,
  moveInboxNote,
  scanTasks,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@contagxt/axa-core";
import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model, SimpleStreamOptions, TextContent } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  mutateChat,
  newMessageId,
  updateSettings as persistSettings,
  readChat,
  readSettings,
  toPublicSettings,
} from "./store.js";
import type {
  PublicSecretarySettings,
  SecretaryChatMessage,
  SecretarySettings,
  SecretaryState,
  SendBossMessageInput,
  UpdateSecretarySettingsInput,
} from "./types.js";

const CHAT_HISTORY_LIMIT = 24;
const RECONCILE_INTERVAL_MS = 60_000;
const AGENT_TIMEOUT_MS = 180_000;

let lastReconcile = 0;
let queue: Promise<void> = Promise.resolve();
let running = 0;

export function isSecretaryBusy(): boolean {
  return running > 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function secondsAgo(iso: string): number {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? Date.now() - time : 0;
}

function isGemini(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes("generativelanguage.googleapis.com");
}

/** Accept both the native Gemini URL and the OpenAI-compatible one, then normalize. */
function geminiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\/openai$/u, "");
  return /\/v\d+\w*$/u.test(trimmed) ? trimmed : `${trimmed}/v1beta`;
}

function modelFor(
  settings: SecretarySettings,
  baseUrl: string,
  api: "openai-completions" | "google-generative-ai",
): Model<Api> {
  const common = {
    id: settings.model,
    name: settings.model,
    baseUrl,
    input: ["text"] as Model<Api>["input"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: api === "google-generative-ai" ? 1_000_000 : 128_000,
    maxTokens: 8_192,
  };
  if (api === "google-generative-ai") {
    return { ...common, api, provider: "google" };
  }
  const compatibleBaseUrl = baseUrl.replace(/\/+$/u, "");
  const compat = compatibleBaseUrl.includes("generativelanguage.googleapis.com")
    ? {
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsUsageInStreaming: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens" as const,
        },
      }
    : {};
  return {
    ...common,
    ...compat,
    api,
    provider: "openai-compatible",
    baseUrl: compatibleBaseUrl,
  };
}

function buildModel(settings: SecretarySettings): Model<Api> {
  return isGemini(settings.baseUrl)
    ? modelFor(settings, geminiBaseUrl(settings.baseUrl), "google-generative-ai")
    : modelFor(settings, settings.baseUrl, "openai-completions");
}

function createStreamFn(settings: SecretarySettings): StreamFn {
  const gemini = isGemini(settings.baseUrl);
  return (model, context, options) => {
    const requestOptions = {
      ...options,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    } satisfies SimpleStreamOptions;
    if (gemini) {
      return googleGenerativeAIApi().streamSimple(model, context, requestOptions);
    }
    return openAICompletionsApi().streamSimple(
      model as Model<"openai-completions">,
      context,
      requestOptions,
    );
  };
}

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as TextContent).type === "text") {
        return (part as TextContent).text;
      }
      return "";
    })
    .join("");
}

function latestAssistantText(agent: Agent): string {
  for (let index = agent.state.messages.length - 1; index >= 0; index -= 1) {
    const message = agent.state.messages[index];
    if (message?.role === "assistant") return textOf(message).trim();
  }
  return "";
}

function formatHistory(messages: SecretaryChatMessage[]): string {
  return messages
    .filter((message) => message.status !== "pending")
    .slice(-CHAT_HISTORY_LIMIT)
    .map((message) => `${message.role === "boss" ? "Boss" : "秘书"}：${message.body}`)
    .join("\n\n");
}

function projectLine(project: ListProjectsResult): string {
  return `- ${project.name}（id: ${project.id}，路径 ${project.path}）`;
}

function systemPrompt(projects: ListProjectsResult[]): string {
  const projectSection =
    projects.length === 0
      ? "当前还没有纳管任何项目。需要落到某个项目的工程任务时，提醒 Boss 先去「项目」页添加项目；通用问题仍然可以直接回答。"
      : `你管理以下全部已纳管项目（不绑定某一个项目，根据上下文判断 Boss 指的是哪个）：\n${projects
          .map(projectLine)
          .join("\n")}`;
  return `你是 axa 的 secretary（秘书），是 Boss（人类）与 worker（执行 Agent）之间的唯一入口，管理 Boss 的所有项目和任务。

三种角色：
- Boss：人类，向你提出需求、验收结果。
- secretary：你，理解 Boss 的意图、处理简单事务、把耗时任务交给 worker，并汇总反馈。
- worker：通过 axa 认领任务并执行代码/工程工作的 Agent。

${projectSection}

工作方式：
1. 先根据对话上下文和历史消息判断 Boss 说的是哪个项目；能确定就直接使用，不要反问。确实无法判断且必须落到具体项目时，列出候选项目询问 Boss。
2. 简单问题（解释、建议、查询、闲聊、状态汇总）直接回答，不创建任务。
3. 需要改代码、跑测试、跨多轮执行的耗时工作，调用 create_task 创建 axa 任务，project 参数填项目名称或 id。创建成功后立刻告诉 Boss 任务编号和所属项目，不要假装已经完成。
4. 可以用 list_projects / list_tasks / get_task 查看项目和任务；worker 完成后系统会通知你，你再向 Boss 汇总。
5. 不要自己认领任务，不要声称代替 worker 完成了工程改动。
6. 每次回复的最后一行必须明确写出本次的处理方式，二选一：
   - 本次由我直接处理。
   - 已创建任务 #编号（项目名），由 worker 执行。
7. 用中文回复，简洁直接；必要时使用 Markdown。`;
}

function normalizePriority(value: unknown): TaskPriority {
  return value === "P0" || value === "P1" || value === "P2" ? value : "P1";
}

function taskLine(task: Task): string {
  const claim = task.claimedBy ? ` @${task.claimedBy}` : "";
  return `#${task.id} [${task.priority}/${task.status}] ${task.title}${claim}`;
}

function findProject(
  projects: ListProjectsResult[],
  selector?: string,
): ListProjectsResult | undefined {
  const wanted = selector?.trim().toLowerCase();
  if (!wanted) return undefined;
  return (
    projects.find(
      (project) => project.id.toLowerCase() === wanted || project.name.toLowerCase() === wanted,
    ) ??
    projects.find(
      (project) =>
        project.path.toLowerCase() === wanted ||
        project.path.toLowerCase().endsWith(`/${wanted}`) ||
        project.path.toLowerCase().endsWith(`\\${wanted}`),
    )
  );
}

function requireProject(projects: ListProjectsResult[], selector?: string): ListProjectsResult {
  const found = findProject(projects, selector);
  if (found) return found;
  if (projects.length === 0) {
    throw new Error("还没有纳管任何项目。请先在「项目」页添加一个本地项目。");
  }
  if (!selector?.trim() && projects.length === 1) {
    return projects[0] as ListProjectsResult;
  }
  throw new Error(
    `无法确定项目「${selector?.trim() ?? ""}」。可用项目：${projects
      .map((project) => `${project.name}（${project.id}）`)
      .join("、")}`,
  );
}

function createTools(
  projects: ListProjectsResult[],
  onTaskCreated: (task: Task, project: ListProjectsResult) => void,
): AgentTool[] {
  const listProjectsTool: AgentTool = {
    name: "list_projects",
    label: "查看纳管项目",
    description: "列出 Boss 已纳管的所有本地项目、路径和任务计数。",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "还没有纳管任何项目。" }],
          details: { count: 0 },
        };
      }
      const text = projects
        .map(
          (project) =>
            `${project.name}（id: ${project.id}）· ${project.path}\n  任务：todo ${project.counts.todo} · doing ${project.counts.doing} · review ${project.counts.review} · done ${project.counts.done}`,
        )
        .join("\n\n");
      return {
        content: [{ type: "text", text }],
        details: { count: projects.length },
      };
    },
  };

  const createTaskTool: AgentTool = {
    name: "create_task",
    label: "创建 axa 任务",
    description:
      "把需要 worker 执行的耗时任务写入 axa。任务会直接进入 todo，由 worker 认领。创建后立即向 Boss 汇报任务编号和项目。",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "项目名称或 id，例如 agentxagent。省略时仅在只有一个项目时自动选择。",
        },
        title: { type: "string", description: "一句话任务标题，能一眼看出要做什么" },
        body: {
          type: "string",
          description: "任务正文：背景、验收标准、约束。可以包含 Markdown。",
        },
        priority: {
          type: "string",
          enum: ["P0", "P1", "P2"],
          description: "P0 阻塞最高，P1 重要，P2 优化/长期。默认 P1。",
        },
        review_required: {
          type: "boolean",
          description: "是否需要 Boss 人工验收。默认 false，由秘书自动汇总。",
        },
      },
      required: ["title", "body"],
    },
    execute: async (_toolCallId, params) => {
      const input = params as {
        project?: string;
        title?: string;
        body?: string;
        priority?: string;
        review_required?: boolean;
      };
      const title = input.title?.trim();
      if (!title) throw new Error("title is required");
      const project = requireProject(projects, input.project);
      const task = await createTask({
        projectRoot: project.path,
        title,
        body: input.body?.trim() ?? "",
        priority: normalizePriority(input.priority),
        status: "todo",
        reviewRequired: input.review_required ?? false,
        actor: "secretary",
        extra: { created_by: "secretary" },
      });
      onTaskCreated(task, project);
      return {
        content: [
          {
            type: "text",
            text: `已在项目「${project.name}」创建任务 #${task.id}「${task.title}」，优先级 ${task.priority}，已进入 todo，等待 worker 认领。`,
          },
        ],
        details: { taskId: task.id, status: task.status, projectId: project.id },
      };
    },
  };

  const listTasksTool: AgentTool = {
    name: "list_tasks",
    label: "查看任务列表",
    description: "查看 axa 任务及其状态；不指定项目时汇总所有项目。",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "项目名称或 id；省略时查看所有项目。" },
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: ["todo", "doing", "review", "done", "backlog", "archived"],
          },
          description: "只看这些状态；省略时看 todo/doing/review/done。",
        },
      },
    },
    execute: async (_toolCallId, params) => {
      const input = params as { project?: string; statuses?: TaskStatus[] };
      const statuses =
        input.statuses && input.statuses.length > 0
          ? input.statuses
          : (["todo", "doing", "review", "done"] as TaskStatus[]);
      const targets = input.project?.trim()
        ? [requireProject(projects, input.project)]
        : projects.filter((project) => project.exists);
      if (targets.length === 0) {
        return {
          content: [{ type: "text", text: "还没有纳管任何项目。" }],
          details: { count: 0 },
        };
      }
      const sections: string[] = [];
      let count = 0;
      for (const project of targets) {
        const { tasks } = await scanTasks(project.path, { statuses });
        count += tasks.length;
        if (tasks.length === 0) continue;
        sections.push(`【${project.name}】\n${tasks.slice(0, 40).map(taskLine).join("\n")}`);
      }
      const text = sections.length === 0 ? "当前没有符合条件的任务。" : sections.join("\n\n");
      return { content: [{ type: "text", text }], details: { count } };
    },
  };

  const getTaskTool: AgentTool = {
    name: "get_task",
    label: "查看任务详情",
    description: "读取一个任务的当前状态与最近会话记录；不指定项目时在所有项目中查找。",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "任务编号，例如 023" },
        project: { type: "string", description: "项目名称或 id；省略时在所有项目中查找。" },
      },
      required: ["task_id"],
    },
    execute: async (_toolCallId, params) => {
      const input = params as { task_id?: string; project?: string };
      if (!input.task_id) throw new Error("task_id is required");
      const targets = input.project?.trim()
        ? [requireProject(projects, input.project)]
        : projects.filter((project) => project.exists);
      let found: { task: Task; project: ListProjectsResult } | undefined;
      for (const project of targets) {
        try {
          const task = await getTask(project.path, input.task_id);
          found = { task, project };
          break;
        } catch {
          // Keep looking in the next project.
        }
      }
      if (!found) {
        throw new Error(
          targets.length === 0 ? "还没有纳管任何项目。" : `没有找到任务 #${input.task_id}。`,
        );
      }
      const { task, project } = found;
      const recent = task.conversation
        .slice(-4)
        .map((entry: ConversationEntry) => `[${entry.role}] ${entry.title}\n${entry.body}`)
        .join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: `项目：${project.name}\n${taskLine(task)}\n\n${recent || task.body || "暂无会话记录。"}`,
          },
        ],
        details: { taskId: task.id, status: task.status, projectId: project.id },
      };
    },
  };

  return [listProjectsTool, createTaskTool, listTasksTool, getTaskTool];
}

interface ProcessResult {
  body: string;
  status: "done" | "error";
  taskId?: string;
  projectId?: string;
}

async function runSecretary(
  settings: SecretarySettings,
  projects: ListProjectsResult[],
  prompt: string,
): Promise<ProcessResult> {
  if (!settings.apiKey) {
    return {
      status: "error",
      body: `还没有配置模型 API Key。请打开 [秘书设置](/secretary/settings)，填入 Base URL、模型名和 API Key 后再试。`,
    };
  }

  let created: { taskId: string; projectId: string } | undefined;
  const agent = new Agent({
    initialState: {
      systemPrompt: systemPrompt(projects),
      model: buildModel(settings),
      tools: createTools(projects, (task, project) => {
        created = { taskId: task.id, projectId: project.id };
      }),
    },
    streamFn: createStreamFn(settings),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    await agent.prompt(prompt);
    if (controller.signal.aborted) {
      return {
        status: "error",
        body: "处理超时了，请稍后重试或把任务拆小一些。",
        ...(created ? { taskId: created.taskId, projectId: created.projectId } : {}),
      };
    }
    const reply = latestAssistantText(agent);
    if (!reply) {
      return {
        status: "error",
        body: agent.state.errorMessage ?? "模型没有返回内容，请检查模型配置。",
        ...(created ? { taskId: created.taskId, projectId: created.projectId } : {}),
      };
    }
    return {
      status: "done",
      body: reply,
      ...(created ? { taskId: created.taskId, projectId: created.projectId } : {}),
    };
  } catch (error) {
    return {
      status: "error",
      body: `处理失败：${error instanceof Error ? error.message : String(error)}`,
      ...(created ? { taskId: created.taskId, projectId: created.projectId } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function processPending(): Promise<void> {
  const initial = await readChat();
  const pendingIds = initial.messages
    .filter((message) => message.role === "secretary" && message.status === "pending")
    .map((message) => message.id);
  if (pendingIds.length === 0) return;

  const settings = await readSettings();
  for (const pendingId of pendingIds) {
    const state = await readChat();
    const placeholder = state.messages.find((message) => message.id === pendingId);
    if (placeholder?.status !== "pending") continue;
    const bossMessage = state.messages.find((message) => message.id === placeholder.inReplyTo);
    if (!bossMessage) {
      await replaceMessage(placeholder.id, {
        body: "这条消息找不到对应的 Boss 输入。",
        status: "error",
      });
      continue;
    }

    const history = formatHistory(
      state.messages.filter((message) => message.id !== placeholder.id),
    );
    const prompt = history
      ? `以下是最近的对话：\n\n${history}\n\nBoss 最新消息：\n${bossMessage.body}`
      : bossMessage.body;

    const projects = await listRegisteredProjects().catch(() => []);
    const result = await runSecretary(settings, projects, prompt);
    await replaceMessage(placeholder.id, result);
    await drainInbox().catch(() => undefined);
  }
}

async function replaceMessage(
  id: string,
  patch: {
    body: string;
    status: "done" | "error";
    taskId?: string;
    projectId?: string;
  },
): Promise<void> {
  await mutateChat((state) => {
    const index = state.messages.findIndex((message) => message.id === id);
    if (index < 0) return undefined;
    const current = state.messages[index] as SecretaryChatMessage;
    state.messages[index] = {
      ...current,
      body: patch.body,
      status: patch.status,
      ...(patch.taskId ? { taskId: patch.taskId } : {}),
      ...(patch.projectId ? { projectId: patch.projectId } : {}),
    };
  });
}

function scheduleProcessing(): void {
  running += 1;
  queue = queue
    .then(() => processPending())
    .catch(() => undefined)
    .finally(() => {
      running = Math.max(0, running - 1);
    });
}

export async function sendBossMessage(input: SendBossMessageInput): Promise<SecretaryChatMessage> {
  const message = input.message.trim();
  if (!message) throw new Error("消息不能为空。");

  const bossMessage: SecretaryChatMessage = {
    id: newMessageId(),
    role: "boss",
    body: message,
    createdAt: nowIso(),
    status: "done",
  };
  const placeholder: SecretaryChatMessage = {
    id: newMessageId(),
    role: "secretary",
    body: "正在处理…",
    createdAt: nowIso(),
    status: "pending",
    inReplyTo: bossMessage.id,
  };

  await mutateChat((state) => {
    state.messages.push(bossMessage, placeholder);
    return undefined;
  });
  scheduleProcessing();
  return bossMessage;
}

/**
 * Hand one inbox note to the secretary agent. The note only states the fact;
 * the agent inspects the task directory with its own tools and decides how to
 * report it to the boss.
 */
async function processInboxNote(note: InboxNote, settings: SecretarySettings): Promise<void> {
  const projects = await listRegisteredProjects().catch(() => []);
  const prompt = [
    "秘书收件箱收到一条任务通知，请核实后向 Boss 汇报：",
    "",
    note.body,
    "",
    "请用 list_tasks / get_task 等工具查看该任务的目录与会话，确认实际完成情况，",
    "然后简洁地汇报给 Boss。如果任务尚未真正完成或信息矛盾，请如实说明。",
  ].join("\n");
  const result = await runSecretary(settings, projects, prompt);
  await mutateChat((current) => {
    current.messages.push({
      id: newMessageId(),
      role: "secretary",
      body: result.body,
      createdAt: nowIso(),
      status: result.status,
      ...(result.taskId ? { taskId: result.taskId } : {}),
      ...(result.projectId ? { projectId: result.projectId } : {}),
    });
    return undefined;
  });
}

/** Drain unread notes: unread -> processing -> agent -> processed. */
export async function drainInbox(): Promise<void> {
  const unread = await listInboxNotes("unread");
  if (unread.length === 0) return;
  const settings = await readSettings();
  for (const note of unread) {
    try {
      const processingPath = await moveInboxNote(note, "processing");
      await processInboxNote(note, settings);
      await moveInboxNote({ ...note, state: "processing", filePath: processingPath }, "processed");
    } catch {
      // Leave the note in processing for a later retry; never lose an event.
    }
  }
}

/**
 * Safety net for the gap between marking a task done and enqueueing its note.
 * Runs at most once per minute; re-enqueues completed tasks that have no note.
 */
export async function reconcileInbox(): Promise<void> {
  const now = Date.now();
  if (now - lastReconcile < RECONCILE_INTERVAL_MS) return;
  lastReconcile = now;

  const projects = await listRegisteredProjects().catch(() => []);
  for (const project of projects) {
    if (!project.exists) continue;
    const { tasks } = await scanTasks(project.path, { statuses: ["done", "review"] });
    for (const task of tasks) {
      if (task.extra.created_by !== "secretary") continue;
      const lastSeq = task.conversation.at(-1)?.seq ?? "0";
      const key = `${task.id}:${lastSeq}:${task.status}`;
      if (await hasInboxNote(key)) continue;
      await enqueueInboxNote({
        from: "reconcile",
        projectId: project.id,
        taskId: task.id,
        key,
        body: `任务 ${task.id}「${task.title}」已完成（状态：${task.status}）。\n\n请查看项目 \`${project.id}\` 下该任务的目录与会话，核对完成情况并向 Boss 汇报。`,
      }).catch(() => undefined);
    }
  }
}

export async function getSecretaryState(): Promise<SecretaryState> {
  await recoverStalePending().catch(() => undefined);
  await reconcileInbox().catch(() => undefined);
  await drainInbox().catch(() => undefined);
  const state = await readChat();
  return {
    messages: state.messages,
    busy:
      isSecretaryBusy() ||
      state.messages.some(
        (message) => message.role === "secretary" && message.status === "pending",
      ),
  };
}

export async function getSecretarySettings(): Promise<PublicSecretarySettings> {
  return toPublicSettings(await readSettings());
}

export async function updateSecretarySettings(
  input: UpdateSecretarySettingsInput,
): Promise<PublicSecretarySettings> {
  return toPublicSettings(await persistSettings(input));
}

export async function clearSecretaryChat(): Promise<void> {
  await mutateChat((state) => {
    state.messages = [];
    return undefined;
  });
}

/** Remove stale pending placeholders left behind by a crashed server. */
export async function recoverStalePending(maxAgeMs = 10 * 60 * 1000): Promise<void> {
  const state = await readChat();
  const stale = state.messages.filter(
    (message) =>
      message.role === "secretary" &&
      message.status === "pending" &&
      secondsAgo(message.createdAt) > maxAgeMs,
  );
  if (stale.length === 0) return;
  await mutateChat((current) => {
    for (const message of current.messages) {
      if (stale.some((entry) => entry.id === message.id)) {
        message.status = "error";
        message.body = "上一次处理没有完成，请重新发送。";
      }
    }
    return undefined;
  });
}
