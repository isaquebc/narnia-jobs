import type { IngestionDepth, RepoReport } from "@narnia-jobs/shared";
import { charsToTokens } from "../../../estimate";
import type { FetchedFile, TreeEntry } from "./collect";

/**
 * Heurística de destaques sem tokens (F03-3 §3, F03 §2.3): o que entra no contexto de cada repositório, nesta
 * ordem: metadados (+ métricas) → [incremental: análise anterior e diff] → README → manifestos/configs/CI →
 * mensagens dos commits do usuário → pontos de entrada → testes → amostras. Cada arquivo é cortado em
 * `maxCharsPerFile` e a soma nunca passa da fatia do repositório (`sliceTokens × 4` chars).
 */
export type HighlightCategory = "manifest" | "entrypoint" | "test" | "sample";
export const CATEGORY_ORDER: HighlightCategory[] = ["manifest", "entrypoint", "test", "sample"];

export interface Candidate {
  path: string;
  size: number;
  category: HighlightCategory;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "target",
  "__pycache__",
  ".git",
  ".venv",
]);
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
  "poetry.lock",
  "go.sum",
  "composer.lock",
  "gemfile.lock",
]);
const BINARY =
  /\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tgz|tar|mp[34]|mov|woff2?|ttf|eot|otf|jar|exe|dll|so|dylib|bin|wasm)$/i;
const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gemfile",
  "composer.json",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "makefile",
  "tsconfig.json",
  "deno.json",
  "mix.exs",
  ".gitlab-ci.yml",
]);
const CODE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|ex|exs|sql|sh|c|cc|cpp|h|hpp|vue|svelte|dart|lua|clj)$/i;
const ENTRY_NAMES = new Set(["index", "main", "app", "server", "manage", "cli"]);
const ENTRY_DIRS = new Set(["", "src", "app", "lib", "bin"]);

/** `null` = fora dos destaques (README é seção própria; lock, binário, build e vendor nunca entram). */
export function classifyPath(path: string): HighlightCategory | null {
  const parts = path.split("/");
  const base = (parts.at(-1) ?? "").toLowerCase();
  const dir = parts.slice(0, -1).join("/");
  if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return null;
  if (LOCKFILES.has(base) || BINARY.test(base) || base.endsWith(".min.js")) return null;
  if (base.startsWith("readme")) return null;
  if (
    MANIFESTS.has(base) ||
    base.startsWith("dockerfile") ||
    base.endsWith(".csproj") ||
    (/^\.github\/workflows$/.test(dir) && /\.ya?ml$/.test(base))
  ) {
    return "manifest";
  }
  if (!CODE.test(base)) return null;
  if (
    /(^|\/)(test|tests|__tests__|spec)\//.test(`${dir}/`) ||
    /\.(test|spec)\.[a-z]+$/.test(base) ||
    base.endsWith("_test.go") ||
    /^test_.+\.py$/.test(base)
  ) {
    return "test";
  }
  const stem = base.replace(/\.[^.]+$/, "");
  if (ENTRY_NAMES.has(stem) && (ENTRY_DIRS.has(dir) || /^cmd\/[^/]+$/.test(dir)))
    return "entrypoint";
  return "sample";
}

export const DEFAULT_CATEGORY_LIMITS: Record<HighlightCategory, number> = {
  manifest: 6,
  entrypoint: 4,
  test: 3,
  sample: 6,
};
const MAX_FILE_BYTES = 200_000;

const depthOf = (p: string) => p.split("/").length;

/** Candidatos em ordem de prioridade (categoria, depois heurística interna), sem arquivos gigantes. */
export function planCandidates(
  entries: TreeEntry[],
  limits: Partial<Record<HighlightCategory, number>> = {},
): Candidate[] {
  const lim = { ...DEFAULT_CATEGORY_LIMITS, ...limits };
  const byCat: Record<HighlightCategory, Candidate[]> = {
    manifest: [],
    entrypoint: [],
    test: [],
    sample: [],
  };
  for (const e of entries) {
    if (e.size > MAX_FILE_BYTES) continue;
    const category = classifyPath(e.path);
    if (category) byCat[category].push({ path: e.path, size: e.size, category });
  }
  const shallowFirst = (a: Candidate, b: Candidate) =>
    depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path);
  byCat.manifest.sort(shallowFirst);
  byCat.entrypoint.sort(shallowFirst);
  byCat.test.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  // amostras: código de tamanho médio, preferindo src/
  const sampleScore = (c: Candidate) =>
    (c.path.startsWith("src/") ? 1 : 0) + (c.size >= 300 && c.size <= 30_000 ? 1 : 0);
  byCat.sample.sort(
    (a, b) => sampleScore(b) - sampleScore(a) || b.size - a.size || a.path.localeCompare(b.path),
  );
  return CATEGORY_ORDER.flatMap((c) => byCat[c].slice(0, lim[c]));
}

/**
 * O que buscar por profundidade (F03 §2 tabela): rápida só manifestos; equilibrada + pontos de entrada;
 * profunda todas as categorias (a chamada barata depois escolhe até 8, F03-3 §5).
 */
export function candidatePathsForDepth(entries: TreeEntry[], depth: IngestionDepth): string[] {
  if (depth === "quick") {
    return planCandidates(entries, { manifest: 3, entrypoint: 0, test: 0, sample: 0 }).map(
      (c) => c.path,
    );
  }
  if (depth === "balanced") {
    return planCandidates(entries, { manifest: 5, entrypoint: 2, test: 0, sample: 0 }).map(
      (c) => c.path,
    );
  }
  return planCandidates(entries).map((c) => c.path);
}

export const QUICK_README_LINES = 60;

export function readmeForDepth(readme: string | null, depth: IngestionDepth): string | null {
  if (readme === null) return null;
  return depth === "quick" ? readme.split("\n").slice(0, QUICK_README_LINES).join("\n") : readme;
}

export interface PackRepo {
  fullName: string;
  description: string | null;
  languages: Record<string, number>;
  topics: string[];
  stars: number;
  pushedAt: string | null;
  isFork: boolean;
}

export interface PackInput {
  repo: PackRepo;
  readme: string | null;
  commitMessages: string[];
  metricsTable: string | null;
  files: FetchedFile[];
  sliceTokens: number;
  maxCharsPerFile: number;
  previousReport?: RepoReport | null;
  diffText?: string | null;
}

export interface PackedContext {
  text: string;
  chars: number;
  tokens: number;
  /** Caminhos que entraram (README como `README.md`). */
  included: string[];
  /** Entraram cortados (máximo por arquivo ou fim da fatia). */
  truncated: string[];
  /** Não couberam na fatia. */
  skipped: string[];
}

/** Seções menores que isto não entram cortadas: melhor pular do que mandar um fiapo. */
const MIN_PARTIAL = 200;

function metadata(r: PackRepo): string {
  const total = Object.values(r.languages).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(r.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([l, b]) => `${l} (${Math.round((b / total) * 100)}%)`)
    .join(", ");
  return [
    `## Repositório ${r.fullName}`,
    `Descrição: ${r.description ?? "(sem descrição)"}`,
    `Linguagens: ${langs || "(não informadas)"}`,
    `Tópicos: ${r.topics.join(", ") || "(nenhum)"}`,
    `Estrelas: ${r.stars} · último push: ${r.pushedAt?.slice(0, 10) ?? "?"} · fork: ${r.isFork ? "sim" : "não"}`,
  ].join("\n");
}

function reportText(r: RepoReport): string {
  return [
    `Resumo: ${r.summary}`,
    `Stack: ${r.stack.join(", ")}`,
    `Destaques: ${r.highlights.join("; ")}`,
    `Riscos: ${r.risks.join("; ")}`,
  ].join("\n");
}

export function packContext(input: PackInput): PackedContext {
  const limit = Math.max(0, input.sliceTokens) * 4;
  const parts: string[] = [];
  let used = 0;
  const included: string[] = [];
  const truncated: string[] = [];
  const skipped: string[] = [];

  const push = (text: string) => {
    parts.push(text);
    used += text.length + 2;
  };
  // metadados sempre entram (identificam o repositório), cortados à fatia se preciso
  push(metadata(input.repo).slice(0, limit));
  if (input.metricsTable) section("Métricas", input.metricsTable, null);
  if (input.previousReport) section("Análise anterior", reportText(input.previousReport), null);
  if (input.diffText) section("Mudanças desde a análise anterior", input.diffText, null);

  function section(title: string, body: string, path: string | null, perItem = Infinity): void {
    const header = `### ${title}\n`;
    const room = limit - used - header.length - 2;
    const cap = Math.min(perItem, room);
    if (room < MIN_PARTIAL && body.length > room) {
      if (path) skipped.push(path);
      return;
    }
    const content = body.slice(0, Math.max(0, cap));
    push(header + content);
    if (path) {
      included.push(path);
      if (content.length < body.length) truncated.push(path);
    }
  }

  if (input.readme !== null) section("README.md", input.readme, "README.md", input.maxCharsPerFile);
  const byCat = (cat: HighlightCategory) =>
    input.files.filter((f) => (classifyPath(f.path) ?? "sample") === cat);
  const files = (cat: HighlightCategory) => {
    for (const f of byCat(cat)) {
      const before = truncated.length;
      section(f.path, f.content, f.path, input.maxCharsPerFile);
      if (f.truncated && truncated.length === before && included.at(-1) === f.path)
        truncated.push(f.path);
    }
  };
  files("manifest");
  if (input.commitMessages.length) {
    section("Commits do usuário", input.commitMessages.map((m) => `- ${m}`).join("\n"), null);
  }
  files("entrypoint");
  files("test");
  files("sample");

  const text = parts.join("\n\n");
  return {
    text,
    chars: text.length,
    tokens: charsToTokens(text.length),
    included,
    truncated,
    skipped,
  };
}
