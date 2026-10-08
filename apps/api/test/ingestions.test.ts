import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, simulateWorker, type TestApp, uploadFixture } from "./helpers";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M4/api ingestões: criação, acompanhamento e revisão", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("POST /api/ingestions cria o run em queued, grava estimativa/opções e enfileira só a primeira etapa", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const res = await t.api(
      "/api/ingestions",
      json({ fileId: file.id, options: { ocr: false, modelRead: true } }),
    );
    expect(res.status).toBe(201);
    const ing = (await res.json()) as {
      id: string;
      status: string;
      jobs: Array<{ type: string; status: string }>;
    };
    expect(ing.status).toBe("queued");
    expect(ing.jobs).toHaveLength(1);
    expect(ing.jobs[0]).toMatchObject({ type: "ingest.read_text", status: "queued" });
    expect(t.queue.enqueued).toEqual([{ runId: ing.id, stage: "ingest.read_text" }]);
    const run = t.repos.ingestionRuns.get(ing.id);
    expect(run?.options).toEqual({ ocr: false, modelRead: true });
    expect(run?.estimate?.documentTokens).toBeGreaterThan(0);
    expect(run?.models).toEqual({ document: "haiku", facts: "haiku", digest: "sonnet" });
    // o estado do onboarding passa a apontar para o run
    const state = (await (await t.api("/api/onboarding/state")).json()) as {
      runId?: string;
      fileId?: string;
    };
    expect(state.runId).toBe(ing.id);
    expect(state.fileId).toBe(file.id);
  });

  it("fileId inexistente → 404; GET de ingestão inexistente → 404", async () => {
    t = makeTestApp();
    expect((await t.api("/api/ingestions", json({ fileId: "nope" }))).status).toBe(404);
    expect((await t.api("/api/ingestions/nope")).status).toBe(404);
  });

  it("GET /api/ingestions/:id em review traz propostas com origem por trecho, digest, leituras e jobs", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const ing = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
    };
    simulateWorker(t, ing.id);
    const res = await t.api(`/api/ingestions/${ing.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      proposals: Array<{
        id: string;
        proposal: { kind: string };
        decision: string;
        origin: string | null;
      }>;
      digest: { summary: string } | null;
      jobs: Array<{ status: string }>;
      readings: Array<{ kind: string }>;
      segments: Array<{ origin: string }>;
    };
    expect(body.status).toBe("review");
    expect(body.proposals.length).toBeGreaterThan(5);
    const exp = body.proposals.find((p) => p.proposal.kind === "experience");
    expect(exp?.origin).toBe("text_layer");
    const edu = body.proposals.find((p) => p.proposal.kind === "education");
    expect(edu?.origin).toBe("ocr");
    const skill = body.proposals.find((p) => p.proposal.kind === "skill");
    expect(skill?.origin).toBe("consolidated");
    expect(body.digest?.summary).toContain("Ana Maria Exemplo");
    expect(body.jobs.every((j) => j.status === "done")).toBe(true);
    expect(body.readings.map((r) => r.kind)).toEqual(["text_layer"]);
    expect(body.segments).toHaveLength(2);
  });

  it("POST review aplica aceitar/editar/rejeitar, cria fatos verificados, incrementa facts_version e fecha o run quando tudo foi decidido", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const ing = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
    };
    const proposals = simulateWorker(t, ing.id);
    const before = t.repos.settings.getFactsVersion();
    const decisions = proposals.map((p, i) => {
      if (p.kind === "experience" && i === proposals.findIndex((q) => q.kind === "experience")) {
        return {
          proposalId: p.id,
          decision: "edited",
          editedData: { title: "Engenheira Sênior (editado)" },
        };
      }
      if (p.kind === "language") return { proposalId: p.id, decision: "rejected" };
      return { proposalId: p.id, decision: "accepted" };
    });
    const res = await t.api(`/api/ingestions/${ing.id}/review`, json({ decisions }));
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      accepted: number;
      edited: number;
      rejected: number;
      runStatus: string;
    };
    expect(result.edited).toBe(1);
    expect(result.rejected).toBe(2);
    expect(result.accepted).toBeGreaterThan(5);
    expect(result.runStatus).toBe("done");
    expect(t.repos.facts.experiences.list()[0]?.verified).toBe(true);
    expect(t.repos.facts.experiences.list().some((e) => e.title.includes("(editado)"))).toBe(true);
    expect(t.repos.facts.languages.count()).toBe(0);
    expect(t.repos.settings.getFactsVersion()).toBeGreaterThan(before);
    expect(t.repos.users.get()?.email).toBe("ana.exemplo@example.com");
  });

  it("review parcial deixa o run em review; decisão para proposta de outro run → 409; desconhecida → 404; edited sem editedData → 400", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const a = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
    };
    const b = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
    };
    const pa = simulateWorker(t, a.id);
    const pb = simulateWorker(t, b.id);
    const partial = await t.api(
      `/api/ingestions/${a.id}/review`,
      json({ decisions: [{ proposalId: pa[0]?.id, decision: "accepted" }] }),
    );
    expect(partial.status).toBe(200);
    expect(((await partial.json()) as { runStatus: string }).runStatus).toBe("review");
    const foreign = await t.api(
      `/api/ingestions/${a.id}/review`,
      json({ decisions: [{ proposalId: pb[1]?.id, decision: "accepted" }] }),
    );
    expect(foreign.status).toBe(409);
    const unknown = await t.api(
      `/api/ingestions/${a.id}/review`,
      json({ decisions: [{ proposalId: "zzz", decision: "accepted" }] }),
    );
    expect(unknown.status).toBe(404);
    const noData = await t.api(
      `/api/ingestions/${a.id}/review`,
      json({ decisions: [{ proposalId: pa[2]?.id, decision: "edited" }] }),
    );
    expect(noData.status).toBe(400);
  });
});
