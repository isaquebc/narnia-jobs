import { answerProfileId, assumptionAsMotivation, type Repos } from "@narnia-jobs/core";
import {
  AssumptionDecisionSchema,
  MotivationCreateSchema,
  MotivationPatchSchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import {
  applicationView,
  enqueueAnswers,
  enqueueMotivations,
  suggestingMotivations,
} from "../services/applications";
import { validate } from "./validate";

/**
 * Motivações do perfil (F12-23, pedido do dono 2026-10-26): o que move a pessoa, decidido por ela. Recusar guarda a
 * frase (não volta) e pede outra no lugar; revisar libera as respostas dos formulários que esperavam. Na janela do
 * formulário, as suposições do roleplay também são decididas aqui: aceitar vira motivação; recusar refaz a pergunta.
 */
export function motivationsRoutes(deps: {
  repos: Repos;
  queue?: QueueAdapter | undefined;
  bus?: EventBus | undefined;
}) {
  const app = new Hono();
  const { repos } = deps;
  const changed = (profileId: string) =>
    deps.bus?.emit({ type: "profile.motivations.updated", profileId });

  app.get("/api/profiles/:id/motivations", (c) => {
    const profileId = c.req.param("id");
    if (!repos.profiles.get(profileId))
      return apiError(c, 404, "not_found", "Perfil não encontrado");
    return c.json({
      items: repos.profileMotivations.list(profileId),
      reviewed: repos.profileMotivations.reviewedAt(profileId) !== null,
      suggesting: suggestingMotivations(repos, profileId),
    });
  });

  app.post("/api/profiles/:id/motivations/suggest", async (c) => {
    const profileId = c.req.param("id");
    if (!repos.profiles.get(profileId))
      return apiError(c, 404, "not_found", "Perfil não encontrado");
    if (!deps.queue) return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    const job = await enqueueMotivations(deps.queue, profileId);
    changed(profileId);
    return c.json({ job }, 202);
  });

  app.post("/api/profiles/:id/motivations", validate("json", MotivationCreateSchema), (c) => {
    const profileId = c.req.param("id");
    if (!repos.profiles.get(profileId))
      return apiError(c, 404, "not_found", "Perfil não encontrado");
    const motivation = repos.profileMotivations.add({
      profileId,
      text: c.req.valid("json").text,
      status: "accepted",
      source: "user",
    });
    changed(profileId);
    return c.json({ motivation }, 201);
  });

  app.patch(
    "/api/profiles/:id/motivations/:motivationId",
    validate("json", MotivationPatchSchema),
    async (c) => {
      const profileId = c.req.param("id");
      const m = repos.profileMotivations.get(c.req.param("motivationId"));
      if (!m || m.profileId !== profileId)
        return apiError(c, 404, "not_found", "Motivação não encontrada");
      const motivation = repos.profileMotivations.update(m.id, c.req.valid("json"));
      // recusada: fica guardada e outra é sugerida no lugar
      if (motivation.status === "refused" && m.status !== "refused" && deps.queue)
        await enqueueMotivations(deps.queue, profileId, 1);
      changed(profileId);
      return c.json({ motivation });
    },
  );

  // a pessoa revisou (mesmo sem aceitar nenhuma): os formulários que esperavam por este perfil seguem
  app.post("/api/profiles/:id/motivations/review", async (c) => {
    const profileId = c.req.param("id");
    if (!repos.profiles.get(profileId))
      return apiError(c, 404, "not_found", "Perfil não encontrado");
    repos.profileMotivations.markReviewed(profileId);
    for (const f of repos.applications.withAnswersStatus("motivations")) {
      if (answerProfileId(repos, f) !== profileId || !deps.queue) continue;
      await enqueueAnswers(repos, deps.queue, f.id);
      deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    }
    changed(profileId);
    return c.json({ reviewed: true });
  });

  app.post(
    "/api/applications/:id/answers/:questionId/assumptions",
    validate("json", AssumptionDecisionSchema),
    async (c) => {
      const f = repos.applications.get(c.req.param("id"));
      if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
      const questionId = c.req.param("questionId");
      const answer = repos.applications
        .latestAnswers(f.id)
        .find((a) => a.questionId === questionId);
      if (!answer) return apiError(c, 404, "question_not_found", "Resposta não encontrada");
      const { index, action, text } = c.req.valid("json");
      const assumption = answer.assumptions[index];
      if (assumption === undefined)
        return apiError(c, 422, "invalid_assumption", "Suposição não encontrada nesta resposta");
      const profileId = answerProfileId(repos, f);
      if (!profileId) return apiError(c, 422, "no_profile", "Sem perfil para guardar a motivação");
      const status = action === "accept" ? "accepted" : "refused";
      const same = repos.profileMotivations
        .list(profileId)
        .find((m) => m.assumption === assumption);
      const motivationText = text ?? assumptionAsMotivation(assumption);
      if (same) repos.profileMotivations.update(same.id, { text: motivationText, status });
      else
        repos.profileMotivations.add({
          profileId,
          text: motivationText,
          status,
          source: "assumption",
          assumption,
        });
      // recusada: a resposta se apoiava nela; refaz só esta pergunta, já sem ela
      if (status === "refused" && deps.queue)
        await enqueueAnswers(repos, deps.queue, f.id, [questionId]);
      changed(profileId);
      deps.bus?.emit({ type: "application.updated", applicationId: f.id });
      return c.json({
        application: applicationView(repos, repos.applications.get(f.id) as typeof f),
      });
    },
  );

  return app;
}
