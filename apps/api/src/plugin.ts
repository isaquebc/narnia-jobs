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

/** O frontmatter é metadado do Claude Code (nome, tools); o prompt é só o corpo. */
export function stripFrontmatter(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return (m ? markdown.slice(m[0].length) : markdown).trimStart();
}
