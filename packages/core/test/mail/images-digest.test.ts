import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMailApplications,
  applyMailUpdates,
  createRepos,
  digestMail,
  type MailClassifier,
  type MailImageReader,
  migrate,
  openDatabase,
  type Repos,
  rereadMail,
} from "../../src";
import { rawMail } from "./fixtures";

/**
 * F15/M4 · imagens do corpo com OCR na leitura (plano §2.4, F15-5): só de e-mail ligado a uma candidatura já feita e de
 * remetente confiável ou do domínio da vaga/empresa com autenticação; o texto lido vai ao classificador numa segunda
 * chamada; o que foi lido fica guardado ao lado do e-mail ("Ler de novo" não baixa de novo).
 */
const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "update",
  confidence: 95,
  company: "Acme",
  title: "Backend Sr",
  postingUrl: null,
  jobs: [],
  stageHint: null,
  interview: null,
  summary: "Resumo.",
  actions: [],
  process: null,
  ...o,
});
const ctx = { log: () => {}, item: () => {}, count: () => {}, publish: async () => {} };
const BANNER = '<p>Próxima etapa</p><img src="https://cdn.acme.example/fases.png" width="600">';
const PROCESS = {
  stages: ["Inscrição", "Pré-seleção", "Entrevista", "Proposta"],
  current: "Pré-seleção",
};

describe("F15/M4 · imagens do e-mail na leitura", () => {
  let repos: Repos;
  let dataDir: string;
  let n = 0;
  let seen: Array<string | undefined>;
  let reads: string[];
  const classify: MailClassifier = async (i) => {
    seen.push(i.images);
    if (/Inscrição/.test(i.images ?? "")) return out({ process: PROCESS });
    return out({});
  };
  const readImages: MailImageReader = async (html) => {
    reads.push(html);
    return [
      {
        url: "https://cdn.acme.example/fases.png",
        text: "Inscrição > Pré-seleção (VOCÊ ESTÁ AQUI) > Entrevista > Proposta",
        skipped: null,
      },
    ];
  };
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-f15-m4-"));
    seen = [];
    reads = [];
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const mail = (
    o: {
      risk?: "trusted" | "neutral";
      from?: string;
      auth?: string | null;
      html?: string;
      thread?: string;
      result?: MailClassifyOutput;
    } = {},
  ) => {
    const gmailId = `m${++n}`;
    const from = o.from ?? "rh@acme.example";
    const at = new Date(Date.parse("2026-11-12T10:00:00Z") + n * 60_000).toISOString();
    writeFileSync(
      join(dataDir, `${gmailId}.eml`),
      rawMail({
        from: `RH <${from}>`,
        text: "Oi, sua próxima etapa está abaixo.",
        html: o.html ?? BANNER,
        ...(o.auth !== undefined ? { auth: o.auth } : {}),
      }),
    );
    const { record } = repos.mail.insert(
      {
        gmailId,
        threadId: o.thread ?? `t${n}`,
        fromAddr: from,
        fromName: "RH",
        replyTo: null,
        subject: "Próxima etapa",
        receivedAt: at,
        size: 1,
        labels: [],
        rawPath: `${gmailId}.eml`,
      },
      at,
    );
    repos.mail.setAssessment(
      record.id,
      { status: "pending", class: "candidate", riskLevel: o.risk ?? "trusted", riskReasons: [] },
      at,
    );
    if (o.result)
      repos.mail.setResult(
        record.id,
        { status: "pending", class: o.result.class, confidence: 95, result: o.result as never },
        at,
      );
    return record.id;
  };
  const applied = async () => {
    mail({ result: out({ class: "application_received" }), html: "<p>Recebemos</p>" });
    await applyMailApplications({ repos, dataDir, ctx });
    expect(repos.jobApplications.list()).toHaveLength(1);
  };
  const digest = () => digestMail({ repos, dataDir, ctx, classify, readImages });

  it("remetente confiável de candidatura feita: lê a imagem, classifica de novo com o texto e guarda o lido", async () => {
    await applied();
    const id = mail();
    await digest();
    expect(reads).toHaveLength(1);
    expect(seen).toEqual([undefined, expect.stringContaining("Pré-seleção (VOCÊ ESTÁ AQUI)")]);
    const r = repos.mail.get(id)?.result as {
      process?: unknown;
      images?: Array<{ url: string; chars: number }>;
    };
    expect(r.process).toEqual(PROCESS);
    expect(r.images?.[0]).toMatchObject({ url: "https://cdn.acme.example/fases.png" });
    expect(r.images?.[0]?.chars).toBeGreaterThan(10);
    expect(existsSync(join(dataDir, "m2.eml.images.json"))).toBe(true);

    // as fases trocam as etapas padrão (M3); "Ler de novo" usa o que já foi lido, sem baixar de novo
    await applyMailUpdates({ repos, dataDir, ctx });
    const app = repos.jobApplications.list()[0];
    expect(app?.stages.map((s) => s.name)).toEqual(PROCESS.stages);
    rereadMail(repos, dataDir, id);
    // volta ao começo da fila: a avaliação de risco roda de novo antes da leitura
    repos.mail.setAssessment(
      id,
      { status: "pending", class: "candidate", riskLevel: "trusted", riskReasons: [] },
      "2026-11-12T12:00:00.000Z",
    );
    await digest();
    expect(reads).toHaveLength(1);
    expect((repos.mail.get(id)?.result as { process?: unknown } | undefined)?.process).toEqual(
      PROCESS,
    );
  });

  it("sem candidatura feita, as imagens não abrem", async () => {
    mail();
    await digest();
    expect(reads).toEqual([]);
    expect(seen).toEqual([undefined]);
  });

  it("remetente neutro: só do domínio da empresa com autenticação; de outro domínio ou sem autenticação, não", async () => {
    await applied();
    mail({ risk: "neutral", from: "talentos@outra.example" });
    mail({ risk: "neutral", auth: null });
    await digest();
    expect(reads).toEqual([]);
    mail({ risk: "neutral" });
    await digest();
    expect(reads).toHaveLength(1);
  });

  it("sem imagem no corpo ou sem leitor nesta execução: uma chamada só", async () => {
    await applied();
    mail({ html: "<p>Sem imagem</p>" });
    await digest();
    mail();
    await digestMail({ repos, dataDir, ctx, classify });
    expect(reads).toEqual([]);
    expect(seen).toEqual([undefined, undefined]);
  });
});
