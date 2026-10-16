import { seedFixture, taskJobId } from "@narnia-jobs/core";
import { ClaudeCodeProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { EventBus } from "../src/events";
import { FakeQueueAdapter, makeTestApp, type TestApp, VALID_PROFILE, VALID_USER } from "./helpers";

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const PM = {
  ...VALID_PROFILE,
  name: "Project Manager",
  targetTitle: "Project Manager",
  altTitles: [],
  area: "management",
};

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("F02/M3 api · perfis: criar, listar, editar, arquivar, clonar, ativar", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("segundo perfil nasce inativo; activate:true ativa e emite profile.switched; ?archived=1 inclui arquivados", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    const created = await t.api("/api/profiles", json("POST", PM));
    expect(created.status).toBe(201);
    const pm = await body<{ id: string; isActive: boolean }>(created);
    expect(pm.isActive).toBe(false);
    expect(t.repos.profiles.active()?.id).toBe(seeded.profileId);

    const third = await body<{ id: string; isActive: boolean }>(
      await t.api("/api/profiles", json("POST", { ...PM, name: "Staff", activate: true })),
    );
    expect(third.isActive).toBe(true);
    expect(t.events.some((e) => e.type === "profile.switched" && e.profileId === third.id)).toBe(
      true,
    );

    await t.api(`/api/profiles/${pm.id}/archive`, json("POST"));
    const plain = await body<{ profiles: Array<{ id: string }> }>(await t.api("/api/profiles"));
    expect(plain.profiles.map((p) => p.id)).not.toContain(pm.id);
    const all = await body<{ profiles: Array<{ id: string; archivedAt: string | null }> }>(
      await t.api("/api/profiles?archived=1"),
    );
    expect(all.profiles.find((p) => p.id === pm.id)?.archivedAt).toBeTruthy();
    const one = await t.api(`/api/profiles/${pm.id}`);
    expect(one.status).toBe(200);
    expect((await t.api("/api/profiles/nao-existe")).status).toBe(404);
  });

  it("PATCH parcial não esvazia listas, reaplica a regra de carreira e emite card_invalidated só quando o cartão estava válido", async () => {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    await t.api(`/api/profiles/${profileId}/card`); // reconstrói e deixa válido
    t.events.length = 0;
    const res = await t.api(`/api/profiles/${profileId}`, json("PATCH", { pitch: "Novo pitch" }));
    expect(res.status).toBe(200);
    const p = await body<{ pitch: string; contractTypes: string[] }>(res);
    expect(p.pitch).toBe("Novo pitch");
    expect(p.contractTypes.length).toBeGreaterThan(0);
    const inv = t.events.filter((e) => e.type === "profile.card_invalidated");
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ profileIds: [profileId] });
    // cartão já inválido: nova escrita não emite de novo
    await t.api(`/api/profiles/${profileId}`, json("PATCH", { pitch: "Outro" }));
    expect(t.events.filter((e) => e.type === "profile.card_invalidated")).toHaveLength(1);
    // tirar o salário sem "não sei" viola a regra de carreira
    const bad = await t.api(
      `/api/profiles/${profileId}`,
      json("PATCH", { salary: null, needsResearch: [] }),
    );
    expect([400, 422]).toContain(bad.status);
  });

  it("arquivar o ativo → 409 profile_active; ativar arquivado → 409 profile_archived; desarquivar; clone copia ênfases, pitch e persona", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    const active = seeded.profileId;
    const archiveActive = await t.api(`/api/profiles/${active}/archive`, json("POST"));
    expect(archiveActive.status).toBe(409);
    expect(await body(archiveActive)).toMatchObject({ error: { code: "profile_active" } });

    await t.api(`/api/profiles/${active}`, json("PATCH", { pitch: "Pitch da engenheira" }));
    await t.api(`/api/profiles/${active}/persona`, json("PUT", { tone: "cordial" }));
    await t.api(
      `/api/profiles/${active}/emphasis`,
      json("PUT", {
        items: [
          { kind: "experience", id: seeded.experienceIds[0], mode: "highlight", position: 0 },
          { kind: "skill", id: seeded.skillIds[0], mode: "hidden" },
        ],
      }),
    );
    const cloneRes = await t.api(
      `/api/profiles/${active}/clone`,
      json("POST", { ...PM, name: "Staff Engineer", targetTitle: "Staff Engineer" }),
    );
    expect(cloneRes.status).toBe(201);
    const clone = await body<{
      id: string;
      pitch: string | null;
      clonedFrom: string | null;
      personaOverrides: Record<string, unknown>;
      salary: { min: number };
      isActive: boolean;
    }>(cloneRes);
    expect(clone.clonedFrom).toBe(active);
    expect(clone.pitch).toBe("Pitch da engenheira");
    expect(clone.personaOverrides).toMatchObject({ tone: "cordial" });
    expect(clone.salary.min).toBe(PM.salary.min);
    expect(clone.isActive).toBe(false);
    const cloneEmphasis = await body<{ items: Array<{ id: string; mode: string }> }>(
      await t.api(`/api/profiles/${clone.id}/emphasis`),
    );
    expect(cloneEmphasis.items.find((i) => i.id === seeded.skillIds[0])?.mode).toBe("hidden");

    await t.api(`/api/profiles/${clone.id}/archive`, json("POST"));
    const act = await t.api(`/api/profiles/${clone.id}/activate`, json("PUT"));
    expect(act.status).toBe(409);
    expect(await body(act)).toMatchObject({ error: { code: "profile_archived" } });
    expect((await t.api(`/api/profiles/${clone.id}/unarchive`, json("POST"))).status).toBe(200);
    expect((await t.api(`/api/profiles/${clone.id}/unarchive`, json("POST"))).status).toBe(409);
    expect((await t.api(`/api/profiles/${clone.id}/activate`, json("PUT"))).status).toBe(200);
    expect(t.repos.profiles.active()?.id).toBe(clone.id);
    expect(t.events.filter((e) => e.type === "profile.switched")).toHaveLength(1);
  });
});

describe("F02/M3 api · cartão, ênfases, persona", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET card reconstrói quando inválido (cache hit depois); rebuild força; texto ≤ 1.600 chars", async () => {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    const first = await body<{
      profileId: string;
      text: string;
      valid: boolean;
      builtAt: string;
      hash: string;
    }>(await t.api(`/api/profiles/${profileId}/card`));
    expect(first.valid).toBe(true);
    expect(first.profileId).toBe(profileId);
    expect(first.text.length).toBeLessThanOrEqual(1600);
    expect(first.text).toContain("Resumo");
    const second = await body<{ builtAt: string; hash: string }>(
      await t.api(`/api/profiles/${profileId}/card`),
    );
    expect(second.builtAt).toBe(first.builtAt);
    const rebuilt = await t.api(`/api/profiles/${profileId}/card/rebuild`, json("POST"));
    expect(rebuilt.status).toBe(200);
    expect((await body<{ hash: string }>(rebuilt)).hash).toBe(first.hash);
    expect((await t.api("/api/profiles/x/card")).status).toBe(404);
  });

  it("emphasis GET lista fatos com modo, rótulo e relevância; PUT em lote valida dono (400) e invalida o cartão", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    await t.api(`/api/profiles/${seeded.profileId}/card`);
    const list = await body<{
      items: Array<{
        kind: string;
        id: string;
        mode: string;
        label: string;
        relevance: { score: number } | null;
      }>;
    }>(await t.api(`/api/profiles/${seeded.profileId}/emphasis`));
    expect(list.items.length).toBeGreaterThanOrEqual(
      seeded.experienceIds.length + seeded.skillIds.length,
    );
    const exp = list.items.find((i) => i.id === seeded.experienceIds[0]);
    expect(exp).toMatchObject({ kind: "experience" });
    expect(["highlight", "normal", "hidden"]).toContain(exp?.mode);
    expect(exp?.label.length).toBeGreaterThan(0);
    expect(exp?.relevance?.score).toBeGreaterThanOrEqual(0);
    expect(list.items.some((i) => i.kind === "project")).toBe(true);
    // F05 (§2.9): as conquistas entraram no quadro de ênfases
    expect(list.items.some((i) => i.kind === "achievement")).toBe(true);

    t.events.length = 0;
    const put = await t.api(
      `/api/profiles/${seeded.profileId}/emphasis`,
      json("PUT", {
        items: [
          { kind: "experience", id: seeded.experienceIds[1], mode: "highlight", position: 0 },
        ],
      }),
    );
    expect(put.status).toBe(200);
    expect(await body(put)).toMatchObject({ updated: 1 });
    expect(t.events.some((e) => e.type === "profile.card_invalidated")).toBe(true);
    const after = await body<{
      items: Array<{ id: string; mode: string; position: number | null }>;
    }>(await t.api(`/api/profiles/${seeded.profileId}/emphasis`));
    expect(after.items.find((i) => i.id === seeded.experienceIds[1])).toMatchObject({
      mode: "highlight",
      position: 0,
    });
    const foreign = await t.api(
      `/api/profiles/${seeded.profileId}/emphasis`,
      json("PUT", { items: [{ kind: "experience", id: "nao-existe", mode: "hidden" }] }),
    );
    expect([400, 404]).toContain(foreign.status);
  });

  it("persona GET devolve derivada, padrões e overrides; PUT grava e null restaura o padrão", async () => {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    const initial = await body<{
      persona: Record<string, string>;
      defaults: Record<string, string>;
      overrides: Record<string, unknown>;
    }>(await t.api(`/api/profiles/${profileId}/persona`));
    expect(initial.persona).toMatchObject({
      tone: "direto",
      honesty: "maxima",
      rigor: "alto",
      recruiterSeniority: "senior",
    });
    expect(initial.overrides).toEqual({});
    const put = await t.api(
      `/api/profiles/${profileId}/persona`,
      json("PUT", { tone: "cordial", rigor: "medio" }),
    );
    expect(put.status).toBe(200);
    expect((await body<{ persona: Record<string, string> }>(put)).persona).toMatchObject({
      tone: "cordial",
      rigor: "medio",
    });
    const restored = await body<{
      persona: Record<string, string>;
      overrides: Record<string, unknown>;
    }>(await t.api(`/api/profiles/${profileId}/persona`, json("PUT", { tone: null })));
    expect(restored.persona.tone).toBe("direto");
    expect(restored.persona.rigor).toBe("medio");
    expect(
      (await t.api(`/api/profiles/${profileId}/persona`, json("PUT", { tone: "gritado" }))).status,
    ).toBe(400);
  });
});

describe("F02/M3 api · sugestões, análise, dashboard, invalidação por escrita de fatos", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /api/profiles/suggestions roda a heurística (literal antes de /:id), dispensar persiste e 404 em id desconhecido", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    const res = await t.api("/api/profiles/suggestions");
    expect(res.status).toBe(200);
    const list = await body<{
      suggestions: Array<{ id: string; source: string; payload: { title: string } }>;
    }>(res);
    expect(list.suggestions.length).toBeGreaterThan(0);
    expect(list.suggestions.every((s) => s.source === "heuristic")).toBe(true);
    const first = list.suggestions[0] as { id: string };
    expect(
      (await t.api(`/api/profiles/suggestions/${first.id}/dismiss`, json("POST"))).status,
    ).toBe(200);
    const again = await body<{ suggestions: Array<{ id: string }> }>(
      await t.api("/api/profiles/suggestions"),
    );
    expect(again.suggestions.map((s) => s.id)).not.toContain(first.id);
    expect((await t.api("/api/profiles/suggestions/nope/dismiss", json("POST"))).status).toBe(404);
    // a rota do F01 continua
    expect((await t.api("/api/profiles/suggestion")).status).toBe(200);
  });

  it("POST /api/profiles com suggestionId marca a sugestão como aceita (some da lista de novas); id desconhecido é ignorado", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    const list = await body<{ suggestions: Array<{ id: string; payload: { title: string } }> }>(
      await t.api("/api/profiles/suggestions"),
    );
    const first = list.suggestions[0] as { id: string; payload: { title: string } };
    const created = await t.api(
      "/api/profiles",
      json("POST", {
        ...PM,
        name: first.payload.title,
        targetTitle: first.payload.title,
        suggestionId: first.id,
      }),
    );
    expect(created.status).toBe(201);
    expect(t.repos.suggestions.list().find((s) => s.id === first.id)?.status).toBe("accepted");
    const again = await body<{ suggestions: Array<{ id: string }> }>(
      await t.api("/api/profiles/suggestions"),
    );
    expect(again.suggestions.map((s) => s.id)).not.toContain(first.id);
    expect(
      (await t.api("/api/profiles", json("POST", { ...PM, name: "Outro", suggestionId: "nope" })))
        .status,
    ).toBe(201);
  });

  it("analyze/estimate devolve modelo e tokens; POST analyze enfileira a tarefa (202) e repete → 409 analyze_pending", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const est = await body<{ model: string; tokens: number; inputChars: number }>(
      await t.api("/api/profiles/analyze/estimate"),
    );
    expect(est.model).toBe("sonnet");
    expect(est.tokens).toBeGreaterThan(0);
    expect(est.inputChars).toBeGreaterThan(0);
    const res = await t.api("/api/profiles/analyze", json("POST", { model: "opus" }));
    expect(res.status).toBe(202);
    const { job } = await body<{
      job: { id: string; type: string; status: string; queue: string };
    }>(res);
    expect(job).toMatchObject({ type: "profile.analyze", status: "queued", queue: "extract" });
    expect(t.queue.tasks.map((x) => x.type)).toEqual(["profile.analyze"]);
    expect(t.queue.tasks[0]?.payload).toMatchObject({ model: "opus" });
    const dup = await t.api("/api/profiles/analyze", json("POST", {}));
    expect(dup.status).toBe(409);
    expect(await body(dup)).toMatchObject({ error: { code: "analyze_pending" } });
    t.repos.jobs.applyEvent({ jobId: job.id, type: "completed", at: new Date().toISOString() });
    expect((await t.api("/api/profiles/analyze", json("POST", {}))).status).toBe(202);
    expect(t.repos.jobs.get(taskJobId("profile.analyze", t.repos.users.ensureId()))?.status).toBe(
      "queued",
    );
  });

  it("dashboard traz cartão resumido com validade, contadores de ênfase, sugestões novas e projetos", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "leader");
    const d1 = await body<{
      card: { text: string; valid: boolean } | null;
      emphasis: { highlighted: number; hidden: number };
      suggestions: number;
      counts: { projects: number };
    }>(await t.api("/api/dashboard"));
    expect(d1.card?.valid).toBe(true);
    expect(d1.card?.text.split("\n").length).toBeLessThanOrEqual(3);
    expect(d1.emphasis).toEqual({ highlighted: 0, hidden: 0 });
    expect(d1.counts.projects).toBe(seeded.projectIds.length);
    await t.api("/api/profiles/suggestions");
    await t.api(
      `/api/profiles/${seeded.profileId}/emphasis`,
      json("PUT", {
        items: [{ kind: "experience", id: seeded.experienceIds[0], mode: "highlight" }],
      }),
    );
    const d2 = await body<{
      card: { valid: boolean } | null;
      emphasis: { highlighted: number };
      suggestions: number;
    }>(await t.api("/api/dashboard"));
    expect(d2.suggestions).toBeGreaterThan(0);
    expect(d2.emphasis.highlighted).toBe(1);
    expect(d2.card?.valid).toBe(false);
  });

  it("PUT /api/user e _test/facts invalidam os cartões válidos e emitem profile.card_invalidated uma vez; endpoints de teste só com mock", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    const pm = await body<{ id: string }>(await t.api("/api/profiles", json("POST", PM)));
    await t.api(`/api/profiles/${seeded.profileId}/card`);
    await t.api(`/api/profiles/${pm.id}/card`);
    t.events.length = 0;
    const patched = await t.api(
      `/api/_test/facts/experience/${seeded.experienceIds[0]}`,
      json("PATCH", { title: "Principal Engineer" }),
    );
    expect(patched.status).toBe(200);
    expect((await body<{ title: string }>(patched)).title).toBe("Principal Engineer");
    const inv = t.events.filter((e) => e.type === "profile.card_invalidated");
    expect(inv).toHaveLength(1);
    expect((inv[0] as { profileIds: string[] }).profileIds.sort()).toEqual(
      [seeded.profileId, pm.id].sort(),
    );

    await t.api(`/api/profiles/${seeded.profileId}/card`);
    t.events.length = 0;
    await t.api("/api/user", json("PUT", { ...VALID_USER, city: "São Paulo" }));
    expect(t.events.filter((e) => e.type === "profile.card_invalidated")).toHaveLength(1);

    const seed = await t.api("/api/_test/seed", json("POST", { fixture: "leader" }));
    expect(seed.status).toBe(200);
    expect(await body(seed)).toMatchObject({ ok: true, ids: { profileId: expect.any(String) } });
    expect(await body(await t.api("/api/onboarding/state"))).toMatchObject({ completed: true });

    const real = makeTestApp();
    try {
      const app = createApp({
        version: "t",
        repos: real.repos,
        dataDir: real.dataDir,
        provider: new ClaudeCodeProvider({
          exec: async () => ({ stdout: "", stderr: "", code: 1 }),
          binaryPath: null as unknown as string,
        }),
        queue: new FakeQueueAdapter(real.repos),
        bus: new EventBus(),
        token: "tk",
      });
      const r = await app.request("/api/_test/seed", {
        ...json("POST", { fixture: "engineer" }),
        headers: { Authorization: "Bearer tk", "content-type": "application/json" },
      });
      expect(r.status).toBe(404);
    } finally {
      real.cleanup();
    }
  });
});
