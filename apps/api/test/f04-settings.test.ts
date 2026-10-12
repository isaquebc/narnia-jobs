import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("F04/M4 api · configurações do chat e domínios confiáveis", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET devolve os padrões (5 sessões, 60 min, sonnet); PUT parcial grava e devolve o novo estado", async () => {
    t = makeTestApp();
    const r = await t.api("/api/settings/chat");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({
      maxLiveSessions: 5,
      hibernateAfterMin: 60,
      defaultModel: "sonnet",
    });
    const put = await t.api(
      "/api/settings/chat",
      json({ maxLiveSessions: 3, defaultModel: "haiku" }, "PUT"),
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as { settings: Record<string, unknown> }).settings).toMatchObject({
      maxLiveSessions: 3,
      hibernateAfterMin: 60,
      defaultModel: "haiku",
    });
    expect((await t.api("/api/settings/chat", json({ maxLiveSessions: 0 }, "PUT"))).status).toBe(
      400,
    );
  });

  it("domínios: lista padrão, adicionar com máscara, desativar, remover e restaurar padrões", async () => {
    t = makeTestApp();
    const list = async () =>
      (
        (await (await t.api("/api/settings/trusted-domains")).json()) as {
          domains: Array<{ id: string; pattern: string; enabled: boolean; builtin: boolean }>;
        }
      ).domains;
    const before = await list();
    expect(before.length).toBeGreaterThan(0);
    const created = await t.api(
      "/api/settings/trusted-domains",
      json({ pattern: "*.exemplo.org", trustTag: "survey" }),
    );
    expect(created.status).toBe(201);
    const { domain } = (await created.json()) as { domain: { id: string; pattern: string } };
    expect(domain.pattern).toBe("*.exemplo.org");
    expect(
      (
        await t.api(
          "/api/settings/trusted-domains",
          json({ pattern: "http://x.com/a", trustTag: "other" }),
        )
      ).status,
    ).toBe(400);
    const off = await t.api(
      `/api/settings/trusted-domains/${domain.id}`,
      json({ enabled: false }, "PATCH"),
    );
    expect(off.status).toBe(200);
    expect((await list()).find((d) => d.id === domain.id)?.enabled).toBe(false);
    // padrão só pode ser desligado; o do usuário pode ser removido
    const builtin = before.find((d) => d.builtin) as { id: string };
    expect(
      (await t.api(`/api/settings/trusted-domains/${builtin.id}`, { method: "DELETE" })).status,
    ).toBe(409);
    expect(
      (
        await t.api(
          `/api/settings/trusted-domains/${builtin.id}`,
          json({ enabled: false }, "PATCH"),
        )
      ).status,
    ).toBe(200);
    expect(
      (await t.api(`/api/settings/trusted-domains/${domain.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await list()).some((d) => d.id === domain.id)).toBe(false);
    await t.api(
      "/api/settings/trusted-domains",
      json({ pattern: "meu.dominio.com", trustTag: "other" }),
    );
    const restored = await t.api("/api/settings/trusted-domains/restore", json({}));
    expect(restored.status).toBe(200);
    const after = await list();
    expect(after.every((d) => d.builtin && d.enabled)).toBe(true);
    expect(after.length).toBe(before.length);
  });
});
