import { notifyAnalysisDone, seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, VALID_PROFILE } from "./helpers";

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const openOf = (t: TestApp, kind: string) =>
  t.repos.notifications.list({ status: "open" }).filter((n) => n.kind === kind);

describe("F03/M5 api · notificações das sugestões de perfil (F03-10)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("CM-3: GET /api/profiles/suggestions cria UMA notificação agrupada e emite notification.created uma vez", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    const res = await t.api("/api/profiles/suggestions");
    const { suggestions } = (await res.json()) as { suggestions: Array<{ id: string }> };
    expect(suggestions.length).toBeGreaterThan(0);
    expect(openOf(t, "profile.suggestion")).toHaveLength(1);
    const created = t.events.filter(
      (e) => e.type === "notification.created" && e.notification.kind === "profile.suggestion",
    );
    expect(created).toHaveLength(1);
    await t.api("/api/profiles/suggestions");
    expect(openOf(t, "profile.suggestion")).toHaveLength(1);
  });

  it("dispensar resolve a notificação da sugestão e a de análise concluída", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    notifyAnalysisDone(t.repos, "task__profile.analyze__x", { created: 1, skipped: 0 });
    const { suggestions } = (await (await t.api("/api/profiles/suggestions")).json()) as {
      suggestions: Array<{ id: string }>;
    };
    const target = suggestions[0]?.id as string;
    await t.api(`/api/profiles/suggestions/${target}/dismiss`, json("POST"));
    // a agrupada diminui (ou resolve, se era a única)
    const group = openOf(t, "profile.suggestion")[0];
    if (suggestions.length === 1) expect(group).toBeUndefined();
    else expect(group?.title).not.toContain(String(suggestions.length));
    expect(openOf(t, "profile.analysis_done")).toHaveLength(0);
    expect(
      t.events.some((e) => e.type === "notification.updated" && e.notification.resolvedAt !== null),
    ).toBe(true);
  });

  it("criar perfil a partir da sugestão resolve a notificação; ?seen=1 resolve a análise concluída", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "leader");
    const { suggestions } = (await (await t.api("/api/profiles/suggestions")).json()) as {
      suggestions: Array<{ id: string; payload: { title: string } }>;
    };
    const s = suggestions[0] as { id: string; payload: { title: string } };
    await t.api(
      "/api/profiles",
      json("POST", {
        ...VALID_PROFILE,
        name: s.payload.title,
        targetTitle: s.payload.title,
        suggestionId: s.id,
      }),
    );
    expect(openOf(t, "profile.suggestion").some((n) => n.subjectId === s.id)).toBe(false);

    notifyAnalysisDone(t.repos, "task__profile.analyze__y", { created: 0, skipped: 2 });
    await t.api("/api/profiles/suggestions");
    expect(openOf(t, "profile.analysis_done")).toHaveLength(1);
    await t.api("/api/profiles/suggestions?seen=1");
    expect(openOf(t, "profile.analysis_done")).toHaveLength(0);
  });
});

describe("CM-3 api · o sino conta só o que o dono ainda não viu", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /api/notifications devolve em unresolved só as abertas não vistas", async () => {
    t = makeTestApp();
    const a = t.repos.notifications.upsert({
      kind: "review.pending",
      subjectKind: "ingestion_run",
      subjectId: "r1",
      title: "Pronta para revisão: x",
      actionUrl: "/ingestao/r1",
    });
    t.repos.notifications.upsert({
      kind: "review.conflicts",
      subjectKind: "ingestion_run",
      subjectId: "r1",
      title: "Conflitos: x",
      actionUrl: "/ingestao/r1",
    });
    const before = (await (await t.api("/api/notifications")).json()) as { unresolved: number };
    expect(before.unresolved).toBe(2);
    await t.api(`/api/notifications/${a.notification.id}/read`, json("POST", {}));
    const after = (await (await t.api("/api/notifications")).json()) as {
      unresolved: number;
      notifications: unknown[];
    };
    expect(after.unresolved).toBe(1);
    expect(after.notifications).toHaveLength(2);
  });
});
