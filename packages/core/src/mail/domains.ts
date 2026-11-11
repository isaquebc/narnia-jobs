import { getDomain } from "tldts";

/**
 * Domínios conhecidos (F14-13, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.7): plataformas de vagas e ATS (a base
 * da confiabilidade e da detecção de domínio parecido), webmails (recrutador individual; só por endereço na lista de
 * remetentes) e encurtadores. Tudo por código, sem modelo.
 */

/**
 * Domínio registrável pela Public Suffix List (`tldts`, revisão do M3): `mail.linkedin.com` → `linkedin.com`,
 * `acme.ind.br` → `acme.ind.br` (a lista curta tratava `ind.br` como o domínio), `x.github.io` → `x.github.io`.
 */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

export const domainOfAddress = (addr: string | null): string | null => {
  const at = addr?.lastIndexOf("@") ?? -1;
  return addr && at > 0 ? addr.slice(at + 1).toLowerCase() : null;
};

/** Marca → domínios registráveis dela (o e-mail legítimo vem de um desses). */
export const PLATFORMS: Record<string, string[]> = {
  linkedin: ["linkedin.com", "lnkd.in", "linkedin.cn"],
  glassdoor: [
    "glassdoor.com",
    "glassdoor.com.br",
    "glassdoor.co.uk",
    "glassdoor.ca",
    "glassdoor.de",
    "glassdoor.fr",
    "glassdoor.co.in",
    "glassdoor.com.au",
    "glassdoor.ie",
    "glassdoor.es",
  ],
  indeed: ["indeed.com", "indeedemail.com"],
  gupy: ["gupy.io", "gupy.com.br"],
  catho: ["catho.com.br"],
  vagas: ["vagas.com.br"],
  infojobs: ["infojobs.com.br", "infojobs.net"],
  greenhouse: ["greenhouse.io", "greenhouse-mail.io"],
  lever: ["lever.co"],
  workday: ["myworkday.com", "workday.com", "myworkdayjobs.com", "myworkdaysite.com"],
  successfactors: ["jobs2web.com", "successfactors.com", "successfactors.eu", "sap.com"],
  inhire: ["inhire.app", "inhire.com.br"],
  coders: ["coders.com.br"],
  nerdin: ["nerdin.com.br"],
  smartrecruiters: ["smartrecruiters.com"],
  workable: ["workablemail.com", "workable.com"],
  kenoby: ["kenoby.com"],
  solides: ["solides.com.br", "solides.jobs"],
  programathor: ["programathor.com.br"],
  google: ["google.com"],
};

const PLATFORM_OF = new Map<string, string>(
  Object.entries(PLATFORMS).flatMap(([brand, ds]) => ds.map((d) => [d, brand] as const)),
);

/** Marca da plataforma do domínio (registrável), ou null. */
export const platformOf = (domain: string | null): string | null =>
  domain ? (PLATFORM_OF.get(registrableDomain(domain)) ?? null) : null;

export const WEBMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
]);

export const isWebmail = (domain: string | null) =>
  !!domain && WEBMAIL_DOMAINS.has(domain.toLowerCase());

export const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "cutt.ly",
  "rebrand.ly",
  "is.gd",
  "ow.ly",
  "shorturl.at",
  "rb.gy",
  "encurtador.com.br",
]);

/** Troca os caracteres que imitam outros (0→o, 1→l, rn→m, vv→w) para comparar domínios. */
function skeleton(label: string): string {
  return label
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[1|]/g, "l")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[-_]/g, "");
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] as number;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] as number;
      dp[j] = Math.min(
        (dp[j] as number) + 1,
        (dp[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length] as number;
}

/**
 * Domínio que imita uma plataforma sem ser dela (`linkedln.com`, `xn--lnkedin-…`, `linkedin-vagas.com`): devolve a
 * marca imitada, ou null.
 */
export function lookalikeOf(domain: string | null): string | null {
  if (!domain) return null;
  const reg = registrableDomain(domain);
  if (PLATFORM_OF.has(reg)) return null;
  const label = reg.split(".")[0] ?? "";
  for (const [brand, ds] of Object.entries(PLATFORMS)) {
    if (brand === "google" || brand === "vagas") continue; // nomes comuns demais para comparar
    for (const d of ds) {
      const target = d.split(".")[0] ?? "";
      if (target.length < 5) continue;
      if (reg.startsWith("xn--") && editDistance(skeleton(label), skeleton(target)) <= 3)
        return brand;
      if (skeleton(label) === skeleton(target)) return brand;
      // distância só em nomes longos (com 5 a 7 letras há palavras comuns a uma letra: "orders" e "coders")
      if (target.length >= 8 && editDistance(label, target) <= 2) return brand;
      if (target.length >= 6 && label.includes(target) && label !== target) return brand;
    }
  }
  return null;
}

/** Marca citada no nome de exibição ("LinkedIn Vagas", "Equipe Gupy"). */
export function brandInName(name: string | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const brand of Object.keys(PLATFORMS)) {
    if (brand === "google" || brand === "vagas") continue;
    if (new RegExp(`\\b${brand}\\b`, "i").test(n)) return brand;
  }
  return null;
}
