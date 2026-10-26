import { APPLICATION_TOOLS, type ApplicationToolName } from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { declarationAnswer, PREFER_NOT } from "./self-declaration";

/**
 * Handlers das tools do formulário (F12/M5). `application.answer_save` vale as mesmas travas da edição na janela
 * (F12-19): consentimento, autodeclaração e anexo ficam com a pessoa (F12-12); escolha só entre as opções da página;
 * texto dentro do limite. A versão nova tem origem `chat`, e gerar as respostas de novo não a sobrescreve.
 */
type In<N extends ApplicationToolName> = z.infer<(typeof APPLICATION_TOOLS)[N]["input"]>;
type Out<N extends ApplicationToolName> = z.infer<(typeof APPLICATION_TOOLS)[N]["output"]>;
export type ApplicationToolHandlers = {
  [N in ApplicationToolName]: (input: unknown) => Promise<Out<N>>;
};

export interface ApplicationToolPorts {
  /** Resposta gravada: a api avisa a janela (`application.updated`). */
  changed?(applicationId: string): void;
  /** Vaga ligada a um formulário pronto: a api enfileira as respostas sugeridas (F12-11). */
  requestAnswers?(applicationId: string): Promise<void>;
}

export class ApplicationToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const LOCKED = new Set(["consent", "self_declaration", "file"]);

export function createApplicationTools(
  repos: Repos,
  ctx: { ports: ApplicationToolPorts; sessionId?: string | null | undefined },
): ApplicationToolHandlers {
  const wrap = <N extends ApplicationToolName>(
    name: N,
    impl: (input: In<N>) => Out<N> | Promise<Out<N>>,
  ) => {
    const def = APPLICATION_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(await impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };
  const must = (id: string) => {
    const f = repos.applications.get(id);
    if (!f) throw new ApplicationToolError("not_found", `Formulário não encontrado: ${id}`);
    return f;
  };

  return {
    "application.list": wrap("application.list", (i) => ({
      items: repos.applications.listRecent(i.limit ?? 5).map((f) => ({
        applicationId: f.id,
        url: f.url,
        title: f.title,
        postingId: f.postingId,
        status: f.status,
        updatedAt: f.updatedAt,
      })),
    })),
    "application.link_posting": wrap("application.link_posting", async (i) => {
      const f = must(i.applicationId);
      if (!repos.postings.get(i.postingId))
        throw new ApplicationToolError("posting_not_found", `Vaga não encontrada: ${i.postingId}`);
      repos.applications.setPosting(f.id, i.postingId);
      // a conversa do formulário passa a ser a da vaga também (contexto e menu)
      const s = ctx.sessionId ? repos.chatSessions.get(ctx.sessionId) : null;
      if (s && s.category === "job" && !s.postingId)
        repos.chatSessions.setPosting(s.id, i.postingId);
      const answersRequested = f.status === "ready" && Boolean(ctx.ports.requestAnswers);
      if (answersRequested) await ctx.ports.requestAnswers?.(f.id);
      ctx.ports.changed?.(f.id);
      return { applicationId: f.id, postingId: i.postingId, answersRequested };
    }),
    "self_declaration.list": wrap("self_declaration.list", () => ({
      items: repos.selfDeclarations.list().map((d) => ({
        topic: d.topic,
        value: d.value === PREFER_NOT ? null : d.value,
        preferNotToSay: d.value === PREFER_NOT,
      })),
    })),
    "self_declaration.save": wrap("self_declaration.save", (i) => {
      repos.selfDeclarations.set(i.topic, i.preferNotToSay ? PREFER_NOT : (i.value as string));
      return { topic: i.topic };
    }),
    "application.get": wrap("application.get", (i) => {
      const f = must(i.applicationId);
      const answers = repos.applications.latestAnswers(f.id);
      return {
        applicationId: f.id,
        url: f.url,
        title: f.title,
        postingId: f.postingId,
        questions: f.questions.map((q) => {
          const a = answers.find((x) => x.questionId === q.id);
          const declared = q.kind === "self_declaration" && q.topic !== null;
          return {
            questionId: q.id,
            question: q.question,
            kind: q.kind,
            required: q.required,
            options: q.options.map((o) => o.label),
            maxChars: q.maxChars,
            answer: declared ? declarationAnswer(repos, q) : (a?.answer ?? null),
            source: a?.source ?? null,
            gap: a?.gap ?? null,
            editable: !LOCKED.has(q.kind),
            declared: declared && repos.selfDeclarations.get(q.topic as never) !== null,
          };
        }),
      };
    }),
    "application.answer_save": wrap("application.answer_save", (i) => {
      const f = must(i.applicationId);
      const q = f.questions.find((x) => x.id === i.questionId);
      if (!q) throw new ApplicationToolError("question_not_found", "Pergunta não encontrada.");
      if (LOCKED.has(q.kind))
        throw new ApplicationToolError(
          "not_editable",
          "Consentimento, autodeclaração e anexo: a resposta fica com a pessoa, direto no formulário.",
        );
      let answer = i.answer.trim();
      if (q.options.length > 0) {
        // escolha: cada parte tem de ser uma opção da página; grava o rótulo como está na página
        const labels = q.options.map((o) => o.label);
        const picked = answer.split(";").map((part) => {
          const p = part.trim().toLowerCase();
          return q.options.find((o) => o.label.toLowerCase() === p || o.value.toLowerCase() === p);
        });
        if (picked.some((o) => !o))
          throw new ApplicationToolError(
            "invalid_option",
            `Use o texto exato de uma opção: ${labels.join("; ")}.`,
          );
        answer = picked.map((o) => o?.label).join("; ");
      }
      if (q.maxChars && answer.length > q.maxChars)
        throw new ApplicationToolError(
          "too_long",
          `A resposta tem ${answer.length} caracteres e o campo aceita ${q.maxChars}: encurte e grave de novo.`,
        );
      repos.applications.addAnswers(f.id, [
        { questionId: q.id, answer, origins: [], gap: null, assumptions: [], source: "chat" },
      ]);
      ctx.ports.changed?.(f.id);
      const version =
        repos.applications.latestAnswers(f.id).find((a) => a.questionId === q.id)?.version ?? 1;
      return { questionId: q.id, version };
    }),
  };
}
