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
  it("uma notificação por sugestão nova, com link para /perfis, sem duplicar", () => {
    const r = setup();
    const s = r.suggestions.create({
      source: "heuristic",
      payload: payload("Engineering Manager"),
    });
    const first = syncSuggestionNotifications(r);
    expect(first.filter((e) => e.created)).toHaveLength(1);
    const again = syncSuggestionNotifications(r);
    expect(again.filter((e) => e.created)).toHaveLength(0);
    const [n] = open(r, "profile.suggestion");
    expect(n?.subjectId).toBe(s?.id);
    expect(n?.actionUrl).toBe("/perfis");
    expect(n?.title).toContain("Engineering Manager");
  });

  it("resolve sozinha quando a sugestão é dispensada ou aceita", () => {
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
    expect(open(r, "profile.suggestion")).toHaveLength(2);
    r.suggestions.dismiss(a?.id as string);
    r.suggestions.accept(b?.id as string);
    const events = syncSuggestionNotifications(r);
    expect(events.filter((e) => e.notification.resolvedAt)).toHaveLength(2);
    expect(open(r, "profile.suggestion")).toHaveLength(0);
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
