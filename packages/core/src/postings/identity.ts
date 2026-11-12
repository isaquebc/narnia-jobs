import { createHash } from "node:crypto";
import { POSTING_IDENTITY_FIELDS, type PostingFields } from "@narnia-jobs/shared";

/**
 * Identidade da vaga (F06-2, F06-9): empresa + cliente + cargo + role, sem a data de publicação. Caixa, acentos,
 * pontuação e espaços não contam ("Itaú Unibanco S.A." = "itau unibanco sa"). Sem empresa nem cargo/role não há
 * identidade (null): a vaga ainda não tem dados para comparar.
 */
export function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function postingIdentityHash(
  fields: {
    [K in (typeof POSTING_IDENTITY_FIELDS)[number]]?: PostingFields[K] | undefined;
  },
): string | null {
  const company = normalizeIdentityPart(fields.company);
  if (!company || !(fields.title || fields.role)) return null;
  const parts = POSTING_IDENTITY_FIELDS.map((k) => `${k}=${normalizeIdentityPart(fields[k])}`);
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Sufixos jurídicos: não distinguem a empresa ("Initech Ltda." = "initech"). */
const COMPANY_LEGAL =
  /\b(ltda|ltd|s ?a|inc|llc|gmbh|eireli|epp|corp|corporation|co|company|plc|ag|bv|sarl|srl)\b/g;

/** Nomes genéricos (empresa escondida): nunca são a mesma empresa por nome (revisão: "Empresa Confidencial"). */
export const COMPANY_GENERIC_NAME =
  /^(empresa )?(confidencial|sigilos[oa]|anonim[oa]|confidential|undisclosed|stealth( startup)?|empresa|company|cliente|client|consultoria)$/;

/**
 * Palavras que podem sobrar quando um nome contém o outro sem mudar a empresa ("Nubank" e "Nubank Tecnologia",
 * "Boticário" e "Grupo Boticário"); qualquer outra palavra a mais é outra empresa ("Itaú" e "Itaú BBA").
 */
const COMPANY_EXTRA = new Set([
  "tecnologia",
  "tecnologias",
  "technology",
  "technologies",
  "tech",
  "software",
  "solutions",
  "solucoes",
  "sistemas",
  "systems",
  "digital",
  "labs",
  "servicos",
  "services",
  "informatica",
  "brasil",
  "brazil",
  "br",
  "latam",
  "grupo",
  "group",
  "holding",
  "global",
  "do",
  "da",
  "de",
]);

export function companyKey(company: string | null | undefined): string {
  return normalizeIdentityPart(company).replace(COMPANY_LEGAL, " ").replace(/\s+/g, " ").trim();
}

/**
 * Mesma empresa: igual sem os sufixos jurídicos, ou um nome contido no outro por palavras inteiras com só palavras
 * genéricas a mais (revisão 2026-11-11). Nome genérico ("Confidencial") nunca casa.
 */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb || COMPANY_GENERIC_NAME.test(ka) || COMPANY_GENERIC_NAME.test(kb)) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length < 3 || !` ${long} `.includes(` ${short} `)) return false;
  const rest = ` ${long} `.replace(` ${short} `, " ").trim().split(" ").filter(Boolean);
  return rest.every((w) => COMPANY_EXTRA.has(w));
}

const TITLE_STOP = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "com",
  "the",
  "of",
  "and",
  "for",
  "a",
  "o",
  "as",
  "os",
  "at",
  "in",
  "to",
]);
const TITLE_SYNONYM: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  pl: "pleno",
  dev: "desenvolvedor",
  developer: "desenvolvedor",
  desenvolvedora: "desenvolvedor",
  desenvolvimento: "desenvolvedor",
  engineer: "engenheiro",
  engenheira: "engenheiro",
  ii: "2",
  iii: "3",
  iv: "4",
};

/**
 * Palavras que não mudam a vaga (modo, lugar, "pessoa", "vaga"): duas vagas que diferem só nelas são a mesma
 * ("Desenvolvedor Backend Sênior | Remoto" = "Desenvolvedor Backend Sênior").
 */
const TITLE_GENERIC = new Set([
  "remoto",
  "remota",
  "remote",
  "hibrido",
  "hybrid",
  "presencial",
  "onsite",
  "home",
  "office",
  "work",
  "trabalho",
  "100",
  "pessoa",
  "vaga",
  "brasil",
  "brazil",
  "latam",
  "sp",
  "rj",
  "full",
  "time",
  "integral",
  "clt",
  "pj",
]);

/**
 * Palavras do cargo: sem código da vaga ("3672:", "[1321]", "REF#304481", "ID95927"), sem a marca de gênero "(a)",
 * sem conectivos, com sinônimos; "C#", "C++", ".NET" e "full stack"/"back end"/"front end" viram uma palavra só
 * (revisão: "C#" e "C++" eram a mesma vaga). Níveis curtos ("2", "II") ficam: "Analista 1" ≠ "Analista 2".
 */
export function titleTokens(title: string | null | undefined): Set<string> {
  const pre = (title ?? "")
    .replace(/c#/gi, " csharp ")
    .replace(/c\+\+/gi, " cpp ")
    .replace(/f#/gi, " fsharp ")
    .replace(/\.net\b/gi, " dotnet ")
    .replace(/\b(ref|id|cod|codigo|código)\s*#?\s*\d+/gi, " ");
  const words = normalizeIdentityPart(pre)
    .replace(/\bfull stack\b/g, "fullstack")
    .replace(/\bback end\b/g, "backend")
    .replace(/\bfront end\b/g, "frontend")
    .split(" ")
    .map((w) => TITLE_SYNONYM[w] ?? w)
    // código da vaga: número de 3 dígitos ou mais; letra solta é a marca de gênero
    .filter(
      (w) => w && !/^\d{3,}$/.test(w) && (w.length > 1 || /\d/.test(w)) && !TITLE_STOP.has(w),
    );
  return new Set(words);
}

/** Semelhança de dois cargos (Dice das palavras, 0–1). */
export function titleSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/**
 * Mesmo cargo: as mesmas palavras, a menos das que não mudam a vaga (modo, lugar). Qualquer outra diferença —
 * senioridade, especialidade, linguagem, nível — é outra vaga ("Senior Software Engineer" ≠ "Software Engineer").
 */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return false;
  for (const w of ta) if (!tb.has(w) && !TITLE_GENERIC.has(w)) return false;
  for (const w of tb) if (!ta.has(w) && !TITLE_GENERIC.has(w)) return false;
  return true;
}

/** Cargo parecido (na dúvida, revisão): semelhança a partir daqui. */
export const TITLE_NEAR = 0.5;
