import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhExec, GhExecResult } from "../ingest/sources/github/gh";

/**
 * Executor falso do `gh` sobre respostas gravadas (F03 M2) e sintetizadas (M3). Emula `gh api` com `--paginate`
 * (páginas JSON concatenadas, como o `gh` imprime), o Accept raw (texto), `gh api graphql` por nome da operação,
 * 404, 401 e rate limit. `ana-exemplo/api-pagamentos` usa respostas gravadas completas; os demais repositórios das
 * listagens recebem respostas sintéticas coerentes. Usado pelos testes e, com o provider mock, por api e worker
 * (estado compartilhado num arquivo JSON da pasta de dados: login, rate limit, commits novos por repositório).
 */
const DIR = join(import.meta.dirname, "github");
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const text = (f: string) => readFileSync(join(DIR, f), "utf8");

export const LOGIN = "ana-exemplo";
export const HEAD_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
export const BASE_SHA = "0f0e0d0c0b0a09080706050403020100ffeeddcc";
/** Nome do arquivo de estado do `gh` falso dentro da pasta de dados (provider mock). */
export const FAKE_GH_STATE_FILENAME = ".gh-fake.json";

export interface FakeGhState {
  /** false = sem login (`user` devolve 401; a análise privada exige login). */
  authenticated?: boolean;
  /** true = toda rota REST devolve 403 de rate limit. */
  rateLimited?: boolean;
  /** Commit atual por repositório (simula push novo para a análise incremental). */
  heads?: Record<string, string>;
  /** true = sem rede (toda chamada falha como `error connecting to api.github.com`). */
  offline?: boolean;
  /** Repositórios cujas rotas REST falham (HTTP 422, sem nova tentativa): e2e de "refazer este repositório". */
  failRepos?: string[];
}

type Route = () => GhExecResult;
const ok = (stdout: string): GhExecResult => ({ stdout, stderr: "", code: 0 });
const json = (v: unknown) => ok(JSON.stringify(v));
const pages = (f: string) => ok((load(f) as unknown[]).map((p) => JSON.stringify(p)).join(""));
export const notFound: GhExecResult = { stdout: "", stderr: "gh: Not Found (HTTP 404)", code: 1 };
export const unauthenticated: GhExecResult = {
  stdout: "",
  stderr: "gh: Requires authentication (HTTP 401)",
  code: 1,
};
export const rateLimitedResult: GhExecResult = {
  stdout: "",
  stderr: "gh: API rate limit exceeded for user. (HTTP 403)",
  code: 1,
};

export const offlineResult: GhExecResult = {
  stdout: "",
  stderr:
    "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com",
  code: 1,
};

const RECORDED = "ana-exemplo/api-pagamentos";
const contents = load("contents-api-pagamentos.json") as Record<string, string>;

interface ListedRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  default_branch?: string;
  [k: string]: unknown;
}

/** Todos os repositórios das listagens gravadas (usuário + organizações), por nome completo. */
function listedRepos(): Map<string, ListedRepo> {
  const files = [
    "user-repos.pages.json",
    "users-repos.pages.json",
    "org-acme-labs-all.pages.json",
    "org-coletivo-oss-all.pages.json",
  ];
  const out = new Map<string, ListedRepo>();
  for (const f of files) {
    for (const page of load(f) as ListedRepo[][]) for (const r of page) out.set(r.full_name, r);
  }
  return out;
}

/** Commit sintético e estável por repositório (40 hex). */
export function syntheticSha(fullName: string, salt = ""): string {
  return createHash("sha1").update(`${fullName}${salt}`).digest("hex");
}

function genericTree(name: string) {
  return {
    sha: "t",
    truncated: false,
    tree: [
      { path: "README.md", type: "blob", size: 900 },
      { path: "package.json", type: "blob", size: 400 },
      { path: ".github/workflows/ci.yml", type: "blob", size: 300 },
      { path: "src", type: "tree" },
      { path: "src/index.ts", type: "blob", size: 1200 },
      { path: `src/${name}.ts`, type: "blob", size: 2400 },
      { path: "test/index.test.ts", type: "blob", size: 800 },
    ],
  };
}

function genericContent(full: string, path: string, desc: string | null, lang: string): string {
  if (path === "package.json") {
    return JSON.stringify({
      name: full.split("/")[1],
      description: desc,
      scripts: { test: "vitest" },
    });
  }
  if (path.endsWith(".yml"))
    return "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n";
  return `// ${full} · ${path}\n// Código em ${lang}: ${desc ?? "projeto pessoal"}\nexport function main() {\n  return "${full}";\n}\n`;
}

function argValue(args: string[], flag: string, name: string): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1]?.startsWith(`${name}=`)) {
      return args[i + 1]?.slice(name.length + 1);
    }
  }
  return undefined;
}

function graphql(args: string[]): GhExecResult {
  const query = argValue(args, "-f", "query") ?? "";
  const op = /query\s+(\w+)/.exec(query)?.[1];
  if (op === "RepoMetrics") {
    const owner = argValue(args, "-f", "owner");
    const name = argValue(args, "-f", "name");
    const all = load("graphql-repo-metrics.json") as Record<string, unknown>;
    const data = all[`${owner}/${name}`];
    if (data) return json({ data });
    // repositório sem resposta gravada: mesmas contagens, menores, para os que existem nas listagens
    return listedRepos().has(`${owner}/${name}`)
      ? json({
          data: {
            repository: { defaultBranchRef: { target: { history: { totalCount: 12 } } } },
            prsOpen: { issueCount: 1 },
            prsMerged: { issueCount: 3 },
            prsClosed: { issueCount: 0 },
            reviews: { issueCount: 2 },
            issuesOpened: { issueCount: 1 },
            issuesClosed: { issueCount: 1 },
          },
        })
      : json({ data: null, errors: [{ message: "Could not resolve" }] });
  }
  if (op === "UserMetrics") return json({ data: load("graphql-user.json") });
  if (op === "YearMetrics") return json({ data: load("graphql-years.json") });
  return { stdout: "", stderr: `operação desconhecida: ${op}`, code: 1 };
}

function restRoutes(): Record<string, Route> {
  const routes: Record<string, Route> = {
    "user/repos?affiliation=owner&per_page=100": () => pages("user-repos.pages.json"),
    "users/ana-exemplo/repos?type=owner&per_page=100": () => pages("users-repos.pages.json"),
    "user/orgs?per_page=100": () => pages("orgs.pages.json"),
    "users/ana-exemplo/orgs?per_page=100": () => pages("orgs.pages.json"),
    "orgs/acme-labs/repos?type=all&per_page=100": () => pages("org-acme-labs-all.pages.json"),
    "orgs/acme-labs/repos?type=public&per_page=100": () => pages("org-acme-labs-public.pages.json"),
    "orgs/coletivo-oss/repos?type=all&per_page=100": () => pages("org-coletivo-oss-all.pages.json"),
    "orgs/coletivo-oss/repos?type=public&per_page=100": () =>
      pages("org-coletivo-oss-public.pages.json"),
    rate_limit: () => json({ resources: { core: { reset: 1_790_000_600, remaining: 0 } } }),
  };
  return routes;
}

/** Rotas por repositório (gravadas para api-pagamentos, sintéticas para os demais). */
function repoRoute(path: string, heads: Record<string, string>): GhExecResult | null {
  const m = /^repos\/([\w.-]+)\/([\w.-]+)(\/.*)?$/.exec(path.split("?")[0] ?? "");
  if (!m) return null;
  const full = `${m[1]}/${m[2]}`;
  const rest = m[3] ?? "";
  const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  const listed = listedRepos().get(full);
  const recorded = full === RECORDED;
  if (!recorded && !listed) return notFound;
  const head = heads[full] ?? (recorded ? HEAD_SHA : syntheticSha(full));
  const name = m[2] ?? "repo";
  const lang = listed?.language ?? "TypeScript";
  const desc = listed?.description ?? null;

  if (rest === "") {
    return recorded
      ? json(load("repo-api-pagamentos.json"))
      : json({ ...listed, default_branch: listed?.default_branch ?? "main" });
  }
  if (rest === "/languages") {
    return recorded ? json(load("languages-api-pagamentos.json")) : json({ [lang]: 4000 });
  }
  if (rest.startsWith("/commits/")) {
    const base = recorded ? (load("commit-head-api-pagamentos.json") as object) : {};
    return json({ ...base, sha: head, commit: { message: `feat: ${name}` } });
  }
  if (rest === "/readme") {
    return recorded
      ? ok(text("readme-api-pagamentos.md"))
      : ok(
          `# ${name}\n\n${desc ?? "Projeto pessoal."}\n\nFeito em ${lang}, com testes automatizados.\n`,
        );
  }
  if (rest.startsWith("/git/trees/")) {
    return recorded ? json(load("tree-api-pagamentos.json")) : json(genericTree(name));
  }
  if (rest === "/commits" && query.startsWith("?author=")) {
    if (recorded) return pages("commits-api-pagamentos.pages.json");
    return ok(
      JSON.stringify([
        { sha: head, commit: { message: `feat: primeira versão de ${name}` } },
        { sha: syntheticSha(full, "2"), commit: { message: `test: cobertura de ${name}` } },
        { sha: syntheticSha(full, "3"), commit: { message: "docs: README" } },
      ]),
    );
  }
  if (rest.startsWith("/contents/")) {
    const file = decodeURIComponent(rest.slice("/contents/".length));
    if (recorded) return contents[file] !== undefined ? ok(contents[file] as string) : notFound;
    const t = genericTree(name).tree.find((e) => e.path === file && e.type === "blob");
    return t ? ok(genericContent(full, file, desc, lang)) : notFound;
  }
  if (rest.startsWith("/compare/")) {
    const [base, headSha] = rest.slice("/compare/".length).split("...");
    if (recorded) {
      return json({ ...(load("compare-api-pagamentos.json") as object), base, head: headSha });
    }
    return json({
      ahead_by: 1,
      commits: [{ commit: { message: `feat: melhoria em ${name}` } }],
      files: [
        {
          filename: `src/${name}.ts`,
          status: "modified",
          additions: 12,
          deletions: 2,
          patch: `@@ -1,2 +1,12 @@\n+export function melhoria() {\n+  return "${name}";\n+}`,
        },
      ],
    });
  }
  return notFound;
}

export interface FakeGh {
  exec: GhExec;
  calls: string[][];
}

export interface FakeGhOptions {
  /** `overrides[path]` substitui a resposta de uma rota REST (ex.: 401, 403 de rate limit). */
  overrides?: Record<string, GhExecResult>;
  /** Estado em memória (testes) ou arquivo compartilhado por api e worker (provider mock). */
  state?: FakeGhState;
  stateFile?: string | null;
}

function readState(o: FakeGhOptions): FakeGhState {
  if (o.stateFile && existsSync(o.stateFile)) {
    try {
      return { ...o.state, ...(JSON.parse(readFileSync(o.stateFile, "utf8")) as FakeGhState) };
    } catch {
      return o.state ?? {};
    }
  }
  return o.state ?? {};
}

export function fakeGh(arg: Record<string, GhExecResult> | FakeGhOptions = {}): FakeGh {
  const o: FakeGhOptions =
    "overrides" in arg || "state" in arg || "stateFile" in arg
      ? (arg as FakeGhOptions)
      : { overrides: arg as Record<string, GhExecResult> };
  const routes = restRoutes();
  const calls: string[][] = [];
  const exec: GhExec = async (args) => {
    calls.push(args);
    const state = readState(o);
    if (args[0] !== "api") return { stdout: "", stderr: "comando não suportado", code: 1 };
    if (state.offline) return offlineResult;
    if (args[1] === "graphql") {
      if (state.authenticated === false) return unauthenticated;
      return graphql(args);
    }
    const path = args[1] ?? "";
    if (o.overrides?.[path]) return o.overrides[path] as GhExecResult;
    if (state.rateLimited && path !== "rate_limit") return rateLimitedResult;
    if (state.failRepos?.some((r) => path === `repos/${r}` || path.startsWith(`repos/${r}/`)))
      return { stdout: "", stderr: "gh: Validation Failed (HTTP 422)", code: 1 };
    if (path === "user")
      return state.authenticated === false ? unauthenticated : json(load("user.json"));
    const route = routes[path];
    if (route) return route();
    return repoRoute(path, state.heads ?? {}) ?? notFound;
  };
  return { exec, calls };
}
