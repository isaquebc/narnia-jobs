import { describe, expect, it } from "vitest";
import { friendlyError } from "../../src/errors/friendly";

/** Plano de comunicação C5: mensagens em pt-BR com o que fazer; o texto técnico vai junto, recolhido na UI. */
describe("friendlyError · mapa único de erros", () => {
  const cases: Array<[string, string]> = [
    [
      "Falha ao consultar o modelo: Claude Code returned an error result: Reached maximum number of turns (1)",
      "error.model_format",
    ],
    ["Sem saída estruturada (error_max_structured_output_retries): x", "error.model_format"],
    ["Saída fora do schema: ...", "error.model_format"],
    [
      "GitHub: GitHub instável (HTTP 502); tente de novo em alguns minutos: gh: HTTP 502",
      "error.github_unstable",
    ],
    ["Falha no gh: gh: HTTP 503 (HTTP 503)", "error.github_unstable"],
    ["job stalled more than allowable limit", "error.interrupted"],
    ["GitHub não conectado: conecte em Configurações › Integrações", "error.github_not_connected"],
    [
      "Limite de requisições do GitHub atingido; tente mais tarde ou conecte sua conta",
      "error.github_rate_limited",
    ],
    ["repositório vazio (sem commits)", "error.repo_empty"],
    ["GitHub CLI indisponível no container", "error.gh_missing"],
    ["gh não está instalado", "error.gh_missing"],
    [
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      "error.auth_expired",
    ],
    [
      "API Error: 401 authentication_error: invalid token · Please run /login",
      "error.auth_expired",
    ],
    ["algo totalmente inesperado", "error.unknown"],
  ];
  for (const [raw, key] of cases) {
    it(`${key} ← ${raw.slice(0, 50)}`, () => {
      const f = friendlyError(raw);
      expect(f.key).toBe(key);
      expect(f.hint).toBe(`${key}_hint`);
      expect(f.technical).toBe(raw);
    });
  }

  it("aceita objeto com code (GhError/ProviderError) e prefere o code ao texto", () => {
    expect(friendlyError({ code: "rate_limited", message: "x" }).key).toBe(
      "error.github_rate_limited",
    );
    expect(friendlyError({ code: "not_authenticated", message: "x" }).key).toBe(
      "error.github_not_connected",
    );
    expect(friendlyError({ code: "empty", message: "x" }).key).toBe("error.repo_empty");
    expect(friendlyError({ code: "structured_output_failed", message: "x" }).key).toBe(
      "error.model_format",
    );
  });

  it("vazio ou nulo vira desconhecido sem quebrar", () => {
    expect(friendlyError(null).key).toBe("error.unknown");
    expect(friendlyError("").technical).toBe("");
  });
});
