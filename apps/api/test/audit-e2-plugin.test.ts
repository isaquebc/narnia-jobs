import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPLICATION_TOOLS,
  CHAT_TOOLS,
  CV_TOOLS,
  INGEST_TOOLS,
  POSTING_TOOLS,
  PROFILE_TOOLS,
} from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { publishedName } from "../src/mcp/scopes";
import { pluginDir, splitFrontmatter } from "../src/plugin";

/**
 * Auditoria pós-F04 · bloco E2 (18a/18b): skills do plugin. Toda skill tem frontmatter com o nome da pasta e descrição,
 * e só cita tools que o `/mcp` publica (a `clarificar` chegou a citar uma tool fora do escopo do terminal).
 */
const PLUGIN = pluginDir();
const SKILLS = join(PLUGIN, "skills");
const PUBLISHED = new Set(
  [
    ...Object.keys(PROFILE_TOOLS),
    ...Object.keys(INGEST_TOOLS),
    ...Object.keys(CHAT_TOOLS),
    ...Object.keys(POSTING_TOOLS),
    ...Object.keys(CV_TOOLS),
    ...Object.keys(APPLICATION_TOOLS),
  ].map(publishedName),
);
const TOOL_REF = /`([a-z]+_[a-z_]+)`/g;

describe("auditoria E2 · skills do plugin", () => {
  it("existem as skills github-publico (F03-2) e descoberta (passo 7 do primeiro uso)", () => {
    for (const s of ["github-publico", "descoberta"])
      expect(existsSync(join(SKILLS, s, "SKILL.md")), s).toBe(true);
  });

  it("cada skill tem name igual à pasta, descrição e só cita tools publicadas pelo /mcp", () => {
    for (const dir of readdirSync(SKILLS)) {
      const raw = readFileSync(join(SKILLS, dir, "SKILL.md"), "utf8");
      const { frontmatter, body } = splitFrontmatter(raw);
      expect(frontmatter, dir).toMatch(new RegExp(`^name: ${dir}$`, "m"));
      expect(frontmatter, dir).toMatch(/^description: .{20,}$/m);
      const refs = [...body.matchAll(TOOL_REF)].map((m) => m[1] as string);
      expect(refs.length, `${dir} não cita nenhuma tool`).toBeGreaterThan(0);
      for (const r of refs) expect(PUBLISHED.has(r), `${dir} cita ${r}`).toBe(true);
    }
  });

  it("github-publico usa os relatórios da ingestão do GitHub e não grava nada direto", () => {
    const body = splitFrontmatter(
      readFileSync(join(SKILLS, "github-publico", "SKILL.md"), "utf8"),
    ).body;
    for (const t of ["file_list", "file_get_digest", "ingest_github"]) expect(body).toContain(t);
    expect(body).toMatch(/revis/i);
  });

  it("descoberta pergunta só as lacunas e manda as respostas para a revisão por ingest_text", () => {
    const body = splitFrontmatter(
      readFileSync(join(SKILLS, "descoberta", "SKILL.md"), "utf8"),
    ).body;
    for (const t of ["profile_get_card", "fact_unverified", "ingest_text"])
      expect(body).toContain(t);
    expect(body).toMatch(/uma pergunta por vez/i);
  });
});
