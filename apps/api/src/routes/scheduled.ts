import {
  isScheduledTaskId,
  listScheduledTasks,
  type Repos,
  SCHEDULED_RUN_TASK,
  ScheduledTaskError,
  updateScheduledTask,
} from "@narnia-jobs/core";
import { ScheduledTaskPatchSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { QueueAdapter } from "../queue";
import { validate } from "./validate";

/**
 * Tarefas agendadas (F14-12, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.6): quem roda é o worker; aqui a tela lê
 * o estado, muda intervalo e pausa, pede uma execução agora e lê o histórico com log e itens.
 */
export function scheduledRoutes(deps: { repos: Repos; queue: QueueAdapter }) {
  const app = new Hono();

  app.get("/api/scheduled-tasks", (c) => c.json({ tasks: listScheduledTasks(deps.repos) }));

  app.patch("/api/scheduled-tasks/:id", validate("json", ScheduledTaskPatchSchema), (c) => {
    const id = c.req.param("id");
    if (!isScheduledTaskId(id))
      return apiError(c, 404, "not_found", "Tarefa agendada não encontrada");
    try {
      return c.json(updateScheduledTask(deps.repos, id, c.req.valid("json")));
    } catch (e) {
      if (e instanceof ScheduledTaskError) return apiError(c, 422, e.code, e.message);
      throw e;
    }
  });

  app.post("/api/scheduled-tasks/:id/run", async (c) => {
    const id = c.req.param("id");
    if (!isScheduledTaskId(id))
      return apiError(c, 404, "not_found", "Tarefa agendada não encontrada");
    const { job, enqueued } = await deps.queue.enqueueTask({
      queue: "scheduled",
      type: SCHEDULED_RUN_TASK,
      key: id,
      payload: { taskId: id, trigger: "manual" },
    });
    // revisão do M1: `enqueued: false` = já havia uma execução da tarefa na fila ou rodando
    return c.json({ jobId: job.id, enqueued }, 202);
  });

  app.get("/api/scheduled-tasks/:id/runs", (c) => {
    const id = c.req.param("id");
    if (!isScheduledTaskId(id))
      return apiError(c, 404, "not_found", "Tarefa agendada não encontrada");
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    return c.json({ runs: deps.repos.scheduled.runs(id, limit) });
  });

  app.get("/api/scheduled-runs/:id", (c) => {
    const run = deps.repos.scheduled.run(c.req.param("id"));
    return run ? c.json(run) : apiError(c, 404, "not_found", "Execução não encontrada");
  });

  return app;
}
