import type { IngestionMode, RepoGroup, RepoPreviewItem } from "@narnia-jobs/shared";
import type { RepoInput } from "../../../db/repos/github";
import { type GhClient, GhError } from "./gh";

/** Coleta sem tokens do GitHub (F03 §2.2–§2.3): seletor agrupado, dados de um repositório, arquivos e diff. */

/** F03-2: pré-seleção dos 10 com push mais recente por grupo; aviso quando o total marcado passa de 10. */
export const PRESELECT_PER_GROUP = 10;
export const SELECTION_WARNING_THRESHOLD = 10;

interface GhRepoJson {
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  default_branch?: string | null;
  topics?: string[];
}

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

export function assertName(value: string, what: string): void {
  if (!SAFE_NAME.test(value)) throw new GhError("failed", `${what} inválido: ${value}`);
}

export function splitFullName(fullName: string): [string, string] {
  const [owner, name, ...rest] = fullName.split("/");
  if (!owner || !name || rest.length)
    throw new GhError("failed", `Repositório inválido: ${fullName}`);
  assertName(owner, "Dono");
  assertName(name, "Repositório");
  return [owner, name];
}

export function toPreviewItem(r: GhRepoJson): RepoPreviewItem {
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    url: r.html_url,
    description: r.description ?? null,
    isPrivate: Boolean(r.private),
    isFork: Boolean(r.fork),
    isArchived: Boolean(r.archived),
    language: r.language ?? null,
    stars: r.stargazers_count ?? 0,
    pushedAt: r.pushed_at ?? null,
    selected: false,
  };
}

const pushedMs = (r: Pick<RepoPreviewItem, "pushedAt">) =>
  r.pushedAt ? Date.parse(r.pushedAt) : 0;

function preselect(repos: RepoPreviewItem[]): RepoPreviewItem[] {
  const eligible = repos
    .filter((r) => !r.isFork && !r.isArchived)
    .sort((a, b) => pushedMs(b) - pushedMs(a) || a.fullName.localeCompare(b.fullName))
    .slice(0, PRESELECT_PER_GROUP);
  const chosen = new Set(eligible.map((r) => r.fullName));
  return [...repos]
    .sort((a, b) => pushedMs(b) - pushedMs(a) || a.fullName.localeCompare(b.fullName))
    .map((r) => ({ ...r, selected: chosen.has(r.fullName) }));
}

function group(
  key: string,
  kind: RepoGroup["kind"],
  label: string,
  repos: RepoPreviewItem[],
): RepoGroup {
  const list = preselect(repos);
  return {
    key,
    kind,
    label,
    total: list.length,
    selected: list.filter((r) => r.selected).length,
    repos: list,
  };
}

/** Grupos do seletor: Pessoais primeiro, depois uma linha por organização (ordem de chegada). */
export function groupRepos(input: {
  login: string;
  personal: RepoPreviewItem[];
  orgs: { login: string; repos: RepoPreviewItem[] }[];
}): RepoGroup[] {
  return [
    group("personal", "personal", input.login, input.personal),
    ...input.orgs.map((o) => group(o.login, "org", o.login, o.repos)),
  ];
}

export function selectedCount(groups: Pick<RepoGroup, "repos">[]): number {
  return groups.reduce((n, g) => n + g.repos.filter((r) => r.selected).length, 0);
}

export function selectionWarning(groups: Pick<RepoGroup, "repos">[]): boolean {
  return selectedCount(groups) > SELECTION_WARNING_THRESHOLD;
}

async function viewerLogin(gh: GhClient): Promise<string | null> {
  try {
    return (await gh.json<{ login: string }>("user")).login;
  } catch (e) {
    if (e instanceof GhError && e.code === "not_authenticated") return null;
    throw e;
  }
}

export interface GithubPreview {
  login: string;
  authenticated: boolean;
  groups: RepoGroup[];
}

/**
 * Seletor (F03-2). Privada: exige login; repositórios do próprio usuário (inclui privados) e das organizações.
 * Pública: só públicos; funciona sem login quando o usuário informa o `login` (limite anônimo de requisições).
 */
export async function previewGithub(
  gh: GhClient,
  o: { mode: IngestionMode; login?: string | null },
): Promise<GithubPreview> {
  const viewer = await viewerLogin(gh);
  if (o.mode === "private" && !viewer) {
    throw new GhError("not_authenticated", "A análise privada exige o GitHub conectado", {
      status: 401,
    });
  }
  const login = o.mode === "private" ? (viewer as string) : (o.login ?? viewer);
  if (!login) {
    throw new GhError("not_authenticated", "Informe o usuário do GitHub ou conecte a conta", {
      status: 401,
    });
  }
  assertName(login, "Usuário");
  const isPrivate = o.mode === "private";
  const personalPath = isPrivate
    ? "user/repos?affiliation=owner&per_page=100"
    : `users/${login}/repos?type=owner&per_page=100`;
  const orgsPath = isPrivate ? "user/orgs?per_page=100" : `users/${login}/orgs?per_page=100`;
  const [personalRaw, orgsRaw] = await Promise.all([
    gh.json<GhRepoJson[]>(personalPath, { paginate: true }),
    gh.json<{ login: string }[]>(orgsPath, { paginate: true }),
  ]);
  const keep = (r: GhRepoJson) => isPrivate || !r.private;
  const orgs = await Promise.all(
    orgsRaw.map(async (org) => {
      assertName(org.login, "Organização");
      const repos = await gh.json<GhRepoJson[]>(
        `orgs/${org.login}/repos?type=${isPrivate ? "all" : "public"}&per_page=100`,
        { paginate: true },
      );
      return { login: org.login, repos: repos.filter(keep).map(toPreviewItem) };
    }),
  );
  return {
    login,
    authenticated: viewer !== null,
    groups: groupRepos({ login, personal: personalRaw.filter(keep).map(toPreviewItem), orgs }),
  };
}

/* ---------- um repositório ---------- */

export interface TreeEntry {
  path: string;
  size: number;
}
export interface CollectedRepo {
  repo: RepoInput;
  readme: string | null;
  tree: { entries: TreeEntry[]; truncated: boolean };
  userCommits: { count: number; messages: string[] };
}

/**
 * Relevância determinística 0–1 (F03 §2.3): estrelas e commits do usuário (log), recência do push, não-fork e
 * README presente. Usada para ordenar evidências e como desempate; não decide seleção.
 */
export function repoRelevance(
  r: {
    stars: number;
    userCommits: number;
    pushedAt: string | null;
    isFork: boolean;
    hasReadme: boolean;
  },
  now: Date = new Date(),
): number {
  const stars = Math.min(1, Math.log10(1 + Math.max(0, r.stars)) / 3);
  const commits = Math.min(1, Math.log10(1 + Math.max(0, r.userCommits)) / 2.5);
  const ageDays = r.pushedAt ? (now.getTime() - Date.parse(r.pushedAt)) / 86_400_000 : Infinity;
  const recency = Number.isFinite(ageDays) ? Math.max(0, 1 - Math.max(0, ageDays) / 730) : 0;
  const score =
    0.25 * stars +
    0.3 * commits +
    0.25 * recency +
    0.1 * (r.isFork ? 0 : 1) +
    0.1 * (r.hasReadme ? 1 : 0);
  return Math.round(score * 1000) / 1000;
}

export async function collectRepo(
  gh: GhClient,
  fullName: string,
  o: { login: string; maxCommitMessages?: number; now?: Date },
): Promise<CollectedRepo> {
  const [owner, name] = splitFullName(fullName);
  assertName(o.login, "Usuário");
  const base = `repos/${owner}/${name}`;
  const meta = await gh.json<GhRepoJson>(base);
  const branch = meta.default_branch ?? "main";
  const [languages, head, readme, commits] = await Promise.all([
    gh.json<Record<string, number>>(`${base}/languages`),
    gh.tryJson<{ sha: string }>(`${base}/commits/${encodeURIComponent(branch)}`),
    gh.tryRaw(`${base}/readme`),
    gh.tryJson<{ commit: { message: string } }[]>(
      `${base}/commits?author=${o.login}&per_page=100`,
      { paginate: true },
    ),
  ]);
  const headSha = head?.sha ?? null;
  const tree = headSha
    ? await gh.tryJson<{
        tree: { path: string; type: string; size?: number }[];
        truncated: boolean;
      }>(`${base}/git/trees/${headSha}?recursive=1`)
    : null;
  const userCommits = commits ?? [];
  const firstLine = (m: string) => m.split("\n")[0]?.trim() ?? "";
  return {
    repo: {
      fullName: meta.full_name,
      owner: meta.owner.login,
      url: meta.html_url,
      description: meta.description ?? null,
      isPrivate: Boolean(meta.private),
      isFork: Boolean(meta.fork),
      isArchived: Boolean(meta.archived),
      languages,
      topics: meta.topics ?? [],
      stars: meta.stargazers_count ?? 0,
      pushedAt: meta.pushed_at ?? null,
      defaultBranch: branch,
      headSha,
      relevance: repoRelevance(
        {
          stars: meta.stargazers_count ?? 0,
          userCommits: userCommits.length,
          pushedAt: meta.pushed_at ?? null,
          isFork: Boolean(meta.fork),
          hasReadme: readme !== null,
        },
        o.now,
      ),
    },
    readme,
    tree: {
      entries: (tree?.tree ?? [])
        .filter((e) => e.type === "blob")
        .map((e) => ({ path: e.path, size: e.size ?? 0 })),
      truncated: Boolean(tree?.truncated),
    },
    userCommits: {
      count: userCommits.length,
      messages: userCommits
        .slice(0, o.maxCommitMessages ?? 30)
        .map((c) => firstLine(c.commit.message)),
    },
  };
}

export interface FetchedFile {
  path: string;
  content: string;
  truncated: boolean;
}

/** Conteúdo só dos caminhos escolhidos (F03-4: API, sem clone), cortado em `maxChars`; inexistentes são pulados. */
export async function fetchFiles(
  gh: GhClient,
  fullName: string,
  ref: string,
  paths: string[],
  o: { maxChars: number },
): Promise<FetchedFile[]> {
  const [owner, name] = splitFullName(fullName);
  const out: FetchedFile[] = [];
  for (const path of paths) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const raw = await gh.tryRaw(`repos/${owner}/${name}/contents/${encoded}?ref=${ref}`);
    if (raw === null) continue;
    out.push({ path, content: raw.slice(0, o.maxChars), truncated: raw.length > o.maxChars });
  }
  return out;
}

export interface CompareResult {
  base: string;
  head: string;
  aheadBy: number;
  messages: string[];
  files: {
    path: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string | null;
  }[];
}

/** Diff desde o commit analisado (F03-3 §7, `compare/{base}...{head}`). */
export async function fetchCompare(
  gh: GhClient,
  fullName: string,
  base: string,
  head: string,
): Promise<CompareResult> {
  const [owner, name] = splitFullName(fullName);
  const c = await gh.json<{
    ahead_by: number;
    commits: { commit: { message: string } }[];
    files?: {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }[];
  }>(`repos/${owner}/${name}/compare/${base}...${head}`);
  return {
    base,
    head,
    aheadBy: c.ahead_by,
    messages: c.commits.map((x) => x.commit.message.split("\n")[0]?.trim() ?? ""),
    files: (c.files ?? []).map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
  };
}

/** Texto compacto do diff para o modelo: mensagens, arquivos com contagem e patches cortados. */
export function summarizeCompare(c: CompareResult, o: { maxPatchChars: number }): string {
  const lines = [
    `Diff ${c.base.slice(0, 7)}...${c.head.slice(0, 7)} (${c.aheadBy} commits)`,
    "Commits:",
    ...c.messages.map((m) => `- ${m}`),
    "Arquivos:",
  ];
  let budget = o.maxPatchChars;
  for (const f of c.files) {
    lines.push(`- ${f.path} (${f.status}, +${f.additions} -${f.deletions})`);
    if (f.patch && budget > 0) {
      const cut = f.patch.slice(0, budget);
      budget -= cut.length;
      lines.push(cut + (cut.length < f.patch.length ? "\n[patch truncado]" : ""));
    } else if (f.patch) {
      lines.push("[patch truncado]");
    }
  }
  return lines.join("\n");
}
