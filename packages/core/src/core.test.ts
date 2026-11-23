import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptTask,
  appendActivityEntry,
  approveTask,
  claimTask,
  commentTask,
  completeTask,
  createTask,
  deleteTask,
  enqueueInboxNote,
  getActivityLogPath,
  getActivityLogSize,
  getTask,
  hasInboxNote,
  initProject,
  isPortableProjectId,
  listInboxNotes,
  listRegisteredProjects,
  listTasks,
  maintainProject,
  moveInboxNote,
  normalizeGitRemoteUrl,
  projectLink,
  readActivityEntries,
  readConfig,
  readProjectInfo,
  readProjectLocalConfig,
  registerProject,
  releaseStaleTasks,
  releaseTask,
  removeRegisteredProject,
  renderPrompt,
  renderTaskCompletedNote,
  resolveCliProject,
  resolveProjectIdentity,
  scanTasks,
  summarizeTask,
  taskLink,
  toAbsolutePath,
  updateTask,
  writeProjectLocalConfig,
} from "./index.js";

const execFileAsync = promisify(execFile);

let workspace: string;
let projectRoot: string;
let axaHome: string;

function taskDir(status: string, folder: string): string {
  return join(projectRoot, ".axa", "tasks", status, folder);
}

async function readMetadata(folderPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(folderPath, "task.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "axa-core-"));
  projectRoot = join(workspace, "demo");
  axaHome = join(workspace, "home");
  process.env.AXA_HOME = axaHome;
  await initProject({ projectRoot, name: "Demo Project" });
});

afterEach(async () => {
  delete process.env.AXA_HOME;
  await rm(workspace, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates the directory contract and preserves a custom skill", async () => {
    const skillFile = join(projectRoot, ".axa", "SKILL.md");
    const skill = await readFile(skillFile, "utf8");
    expect(skill).toContain("axa 行动指南");

    await writeFile(skillFile, "# custom\n", "utf8");
    await initProject({ projectRoot });
    expect(await readFile(skillFile, "utf8")).toBe("# custom\n");
  });
});

describe("task folders", () => {
  it("creates task directories with JSON metadata and an initial user message", async () => {
    const low = await createTask({
      projectRoot,
      title: "Polish the board",
      priority: "P2",
      status: "backlog",
      tags: ["ui"],
    });
    const high = await createTask({
      projectRoot,
      title: "Fix the core lock",
      priority: "P0",
      status: "todo",
      body: "## Goal\n\nNo duplicate claims.",
    });

    expect(low.id).toBe("001");
    expect(high.id).toBe("002");
    expect(low.filename).toBe("001_P2_Polish_the_board");
    expect(high.filename).toBe("002_P0_Fix_the_core_lock");
    expect(high.filePath).toBe(taskDir("todo", "002_P0_Fix_the_core_lock"));
    expect(high.conversation).toHaveLength(1);
    expect(high.conversation[0]?.filename).toBe("000_user_Fix_the_core_lock.md");
    expect(high.conversation[0]?.body).toContain("No duplicate claims.");

    const metadata = await readMetadata(high.filePath);
    expect(metadata).toMatchObject({
      version: 1,
      id: "002",
      title: "Fix the core lock",
      priority: "P0",
      status: "todo",
      reviewRequired: true,
    });
    expect(metadata).not.toHaveProperty("filename");

    const message = await readFile(high.conversation[0]?.filePath ?? "", "utf8");
    expect(message).toContain("No duplicate claims.");

    const tasks = await listTasks(projectRoot);
    expect(tasks.map((task) => task.id)).toEqual(["002", "001"]);

    const todo = await listTasks(projectRoot, { statuses: ["todo"] });
    expect(todo).toHaveLength(1);
    expect(todo[0]?.body).toContain("No duplicate claims.");
  });

  it("updates the latest user message and renames the task folder", async () => {
    const created = await createTask({
      projectRoot,
      title: "Original title",
      body: "Original body.",
      status: "todo",
    });

    const updated = await updateTask({
      projectRoot,
      taskId: created.id,
      title: "Edited title",
      body: "## Edited\n\nNew body.",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.filePath).toBe(taskDir("todo", "001_P1_Edited_title"));
    expect(updated.title).toBe("Edited title");
    expect(updated.body).toBe("## Edited\n\nNew body.");
    expect(updated.conversation).toHaveLength(1);
    expect(await readFile(updated.conversation[0]?.filePath ?? "", "utf8")).toContain("New body.");

    const metadata = await readMetadata(updated.filePath);
    expect(metadata.title).toBe("Edited title");

    await expect(
      updateTask({ projectRoot, taskId: created.id, title: "  ", body: "" }),
    ).rejects.toMatchObject({ code: "INVALID_TASK" });
  });

  it("updates priority, tags, and extra metadata and renames the folder", async () => {
    const created = await createTask({
      projectRoot,
      title: "Original title",
      body: "Original body.",
      status: "todo",
    });

    const updated = await updateTask({
      projectRoot,
      taskId: created.id,
      title: "Original title",
      body: "Edited body.",
      priority: "P2",
      tags: ["ui", " docs "],
      extra: { assignee: "alice", status: "done", id: "999" },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.priority).toBe("P2");
    expect(updated.tags).toEqual(["ui", "docs"]);
    expect(updated.filename).toBe("001_P2_Original_title");
    expect(updated.filePath).not.toBe(created.filePath);
    expect(updated.extra).toEqual({ assignee: "alice" });

    const metadata = await readMetadata(updated.filePath);
    expect(metadata).toMatchObject({
      title: "Original title",
      priority: "P2",
      tags: ["ui", "docs"],
      extra: { assignee: "alice" },
    });
  });

  it("deletes a task directory", async () => {
    const created = await createTask({
      projectRoot,
      title: "Remove me",
      status: "todo",
    });

    const deleted = await deleteTask(projectRoot, created.id);
    expect(deleted.id).toBe(created.id);
    await expect(getTask(projectRoot, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads legacy Markdown tasks and migrates them on the next write", async () => {
    const filename = "009_P1_Handwritten_task.md";
    await writeFile(
      join(projectRoot, ".axa", "tasks", "todo", filename),
      "Do the thing.\n",
      "utf8",
    );

    const task = await getTask(projectRoot, "9");
    expect(task.title).toBe("Handwritten task");
    expect(task.priority).toBe("P1");
    expect(task.body).toBe("Do the thing.");
    expect(task.legacy).toBe(true);
    expect(task.reviewRequired).toBe(true);

    const claimed = await claimTask({
      projectRoot,
      taskId: task.id,
      agentPlatform: "worker",
    });
    expect(claimed.legacy).toBe(false);
    expect(claimed.filePath).toBe(taskDir("doing", "009_P1_Handwritten_task"));
    expect(claimed.conversation).toHaveLength(1);
    expect(claimed.conversation[0]?.filename).toBe("000_user_Handwritten_task.md");
    await expect(readFile(join(projectRoot, ".axa", "tasks", "todo", filename))).rejects.toThrow();
  });

  it("reports malformed task metadata as issues", async () => {
    const broken = taskDir("todo", "010_P1_Broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "task.json"), "{not json", "utf8");

    const result = await scanTasks(projectRoot, { statuses: ["todo"] });
    expect(result.tasks).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.filePath).toContain("010_P1_Broken");
  });
});

describe("task lifecycle", () => {
  it("approves, claims, and completes a task without review", async () => {
    const created = await createTask({
      projectRoot,
      title: "Implement lifecycle",
      priority: "P0",
      actor: "human",
      reviewRequired: false,
    });

    const approved = await approveTask(projectRoot, created.id, "reviewer");
    expect(approved.status).toBe("todo");
    expect(approved.filePath).toContain("/todo/");

    const claimed = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "worker-a",
    });
    expect(claimed.status).toBe("doing");
    expect(claimed.claimedBy).toMatch(/^worker-a_\d{2}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.\d{3}$/u);
    expect(claimed.claimedAt).toBeTruthy();
    expect(claimed.filePath).toContain("/doing/");
    expect((await readdir(claimed.filePath)).includes(".lock")).toBe(false);

    await expect(
      claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker-b" }),
    ).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });

    await summarizeTask(projectRoot, created.id, "Implemented.");
    const done = await completeTask(projectRoot, created.id);
    expect(done.status).toBe("done");
    expect(done.filePath).toContain("/done/");
    expect(done.extra.completed_by).toBe(claimed.claimedBy);
    expect(done.claimedBy).toBeUndefined();
  });

  it("requires a summary even when review is not required", async () => {
    const created = await createTask({
      projectRoot,
      title: "No review but summarize",
      status: "todo",
      reviewRequired: false,
    });
    const claimed = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "worker-a",
    });
    await expect(completeTask(projectRoot, created.id, claimed.claimedBy)).rejects.toThrow(
      /axa summary .* --file/u,
    );
  });

  it("lets the claimer release a task", async () => {
    const created = await createTask({
      projectRoot,
      title: "Release owner check",
      status: "todo",
    });
    const claimed = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "worker-a",
    });

    await expect(releaseTask(projectRoot, created.id, { actor: "worker-b" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );

    const released = await releaseTask(projectRoot, created.id, {
      actor: claimed.claimedBy as string,
    });
    expect(released.status).toBe("todo");
  });

  it("releases a claimed task back to todo", async () => {
    const created = await createTask({
      projectRoot,
      title: "Release me",
      status: "todo",
    });
    await claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker-a" });

    const released = await releaseTask(projectRoot, created.id);
    expect(released.status).toBe("todo");
    expect(released.claimedBy).toBeUndefined();
    expect(released.claimedAt).toBeUndefined();
  });

  it("rejects invalid transitions", async () => {
    const created = await createTask({ projectRoot, title: "Not approved yet" });
    await expect(
      claimTask({ projectRoot, taskId: created.id, agentPlatform: "a" }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(completeTask(projectRoot, created.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("claims the highest-priority next task", async () => {
    await createTask({ projectRoot, title: "Low", priority: "P2", status: "todo" });
    const high = await createTask({
      projectRoot,
      title: "High",
      priority: "P0",
      status: "todo",
    });

    const claimed = await claimTask({ projectRoot, agentPlatform: "worker", next: true });
    expect(claimed.id).toBe(high.id);
  });

  it("only lets one concurrent claim win", async () => {
    const created = await createTask({
      projectRoot,
      title: "Contended task",
      status: "todo",
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        claimTask({ projectRoot, taskId: created.id, agentPlatform: `worker-${index}` }),
      ),
    );

    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const task = await getTask(projectRoot, created.id);
    expect(task.status).toBe("doing");
    expect(task.claimedBy).toMatch(/^worker-/);
  });

  it("releases tasks whose claim is older than the threshold", async () => {
    const created = await createTask({
      projectRoot,
      title: "Stale task",
      status: "todo",
    });
    const claimed = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "sleepy-agent",
    });

    const metadataPath = join(claimed.filePath, "task.json");
    const metadata = await readMetadata(claimed.filePath);
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    metadata.claimedAt = oldDate;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const result = await releaseStaleTasks(projectRoot, 24 * 60 * 60 * 1000);
    expect(result.released).toHaveLength(1);
    expect(result.released[0]?.status).toBe("todo");
    expect(result.released[0]?.claimedBy).toBeUndefined();
  });
});

describe("review workflow", () => {
  async function claimableReviewTask(reviewRequired: boolean) {
    const created = await createTask({
      projectRoot,
      title: reviewRequired ? "Needs human review" : "No review needed",
      status: "todo",
      reviewRequired,
    });
    return claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker-a" });
  }

  it("defaults reviewRequired to true", async () => {
    const created = await createTask({ projectRoot, title: "Plain task", status: "todo" });
    expect(created.reviewRequired).toBe(true);
    const metadata = await readMetadata(created.filePath);
    expect(metadata.reviewRequired).toBe(true);
  });

  it("requires an agent summary before a review-required task can complete", async () => {
    const claimed = await claimableReviewTask(true);
    await expect(completeTask(projectRoot, claimed.id, claimed.claimedBy)).rejects.toMatchObject({
      code: "INVALID_TASK",
    });

    const summarized = await summarizeTask(
      projectRoot,
      claimed.id,
      "## 本轮完成\n\n实现并通过测试。",
    );
    expect(summarized.conversation.at(-1)?.role).toBe("agent");
    expect(summarized.conversation.at(-1)?.agent).toBe(claimed.claimedBy);

    const completed = await completeTask(projectRoot, claimed.id);
    expect(completed.status).toBe("review");
    expect(completed.filePath).toContain("/review/");
    expect(completed.reviewRequired).toBe(true);
    expect(completed.extra.completed_by).toBe(claimed.claimedBy);
    expect(completed.extra.completed_at).toBeTruthy();
    expect(completed.claimedBy).toBeUndefined();

    await expect(
      claimTask({ projectRoot, taskId: claimed.id, agentPlatform: "worker-b" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("completes straight to done when review is not required", async () => {
    const claimed = await claimableReviewTask(false);
    await summarizeTask(projectRoot, claimed.id, "Done.");
    const done = await completeTask(projectRoot, claimed.id);
    expect(done.status).toBe("done");
    expect(done.filePath).toContain("/done/");
  });

  it("accepts a review task into done and records the reviewer", async () => {
    const claimed = await claimableReviewTask(true);
    await summarizeTask(projectRoot, claimed.id, "Done.");
    await completeTask(projectRoot, claimed.id);

    const accepted = await acceptTask(projectRoot, claimed.id, "human");
    expect(accepted.status).toBe("done");
    expect(accepted.filePath).toContain("/done/");
    expect(accepted.extra.accepted_by).toBe("human");
    expect(accepted.extra.accepted_at).toBeTruthy();
  });

  it("rejects accepting a task that is not in review", async () => {
    const created = await createTask({ projectRoot, title: "Still todo", status: "todo" });
    await expect(acceptTask(projectRoot, created.id, "human")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("toggles reviewRequired off and persists the JSON field", async () => {
    const created = await createTask({
      projectRoot,
      title: "Toggle review",
      status: "todo",
      reviewRequired: true,
    });
    const updated = await updateTask({
      projectRoot,
      taskId: created.id,
      title: "Toggle review",
      body: "",
      reviewRequired: false,
    });
    expect(updated.reviewRequired).toBe(false);
    const metadata = await readMetadata(updated.filePath);
    expect(metadata.reviewRequired).toBe(false);
  });

  it("counts review tasks in project info", async () => {
    const claimed = await claimableReviewTask(true);
    await summarizeTask(projectRoot, claimed.id, "Done.");
    await completeTask(projectRoot, claimed.id);
    const info = await readProjectInfo(projectRoot);
    expect(info.counts.review).toBe(1);
    expect(info.counts.done).toBe(0);
    expect(info.total).toBe(1);
  });
});

describe("task iteration", () => {
  it("reopens a review task when the user appends a new requirement", async () => {
    const created = await createTask({
      projectRoot,
      title: "Iterate me",
      body: "First requirement.",
      status: "todo",
    });
    const first = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "worker-a",
    });
    const firstAgent = first.claimedBy as string;
    await summarizeTask(projectRoot, created.id, "Round one done.");
    const inReview = await completeTask(projectRoot, created.id);
    expect(inReview.status).toBe("review");

    const reopened = await commentTask(projectRoot, created.id, "请补充错误处理。", "human");
    expect(reopened.status).toBe("todo");
    expect(reopened.claimedBy).toBeUndefined();
    expect(reopened.conversation.map((entry) => `${entry.seq}_${entry.role}`)).toEqual([
      "000_user",
      "001_agent",
      "002_user",
    ]);
    expect(reopened.conversation.at(-1)?.filename).toBe("002_user_请补充错误处理.md");
    expect(reopened.body).toBe("请补充错误处理。");
    expect(reopened.filePath).toContain("/todo/");
    expect(reopened.extra.completed_at).toBeUndefined();
    expect(reopened.extra.completed_by).toBeUndefined();

    const second = await claimTask({
      projectRoot,
      taskId: created.id,
      agentPlatform: "worker-b",
    });
    const secondAgent = second.claimedBy as string;
    expect(secondAgent).not.toBe(firstAgent);
    await expect(completeTask(projectRoot, created.id, secondAgent)).rejects.toMatchObject({
      code: "INVALID_TASK",
    });
    await summarizeTask(projectRoot, created.id, "Round two done.");
    const completed = await completeTask(projectRoot, created.id);
    expect(completed.status).toBe("review");
    expect(completed.conversation.map((entry) => entry.seq)).toEqual(["000", "001", "002", "003"]);
    expect(completed.conversation[1]?.agent).toBe(firstAgent);
    expect(completed.conversation[3]?.agent).toBe(secondAgent);

    const roundOne = await readFile(
      join(completed.filePath, "001_agent_Round_one_done.md"),
      "utf8",
    );
    const roundTwo = await readFile(
      join(completed.filePath, "003_agent_Round_two_done.md"),
      "utf8",
    );
    expect(roundOne).toContain(`agent: ${firstAgent}`);
    expect(roundTwo).toContain(`agent: ${secondAgent}`);
    expect(roundOne).not.toContain(secondAgent);
    expect(roundTwo).not.toContain(firstAgent);

    const files = await readdir(completed.filePath);
    expect(files.sort()).toEqual([
      "000_user_Iterate_me.md",
      "001_agent_Round_one_done.md",
      "002_user_请补充错误处理.md",
      "003_agent_Round_two_done.md",
      "task.json",
    ]);
  });

  it("derives concise conversation titles and prefers explicit titles", async () => {
    const created = await createTask({
      projectRoot,
      title: "Title quality",
      status: "todo",
    });
    const commented = await commentTask(
      projectRoot,
      created.id,
      "关于 agent 注册，现在 agent id 是进程级别(是吗?)；我觉得应该是轮次级别，每轮唯一。\n\n后续细节不应进入标题。",
    );
    const userEntry = commented.conversation.at(-1);
    expect(userEntry?.title).not.toContain("后续细节");
    expect(userEntry?.title.length).toBeLessThanOrEqual(40);

    await claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker" });
    const auto = await summarizeTask(
      projectRoot,
      created.id,
      "## 本轮实现\n\n优化会话记录标题的生成逻辑，避免泛化标题。\n",
    );
    const autoEntry = auto.conversation.at(-1);
    expect(autoEntry?.title).not.toBe("本轮实现");
    expect(autoEntry?.title).toContain("优化会话记录标题");

    const explicit = await summarizeTask(
      projectRoot,
      created.id,
      "## 本轮实现\n\n正文。\n",
      undefined,
      "新增 --title 参数",
    );
    expect(explicit.conversation.at(-1)?.title).toBe("新增 --title 参数");
  });

  it("reopens a completed task when the user asks for more work", async () => {
    const created = await createTask({
      projectRoot,
      title: "No review task",
      status: "todo",
      reviewRequired: false,
    });
    await claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker" });
    await summarizeTask(projectRoot, created.id, "Done.");
    const done = await completeTask(projectRoot, created.id);
    expect(done.status).toBe("done");

    const reopened = await commentTask(projectRoot, created.id, "再加一个边界用例。");
    expect(reopened.status).toBe("todo");
    expect(reopened.conversation).toHaveLength(3);
  });
});

describe("archive lifecycle", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function completedTask() {
    const created = await createTask({
      projectRoot,
      title: "Archive me",
      status: "todo",
      reviewRequired: false,
    });
    await claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker" });
    await summarizeTask(projectRoot, created.id, "Done.");
    return completeTask(projectRoot, created.id);
  }

  it("archives done tasks after 30 days and hides them by default", async () => {
    const done = await completedTask();
    const metadata = await readMetadata(done.filePath);
    const extra = metadata.extra as Record<string, unknown>;
    metadata.extra = { ...extra, completed_at: new Date(Date.now() - 31 * DAY).toISOString() };
    await writeFile(
      join(done.filePath, "task.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );

    const result = await maintainProject(projectRoot);
    expect(result.archived).toHaveLength(1);

    const archived = await getTask(projectRoot, done.id);
    expect(archived.status).toBe("archived");
    expect(archived.filePath).toContain("/archived/");
    expect(archived.extra.archived_by).toBe("auto");

    const active = await listTasks(projectRoot);
    expect(active.some((task) => task.id === done.id)).toBe(false);

    const all = await listTasks(projectRoot, { includeArchived: true });
    expect(all.find((task) => task.id === done.id)?.status).toBe("archived");
  });

  it("reopens an archived task when a human appends a requirement", async () => {
    const done = await completedTask();
    await maintainProject(projectRoot, { archiveAfterMs: 0 });

    const archived = await getTask(projectRoot, done.id);
    expect(archived.status).toBe("archived");

    const reopened = await commentTask(projectRoot, done.id, "再补一个用例。", "human");
    expect(reopened.status).toBe("todo");
    expect(reopened.filePath).toContain("/todo/");
    expect(reopened.extra.archived_at).toBeUndefined();
    expect(reopened.extra.archived_by).toBeUndefined();
    expect(reopened.extra.completed_at).toBeUndefined();
  });

  it("counts archived tasks in project info", async () => {
    await completedTask();
    await maintainProject(projectRoot, { archiveAfterMs: 0 });
    const info = await readProjectInfo(projectRoot);
    expect(info.counts.archived).toBe(1);
    expect(info.counts.done).toBe(0);
  });
});

describe("project registry", () => {
  it("registers, resolves, and removes projects through the config file", async () => {
    const secondRoot = join(workspace, "second");
    await initProject({ projectRoot: secondRoot, name: "Second" });

    const first = await registerProject({ path: projectRoot, name: "Demo" });
    const second = await registerProject({ path: secondRoot, name: "Second" });
    expect(first.id).toMatch(/^local:/u);
    expect(second.id).toMatch(/^local:/u);
    expect(first.id).not.toBe(second.id);

    const config = await readConfig();
    expect(config.projects).toHaveLength(2);
    expect(config.defaultProjectId).toBe(first.id);

    const listed = await listRegisteredProjects();
    expect(listed.find((project) => project.id === second.id)?.total).toBe(0);

    expect(await resolveCliProject("second")).toBe(secondRoot);

    await removeRegisteredProject(first.id);
    const after = await readConfig();
    expect(after.projects.map((project) => project.id)).toEqual([second.id]);
    expect(after.defaultProjectId).toBe(second.id);
  });

  it("initializes a missing project on demand when registering", async () => {
    const fresh = join(workspace, "fresh");
    const project = await registerProject({
      path: fresh,
      name: "Fresh",
      initialize: true,
    });
    expect(project.id).toMatch(/^local:/u);
    expect(await resolveCliProject("fresh")).toBe(fresh);
  });

  it("expands ~ in project paths", () => {
    expect(toAbsolutePath("~")).toBe(homedir());
    expect(toAbsolutePath("~/demo")).toBe(join(homedir(), "demo"));
    expect(toAbsolutePath("  ~/demo  ")).toBe(join(homedir(), "demo"));
  });
});

describe("portable project identity", () => {
  it("persists a stable local id and keeps one registry entry", async () => {
    const first = await registerProject({ path: projectRoot, name: "Demo" });
    expect(first.id).toMatch(/^local:[0-9a-f-]+$/u);

    const local = await readProjectLocalConfig(projectRoot);
    expect(local?.projectId).toBe(first.id);

    const again = await registerProject({ path: projectRoot, name: "Demo renamed" });
    expect(again.id).toBe(first.id);
    expect((await readConfig()).projects).toHaveLength(1);
  });

  it("normalizes SSH and HTTPS remotes to the same id", () => {
    const expected = "github.com/chitootoo/agentxagent";
    expect(normalizeGitRemoteUrl("git@github.com:chitootoo/agentxagent.git")).toBe(expected);
    expect(normalizeGitRemoteUrl("ssh://git@github.com/chitootoo/agentxagent.git")).toBe(expected);
    expect(normalizeGitRemoteUrl("https://github.com/chitootoo/agentxagent.git")).toBe(expected);
    expect(normalizeGitRemoteUrl("https://github.com/chitootoo/agentxagent")).toBe(expected);
    expect(normalizeGitRemoteUrl("/local/repo")).toBeUndefined();
    expect(normalizeGitRemoteUrl("")).toBeUndefined();
  });

  it("recognizes portable ids without the git: prefix", () => {
    expect(isPortableProjectId("github.com/chitootoo/agentxagent")).toBe(true);
    expect(isPortableProjectId("local:9f3c")).toBe(true);
    expect(isPortableProjectId("git:github.com/chitootoo/agentxagent")).toBe(false);
    expect(isPortableProjectId("agentxagent")).toBe(false);
  });

  it("upgrades a stored git: id to the prefix-free form without a remote", async () => {
    await writeProjectLocalConfig(projectRoot, {
      version: 1,
      projectId: "git:github.com/acme/demo",
    });

    const identity = await resolveProjectIdentity(projectRoot);

    expect(identity.id).toBe("github.com/acme/demo");
    expect(identity.previousId).toBe("git:github.com/acme/demo");
    expect((await readProjectLocalConfig(projectRoot))?.projectId).toBe("github.com/acme/demo");
  });

  it("upgrades a local id to the git remote id and migrates the registry", async () => {
    const local = await registerProject({ path: projectRoot, name: "Demo" });
    expect(local.id).toMatch(/^local:/u);

    await execFileAsync("git", ["init", "-q", projectRoot]);
    await execFileAsync("git", [
      "-C",
      projectRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:acme/demo.git",
    ]);

    const identity = await resolveProjectIdentity(projectRoot);
    expect(identity.id).toBe("github.com/acme/demo");
    expect(identity.previousId).toBe(local.id);

    const upgraded = await registerProject({ path: projectRoot, name: "Demo" });
    expect(upgraded.id).toBe("github.com/acme/demo");

    const config = await readConfig();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]?.id).toBe("github.com/acme/demo");
    expect(config.defaultProjectId).toBe("github.com/acme/demo");
  });

  it("remaps a moved project by project id", async () => {
    const registered = await registerProject({ path: projectRoot, name: "Demo" });
    const movedRoot = join(workspace, "moved-demo");
    await rename(projectRoot, movedRoot);

    expect(await resolveCliProject(movedRoot)).toBe(movedRoot);

    const config = await readConfig();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]?.id).toBe(registered.id);
    expect(config.projects[0]?.path).toBe(movedRoot);
    projectRoot = movedRoot;
  });

  it("honors AXA_HOME when switching registries", async () => {
    await registerProject({ path: projectRoot, name: "Demo" });
    expect((await readConfig()).projects).toHaveLength(1);

    const otherHome = join(workspace, "other-home");
    process.env.AXA_HOME = otherHome;
    try {
      expect((await readConfig()).projects).toHaveLength(0);
    } finally {
      process.env.AXA_HOME = axaHome;
    }
    expect((await readConfig()).projects).toHaveLength(1);
  });
});

describe("secretary inbox", () => {
  it("enqueues a human-readable note and moves it through states", async () => {
    const note = await enqueueInboxNote({
      from: "worker",
      projectId: "github.com/acme/demo",
      taskId: "001",
      key: "001:002:done",
      body: "任务 001 已完成，请查收。",
    });
    expect(note.state).toBe("unread");

    const raw = await readFile(note.filePath, "utf8");
    expect(raw).toContain("任务 001 已完成");
    expect(raw).toContain('key: "001:002:done"');

    const unread = await listInboxNotes("unread");
    expect(unread.some((entry) => entry.id === note.id)).toBe(true);
    expect(await hasInboxNote("001:002:done")).toBe(true);

    await moveInboxNote(note, "processing");
    expect((await listInboxNotes("unread")).some((entry) => entry.id === note.id)).toBe(false);
    const processing = await listInboxNotes("processing");
    const inProcessing = processing.find((entry) => entry.id === note.id);
    expect(inProcessing).toBeDefined();
    if (!inProcessing) return;

    await moveInboxNote(inProcessing, "processed");
    expect((await listInboxNotes("processed")).some((entry) => entry.id === note.id)).toBe(true);
  });

  it("does not enqueue a duplicate key twice via reconciliation check", async () => {
    await enqueueInboxNote({
      from: "worker",
      projectId: "github.com/acme/demo",
      taskId: "002",
      key: "002:001:done",
      body: "任务 002 已完成。",
    });
    expect(await hasInboxNote("002:001:done")).toBe(true);
    expect(await hasInboxNote("002:002:done")).toBe(false);
  });

  it("enqueues a note when a task is completed", async () => {
    const created = await createTask({
      projectRoot,
      title: "Inbox notify",
      body: "test",
      actor: "secretary",
      status: "todo",
      extra: { created_by: "secretary" },
    });
    await claimTask({ projectRoot, taskId: created.id, agentPlatform: "worker" });
    await summarizeTask(projectRoot, created.id, "Implemented.");
    await completeTask(projectRoot, created.id);

    const notes = await listInboxNotes("unread");
    expect(notes.some((note) => note.taskId === created.id)).toBe(true);
  });
});

describe("legacy config migration", () => {
  function legacyConfig(projects: Array<{ id: string; path: string }>) {
    return {
      version: 1,
      projects: projects.map(({ id, path }) => ({
        id,
        name: id,
        path,
        addedAt: "2026-11-04T16:55:48.681Z",
      })),
      defaultProjectId: projects[0]?.id,
    };
  }

  async function writeLegacyConfig(config: unknown): Promise<void> {
    await mkdir(axaHome, { recursive: true });
    await writeFile(join(axaHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  it("upgrades name-based ids on load and persists the result", async () => {
    await writeLegacyConfig(legacyConfig([{ id: "demo", path: projectRoot }]));

    const config = await readConfig();

    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]?.id).toMatch(/^local:/u);
    expect(config.defaultProjectId).toBe(config.projects[0]?.id);
    const persisted = JSON.parse(await readFile(join(axaHome, "config.json"), "utf8")) as {
      projects: Array<{ id: string }>;
    };
    expect(persisted.projects[0]?.id).toBe(config.projects[0]?.id);
  });

  it("is idempotent", async () => {
    await writeLegacyConfig(legacyConfig([{ id: "demo", path: projectRoot }]));

    const first = await readConfig();
    const afterFirst = await readFile(join(axaHome, "config.json"), "utf8");
    const second = await readConfig();
    const afterSecond = await readFile(join(axaHome, "config.json"), "utf8");

    expect(second).toEqual(first);
    expect(afterSecond).toBe(afterFirst);
  });

  it("migrates stored git: prefixed registry ids without needing the project", async () => {
    await writeLegacyConfig(
      legacyConfig([{ id: "git:github.com/acme/demo", path: join(workspace, "missing") }]),
    );

    const config = await readConfig();
    expect(config.projects[0]?.id).toBe("github.com/acme/demo");
    expect(config.defaultProjectId).toBe("github.com/acme/demo");
  });

  it("leaves portable ids untouched", async () => {
    const portableId = "github.com/acme/demo";
    await writeLegacyConfig(legacyConfig([{ id: portableId, path: projectRoot }]));

    const config = await readConfig();
    expect(config.projects[0]?.id).toBe(portableId);
  });

  it("preserves entries whose project directory no longer exists", async () => {
    await writeLegacyConfig(
      legacyConfig([
        { id: "demo", path: projectRoot },
        { id: "gone", path: join(workspace, "missing") },
      ]),
    );

    const config = await readConfig();
    expect(config.projects).toHaveLength(2);
    expect(config.projects.find((project) => project.name === "gone")?.id).toBe("gone");
  });

  it("upgrades to the git remote id when a remote is available", async () => {
    await execFileAsync("git", ["init", "-q", projectRoot]);
    await execFileAsync("git", [
      "-C",
      projectRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:acme/demo.git",
    ]);
    await writeLegacyConfig(legacyConfig([{ id: "demo", path: projectRoot }]));

    const config = await readConfig();
    expect(config.projects[0]?.id).toBe("github.com/acme/demo");
  });
});

describe("console deep links", () => {
  const projectId = "github.com/chitootoo/agentxagent";

  it("encodes a portable project id into one path segment", () => {
    expect(projectLink(projectId)).toBe("/projects/github.com%2Fchitootoo%2Fagentxagent");
  });

  it("encodes both the project and task segments", () => {
    expect(taskLink(projectId, "024")).toBe(
      "/projects/github.com%2Fchitootoo%2Fagentxagent/tasks/024",
    );
  });

  it("encodes local ids as well", () => {
    expect(projectLink("local:9f3c")).toBe("/projects/local%3A9f3c");
  });
});

describe("activity log", () => {
  const entry = (action: string) => ({
    projectId: "github.com/acme/demo",
    taskId: "001",
    taskTitle: "Demo",
    action,
    actor: "alice",
  });

  it("stores human-readable JSONL entries under AXA_HOME", async () => {
    await appendActivityEntry(entry("create"));
    await appendActivityEntry(entry("claim"));

    const raw = await readFile(getActivityLogPath(), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(raw.trim().split("\n")[0] ?? "")).toMatchObject(entry("create"));
    const entries = await readActivityEntries();
    expect(entries.map((e) => [e.id, e.action])).toEqual([
      [1, "create"],
      [2, "claim"],
    ]);
    expect(entries[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("skips malformed lines and reports source size", async () => {
    await appendActivityEntry(entry("create"));
    const path = getActivityLogPath();
    const before = await getActivityLogSize();
    await writeFile(path, `${await readFile(path, "utf8")}not json\n`, "utf8");
    expect(await getActivityLogSize()).toBeGreaterThan(before);
    expect(await readActivityEntries()).toHaveLength(1);
  });
});

describe("prompt templates", () => {
  it("renders named placeholders and leaves unknown ones visible", () => {
    expect(renderPrompt("任务 {{task_id}} 已完成，{{missing}}", { task_id: "031" })).toBe(
      "任务 031 已完成，{{missing}}",
    );
  });

  it("renders the shared task-completed note from the md template", () => {
    const note = renderTaskCompletedNote({
      taskId: "031",
      taskTitle: "优化 prompt",
      taskStatus: "done",
      projectId: "github.com/acme/demo",
    });
    expect(note).toContain("任务 031「优化 prompt」已完成（状态：done）");
    expect(note).toContain("`github.com/acme/demo`");
    expect(note).not.toContain("{{");
  });
});
