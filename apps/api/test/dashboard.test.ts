import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  makeTestApp,
  simulateWorker,
  type TestApp,
  uploadFixture,
  VALID_PROFILE,
  VALID_USER,
} from "./helpers";

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M4/api dashboard", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("sem dados: perfil null e contadores zerados; com dados: contagens, uso e pendências de pesquisa", async () => {
    t = makeTestApp();
    const empty = (await (await t.api("/api/dashboard")).json()) as {
      profile: null;
      counts: Record<string, number>;
    };
    expect(empty.profile).toBeNull();
    expect(empty.counts).toEqual({
      experiences: 0,
      skills: 0,
      education: 0,
      files: 0,
      projects: 0,
    });

    await t.api("/api/user", put(VALID_USER));
    const { body: file } = await uploadFixture(t);
    const ing = (await (await t.api("/api/ingestions", post({ fileId: file.id }))).json()) as {
      id: string;
    };
    const proposals = simulateWorker(t, ing.id);
    await t.api(
      `/api/ingestions/${ing.id}/review`,
      post({ decisions: proposals.map((p) => ({ proposalId: p.id, decision: "accepted" })) }),
    );
    const { salary: _s, ...noSalary } = VALID_PROFILE;
    await t.api("/api/profiles", post({ ...noSalary, needsResearch: ["salary"] }));
    t.repos.usageEvents.insert({
      id: "u1",
      ts: new Date().toISOString(),
      origin: "narnia",
      category: "ingest.facts",
      jobId: null,
      sessionId: null,
      model: "haiku",
      inputTokens: 100,
      outputTokens: 10,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0,
    });

    const body = (await (await t.api("/api/dashboard")).json()) as {
      profile: { name: string } | null;
      counts: { experiences: number; skills: number; education: number; files: number };
      usage: { totalTokens: number; byCategory: Record<string, number> };
      pendingResearch: number;
    };
    expect(body.profile?.name).toBe(VALID_PROFILE.name);
    expect(body.counts).toEqual({ experiences: 2, skills: 6, education: 1, files: 1, projects: 0 });
    expect(body.usage.totalTokens).toBe(110);
    // redução de custo (2026-10-26): por categoria, com chamadas, cache e custo
    const usage = (await (await t.api("/api/usage/summary")).json()) as {
      categories: Array<Record<string, unknown>>;
      totalCostUsd: number;
    };
    expect(usage.categories).toContainEqual({
      category: "ingest.facts",
      events: 1,
      tokens: 110,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
    });
    expect(body.pendingResearch).toBe(1);
  });

  it("F02: conta as sugestões heurísticas mesmo antes de alguém abrir a lista (o banner depende disso)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    const d = (await (await t.api("/api/dashboard")).json()) as { suggestions: number };
    expect(d.suggestions).toBeGreaterThan(0);
  });
});
