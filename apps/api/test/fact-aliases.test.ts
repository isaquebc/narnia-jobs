import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** Apelidos aprendidos da busca (F04-fix-fundamentacao, FF-1): visíveis e removíveis em Configurações › Chat. */
describe("apelidos da busca pela API", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("lista com o rótulo do fato e apaga; apagar de novo é 404", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const k8s = t.repos.facts.skills.list().find((s) => s.name === "Kubernetes");
    const a = t.repos.factAliases.add({
      term: "orquestração",
      kind: "skill",
      factId: k8s?.id ?? "",
    });
    const list = (await (await t.api("/api/settings/fact-aliases")).json()) as {
      aliases: Array<{ id: string; term: string; factLabel: string | null }>;
    };
    expect(list.aliases).toEqual([
      expect.objectContaining({ id: a.id, term: "orquestração", factLabel: "Kubernetes" }),
    ]);
    expect((await t.api(`/api/settings/fact-aliases/${a.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await t.api(`/api/settings/fact-aliases/${a.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });
});
