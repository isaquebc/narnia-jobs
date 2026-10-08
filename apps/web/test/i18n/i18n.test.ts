import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "../../src/i18n";
import { ptBR } from "../../src/i18n/pt-BR";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Heurística: texto entre `>` e `<` em JSX (ou em `title=`/`placeholder=`/`aria-label=` com aspas) que contenha
 * letras acentuadas ou palavras comuns do pt-BR. Tudo deve passar por `t()`.
 */
const PT_PATTERN =
  /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]|\b(não|sim|voltar|avançar|enviar|salvar|erro|carregando|perfil|arquivo|telefone|revisão|extração|dados)\b/i;
const JSX_TEXT = />\s*([^<>{}\n][^<>{}\n]*?)\s*</g;
const JSX_ATTR = /\b(title|placeholder|aria-label|label)=["']([^"']+)["']/g;

describe("i18n · nenhuma string em pt-BR fora do dicionário", () => {
  const files = walk(join(__dirname, "../../src"));
  it("varre os componentes", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes("/i18n/")) continue;
      // comentários (inclusive biome-ignore) não são texto de interface
      const src = readFileSync(f, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\{\/\*|\*)/.test(line))
        .join("\n");
      for (const re of [JSX_TEXT, JSX_ATTR]) {
        for (const m of src.matchAll(re)) {
          const text = (m[2] ?? m[1]) as string;
          if (PT_PATTERN.test(text)) offenders.push(`${f.replace(/.*\/src\//, "src/")}: "${text}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  it("t() resolve chaves do dicionário pt-BR com interpolação", () => {
    expect(t("app.name")).toBe("narnia-jobs");
    expect(t("activity.pending", { count: 3 })).toContain("3");
    expect(ptBR.app.name).toBe("narnia-jobs");
  });
});
