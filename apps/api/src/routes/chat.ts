import type { Repos } from "@narnia-jobs/core";
import {
  ChatReadRequestSchema,
  ChatSendRequestSchema,
  ChatSessionCreateRequestSchema,
  ChatSessionPatchRequestSchema,
} from "@narnia-jobs/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { SessionLimitError, type SessionManager, SessionStateError } from "../chat/session-manager";
import { apiError } from "../errors";
import { validate } from "./validate";

const STATUS: Record<SessionStateError["code"], 404 | 409> = {
  session_not_found: 404,
  turn_in_progress: 409,
  session_archived: 409,
  no_profile: 409,
  budget_exhausted: 409,
  posting_not_found: 404,
  document_not_found: 404,
  application_not_found: 404,
  job_application_not_found: 404,
  busy: 409,
};

function sessionError(c: Context, e: unknown) {
  if (e instanceof SessionLimitError)
    return apiError(c, 409, "session_limit", e.message, { max: e.max, live: e.live });
  if (e instanceof SessionStateError) return apiError(c, STATUS[e.code], e.code, e.message);
  throw e;
}

/** Rotas do chat (F04 §2.5, M3): sessões, mensagens, controle, clarificação e fontes pesquisadas. */
export function chatRoutes(deps: { repos: Repos; sessions: SessionManager }) {
  const app = new Hono();
  const { sessions, repos } = deps;

  app.post("/api/sessions", validate("json", ChatSessionCreateRequestSchema), (c) => {
    try {
      const b = c.req.valid("json");
      return c.json(
        {
          session: sessions.create({
            category: b.category,
            ...(b.profileId ? { profileId: b.profileId } : {}),
            ...(b.model ? { model: b.model } : {}),
            ...(b.title ? { title: b.title } : {}),
          }),
        },
        201,
      );
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.get("/api/sessions", (c) => {
    const profileId = c.req.query("profile");
    const includeArchived = c.req.query("archived") === "1";
    return c.json({
      sessions: repos.chatSessions
        .list({ ...(profileId ? { profileId } : {}), includeArchived })
        .map((s) => sessions.withBusy(s)),
    });
  });

  app.get("/api/sessions/:id", (c) => {
    try {
      return c.json({ session: sessions.get(c.req.param("id")) });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.patch("/api/sessions/:id", validate("json", ChatSessionPatchRequestSchema), async (c) => {
    try {
      return c.json({ session: await sessions.patch(c.req.param("id"), c.req.valid("json")) });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.delete("/api/sessions/:id", (c) => {
    try {
      sessions.remove(c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.get(
    "/api/sessions/:id/messages",
    validate(
      "query",
      z.object({
        before: z.string().optional(),
        since: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    ),
    (c) => {
      try {
        const id = c.req.param("id");
        sessions.get(id);
        const q = c.req.valid("query");
        return c.json({
          messages: repos.chatMessages.list(id, {
            ...(q.before ? { before: q.before } : {}),
            ...(q.since ? { since: q.since } : {}),
            ...(q.limit ? { limit: q.limit } : {}),
          }),
        });
      } catch (e) {
        return sessionError(c, e);
      }
    },
  );

  app.post("/api/sessions/:id/messages", validate("json", ChatSendRequestSchema), (c) => {
    try {
      return c.json(sessions.send(c.req.param("id"), c.req.valid("json").text), 202);
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.post("/api/sessions/:id/read", validate("json", ChatReadRequestSchema), (c) => {
    try {
      return c.json({
        session: sessions.markRead(c.req.param("id"), c.req.valid("json").messageId),
      });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.post("/api/sessions/:id/interrupt", async (c) => {
    try {
      await sessions.interrupt(c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.post("/api/sessions/:id/hibernate", (c) => {
    try {
      return c.json({ session: sessions.hibernate(c.req.param("id")) });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.post("/api/sessions/:id/wake", (c) => {
    try {
      return c.json({ session: sessions.wake(c.req.param("id")) });
    } catch (e) {
      return sessionError(c, e);
    }
  });

  // F06 §1.1: conversa própria da análise da vaga (título da vaga, categoria job), já com o pedido de análise
  app.post("/api/postings/:id/analyze", (c) => {
    try {
      return c.json({ session: sessions.openPostingAnalysis(c.req.param("id")) }, 201);
    } catch (e) {
      return sessionError(c, e);
    }
  });

  // página da vaga › assets: "Regerar com mensagem" abre a conversa da vaga com o documento no contexto
  app.post(
    "/api/documents/:id/feedback",
    validate("json", z.object({ message: z.string().trim().min(1).max(4000) })),
    (c) => {
      try {
        const { message } = c.req.valid("json");
        return c.json({ session: sessions.openDocumentFeedback(c.req.param("id"), message) }, 201);
      } catch (e) {
        return sessionError(c, e);
      }
    },
  );

  // F12/M5: conversa do formulário na janela da extensão; a primeira mensagem cria, as próximas seguem nela
  app.post(
    "/api/applications/:id/chat",
    validate("json", z.object({ message: z.string().trim().min(1).max(4000) })),
    (c) => {
      try {
        const { message } = c.req.valid("json");
        return c.json({ session: sessions.openApplicationChat(c.req.param("id"), message) }, 201);
      } catch (e) {
        return sessionError(c, e);
      }
    },
  );

  // F07/M6: conversa sobre a candidatura; a primeira mensagem cria, as próximas seguem nela
  app.post(
    "/api/job-applications/:id/chat",
    validate("json", z.object({ message: z.string().trim().min(1).max(4000) })),
    (c) => {
      try {
        const { message } = c.req.valid("json");
        return c.json(
          { session: sessions.openJobApplicationChat(c.req.param("id"), message) },
          201,
        );
      } catch (e) {
        return sessionError(c, e);
      }
    },
  );

  // F04 §2.8: sessão de clarificação ligada à execução; as correções viram propostas no próprio run
  app.post("/api/ingestions/:id/clarify", (c) => {
    const run = repos.ingestionRuns.get(c.req.param("id"));
    if (!run) return apiError(c, 404, "run_not_found", "Ingestão não encontrada");
    try {
      return c.json(
        {
          session: sessions.create({
            category: "clarify",
            ingestionRunId: run.id,
            title: "Clarificar ingestão",
          }),
        },
        201,
      );
    } catch (e) {
      return sessionError(c, e);
    }
  });

  app.get("/api/research", (c) => {
    const profileId = c.req.query("profile");
    return c.json({ sources: repos.researchSources.list(profileId ? { profileId } : {}) });
  });

  return app;
}
