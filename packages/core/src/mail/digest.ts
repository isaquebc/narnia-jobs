import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { MailMessageRecord } from "../db/repos/mail";
import type { ScheduledContext } from "../scheduler";
import { senderMatchesPosting } from "../todos/from-mail";
import { parseJobAlert } from "./alerts";
import { MAIL_LABEL, MAIL_SUSPECT_LABEL } from "./connection";
import { domainOfAddress } from "./domains";
import { imagesText, type MailImageRead, mailImageUrls } from "./images";
import { intakePostingFromMail, type MailJobInput, safeHttpUrl } from "./postings";
import { authVerdict, type ParsedMail, parseMail } from "./risk";
import type { MailSource } from "./source";
import { mailApplicationOf } from "./updates";

/**
 * Processamento dos e-mails avaliados (F14/M4): o leitor por código lê os alertas das plataformas conhecidas; o resto
 * vai ao modelo (`narnia-mail-classify`, sem tools, o e-mail é dado). Alertas viram vagas do feed; fora do assunto
 * fica intocado; candidatura recebida, negativa, atualização, convite e contato ficam classificados para o M5 e o M6.
 * Processado (`done`) ganha a etiqueta `narnia-jobs` e é marcado como lido (pedido do dono).
 */
export type MailClassifier = (input: {
  from: string;
  subject: string;
  date: string;
  text: string;
  links: string[];
  /** F15/M4: texto lido das imagens do corpo (OCR), quando o e-mail pode abri-las. */
  images?: string;
}) => Promise<MailClassifyOutput>;

/** F15/M4: baixa e lê as imagens do HTML (no worker: `readMailImages` com o download protegido e o Tesseract). */
export type MailImageReader = (html: string) => Promise<MailImageRead[]>;

/** Classes em que o e-mail pode trazer as fases ou a ação numa imagem. */
const IMAGE_CLASSES = new Set(["update", "interview_invite", "recruiter_contact"]);

/**
 * Pode abrir as imagens deste e-mail? (F15-5, regra do dono): só de e-mail ligado a uma candidatura já feita, nunca de
 * risco alto, e só de remetente confiável ou do domínio da vaga ou da empresa com a autenticação conferindo.
 */
export function mayReadMailImages(
  repos: Repos,
  msg: MailMessageRecord,
  parsed: ParsedMail,
  cls: MailClassifyOutput,
): boolean {
  if (!IMAGE_CLASSES.has(cls.class) || msg.riskLevel === "high" || !msg.riskLevel) return false;
  const app = mailApplicationOf(repos, msg, cls);
  if (!app || "review" in app) return false;
  if (msg.riskLevel === "trusted") return true;
  if (!authVerdict(parsed.authResults, domainOfAddress(msg.fromAddr)).aligned) return false;
  return senderMatchesPosting(msg.fromAddr, repos.postings.get(app.postingId));
}

/** O que foi lido fica ao lado do e-mail: "Ler de novo" não baixa de novo. */
const imagesCache = (dataDir: string, msg: MailMessageRecord) =>
  join(dataDir, `${msg.rawPath}.images.json`);

export const MAIL_DIGEST_PER_RUN = 100;
/** Modelo da classificação em Configurações › Modelos (padrão: Haiku). */
export const MAIL_MODEL_KEY = "models.mail_classify";

/** Erro passageiro do modelo (limite de uso, rede): para a rodada sem mexer no e-mail. */
class ModelCallError extends Error {}
/** Saída do modelo inválida para este e-mail: conta tentativas e, na segunda, o e-mail vira erro (revisão do M4). */
class ModelOutputError extends Error {}
const OUTPUT_ERRORS = new Set(["invalid_output", "structured_output_failed"]);
async function modelCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: unknown })?.code;
    if (typeof code === "string" && OUTPUT_ERRORS.has(code)) throw new ModelOutputError(msg);
    throw new ModelCallError(msg);
  }
}
export const MAIL_DIGEST_FAILURES_KEY = "mail.digestFailures";
/** Abaixo disso, "fora do assunto" vai para a revisão em vez de ser ignorado. */
export const MAIL_NOT_JOB_MIN_CONFIDENCE = 60;
const TEXT_MAX = 6000;
const LINKS_MAX = 40;

export interface MailDigestResult {
  digested: number;
  alerts: number;
  postingsCreated: number;
  classified: number;
  ignored: number;
}

export async function digestMail(input: {
  repos: Repos;
  dataDir: string;
  ctx: Pick<ScheduledContext, "log" | "item" | "count">;
  classify: MailClassifier | null;
  /** F15/M4: leitor das imagens; ausente, as imagens não são abertas. */
  readImages?: MailImageReader | null;
  limit?: number;
}): Promise<MailDigestResult> {
  const { repos, ctx } = input;
  const out: MailDigestResult = {
    digested: 0,
    alerts: 0,
    postingsCreated: 0,
    classified: 0,
    ignored: 0,
  };
  for (const msg of repos.mail.toDigest(input.limit ?? MAIL_DIGEST_PER_RUN)) {
    const at = () => new Date().toISOString();
    const label = msg.subject ?? "(sem assunto)";
    try {
      const parsed = await parseMail(readFileSync(join(input.dataDir, msg.rawPath)));
      const alert = parseJobAlert(parsed);
      let cls: MailClassifyOutput;
      let by: "code" | "model";
      let imageInfo: Array<{ url: string; skipped: string | null; chars: number }> | null = null;
      if (alert) {
        by = "code";
        cls = {
          class: "job_alert",
          confidence: 100,
          company: null,
          title: null,
          postingUrl: null,
          jobs: alert.items.map((i) => ({
            title: i.title,
            company: i.company,
            location: i.location,
            url: i.url,
          })),
          stageHint: null,
          interview: null,
          summary: `Alerta com ${alert.items.length} vaga(s).`,
          actions: [],
          process: null,
        };
      } else {
        if (!input.classify) continue; // sem modelo nesta execução: fica para a próxima
        by = "model";
        const ask = (images?: string) =>
          modelCall(
            () =>
              input.classify?.({
                from: parsed.fromName
                  ? `${parsed.fromName} <${parsed.fromAddr ?? ""}>`
                  : (parsed.fromAddr ?? ""),
                subject: parsed.subject,
                date: msg.receivedAt,
                text: parsed.text.slice(0, TEXT_MAX),
                links: parsed.links.slice(0, LINKS_MAX),
                ...(images ? { images } : {}),
              }) as Promise<MailClassifyOutput>,
          );
        cls = await ask();
        // F15/M4: imagens do corpo (as fases numa imagem): só com permissão, lidas por OCR e classificado de novo
        if (
          input.readImages &&
          parsed.html &&
          mailImageUrls(parsed.html).length &&
          mayReadMailImages(repos, msg, parsed, cls)
        ) {
          const cache = imagesCache(input.dataDir, msg);
          let reads: MailImageRead[];
          if (existsSync(cache)) reads = JSON.parse(readFileSync(cache, "utf8")) as MailImageRead[];
          else {
            reads = await input.readImages(parsed.html);
            writeFileSync(cache, JSON.stringify(reads));
          }
          const text = imagesText(reads);
          imageInfo = reads.map((r) => ({
            url: r.url,
            skipped: r.skipped,
            chars: r.text?.length ?? 0,
          }));
          ctx.count("images", reads.filter((r) => r.text).length);
          if (text) cls = await ask(text);
        }
      }
      const platform = alert?.platform ?? null;
      // revisão do M4: link vindo do modelo só vale se estiver nos links do próprio e-mail (nada de URL inventada)
      if (by === "model") {
        const allowed = new Set(
          parsed.links.map((l) => safeHttpUrl(l)).filter((l): l is string => !!l),
        );
        const keep = (u: string | null) => {
          const s = safeHttpUrl(u);
          return s && allowed.has(s) ? s : null;
        };
        cls = {
          ...cls,
          postingUrl: keep(cls.postingUrl),
          jobs: cls.jobs.map((j) => ({ ...j, url: keep(j.url) })),
          // F14/M6: o link da chamada do convite também precisa estar no e-mail
          interview: cls.interview ? { ...cls.interview, link: keep(cls.interview.link) } : null,
          // F15-2: o link da ação pedida também
          actions: (cls.actions ?? []).map((a) => ({ ...a, url: keep(a.url) })),
          process: cls.process ?? null,
        };
      }
      const trusted = msg.riskLevel === "trusted";
      if (cls.class === "job_alert") {
        const postings: string[] = [];
        let created = 0;
        for (const j of cls.jobs) {
          if (!j.title?.trim()) continue;
          const job: MailJobInput = {
            ...j,
            gmailId: msg.gmailId,
            platform,
            trusted,
            receivedAt: msg.receivedAt,
          };
          const r = intakePostingFromMail(repos, job);
          postings.push(r.posting.id);
          if (r.created) created++;
          ctx.item({
            kind: "posting",
            refId: r.posting.id,
            label: [j.title, j.company].filter(Boolean).join(" · "),
            action: r.created ? "vaga nova no feed" : "já estava salva",
            href: `/vagas/${r.posting.id}`,
          });
        }
        repos.mail.setResult(
          msg.id,
          {
            status: "done",
            class: "job_alert",
            confidence: cls.confidence,
            result: { by, ...cls, postings },
          },
          at(),
        );
        out.alerts++;
        out.postingsCreated += created;
      } else if (cls.class === "not_job") {
        const unsure = cls.confidence < MAIL_NOT_JOB_MIN_CONFIDENCE;
        repos.mail.setResult(
          msg.id,
          {
            status: unsure ? "review" : "ignored",
            class: "not_job",
            confidence: cls.confidence,
            result: { by, ...cls },
          },
          at(),
        );
        out.ignored++;
        ctx.item({
          kind: "mail",
          refId: msg.gmailId,
          label,
          action: unsure ? "para revisão" : "fora do assunto",
          result: "skipped",
          detail: cls.summary,
        });
        out.digested++;
        continue;
      } else {
        // candidatura, negativa, atualização, convite e contato: classificados aqui, aplicados no M5/M6
        repos.mail.setResult(
          msg.id,
          {
            status: "pending",
            class: cls.class,
            confidence: cls.confidence,
            result: { by, ...cls, ...(imageInfo ? { images: imageInfo } : {}) },
          },
          at(),
        );
        out.classified++;
      }
      ctx.item({
        kind: "mail",
        refId: msg.gmailId,
        label,
        action: `classificado: ${cls.class}`,
        detail: cls.summary,
      });
      out.digested++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // erro do modelo (limite de uso, fora do ar): para a rodada, este e o resto ficam para a próxima
      if (e instanceof ModelCallError) {
        ctx.log(
          "warn",
          `O modelo não respondeu (${error}); o processamento continua na próxima execução`,
        );
        break;
      }
      if (e instanceof ModelOutputError) {
        const failures = repos.settings.get<Record<string, number>>(MAIL_DIGEST_FAILURES_KEY) ?? {};
        const n = (failures[msg.gmailId] ?? 0) + 1;
        if (n < 2) {
          repos.settings.set(MAIL_DIGEST_FAILURES_KEY, { ...failures, [msg.gmailId]: n });
          ctx.log(
            "warn",
            `Resposta inválida do modelo para ${msg.gmailId} (tentativa ${n}); tento de novo na próxima`,
          );
          continue;
        }
        const { [msg.gmailId]: _gone, ...rest } = failures;
        repos.settings.set(MAIL_DIGEST_FAILURES_KEY, rest);
        repos.mail.setStatus(msg.id, "review", at(), { error });
        ctx.log("warn", `O modelo não conseguiu ler ${msg.gmailId}; vai para a revisão`);
        continue;
      }
      // e-mail que não dá para ler: erro nele, sem travar os outros
      repos.mail.setStatus(msg.id, "error", at(), { error });
      ctx.log("warn", `E-mail ${msg.gmailId} não foi processado: ${error}`);
    }
  }
  if (out.digested) {
    ctx.count("digested", out.digested);
    if (out.postingsCreated) ctx.count("postings", out.postingsCreated);
    ctx.log(
      "info",
      `${out.digested} e-mail(s) processado(s): ${out.alerts} alerta(s) com ${out.postingsCreated} vaga(s) nova(s), ${out.classified} classificado(s), ${out.ignored} fora do assunto`,
    );
  }
  return out;
}

/** `narnia-jobs` e lido nos processados (pedido do dono); falha do Gmail fica para a próxima execução. */
export async function syncDigestLabels(input: {
  repos: Repos;
  source: MailSource;
  ctx: Pick<ScheduledContext, "log">;
}) {
  const todo = input.repos.mail.digestToSync(500);
  if (!todo.length) return;
  try {
    const labels = await input.source.ensureLabels([MAIL_LABEL, MAIL_SUSPECT_LABEL]);
    await input.source.modify(
      todo.map((m) => m.gmailId),
      { add: [labels[MAIL_LABEL] as string], remove: ["UNREAD"] },
    );
    input.repos.mail.setGmailSynced(
      todo.map((m) => m.id),
      true,
      new Date().toISOString(),
    );
  } catch (e) {
    input.ctx.log(
      "warn",
      `Não consegui etiquetar ${todo.length} e-mail(s) processado(s) no Gmail; tento de novo na próxima (${(e as Error).message})`,
    );
  }
}
