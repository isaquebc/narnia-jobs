import { answerableQuestions, type Repos } from "@narnia-jobs/core";
import { ApplicationAnswerEditSchema, ApplicationPatchSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { applicationView, enqueueAnswers, enqueueLocate } from "../services/applications";
import { validate } from "./validate";

/**
 * Formulário de candidatura lido pela extensão (F12/M3, §4.8): a janela lê as perguntas e pode pedir para ler de novo
 * (depois de um erro, ou com o formulário mudado).
 */
export function applicationsRoutes(deps: {
  repos: Repos;
  queue?: QueueAdapter | undefined;
  bus?: EventBus | undefined;
}) {
  const app = new Hono();

  app.get("/api/applications/:id", (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    return c.json({ application: applicationView(deps.repos, f) });
  });

  // ligar o formulário à vaga certa quando a busca automática não achou (ou achou outra)
  app.patch("/api/applications/:id", validate("json", ApplicationPatchSchema), async (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    const { postingId } = c.req.valid("json");
    if (postingId && !deps.repos.postings.get(postingId))
      return apiError(c, 404, "posting_not_found", "Vaga não encontrada");
    deps.repos.applications.setPosting(f.id, postingId);
    // vaga ligada a um formulário pronto: as respostas sugeridas vêm agora (F12-11, F12/M4)
    if (postingId && f.status === "ready" && answerableQuestions(f.questions).length && deps.queue)
      await enqueueAnswers(deps.repos, deps.queue, f.id);
    deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    return c.json({
      application: applicationView(deps.repos, deps.repos.applications.get(f.id) as typeof f),
    });
  });

  // gerar (de novo) as respostas sugeridas
  app.post("/api/applications/:id/answers", async (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    if (!f.postingId)
      return apiError(
        c,
        422,
        "no_posting",
        "Ligue o formulário a uma vaga salva antes: as respostas usam a descrição da vaga.",
      );
    if (!deps.queue) return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    const job = await enqueueAnswers(deps.repos, deps.queue, f.id);
    deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    return c.json({ job }, 202);
  });

  // a pessoa editou a resposta na janela antes de preencher (F12-19): versão nova, que gerar de novo não refaz
  app.put(
    "/api/applications/:id/answers/:questionId",
    validate("json", ApplicationAnswerEditSchema),
    (c) => {
      const f = deps.repos.applications.get(c.req.param("id"));
      if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
      const q = f.questions.find((x) => x.id === c.req.param("questionId"));
      if (!q) return apiError(c, 404, "question_not_found", "Pergunta não encontrada");
      if (q.kind === "consent" || q.kind === "self_declaration" || q.kind === "file")
        return apiError(
          c,
          422,
          "not_editable",
          "Consentimento, autodeclaração e anexo ficam com você, direto no formulário.",
        );
      deps.repos.applications.addAnswers(f.id, [
        {
          questionId: q.id,
          answer: c.req.valid("json").answer,
          origins: [],
          gap: null,
          assumptions: [],
          source: "edited",
        },
      ]);
      deps.bus?.emit({ type: "application.updated", applicationId: f.id });
      return c.json({ application: applicationView(deps.repos, f) });
    },
  );

  app.post("/api/applications/:id/locate", async (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    if (!deps.queue) return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    deps.repos.applications.setLocating(f.id);
    const job = await enqueueLocate(deps.queue, f.id);
    deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    return c.json({ job }, 202);
  });

  return app;
}
