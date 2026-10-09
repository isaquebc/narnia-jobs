import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fontes por execução para a revisão anti-alucinação (F03 §2.8): o que foi enviado ao modelo (texto do CV, contexto
 * empacotado de cada repositório, relatórios da síntese) fica em `readings/<run>/*.txt`; a camada 1 confere os
 * trechos citados contra esse material. `consolidated` (CV/texto do F01) também responde por `cv` e `text`.
 */
export function runSourcesDir(dataDir: string, runId: string): string {
  return join(dataDir, "readings", runId);
}

/** Nome seguro de arquivo: barras e caracteres fora de `[\w.-]` viram `__`; nunca sobe de pasta. */
export function sourceFileName(name: string): string {
  return `${name.replace(/[^\w.-]/g, "__").replace(/^\.+/, "_")}.txt`;
}

export function saveRunSource(dataDir: string, runId: string, name: string, text: string): string {
  const dir = runSourcesDir(dataDir, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, sourceFileName(name));
  writeFileSync(file, text, "utf8");
  return file;
}

export function loadRunSources(dataDir: string, runId: string): Record<string, string> {
  const dir = runSourcesDir(dataDir, runId);
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".txt")) continue;
    const name = f.slice(0, -4).replace(/__/g, "/");
    out[name] = readFileSync(join(dir, f), "utf8");
  }
  if (out.consolidated !== undefined) {
    out.cv = out.consolidated;
    out.text = out.consolidated;
  }
  return out;
}
