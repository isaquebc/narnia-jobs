import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import {
  createFactChangeRun,
  FactChangeError,
  factChangeText,
  planFactChange,
} from "../../src/ingest/fact-change";
import { syncRunNotifications } from "../../src/ingest/notify";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): o recrutador nunca grava o fato; a alteração vira
 * uma ingestão cuja fonte é o registro dela (antes, depois, motivo e o pedido literal do usuário) e só vale depois da
 * aprovação. Fica pendente em Pendências enquanto o usuário não decidir.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  const session = repos.chatSessions.create({
    profileId: null,
    category: "career",
    title: "Conversa",
    provider: "mock",
    model: "sonnet",
  });
  repos.chatMessages.add({
    sessionId: session.id,
    turnIndex: 0,
    role: "user",
    contentMd: "Na verdade eu era Tech Lead lá, não engenheiro.   Pode corrigir?",
    toolCalls: [],
    usage: null,
  });
  return { repos, ids, sessionId: session.id };
}

function fileFor(repos: Repos, text: string) {
  return repos.sourceFiles.insert({
    originalName: "alteracao.md",
    mime: "text/plain",
    size: text.length,
    sha256: `sha-${text.length}-${Math.random()}`,
    path: "uploads/alteracao.md",
    kind: "text",
  });
}

describe("alteração de fato pela conversa", () => {
  it("planeja: antes e depois por campo, o fato inteiro na proposta e o pedido conferido na conversa", () => {
    const { repos, ids, sessionId } = setup();
    const id = ids.experienceIds[0] as string;
    const before = repos.facts.experiences.get(id);
    const plan = planFactChange(
      repos,
      {
        kind: "experience",
        id,
        changes: { title: "Tech Lead" },
        reason: "O usuário corrigiu o cargo.",
        quote: "Na verdade eu era Tech Lead lá, não engenheiro. Pode corrigir?",
      },
      { sessionId },
    );
    expect(plan.change).toMatchObject({
      kind: "experience",
      factId: id,
      changes: [{ field: "title", before: before?.title, after: "Tech Lead" }],
      quoteFound: true,
    });
    expect(plan.change.label).toContain(before?.company as string);
    expect(plan.proposal).toMatchObject({
      kind: "experience",
      data: { company: before?.company, title: "Tech Lead", startDate: before?.startDate },
    });
    const text = factChangeText(plan, "2026-10-23T12:00:00.000Z");
    expect(text).toContain("Tech Lead");
    expect(text).toContain(before?.title as string);
    expect(text).toContain("Na verdade eu era Tech Lead lá");
  });

  it("recusa: fato inexistente, campo desconhecido, valor inválido, nada muda, pedido fora da conversa", () => {
    const { repos, ids, sessionId } = setup();
    const id = ids.experienceIds[0] as string;
    const base = { kind: "experience" as const, id, reason: "x", quote: "eu era Tech Lead lá" };
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof FactChangeError ? e.code : String(e);
      }
      return "ok";
    };
    expect(
      code(() =>
        planFactChange(repos, { ...base, id: "nao", changes: { title: "A" } }, { sessionId }),
      ),
    ).toBe("fact_not_found");
    expect(
      code(() => planFactChange(repos, { ...base, changes: { salario: 1 } }, { sessionId })),
    ).toBe("invalid_change");
    expect(
      code(() =>
        planFactChange(repos, { ...base, changes: { startDate: "ontem" } }, { sessionId }),
      ),
    ).toBe("invalid_change");
    const current = repos.facts.experiences.get(id)?.title;
    expect(
      code(() => planFactChange(repos, { ...base, changes: { title: current } }, { sessionId })),
    ).toBe("no_change");
    expect(
      code(() =>
        planFactChange(
          repos,
          { ...base, changes: { title: "B" }, quote: "frase que ninguém disse" },
          { sessionId },
        ),
      ),
    ).toBe("quote_not_found");
    // no terminal (modo B) não há conversa para conferir: passa, sem o selo de conferido
    expect(
      planFactChange(
        repos,
        { ...base, changes: { title: "B" }, quote: "qualquer" },
        {
          sessionId: null,
        },
      ).change.quoteFound,
    ).toBe(false);
  });

  it("vira uma ingestão em revisão; aprovar aplica e liga a fonte da conversa; recusar mantém", () => {
    const { repos, ids, sessionId } = setup();
    const id = ids.experienceIds[0] as string;
    const original = repos.facts.experiences.get(id)?.title;
    const plan = planFactChange(
      repos,
      {
        kind: "experience",
        id,
        changes: { title: "Tech Lead" },
        reason: "Corrigiu o cargo.",
        quote: "eu era Tech Lead lá",
      },
      { sessionId },
    );
    const text = factChangeText(plan, "2026-10-23T12:00:00.000Z");
    const run = createFactChangeRun(repos, plan, {
      fileId: fileFor(repos, text).id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      sessionId,
    });
    expect(run).toMatchObject({ status: "review", chatSessionId: sessionId });
    expect(run.params.factChange).toMatchObject({ factId: id, kind: "experience" });
    // o aviso de "ingestão pronta" para a conversa não sai: quem pediu foi a própria conversa
    expect(repos.ingestionRuns.claimChatNotice(run.id)).toBe(false);
    const [p] = repos.proposals.listByRun(run.id);
    expect(p).toMatchObject({
      kind: "experience",
      match: "conflict",
      matchTargetId: id,
      checkStatus: "supported",
      evidence: { quote: "eu era Tech Lead lá" },
      resolution: { title: { choice: "use_new" } },
    });
    expect(p?.conflict?.fields).toEqual([
      expect.objectContaining({ field: "title", current: original, proposed: "Tech Lead" }),
    ]);

    // pendente: um aviso só em Pendências, com o texto da alteração (sem o de conflito)
    const events = syncRunNotifications(repos, run.id);
    const open = events.map((e) => e.notification).filter((n) => n.resolvedAt === null);
    expect(open.map((n) => n.kind)).toEqual(["review.pending"]);
    expect(open[0]?.title).toMatch(/O recrutador quer alterar/);

    const version = repos.settings.getFactsVersion();
    repos.proposals.review(run.id, [{ proposalId: p?.id as string, decision: "accept" }]);
    expect(repos.facts.experiences.get(id)?.title).toBe("Tech Lead");
    expect(repos.settings.getFactsVersion()).toBeGreaterThan(version);
    expect(repos.factSources.listForFact("experience", id).map((s) => s.kind)).toContain("chat");

    const plan2 = planFactChange(
      repos,
      { kind: "experience", id, changes: { title: "CTO" }, reason: "x", quote: "Pode corrigir?" },
      { sessionId },
    );
    const run2 = createFactChangeRun(repos, plan2, {
      fileId: fileFor(repos, "b").id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      sessionId,
    });
    const [p2] = repos.proposals.listByRun(run2.id);
    repos.proposals.review(run2.id, [{ proposalId: p2?.id as string, decision: "reject" }]);
    expect(repos.facts.experiences.get(id)?.title).toBe("Tech Lead");
  });
});
