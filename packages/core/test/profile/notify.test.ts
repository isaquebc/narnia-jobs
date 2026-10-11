import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  notifyAnalysisDone,
  resolveAnalysisDone,
  syncSuggestionNotifications,
} from "../../src/profile/notify";
import { seedFixture } from "../../src/testing/profile-fixtures";

const payload = (title: string) => ({
  title,
  seniority: "manager" as const,
  area: "software",
  market: "BR",
  rationale: "Lidera squads há 3 anos",
  supportingFactIds: [],
});

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  seedFixture(r, "engineer");
  return r;
}

const open = (r: ReturnType<typeof setup>, kind: string) =>
  r.notifications.list({ status: "open" }).filter((n) => n.kind === kind);

describe("F03/M5 profile/notify · geradores da F02 (F03-10)", () => {
  it("CM-3: sugestões novas viram UMA notificação agrupada, com link para /perfis, sem duplicar", () => {
    const r = setup();
    r.suggestions.create({ source: "heuristic", payload: payload("Engineering Manager") });
    const first = syncSuggestionNotifications(r);
    expect(first.filter((e) => e.created)).toHaveLength(1);
    expect(open(r, "profile.suggestion")[0]?.title).toBe("Sugestão de perfil: Engineering Manager");
    r.suggestions.create({ source: "model", model: "sonnet", payload: payload("Staff Engineer") });
    const again = syncSuggestionNotifications(r);
    expect(again.filter((e) => e.created)).toHaveLength(0);
    const all = open(r, "profile.suggestion");
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe("2 sugestões de perfil");
    expect(all[0]?.actionUrl).toBe("/perfis");
    expect(all[0]?.body).toContain("Staff Engineer");
  });

  it("diminui conforme o dono decide e resolve sozinha quando não sobra nenhuma", () => {
    const r = setup();
    const a = r.suggestions.create({
      source: "heuristic",
      payload: payload("Engineering Manager"),
    });
    const b = r.suggestions.create({
      source: "model",
      model: "sonnet",
      payload: payload("Staff Engineer"),
    });
    syncSuggestionNotifications(r);
    r.suggestions.dismiss(a?.id as string);
    syncSuggestionNotifications(r);
    expect(open(r, "profile.suggestion")[0]?.title).toBe("Sugestão de perfil: Staff Engineer");
    r.suggestions.accept(b?.id as string);
    const events = syncSuggestionNotifications(r);
    expect(events.some((e) => e.notification.resolvedAt)).toBe(true);
    expect(open(r, "profile.suggestion")).toHaveLength(0);
  });

  it("sugestão nova volta a acender o sino mesmo se a agrupada já foi vista; antigas por sugestão são fundidas", () => {
    const r = setup();
    // notificação antiga, do formato anterior (uma por sugestão)
    const legacy = r.suggestions.create({ source: "heuristic", payload: payload("Tech Lead") });
    r.notifications.upsert({
      kind: "profile.suggestion",
      subjectKind: "profile_suggestion",
      subjectId: legacy?.id as string,
      title: "Sugestão de perfil: Tech Lead",
      actionUrl: "/perfis",
    });
    syncSuggestionNotifications(r);
    const grouped = open(r, "profile.suggestion");
    expect(grouped).toHaveLength(1);
    r.notifications.markRead(grouped[0]?.id as string);
    expect(r.notifications.countUnseen()).toBe(0);
    r.suggestions.create({ source: "heuristic", payload: payload("Engineering Manager") });
    syncSuggestionNotifications(r);
    expect(open(r, "profile.suggestion")[0]?.readAt).toBeNull();
    expect(r.notifications.countUnseen()).toBe(1);
  });

  it("CM-3: o sino conta só pendências não vistas", () => {
    const r = setup();
    const a = r.notifications.upsert({
      kind: "review.pending",
      subjectKind: "ingestion_run",
      subjectId: "r1",
      title: "Pronta para revisão: x",
      actionUrl: "/ingestao/r1",
    });
    r.notifications.upsert({
      kind: "review.conflicts",
      subjectKind: "ingestion_run",
      subjectId: "r1",
      title: "Conflitos",
      actionUrl: "/ingestao/r1",
    });
    expect(r.notifications.countUnseen()).toBe(2);
    r.notifications.markRead(a.notification.id);
    expect(r.notifications.countUnseen()).toBe(1);
    expect(r.notifications.list({ status: "open" })).toHaveLength(2);
  });

  it("análise concluída gera uma notificação por job e resolve ao abrir a página ou decidir", () => {
    const r = setup();
    const ev = notifyAnalysisDone(r, "task__profile.analyze__u1", { created: 2, skipped: 0 });
    expect(ev.created).toBe(true);
    expect(ev.notification.body).toContain("2");
    expect(
      notifyAnalysisDone(r, "task__profile.analyze__u1", { created: 2, skipped: 0 }).created,
    ).toBe(false);
    expect(open(r, "profile.analysis_done")).toHaveLength(1);
    const resolved = resolveAnalysisDone(r);
    expect(resolved).toHaveLength(1);
    expect(open(r, "profile.analysis_done")).toHaveLength(0);
    expect(resolveAnalysisDone(r)).toHaveLength(0);
  });
});
