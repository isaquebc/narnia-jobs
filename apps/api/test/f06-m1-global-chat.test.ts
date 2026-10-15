import { seedFixture } from "@narnia-jobs/core";
import { type ChatHandle, type ChatOpenOptions, MockProvider } from "@narnia-jobs/providers";
import type { AnyWsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { specialistAgents } from "../src/chat/session-manager";
import { makeTestApp, type TestApp } from "./helpers";

/** F06/M1 · recrutador global (F06-8): conversa sem perfil, todos os perfis no prompt, subagente especializado. */

class SpyProvider extends MockProvider {
  opened: ChatOpenOptions[] = [];
  override openChat(o: ChatOpenOptions): ChatHandle {
    this.opened.push(o);
    return super.openChat(o);
  }
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function waitFor(events: AnyWsEvent[], pred: (e: AnyWsEvent) => boolean, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (events.some(pred)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("evento não chegou");
}

function secondProfile(t: TestApp, userId: string) {
  return t.repos.profiles.create({
    name: "Engineering Manager",
    targetTitle: "Engineering Manager",
    altTitles: [],
    seniority: "senior",
    area: "gestão",
    goal: "career_change",
    market: "BR",
    docLocale: "pt-BR",
    needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
    userId,
    isActive: false,
  });
}

describe("F06/M1 · recrutador global", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("conversa nasce sem perfil; o prompt traz todos os perfis e o especializado vai como subagente", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    const ids = seedFixture(t.repos, "engineer");
    const em = secondProfile(t, ids.userId);
    const r = await t.api("/api/sessions", json({ category: "career" }));
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as { session: { id: string; profileId: string | null } };
    expect(session.profileId).toBeNull();
    await t.api(`/api/sessions/${session.id}/messages`, json({ text: "oi" }));
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === session.id);
    const opened = spy.opened[0] as ChatOpenOptions;
    expect(opened.systemPrompt).toContain(`id ${ids.profileId}`);
    expect(opened.systemPrompt).toContain(`id ${em.id}`);
    expect(opened.systemPrompt).toContain("recrutador-especializado");
    expect(opened.systemPrompt).not.toMatch(/\{\{/);
    expect(Object.keys(opened.agents ?? {})).toEqual(["recrutador-especializado"]);
    expect(opened.agents?.["recrutador-especializado"]?.disallowedTools).toEqual(["Agent"]);
  });

  it("categoria job abre com o título dado e sem pedir perfil", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api(
      "/api/sessions",
      json({ category: "job", title: "Accenture/Itaú - Backend Engineer" }),
    );
    expect(r.status).toBe(201);
    expect(
      ((await r.json()) as { session: { title: string; category: string } }).session,
    ).toMatchObject({
      title: "Accenture/Itaú - Backend Engineer",
      category: "job",
    });
  });

  it("a lista de conversas é global e trocar o perfil ativo não muda a lista", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const em = secondProfile(t, ids.userId);
    const a = (
      (await (await t.api("/api/sessions", json({ category: "career" }))).json()) as {
        session: { id: string };
      }
    ).session.id;
    t.repos.profiles.setActive(em.id);
    const list = (await (await t.api("/api/sessions")).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(list.sessions.map((s) => s.id)).toEqual([a]);
  });

  it("perfil novo entre turnos: a nota de contexto atualizado leva os cartões", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    const ids = seedFixture(t.repos, "engineer");
    const sid = (
      (await (await t.api("/api/sessions", json({ category: "career" }))).json()) as {
        session: { id: string };
      }
    ).session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "primeira" }));
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === sid);
    const em = secondProfile(t, ids.userId);
    t.events.length = 0;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "segunda" }));
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === sid);
    const msgs = t.repos.chatMessages.list(sid).map((m) => m.role);
    expect(msgs).toContain("system_note");
    expect(spy.opened).toHaveLength(1);
    expect(em.id).toBeTruthy();
  });

  it("specialistAgents lê o arquivo do plugin: descrição e modelo do frontmatter, corpo como prompt", () => {
    const a = specialistAgents()["recrutador-especializado"];
    expect(a?.model).toBe("sonnet");
    expect(a?.description).toMatch(/profileId/);
    expect(a?.prompt).toMatch(/profile_get_card/);
    expect(a?.prompt).not.toMatch(/^---/);
  });
});
