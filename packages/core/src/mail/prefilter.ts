import { domainOfAddress, platformOf } from "./domains";
import type { ParsedMail } from "./risk";

/**
 * Pré-filtro por código (F14, plano §2.1): antes do modelo, separa o que é de vagas do que não é. A busca do Gmail já
 * filtra remetentes e assuntos; aqui saem as notificações das plataformas que não falam de vaga (convites e posts do
 * LinkedIn, comunidade do Glassdoor), que ficam intocadas no Gmail. O que sobra em dúvida vai ao modelo (M4).
 */
export type PrefilterDecision = "candidate" | "ignored" | "unknown";

export interface PrefilterResult {
  decision: PrefilterDecision;
  reason: string;
  platform: string | null;
  /** Dica para o M4: convite com `.ics`. */
  hasCalendar: boolean;
}

const JOB_WORDS =
  /\b(vagas?|candidatura|candidat[oa]s?|processo seletivo|sele[çc][ãa]o|entrevistas?|oportunidades?|recrutador[a]?|recrutamento|contrata[çc][ãa]o|application|applied|apply|interviews?|jobs?|positions?|roles?|hiring|openings?|recruiter|talent|offer)\b/i;
/**
 * Cargo no assunto (alerta de uma vaga só, sem "vaga" escrito: "Programador Junior na empresa X", "[1321] Pessoa
 * Desenvolvedora Fullstack"; correção 2026-11-11, os alertas do Glassdoor caíam como fora do assunto).
 */
const ROLE_WORDS =
  /\b(candidatar(-se)?|inscri[çc][ãa]o|contratando|est[áa]gio|na empresa|desenvolvedor[a]?|programador[a]?|engenheir[oa]|analista|arquitet[oa]|pessoa desenvolvedora|tech lead|developer|engineer|programmer|architect|devops|sre|fullstack|full[- ]stack|back[- ]?end|front[- ]?end)\b/i;
/** Canal do Indeed que só manda a confirmação da candidatura ("Inscrição via Indeed: …"). */
const INDEED_APPLY = /^indeedapply$/i;

/** Sistemas de candidatura (ATS): só escrevem sobre candidaturas. */
const ATS = new Set([
  "greenhouse",
  "lever",
  "workday",
  "successfactors",
  "gupy",
  "inhire",
  "solides",
  "kenoby",
  "smartrecruiters",
  "workable",
]);
/** Plataformas que também mandam notificações que não são de vaga. */
const BOARDS = new Set([
  "linkedin",
  "glassdoor",
  "indeed",
  "catho",
  "vagas",
  "infojobs",
  "coders",
  "nerdin",
  "programathor",
]);
/** Canais do LinkedIn que nunca são de vaga. */
const LINKEDIN_NOISE =
  /^(notifications-noreply|invitations|newsletters-noreply|groups-noreply|editors-noreply|security-noreply|updates-noreply)$/i;
/** Mensagens (de recrutador inclusive) repassadas pela plataforma: o assunto não diz se é vaga; o modelo decide. */
const MESSAGE_CHANNELS =
  /^(messages-noreply|messaging-digest-noreply|inmail|notifications-messages)/i;
const LINKEDIN_JOBS = /^(jobalerts-noreply|jobs-noreply|jobs-listings|inmail-hit-reply|hit-reply)/i;

export function prefilterMail(m: ParsedMail): PrefilterResult {
  const domain = domainOfAddress(m.fromAddr);
  const platform = platformOf(domain);
  const local = m.fromAddr?.split("@")[0] ?? "";
  const hasCalendar = m.attachments.some(
    (a) => /\.ics$/i.test(a.filename) || /text\/calendar/i.test(a.contentType),
  );
  const words = JOB_WORDS.test(m.subject);
  // cargo e palavras como "inscrição" só contam nas plataformas de vaga (revisão: inscrição em curso ou webinar de
  // qualquer remetente iria ao modelo; no LinkedIn, "fulano, engenheiro na X, viu seu perfil" é ruído)
  const role = ROLE_WORDS.test(m.subject);
  const base = { platform, hasCalendar };
  if (hasCalendar) return { decision: "candidate", reason: "convite de calendário", ...base };
  if (
    MESSAGE_CHANNELS.test(local) ||
    (platform === "indeed" && /indeedemail\.com$/.test(domain ?? ""))
  )
    return words
      ? { decision: "candidate", reason: "mensagem repassada pela plataforma", ...base }
      : {
          decision: "unknown",
          reason: "mensagem repassada pela plataforma; o modelo decide",
          ...base,
        };
  if (platform === "indeed" && INDEED_APPLY.test(local))
    return { decision: "candidate", reason: "confirmação de candidatura do Indeed", ...base };
  if (platform === "linkedin") {
    if (LINKEDIN_JOBS.test(local))
      return { decision: "candidate", reason: "canal de vagas do LinkedIn", ...base };
    if (LINKEDIN_NOISE.test(local) && !words)
      return { decision: "ignored", reason: "notificação do LinkedIn que não é de vaga", ...base };
  }
  if (platform && ATS.has(platform))
    return { decision: "candidate", reason: `sistema de candidatura (${platform})`, ...base };
  if (platform && BOARDS.has(platform))
    return words || role
      ? { decision: "candidate", reason: `plataforma de vagas (${platform})`, ...base }
      : { decision: "ignored", reason: `notificação de ${platform} sem assunto de vaga`, ...base };
  if (words) return { decision: "candidate", reason: "assunto de vaga", ...base };
  return { decision: "unknown", reason: "sem sinal claro; o modelo decide", ...base };
}
