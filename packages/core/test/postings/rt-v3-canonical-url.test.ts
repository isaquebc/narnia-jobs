import { describe, expect, it } from "vitest";
import { samePostingUrl } from "../../src";

/**
 * F14 · RT-V3 (§2.0.1): o que o link canônico já considera a mesma vaga continua igual quando a F14 acrescentar os
 * links do LinkedIn vindos de e-mail (M4): parâmetros de rastreio, ordem da query, barra final e página do formulário.
 */
describe("F14 · RT-V3 · mesma vaga pelo link", () => {
  it.each([
    ["https://vagas.example/job/1?utm_source=x&utm_medium=email", "https://vagas.example/job/1"],
    ["https://vagas.example/job/1?trk=abc&refId=9", "https://vagas.example/job/1"],
    ["https://vagas.example/job/1?b=2&a=1", "https://vagas.example/job/1?a=1&b=2"],
    ["https://vagas.example/job/1/", "https://vagas.example/job/1"],
    ["https://VAGAS.example/job/1", "https://vagas.example/job/1"],
    ["https://jobs.lever.co/acme/123/apply", "https://jobs.lever.co/acme/123"],
    [
      "https://boards.greenhouse.io/acme/jobs/9/applications/new",
      "https://boards.greenhouse.io/acme/jobs/9",
    ],
    ["https://acme.gupy.io/jobs/77/candidatar", "https://acme.gupy.io/jobs/77"],
  ])("%s = %s", (a, b) => {
    expect(samePostingUrl(a, b)).toBe(true);
  });

  it.each([
    ["https://vagas.example/job/1", "https://vagas.example/job/2"],
    ["https://vagas.example/job/1?id=1", "https://vagas.example/job/1?id=2"],
    ["https://a.example/job/1", "https://b.example/job/1"],
    ["não é link", "não é link"],
  ])("%s ≠ %s", (a, b) => {
    expect(samePostingUrl(a, b)).toBe(false);
  });
});
