import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `plugin/` na raiz é a fonte única de persona, skills e hook (F04-1): o `api` lê o template do recrutador daqui
 * para o `systemPrompt` do modo A e para a rota do hook do modo B. `NARNIA_PLUGIN_DIR` sobrescreve (imagem, testes).
 */
export function pluginDir(): string {
  return (
    process.env.NARNIA_PLUGIN_DIR ?? fileURLToPath(new URL("../../../plugin/", import.meta.url))
  );
}

export function readRecruiterTemplate(dir = pluginDir()): string {
  return readFileSync(join(dir, "agents", "recrutador.md"), "utf8");
}

/** Arquivo de apoio do plugin (ex.: `prompts/…`), fora de `agents/` para o Claude Code não o tomar por agente. */
export function readPluginFile(relative: string, dir = pluginDir()): string {
  return readFileSync(join(dir, relative), "utf8");
}

/** Separa o frontmatter (metadado do Claude Code: nome, tools) do corpo (o prompt). */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return m
    ? { frontmatter: m[0].trimEnd(), body: markdown.slice(m[0].length).trimStart() }
    : { frontmatter: "", body: markdown.trimStart() };
}

/** O frontmatter é metadado do Claude Code (nome, tools); o prompt é só o corpo. */
export function stripFrontmatter(markdown: string): string {
  return splitFrontmatter(markdown).body;
}
