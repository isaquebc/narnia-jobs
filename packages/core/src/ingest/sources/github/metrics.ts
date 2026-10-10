import type { GithubMetrics } from "@narnia-jobs/shared";
import type { Repos } from "../../../db";
import { assertName, splitFullName } from "./collect";
import { type GhClient, GhError } from "./gh";

/**
 * Métricas quantitativas sem tokens (F03-3 §3, F03 §2.3): por repositório, por ano e globais. Uma consulta GraphQL
 * por repositório e uma para todos os anos (buscas com apelido), para não esgotar o limite da API de busca REST.
 */

type Base = Omit<GithubMetrics, "ossRepos" | "externalContributions">;
const ZERO: Base = {
  commits: 0,
  prsOpened: 0,
  prsMerged: 0,
  prsClosed: 0,
  reviewsApproved: 0,
  issuesOpened: 0,
  issuesClosed: 0,
};
const FIELDS = Object.keys(ZERO) as (keyof Base)[];

export function sumMetrics(list: GithubMetrics[]): Base {
  const out = { ...ZERO };
  for (const m of list) for (const f of FIELDS) out[f] += m[f];
  return out;
}

const SAFE_ID = /^[A-Za-z0-9_=-]+$/;
const q = (s: string) => JSON.stringify(s);
const search = (alias: string, query: string) =>
  `${alias}: search(query: ${q(query)}, type: ISSUE, first: 0) { issueCount }`;
type Count = { issueCount: number } | null | undefined;
const n = (c: Count) => c?.issueCount ?? 0;

export async function collectRepoMetrics(
  gh: GhClient,
  o: { fullName: string; login: string; userId: string },
): Promise<GithubMetrics> {
  const [owner, name] = splitFullName(o.fullName);
  assertName(o.login, "Usuário");
  if (!SAFE_ID.test(o.userId)) throw new GhError("failed", `Id de usuário inválido: ${o.userId}`);
  const scope = `repo:${owner}/${name}`;
  const query = `query RepoMetrics($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit { history(author: { id: ${q(o.userId)} }) { totalCount } } } }
  }
  ${search("prsOpen", `${scope} type:pr author:${o.login} is:open`)}
  ${search("prsMerged", `${scope} type:pr author:${o.login} is:merged`)}
  ${search("prsClosed", `${scope} type:pr author:${o.login} is:closed is:unmerged`)}
  ${search("reviews", `${scope} type:pr reviewed-by:${o.login} -author:${o.login} review:approved`)}
  ${search("issuesOpened", `${scope} type:issue author:${o.login}`)}
  ${search("issuesClosed", `${scope} type:issue author:${o.login} is:closed`)}
}`;
  const d = await gh.graphql<{
    repository: {
      defaultBranchRef: { target: { history?: { totalCount: number } } | null } | null;
    } | null;
    prsOpen: Count;
    prsMerged: Count;
    prsClosed: Count;
    reviews: Count;
    issuesOpened: Count;
    issuesClosed: Count;
  }>(query, { owner, name });
  return {
    commits: d.repository?.defaultBranchRef?.target?.history?.totalCount ?? 0,
    prsOpened: n(d.prsOpen) + n(d.prsMerged) + n(d.prsClosed),
    prsMerged: n(d.prsMerged),
    prsClosed: n(d.prsClosed),
    reviewsApproved: n(d.reviews),
    issuesOpened: n(d.issuesOpened),
    issuesClosed: n(d.issuesClosed),
  };
}

export interface GithubMetricsResult {
  login: string;
  userId: string;
  years: { year: number; metrics: GithubMetrics }[];
  global: GithubMetrics;
  repos: { fullName: string; metrics: GithubMetrics }[];
  failed: string[];
  /** Métricas não coletadas: a API GraphQL do GitHub exige login (análise pública anônima). */
  unavailable?: "not_authenticated";
}

interface Contributions {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalIssueContributions: number;
  totalPullRequestReviewContributions: number;
}

async function yearMetrics(gh: GhClient, login: string, years: number[]) {
  if (!years.length) return [];
  const parts = years.map((y) => {
    const range = `created:${y}-01-01..${y}-12-31`;
    return `y${y}: user(login: $login) {
    contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions
    }
  }
  ${search(`y${y}_prsMerged`, `author:${login} type:pr is:merged ${range}`)}
  ${search(`y${y}_prsClosed`, `author:${login} type:pr is:closed is:unmerged ${range}`)}
  ${search(`y${y}_reviewsApproved`, `reviewed-by:${login} -author:${login} type:pr review:approved ${range}`)}
  ${search(`y${y}_issuesClosed`, `author:${login} type:issue is:closed ${range}`)}`;
  });
  const d = await gh.graphql<Record<string, unknown>>(
    `query YearMetrics($login: String!) {\n  ${parts.join("\n  ")}\n}`,
    { login },
  );
  return years.map((year) => {
    const c = (d[`y${year}`] as { contributionsCollection: Contributions } | null)
      ?.contributionsCollection;
    const count = (k: string) => n(d[`y${year}_${k}`] as Count);
    return {
      year,
      metrics: {
        commits: c?.totalCommitContributions ?? 0,
        prsOpened: c?.totalPullRequestContributions ?? 0,
        prsMerged: count("prsMerged"),
        prsClosed: count("prsClosed"),
        reviewsApproved: count("reviewsApproved"),
        issuesOpened: c?.totalIssueContributions ?? 0,
        issuesClosed: count("issuesClosed"),
      },
    };
  });
}

/**
 * Métricas globais (soma dos anos + open source próprios + contribuições em terceiros), por ano e por repositório.
 * Um repositório que falha vai para `failed` e não derruba os outros.
 */
export async function collectGithubMetrics(
  gh: GhClient,
  o: { login: string; repos: string[] },
): Promise<GithubMetricsResult> {
  assertName(o.login, "Usuário");
  let u: {
    user: {
      id: string;
      contributionsCollection: { contributionYears: number[] };
      ownRepos: { totalCount: number };
      contributedTo: { totalCount: number };
    };
  };
  try {
    u = await userMetrics(gh, o.login);
  } catch (e) {
    // a GraphQL do GitHub não aceita chamada anônima: a análise pública sem login segue sem as métricas
    if (e instanceof GhError && e.code === "not_authenticated") return emptyMetrics(o.login);
    throw e;
  }
  return collectWithUser(gh, o, u);
}

function emptyMetrics(login: string): GithubMetricsResult {
  return {
    login,
    userId: "",
    years: [],
    global: sumMetrics([]),
    repos: [],
    failed: [],
    unavailable: "not_authenticated",
  };
}

function userMetrics(gh: GhClient, login: string) {
  return gh.graphql<{
    user: {
      id: string;
      contributionsCollection: { contributionYears: number[] };
      ownRepos: { totalCount: number };
      contributedTo: { totalCount: number };
    };
  }>(
    `query UserMetrics($login: String!) {
  user(login: $login) {
    id
    contributionsCollection { contributionYears }
    ownRepos: repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) { totalCount }
    contributedTo: repositoriesContributedTo(includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, PULL_REQUEST_REVIEW]) { totalCount }
  }
}`,
    { login },
  );
}

async function collectWithUser(
  gh: GhClient,
  o: { login: string; repos: string[] },
  u: Awaited<ReturnType<typeof userMetrics>>,
): Promise<GithubMetricsResult> {
  const years = await yearMetrics(gh, o.login, u.user.contributionsCollection.contributionYears);
  const repos: GithubMetricsResult["repos"] = [];
  const failed: string[] = [];
  for (const fullName of o.repos) {
    try {
      repos.push({
        fullName,
        metrics: await collectRepoMetrics(gh, { fullName, login: o.login, userId: u.user.id }),
      });
    } catch (e) {
      if (e instanceof GhError && e.code !== "failed" && e.code !== "not_found") throw e;
      failed.push(fullName);
    }
  }
  return {
    login: o.login,
    userId: u.user.id,
    years,
    global: {
      ...sumMetrics(years.map((y) => y.metrics)),
      ossRepos: u.user.ownRepos.totalCount,
      externalContributions: u.user.contributedTo.totalCount,
    },
    repos,
    failed,
  };
}

const row = (label: string | number, m: GithubMetrics) =>
  `| ${label} | ${FIELDS.map((f) => m[f]).join(" | ")} |`;

/** Tabela compacta (Markdown) que entra no contexto do modelo e na tela de métricas. */
export function metricsTable(
  r: Pick<GithubMetricsResult, "global" | "years" | "repos" | "unavailable">,
): string {
  if (r.unavailable === "not_authenticated")
    return "Métricas do GitHub indisponíveis sem login (a API de contribuições exige autenticação).";
  return [
    "Métricas do GitHub (contagens do próprio usuário)",
    "| escopo | commits | PRs abertos | PRs mergeados | PRs fechados sem merge | revisões aprovadas | issues abertas | issues resolvidas |",
    "|---|---|---|---|---|---|---|---|",
    row("total", r.global),
    ...r.years.map((y) => row(y.year, y.metrics)),
    ...r.repos.map((x) => row(x.fullName, x.metrics)),
    `open source próprios: ${r.global.ossRepos ?? 0} · contribuições em repositórios de terceiros: ${r.global.externalContributions ?? 0}`,
  ].join("\n");
}

/** Grava em `github_metric`: global, por ano e por repositório já registrado em `repo`. */
export function persistMetrics(repos: Repos, r: GithubMetricsResult): void {
  if (r.unavailable) return; // sem login não há métricas: nada de gravar zeros como se fossem reais
  repos.githubMetrics.put({ scope: "global" }, r.global);
  for (const y of r.years) repos.githubMetrics.put({ scope: "year", year: y.year }, y.metrics);
  for (const x of r.repos) {
    const repo = repos.repos.getByFullName(x.fullName);
    if (repo) repos.githubMetrics.put({ scope: "repo", repoId: repo.id }, x.metrics);
  }
}
