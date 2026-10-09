import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhExec, GhExecResult } from "../../../src/ingest/sources/github/gh";

/**
 * Executor falso do `gh` sobre respostas gravadas (F03 M2). Emula `gh api` com `--paginate` (páginas JSON
 * concatenadas, como o `gh` imprime), o Accept raw (texto), `gh api graphql` por nome da operação, 404 e falhas.
 */
const DIR = join(import.meta.dirname);
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const text = (f: string) => readFileSync(join(DIR, f), "utf8");

export const LOGIN = "ana-exemplo";
export const HEAD_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
export const BASE_SHA = "0f0e0d0c0b0a09080706050403020100ffeeddcc";

type Route = () => GhExecResult;
const ok = (stdout: string): GhExecResult => ({ stdout, stderr: "", code: 0 });
const json = (v: unknown) => ok(JSON.stringify(v));
const pages = (f: string) => ok((load(f) as unknown[]).map((p) => JSON.stringify(p)).join(""));
export const notFound: GhExecResult = { stdout: "", stderr: "gh: Not Found (HTTP 404)", code: 1 };

const R = "repos/ana-exemplo/api-pagamentos";
const contents = load("contents-api-pagamentos.json") as Record<string, string>;

function restRoutes(): Record<string, Route> {
  const routes: Record<string, Route> = {
    user: () => json(load("user.json")),
    "user/repos?affiliation=owner&per_page=100": () => pages("user-repos.pages.json"),
    "users/ana-exemplo/repos?type=owner&per_page=100": () => pages("users-repos.pages.json"),
    "user/orgs?per_page=100": () => pages("orgs.pages.json"),
    "users/ana-exemplo/orgs?per_page=100": () => pages("orgs.pages.json"),
    "orgs/acme-labs/repos?type=all&per_page=100": () => pages("org-acme-labs-all.pages.json"),
    "orgs/acme-labs/repos?type=public&per_page=100": () => pages("org-acme-labs-public.pages.json"),
    "orgs/coletivo-oss/repos?type=all&per_page=100": () => pages("org-coletivo-oss-all.pages.json"),
    "orgs/coletivo-oss/repos?type=public&per_page=100": () =>
      pages("org-coletivo-oss-public.pages.json"),
    [R]: () => json(load("repo-api-pagamentos.json")),
    [`${R}/languages`]: () => json(load("languages-api-pagamentos.json")),
    [`${R}/commits/main`]: () => json(load("commit-head-api-pagamentos.json")),
    [`${R}/readme`]: () => ok(text("readme-api-pagamentos.md")),
    [`${R}/git/trees/${HEAD_SHA}?recursive=1`]: () => json(load("tree-api-pagamentos.json")),
    [`${R}/commits?author=ana-exemplo&per_page=100`]: () =>
      pages("commits-api-pagamentos.pages.json"),
    [`${R}/compare/${BASE_SHA}...${HEAD_SHA}`]: () => json(load("compare-api-pagamentos.json")),
    rate_limit: () => json({ resources: { core: { reset: 1_790_000_600, remaining: 0 } } }),
  };
  for (const [path, body] of Object.entries(contents)) {
    routes[`${R}/contents/${path}?ref=${HEAD_SHA}`] = () => ok(body);
  }
  return routes;
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
    const data = (load("graphql-repo-metrics.json") as Record<string, unknown>)[`${owner}/${name}`];
    return data ? json({ data }) : json({ data: null, errors: [{ message: "Could not resolve" }] });
  }
  if (op === "UserMetrics") return json({ data: load("graphql-user.json") });
  if (op === "YearMetrics") return json({ data: load("graphql-years.json") });
  return { stdout: "", stderr: `operação desconhecida: ${op}`, code: 1 };
}

export interface FakeGh {
  exec: GhExec;
  calls: string[][];
}

/** `overrides[path]` substitui a resposta de uma rota REST (ex.: 401, 403 de rate limit). */
export function fakeGh(overrides: Record<string, GhExecResult> = {}): FakeGh {
  const routes = restRoutes();
  const calls: string[][] = [];
  const exec: GhExec = async (args) => {
    calls.push(args);
    if (args[0] !== "api") return { stdout: "", stderr: "comando não suportado", code: 1 };
    if (args[1] === "graphql") return graphql(args);
    const path = args[1] ?? "";
    if (overrides[path]) return overrides[path];
    const route = routes[path];
    return route ? route() : notFound;
  };
  return { exec, calls };
}
