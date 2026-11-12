import type { Posting, PostingRole } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { roleIn, seniorityIn } from "../postings/heuristics";
import { titleSimilarity } from "../postings/identity";
import { postingRisks, SENIORITY_RANK } from "../postings/match";

/**
 * Score provisório (F14-16, decisão do dono 2026-11-11): a vaga do alerta sem descrição (o LinkedIn recusa robôs pelo
 * `robots.txt`) ganha um score só pelo que o alerta traz — cargo, senioridade e local — contra cada perfil não
 * arquivado, sem tokens. Serve para tirar do caminho o que claramente não serve; o score completo (pela descrição, que
 * chega pela extensão ou pelo link) toma o lugar, e o provisório nunca dispara a pré-análise automática.
 */

/** Cargo de quem escreve software, sem dizer a especialidade ("Software Engineer", "Desenvolvedor"). */
const DEV_TITLE =
  /desenvolvedor|developer|\bdev\b|engineer|engenheir|programador|programmer|software|\bswe\b/;

/** Especialidades vizinhas: quem faz uma costuma servir para a outra. */
const NEAR_ROLES: Partial<Record<PostingRole, PostingRole[]>> = {
  fullstack: ["backend", "frontend"],
  backend: ["fullstack", "platform", "architect", "tech_lead"],
  frontend: ["fullstack", "mobile"],
  mobile: ["frontend"],
  platform: ["backend", "devops_sre"],
  devops_sre: ["platform"],
  data_engineering: ["backend", "ml_engineering"],
  ml_engineering: ["data_science", "data_engineering", "backend"],
  data_science: ["ml_engineering"],
  architect: ["backend", "fullstack", "tech_lead"],
  tech_lead: ["backend", "fullstack", "architect"],
};

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Quanto o cargo da vaga combina com os cargos do perfil (0–1). */
function roleFit(postingTitle: string, profileTitles: string[]): number {
  const t = plain(postingTitle);
  const role = roleIn(postingTitle);
  const dev = DEV_TITLE.test(t);
  const words = Math.max(0, ...profileTitles.map((p) => titleSimilarity(postingTitle, p)));
  let best = words;
  for (const p of profileTitles) {
    const mine = roleIn(p);
    const mineDev = DEV_TITLE.test(plain(p));
    let fit = 0;
    if (role && mine && role === mine) fit = 1;
    else if (role && mine && NEAR_ROLES[mine]?.includes(role)) fit = 0.75;
    // "Senior Software Engineer": de software, sem especialidade; serve, mas não tanto quanto a mesma especialidade
    else if (!role && dev && mineDev) fit = 0.7;
    else if (role && mine) fit = 0.25;
    else if (dev && mineDev) fit = 0.5;
    best = Math.max(best, fit);
  }
  return best;
}

/** Senioridade da vaga (pelo cargo) contra a do perfil: igual 1; um degrau 0,85; dois 0,5; mais 0,2; não diz 0,9. */
function seniorityFit(postingTitle: string, profileSeniority: string): number {
  const asked = seniorityIn(postingTitle);
  const a = asked ? SENIORITY_RANK[asked] : undefined;
  const b = SENIORITY_RANK[profileSeniority];
  if (a === undefined || b === undefined) return 0.9;
  const d = Math.abs(a - b);
  return d === 0 ? 1 : d === 1 ? 0.85 : d === 2 ? 0.5 : 0.2;
}

/** Score provisório da vaga (0–100), o melhor entre os perfis; null sem cargo ou sem perfil. */
export function provisionalMatchScore(repos: Repos, posting: Posting): number | null {
  if (!posting.title) return null;
  const profiles = repos.profiles.list();
  if (!profiles.length) return null;
  const user = repos.users.get();
  let best: number | null = null;
  for (const p of profiles) {
    const titles = [p.targetTitle, ...(p.altTitles ?? [])].filter(Boolean);
    const base = 100 * roleFit(posting.title, titles) * seniorityFit(posting.title, p.seniority);
    // local e modo de trabalho do alerta (a senioridade já entrou acima)
    const risks = postingRisks(
      { workMode: posting.workMode, city: posting.city, state: posting.state },
      p,
      user,
    ).length;
    const score = Math.max(0, Math.min(100, Math.round(base - 15 * risks)));
    best = best === null ? score : Math.max(best, score);
  }
  return best;
}

/**
 * Preenche o provisório das vagas do e-mail sem score completo (as novas e as que já estavam no feed). Roda a cada
 * leitura; devolve quantas mudaram.
 */
export function refreshProvisionalScores(repos: Repos, limit = 2000): number {
  let n = 0;
  for (const p of repos.postings.needingProvisionalScore(limit)) {
    const score = provisionalMatchScore(repos, p);
    if (score === p.matchScore) continue;
    repos.postings.setProvisionalScore(p.id, score);
    n++;
  }
  return n;
}
