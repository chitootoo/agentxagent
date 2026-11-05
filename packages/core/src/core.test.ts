import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptTask,
  approveTask,
  claimTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  initProject,
  listRegisteredProjects,
  listTasks,
  parseTaskDocument,
  readConfig,
  readProjectInfo,
  reclaimStaleTasks,
  registerProject,
  releaseTask,
  removeRegisteredProject,
  resolveCliProject,
  scanTasks,
  toAbsolutePath,
  updateTask,
} from "./index.js";

let workspace: string;
let projectRoot: string;
let axaHome: string;

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

describe("task documents", () => {
  it("creates parseable tasks, sorts by priority, and filters", async () => {
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
    expect(low.filename).toBe("001_P2_Polish_the_board.md");
    expect(high.filename).toBe("002_P0_Fix_the_core_lock.md");

    const tasks = await listTasks(projectRoot);
    expect(tasks.map((task) => task.id)).toEqual(["002", "001"]);

    const todo = await listTasks(projectRoot, { statuses: ["todo"] });
    expect(todo).toHaveLength(1);
    expect(todo[0]?.body).toContain("No duplicate claims.");

    const raw = await readFile(high.filePath, "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    const persisted = parseTaskDocument(raw).data;
    expect(persisted).toMatchObject({ title: "Fix the core lock" });
    expect(persisted).not.toHaveProperty("id");
    expect(persisted).not.toHaveProperty("priority");
    expect(persisted).not.toHaveProperty("status");
  });

  it("ignores redundant id, priority, and status fields in frontmatter", async () => {
    const filename = "011_P2_Path_wins.md";
    await writeFile(
      join(projectRoot, ".axa", "tasks", "todo", filename),
      "---\nid: '999'\npriority: P0\nstatus: done\ntitle: Path wins\n---\n\nBody.\n",
      "utf8",
    );

    const task = await getTask(projectRoot, "11");
    expect(task.id).toBe("011");
    expect(task.priority).toBe("P2");
    expect(task.status).toBe("todo");
    expect(task.extra).not.toHaveProperty("id");
    expect(task.extra).not.toHaveProperty("priority");
    expect(task.extra).not.toHaveProperty("status");
  });

  it("updates the title and body without moving the task file", async () => {
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
    expect(updated.filePath).toBe(created.filePath);
    expect(updated.title).toBe("Edited title");
    expect(updated.body).toBe("## Edited\n\nNew body.");

    const persisted = parseTaskDocument(await readFile(created.filePath, "utf8"));
    expect(persisted.data).toMatchObject({ title: "Edited title" });

    await expect(
      updateTask({ projectRoot, taskId: created.id, title: "  ", body: "" }),
    ).rejects.toMatchObject({ code: "INVALID_TASK" });
  });

  it("updates priority, tags, and extra frontmatter and renames the file", async () => {
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
    expect(updated.filename).toBe("001_P2_Original_title.md");
    expect(updated.filePath).not.toBe(created.filePath);
    expect(updated.extra).toEqual({ assignee: "alice" });

    const persisted = parseTaskDocument(await readFile(updated.filePath, "utf8"));
    expect(persisted.data).toMatchObject({
      title: "Original title",
      tags: ["ui", "docs"],
      assignee: "alice",
    });
    expect(persisted.data).not.toHaveProperty("priority");
    expect(persisted.data).not.toHaveProperty("status");
    expect(persisted.data).not.toHaveProperty("id");
  });

  it("deletes a task file", async () => {
    const created = await createTask({
      projectRoot,
      title: "Remove me",
      status: "todo",
    });

    const deleted = await deleteTask(projectRoot, created.id);
    expect(deleted.id).toBe(created.id);
    await expect(getTask(projectRoot, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("supports hand-written files without frontmatter", async () => {
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
  });

  it("reports malformed task documents as issues", async () => {
    await writeFile(
      join(projectRoot, ".axa", "tasks", "todo", "010_P1_Broken.md"),
      "---\ntitle: [not yaml\n---\n",
      "utf8",
    );

    const result = await scanTasks(projectRoot, { statuses: ["todo"] });
    expect(result.tasks).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.filePath).toContain("010_P1_Broken.md");
  });
});

describe("task lifecycle", () => {
  it("approves, claims, and completes a task", async () => {
    const created = await createTask({
      projectRoot,
      title: "Implement lifecycle",
      priority: "P0",
      actor: "human",
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

    const content = await readFile(claimed.filePath, "utf8");
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await writeFile(
      claimed.filePath,
      content.replace(/claimed_at: .*/u, `claimed_at: "${oldDate}"`),
      "utf8",
    );

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

  it("defaults reviewRequired to false and omits the frontmatter key", async () => {
    const created = await createTask({ projectRoot, title: "Plain task", status: "todo" });
    expect(created.reviewRequired).toBe(false);
    const persisted = parseTaskDocument(await readFile(created.filePath, "utf8"));
    expect(persisted.data).not.toHaveProperty("review_required");
  });

  it("persists review_required as a core frontmatter field, not extra", async () => {
    const created = await createTask({
      projectRoot,
      title: "Needs human review",
      status: "todo",
      reviewRequired: true,
    });
    expect(created.reviewRequired).toBe(true);
    expect(created.extra).not.toHaveProperty("review_required");
    const persisted = parseTaskDocument(await readFile(created.filePath, "utf8"));
    expect(persisted.data).toMatchObject({ review_required: true });
  });

  it("completes straight to done when review is not required", async () => {
    const claimed = await claimableReviewTask(false);
    const done = await completeTask(projectRoot, claimed.id, "worker-a");
    expect(done.status).toBe("done");
    expect(done.filePath).toContain("/done/");
  });

  it("moves review-required tasks from doing to review on completion", async () => {
    const claimed = await claimableReviewTask(true);
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

  it("accepts a review task into done and records the reviewer", async () => {
    const claimed = await claimableReviewTask(true);
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

  it("toggles reviewRequired off and removes the frontmatter key", async () => {
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
    const persisted = parseTaskDocument(await readFile(updated.filePath, "utf8"));
    expect(persisted.data).not.toHaveProperty("review_required");
  });

  it("counts review tasks in project info", async () => {
    const claimed = await claimableReviewTask(true);
    await completeTask(projectRoot, claimed.id, "worker-a");
    const info = await readProjectInfo(projectRoot);
    expect(info.counts.review).toBe(1);
    expect(info.counts.done).toBe(0);
    expect(info.total).toBe(1);
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
