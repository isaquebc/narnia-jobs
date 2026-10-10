import { describe, expect, it } from "vitest";
import { createGhClient, GhError, parseJsonStream } from "../../../src/ingest/sources/github/gh";
import { fakeGh } from "../../fixtures/github/fake-gh";

const TOKEN = "gho_abcdefghijklmnopqrstuvwxyz0123456789";

describe("F03/M2 gh: cliente sobre o `gh api` (exec injetável)", () => {
  it("lê páginas concatenadas do --paginate como uma lista só", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const repos = await gh.json<unknown[]>("user/repos?affiliation=owner&per_page=100", {
      paginate: true,
    });
    expect(repos).toHaveLength(12);
  });

  it("parseJsonStream separa valores JSON concatenados, inclusive com colchetes em strings", () => {
    expect(parseJsonStream('[1,2][3]{"a":"]["}')).toEqual([[1, 2], [3], { a: "][" }]);
    expect(parseJsonStream("")).toEqual([]);
  });

  it("raw devolve texto e pede o Accept raw", async () => {
    const fake = fakeGh();
    const gh = createGhClient({ exec: fake.exec });
    const readme = await gh.raw("repos/ana-exemplo/api-pagamentos/readme");
    expect(readme).toContain("# API de pagamentos");
    expect(fake.calls.at(-1)).toEqual(
      expect.arrayContaining(["-H", "Accept: application/vnd.github.raw"]),
    );
  });

  it("404 vira GhError not_found; tryJson/tryRaw devolvem null", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    await expect(gh.json("repos/ninguem/nada")).rejects.toMatchObject({ code: "not_found" });
    expect(await gh.tryJson("repos/ninguem/nada")).toBeNull();
    expect(await gh.tryRaw("repos/ninguem/nada/readme")).toBeNull();
  });

  it("401 vira not_authenticated", async () => {
    const gh = createGhClient({
      exec: fakeGh({
        user: { stdout: "", stderr: "gh: Requires authentication (HTTP 401)", code: 1 },
      }).exec,
    });
    await expect(gh.json("user")).rejects.toMatchObject({ code: "not_authenticated", status: 401 });
  });

  it("403 de rate limit vira rate_limited com retry_after calculado pelo /rate_limit", async () => {
    const gh = createGhClient({
      exec: fakeGh({
        user: {
          stdout: "",
          stderr: "gh: API rate limit exceeded for 1.2.3.4. (HTTP 403)",
          code: 1,
        },
      }).exec,
      now: () => 1_790_000_000_000,
    });
    const err = await gh.json("user").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GhError);
    expect(err).toMatchObject({ code: "rate_limited", status: 403, retryAfterSec: 600 });
  });

  it("nunca põe o token em argumentos nem em mensagens de erro", async () => {
    const fake = fakeGh({
      user: { stdout: "", stderr: `gh: Bad credentials ${TOKEN} (HTTP 401)`, code: 1 },
    });
    const gh = createGhClient({ exec: fake.exec, token: TOKEN });
    const err = (await gh.json("user").catch((e: unknown) => e)) as GhError;
    expect(err.message).not.toContain(TOKEN);
    expect(String(err.stderr)).not.toContain(TOKEN);
    expect(err.message).toContain("***");
    expect(JSON.stringify(fake.calls)).not.toContain(TOKEN);
  });

  it("graphql passa variáveis por -f e devolve só `data`; erros do GraphQL viram GhError", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const data = await gh.graphql<{ user: { id: string } }>(
      "query UserMetrics($login: String!) { user(login: $login) { id } }",
      { login: "ana-exemplo" },
    );
    expect(data.user.id).toBe("U_ana");
    await expect(
      gh.graphql("query RepoMetrics($owner: String!, $name: String!) { x }", {
        owner: "x",
        name: "y",
      }),
    ).rejects.toMatchObject({ code: "failed" });
  });
});

describe("Regressão 2026-10-10 · erros transitórios do GitHub (5xx) ganham novas tentativas", () => {
  const flaky = (failures: number, stderr = "gh: HTTP 502 (HTTP 502)") => {
    let calls = 0;
    return {
      calls: () => calls,
      exec: async () => {
        calls++;
        return calls <= failures
          ? { code: 1, stdout: "", stderr }
          : { code: 0, stdout: '{"login":"ana-exemplo"}', stderr: "" };
      },
    };
  };

  it("502 duas vezes e depois sucesso: devolve o resultado, esperando 1 s e 2 s", async () => {
    const f = flaky(2);
    const waits: number[] = [];
    const gh = createGhClient({ exec: f.exec, sleep: async (ms) => void waits.push(ms) });
    expect(await gh.json<{ login: string }>("user")).toEqual({ login: "ana-exemplo" });
    expect(f.calls()).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("5xx persistente vira GhError unavailable com mensagem de instabilidade após 3 tentativas", async () => {
    const f = flaky(10, "gh: HTTP 503 (HTTP 503)");
    const gh = createGhClient({ exec: f.exec, sleep: async () => {} });
    const err = await gh.json("user").catch((e) => e);
    expect(err).toBeInstanceOf(GhError);
    expect((err as GhError).code).toBe("unavailable");
    expect((err as GhError).message).toMatch(/GitHub instável/);
    expect(f.calls()).toBe(3);
  });

  it("4xx não ganha nova tentativa", async () => {
    const f = flaky(10, "gh: Not Found (HTTP 404)");
    const gh = createGhClient({ exec: f.exec, sleep: async () => {} });
    await gh.json("user").catch(() => null);
    expect(f.calls()).toBe(1);
  });
});
