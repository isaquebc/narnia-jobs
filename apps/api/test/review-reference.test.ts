import { applyReconciliation, seedFixture } from "@narnia-jobs/core";
import type { FactProposal } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * Revisão (pedido do dono, 2026-10-14): todo card diz onde o fato entra (informação pessoal, experiência, projeto…),
 * a conquista diz de qual experiência é, e a ingestão diz de onde veio (texto, arquivo, conversa).
 */
const acmeAgain: FactProposal = {
  kind: "experience",
  confidence: 0.9,
  data: {
    company: "Acme Pagamentos",
    title: "Engenheira de Software Sênior",
    startDate: "2023-02",
    isCurrent: true,
    tech: [],
  },
};
const zeta: FactProposal = {
  kind: "experience",
  confidence: 0.9,
  data: {
    company: "Zeta Bank",
    title: "Tech Lead",
    startDate: "2018-01",
    endDate: "2019-12",
    isCurrent: false,
    tech: [],
  },
};
const ach = (data: Record<string, unknown>): FactProposal =>
  ({
    kind: "achievement",
    confidence: 0.8,
    data: { text: "Liderou 7 pessoas", ...data },
  }) as FactProposal;

type Detail = {
  origin: { name: string | null; excerpt: string | null; chatTitle: string | null };
  profileExperiences: Array<{ id: string; label: string }>;
  proposals: Array<{
    id: string;
    proposal: FactProposal;
    reference?: {
      existing: string | null;
      experience: {
        source: "profile" | "run";
        label: string;
        experienceId?: string | null;
        proposalId?: string | null;
        experienceIndex?: number | null;
      } | null;
    };
  }>;
};

describe("referência de cada card e origem da ingestão", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("conquista diz a experiência (do perfil ou desta ingestão); fato repetido diz qual fato do perfil; origem do texto e da conversa", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const [acme, beta] = ids.experienceIds as [string, string];
    const file = t.repos.sourceFiles.insert({
      mime: "text/plain",
      size: 10,
      sha256: "r".repeat(64),
      path: "uploads/r.txt",
      kind: "text",
    });
    const run = t.repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    const session = t.repos.chatSessions.create({
      category: "career",
      profileId: ids.profileId,
      title: "Liderança na Acme",
      provider: "mock",
      model: "sonnet",
    });
    t.repos.ingestionRuns.linkChat(run.id, session.id);
    t.repos.readings.replaceSegments(run.id, [
      {
        index: 0,
        sectionHint: null,
        text: "Na   Acme Pagamentos eu liderei um time de 7 pessoas e montei o plantão de incidentes, além de cuidar do onboarding dos estagiários de verão.",
        origin: "text_layer",
        agreement: 1,
        divergences: [],
      },
    ]);
    t.repos.proposals.insertMany(run.id, [
      { kind: "identity", confidence: 0.9, data: { city: "Campinas" } },
      acmeAgain,
      zeta,
      ach({ experienceIndex: 0 }),
      ach({ experienceIndex: 1, text: "Criou o time de dados" }),
      ach({ experienceId: beta, text: "Montou o plantão" }),
      ach({ text: "Cuidou do onboarding" }),
      { kind: "skill", confidence: 0.8, data: { name: "Go", category: "language" } },
      { kind: "link", confidence: 1, data: { label: "Blog", url: "https://blog.example.com" } },
      { kind: "project", confidence: 0.8, data: { name: "Radar", tech: [] } },
    ]);
    applyReconciliation(t.repos, run.id, new Date("2026-10-01T00:00:00Z"));
    t.repos.ingestionRuns.setStatus(run.id, "review");

    const res = await t.api(`/api/ingestions/${run.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Detail;
    expect(body.origin).toEqual({
      name: null,
      excerpt: expect.stringMatching(/^Na Acme Pagamentos eu liderei um time de 7 pessoas.*…$/),
      chatTitle: "Liderança na Acme",
    });
    expect(body.origin.excerpt?.length).toBeLessThanOrEqual(121);
    expect(body.profileExperiences.map((e) => e.id)).toContain(acme);
    expect(body.profileExperiences.find((e) => e.id === acme)?.label).toBe(
      "Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual",
    );

    const ref = (i: number) => body.proposals[i]?.reference;
    // identidade: só onde entra (o tipo basta); nada a ligar
    expect(ref(0)).toEqual({ existing: null, experience: null });
    // experiência repetida: diz qual do perfil
    expect(ref(1)?.existing).toBe(
      "Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual",
    );
    expect(ref(2)?.existing).toBeNull();
    // conquista da experiência repetida → a do perfil
    expect(ref(3)?.experience).toMatchObject({
      source: "profile",
      experienceId: acme,
      proposalId: body.proposals[1]?.id,
      label: "Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual",
    });
    // conquista da experiência nova desta ingestão
    expect(ref(4)?.experience).toMatchObject({
      source: "run",
      proposalId: body.proposals[2]?.id,
      experienceIndex: 1,
      label: "Tech Lead · Zeta Bank · 2018-01–2019-12",
    });
    // ligada direto a uma experiência do perfil
    expect(ref(5)?.experience).toMatchObject({ source: "profile", experienceId: beta });
    // sem experiência: a revisão pede para escolher
    expect(ref(6)?.experience).toBeNull();
    // skill que já está no perfil
    expect(ref(7)?.existing).toBe("Go");
  });

  it("arquivo: a origem é o nome do arquivo; sem conversa", async () => {
    t = makeTestApp();
    const file = t.repos.sourceFiles.insert({
      originalName: "cv-2026.pdf",
      mime: "application/pdf",
      size: 10,
      sha256: "f".repeat(64),
      path: "uploads/f.pdf",
      kind: "cv",
    });
    const run = t.repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    const body = (await (await t.api(`/api/ingestions/${run.id}`)).json()) as Detail;
    expect(body.origin).toEqual({ name: "cv-2026.pdf", excerpt: null, chatTitle: null });
  });
});
