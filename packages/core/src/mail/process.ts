import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "../db";
import type { ScheduledContext } from "../scheduler";
import { MAIL_LABEL, MAIL_SUSPECT_LABEL } from "./connection";
import { isWebmail, platformOf, registrableDomain } from "./domains";
import { prefilterMail } from "./prefilter";
import { assessMailRisk, parseMail } from "./risk";
import type { MailSource } from "./source";

/**
 * Primeira etapa do processamento (F14/M3, §2.7): para cada e-mail baixado e ainda não avaliado, do mais antigo para
 * o mais novo, calcula o risco e o pré-filtro. Risco alto vai para a quarentena (etiqueta `narnia-jobs/suspeito`,
 * continua não lido, F14-14); fora do assunto fica `ignored` e intocado no Gmail; o resto espera o modelo (M4) como
 * `candidate` ou `unknown`, com o risco gravado.
 */
export const MAIL_ASSESS_PER_RUN = 300;

export interface MailAssessResult {
  assessed: number;
  quarantined: number;
  ignored: number;
  forModel: number;
}

/**
 * Domínios dos sites das vagas em que a pessoa se candidatou (link da vaga e site da empresa), pedido do dono
 * 2026-11-12: a empresa que responde do próprio domínio é confiável. Quadros de vagas e webmail ficam de fora (o
 * LinkedIn na lista não diz nada sobre quem escreve).
 */
export function appliedSiteDomains(repos: Repos): Set<string> {
  const out = new Set<string>();
  for (const a of repos.jobApplications.list()) {
    const p = repos.postings.get(a.postingId);
    for (const raw of [p?.postingUrl, p?.companyUrl]) {
      if (!raw) continue;
      let host: string;
      try {
        host = new URL(raw).hostname.toLowerCase();
      } catch {
        continue;
      }
      const d = registrableDomain(host);
      if (!platformOf(d) && !isWebmail(d)) out.add(d);
    }
  }
  return out;
}

export async function assessPendingMail(input: {
  repos: Repos;
  dataDir: string;
  source: MailSource | null;
  ctx: Pick<ScheduledContext, "log" | "item" | "count">;
  limit?: number;
}): Promise<MailAssessResult> {
  const { repos, ctx } = input;
  const out: MailAssessResult = { assessed: 0, quarantined: 0, ignored: 0, forModel: 0 };
  const applied = appliedSiteDomains(repos);
  for (const msg of repos.mail.unassessed(input.limit ?? MAIL_ASSESS_PER_RUN)) {
    const at = new Date().toISOString();
    try {
      const parsed = await parseMail(readFileSync(join(input.dataDir, msg.rawPath)));
      const risk = assessMailRisk(parsed, repos.mailSenders, applied);
      const pre = prefilterMail(parsed);
      if (risk.sender.address) repos.mailSenders.bump(risk.sender.address, "seen", at);
      const label = msg.subject ?? "(sem assunto)";
      // fora do assunto fica intocado no Gmail mesmo com risco (revisão do M3: nada de etiqueta em post do LinkedIn)
      if (risk.level === "high" && pre.decision !== "ignored") {
        repos.mail.setAssessment(
          msg.id,
          {
            status: "quarantine",
            class: pre.decision,
            riskLevel: "high",
            riskReasons: risk.reasons,
          },
          at,
        );
        out.quarantined++;
        ctx.item({
          kind: "mail",
          refId: msg.gmailId,
          label,
          action: "quarentena",
          result: "skipped",
          detail: risk.reasons.join("; "),
        });
      } else if (pre.decision === "ignored") {
        repos.mail.setAssessment(
          msg.id,
          { status: "ignored", class: "ignored", riskLevel: risk.level, riskReasons: risk.reasons },
          at,
        );
        out.ignored++;
        ctx.item({
          kind: "mail",
          refId: msg.gmailId,
          label,
          action: "fora do assunto",
          result: "skipped",
          detail: pre.reason,
        });
      } else {
        repos.mail.setAssessment(
          msg.id,
          {
            status: "pending",
            class: pre.decision,
            riskLevel: risk.level,
            riskReasons: risk.reasons,
          },
          at,
        );
        out.forModel++;
        ctx.item({
          kind: "mail",
          refId: msg.gmailId,
          label,
          action: risk.level === "trusted" ? "confiável, para análise" : "para análise",
          detail: [pre.reason, ...risk.reasons].join("; "),
        });
      }
      out.assessed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      repos.mail.setStatus(msg.id, "error", at, { error });
      ctx.log("warn", `E-mail ${msg.gmailId} não pôde ser lido: ${error}`);
    }
  }
  if (out.assessed) {
    ctx.count("assessed", out.assessed);
    if (out.quarantined) ctx.count("quarantined", out.quarantined);
    if (out.ignored) ctx.count("ignored", out.ignored);
    ctx.log(
      "info",
      `${out.assessed} avaliado(s): ${out.quarantined} em quarentena, ${out.ignored} fora do assunto, ${out.forModel} para análise`,
    );
  }
  if (input.source) await syncQuarantineLabels({ repos, source: input.source, ctx });
  return out;
}

/**
 * Etiqueta `narnia-jobs/suspeito` nos e-mails em quarentena (sem marcar como lido) e tira dos que saíram dela
 * (reprocessados depois de confiar no remetente). Falha do Gmail fica para a próxima execução.
 */
export async function syncQuarantineLabels(input: {
  repos: Repos;
  source: MailSource;
  ctx: Pick<ScheduledContext, "log">;
}) {
  const add = input.repos.mail.quarantineToSync(500);
  const remove = input.repos.mail.suspectToRemove(500);
  if (!add.length && !remove.length) return;
  try {
    const labels = await input.source.ensureLabels([MAIL_LABEL, MAIL_SUSPECT_LABEL]);
    const suspect = labels[MAIL_SUSPECT_LABEL] as string;
    const at = new Date().toISOString();
    if (add.length) {
      await input.source.modify(
        add.map((m) => m.gmailId),
        { add: [suspect] },
      );
      input.repos.mail.setSuspectLabel(
        add.map((m) => m.id),
        true,
        at,
      );
    }
    if (remove.length) {
      await input.source.modify(
        remove.map((m) => m.gmailId),
        { remove: [suspect] },
      );
      input.repos.mail.setSuspectLabel(
        remove.map((m) => m.id),
        false,
        at,
      );
    }
  } catch (e) {
    input.ctx.log(
      "warn",
      `Não consegui atualizar a etiqueta de quarentena de ${add.length + remove.length} e-mail(s) no Gmail; tento de novo na próxima (${(e as Error).message})`,
    );
  }
}
