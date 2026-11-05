import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptTask,
  approveTask,
  claimTask,
  commentTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  initProject,
  listRegisteredProjects,
  listTasks,
  readConfig,
  readProjectInfo,
  reclaimStaleTasks,
  registerProject,
  releaseTask,
  removeRegisteredProject,
  resolveCliProject,
  scanTasks,
  summarizeTask,
  toAbsolutePath,
  updateTask,
} from "./index.js";

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
  it("creates the directory contract and preserves a custom instruction", async () => {
    const instructionPath = join(projectRoot, ".axa", "instruction.md");
    const instruction = await readFile(instructionPath, "utf8");
    expect(instruction).toContain("axa 行动指南");

    await writeFile(instructionPath, "# custom\n", "utf8");
    await initProject({ projectRoot });
    expect(await readFile(instructionPath, "utf8")).toBe("# custom\n");
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

    const claimed = await claimTask({ projectRoot, taskId: task.id, agent: "worker" });
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
      agent: "worker-a",
    });
    expect(claimed.status).toBe("doing");
    expect(claimed.claimedBy).toBe("worker-a");
    expect(claimed.claimedAt).toBeTruthy();
    expect(claimed.filePath).toContain("/doing/");

    await expect(
      claimTask({ projectRoot, taskId: created.id, agent: "worker-b" }),
    ).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });

    const done = await completeTask(projectRoot, created.id, "worker-a");
    expect(done.status).toBe("done");
    expect(done.filePath).toContain("/done/");
    expect(done.extra.completed_by).toBe("worker-a");
  });

  it("releases a claimed task back to todo", async () => {
    const created = await createTask({
      projectRoot,
      title: "Release me",
      status: "todo",
    });
    await claimTask({ projectRoot, taskId: created.id, agent: "worker-a" });

    const released = await releaseTask(projectRoot, created.id);
    expect(released.status).toBe("todo");
    expect(released.claimedBy).toBeUndefined();
    expect(released.claimedAt).toBeUndefined();
  });

  it("rejects invalid transitions", async () => {
    const created = await createTask({ projectRoot, title: "Not approved yet" });
    await expect(claimTask({ projectRoot, taskId: created.id, agent: "a" })).rejects.toMatchObject({
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

    const claimed = await claimTask({ projectRoot, agent: "worker", next: true });
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
        claimTask({ projectRoot, taskId: created.id, agent: `worker-${index}` }),
      ),
    );

    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const task = await getTask(projectRoot, created.id);
    expect(task.status).toBe("doing");
    expect(task.claimedBy).toMatch(/^worker-/);
  });

  it("reclaims tasks whose claim is older than the threshold", async () => {
    const created = await createTask({
      projectRoot,
      title: "Stale task",
      status: "todo",
    });
    const claimed = await claimTask({
      projectRoot,
      taskId: created.id,
      agent: "sleepy-agent",
    });

    const metadataPath = join(claimed.filePath, "task.json");
    const metadata = await readMetadata(claimed.filePath);
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    metadata.claimedAt = oldDate;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const result = await reclaimStaleTasks(projectRoot, 24 * 60 * 60 * 1000);
    expect(result.reclaimed).toHaveLength(1);
    expect(result.reclaimed[0]?.status).toBe("todo");
    expect(result.reclaimed[0]?.claimedBy).toBeUndefined();
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
    return claimTask({ projectRoot, taskId: created.id, agent: "worker-a" });
  }

  it("defaults reviewRequired to true", async () => {
    const created = await createTask({ projectRoot, title: "Plain task", status: "todo" });
    expect(created.reviewRequired).toBe(true);
    const metadata = await readMetadata(created.filePath);
    expect(metadata.reviewRequired).toBe(true);
  });

  it("requires an agent summary before a review-required task can complete", async () => {
    const claimed = await claimableReviewTask(true);
    await expect(completeTask(projectRoot, claimed.id, "worker-a")).rejects.toMatchObject({
      code: "INVALID_TASK",
    });

    const summarized = await summarizeTask(
      projectRoot,
      claimed.id,
      "## 本轮完成\n\n实现并通过测试。",
      "worker-a",
    );
    expect(summarized.conversation.at(-1)?.role).toBe("agent");

    const completed = await completeTask(projectRoot, claimed.id, "worker-a");
    expect(completed.status).toBe("review");
    expect(completed.filePath).toContain("/review/");
    expect(completed.reviewRequired).toBe(true);
    expect(completed.extra.completed_by).toBe("worker-a");
    expect(completed.extra.completed_at).toBeTruthy();

    await expect(
      claimTask({ projectRoot, taskId: claimed.id, agent: "worker-b" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("completes straight to done when review is not required", async () => {
    const claimed = await claimableReviewTask(false);
    const done = await completeTask(projectRoot, claimed.id, "worker-a");
    expect(done.status).toBe("done");
    expect(done.filePath).toContain("/done/");
  });

  it("accepts a review task into done and records the reviewer", async () => {
    const claimed = await claimableReviewTask(true);
    await summarizeTask(projectRoot, claimed.id, "Done.", "worker-a");
    await completeTask(projectRoot, claimed.id, "worker-a");

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
    await summarizeTask(projectRoot, claimed.id, "Done.", "worker-a");
    await completeTask(projectRoot, claimed.id, "worker-a");
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
    await claimTask({ projectRoot, taskId: created.id, agent: "worker-a" });
    await summarizeTask(projectRoot, created.id, "Round one done.", "worker-a");
    const inReview = await completeTask(projectRoot, created.id, "worker-a");
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

    await claimTask({ projectRoot, taskId: created.id, agent: "worker-b" });
    await expect(completeTask(projectRoot, created.id, "worker-b")).rejects.toMatchObject({
      code: "INVALID_TASK",
    });
    await summarizeTask(projectRoot, created.id, "Round two done.", "worker-b");
    const completed = await completeTask(projectRoot, created.id, "worker-b");
    expect(completed.status).toBe("review");
    expect(completed.conversation.map((entry) => entry.seq)).toEqual(["000", "001", "002", "003"]);

    const files = await readdir(completed.filePath);
    expect(files.sort()).toEqual([
      "000_user_Iterate_me.md",
      "001_agent_Round_one_done.md",
      "002_user_请补充错误处理.md",
      "003_agent_Round_two_done.md",
      "task.json",
    ]);
  });

  it("reopens a completed task when the user asks for more work", async () => {
    const created = await createTask({
      projectRoot,
      title: "No review task",
      status: "todo",
      reviewRequired: false,
    });
    await claimTask({ projectRoot, taskId: created.id, agent: "worker" });
    const done = await completeTask(projectRoot, created.id, "worker");
    expect(done.status).toBe("done");

    const reopened = await commentTask(projectRoot, created.id, "再加一个边界用例。");
    expect(reopened.status).toBe("todo");
    expect(reopened.conversation).toHaveLength(2);
  });
});

describe("project registry", () => {
  it("registers, resolves, and removes projects through the config file", async () => {
    const secondRoot = join(workspace, "second");
    await initProject({ projectRoot: secondRoot, name: "Second" });

    const first = await registerProject({ path: projectRoot, name: "Demo" });
    const second = await registerProject({ path: secondRoot, name: "Second" });
    expect(first.id).toBe("demo");
    expect(second.id).toBe("second");

    const config = await readConfig();
    expect(config.projects).toHaveLength(2);
    expect(config.defaultProjectId).toBe("demo");

    const listed = await listRegisteredProjects();
    expect(listed.find((project) => project.id === "second")?.total).toBe(0);

    expect(await resolveCliProject("second")).toBe(secondRoot);

    await removeRegisteredProject("demo");
    const after = await readConfig();
    expect(after.projects.map((project) => project.id)).toEqual(["second"]);
    expect(after.defaultProjectId).toBe("second");
  });

  it("initializes a missing project on demand when registering", async () => {
    const fresh = join(workspace, "fresh");
    const project = await registerProject({
      path: fresh,
      name: "Fresh",
      initialize: true,
    });
    expect(project.id).toBe("fresh");
    expect(await resolveCliProject("fresh")).toBe(fresh);
  });

  it("expands ~ in project paths", () => {
    expect(toAbsolutePath("~")).toBe(homedir());
    expect(toAbsolutePath("~/demo")).toBe(join(homedir(), "demo"));
    expect(toAbsolutePath("  ~/demo  ")).toBe(join(homedir(), "demo"));
  });
});
