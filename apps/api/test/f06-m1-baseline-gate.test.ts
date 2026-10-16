import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaselineGate, gateFlags } from "../src/evals/baseline-file";

/** F06/M1 · bloqueador de regressão (F06-14): `--gate` e `--update-baseline` sobre `evals/baselines.json`. */
describe("F06/M1 · gate da linha de base", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const file = (content?: string) => {
    const d = mkdtempSync(join(tmpdir(), "narnia-baseline-"));
    dirs.push(d);
    const p = join(d, "baselines.json");
    if (content !== undefined) writeFileSync(p, content);
    return p;
  };

  it("lê as flags", () => {
    expect(gateFlags(["x", "--gate"])).toEqual({ gate: true, update: false });
    expect(gateFlags(["--update-baseline"])).toEqual({ gate: false, update: true });
  });

  it("sem arquivo: nada regride; --update-baseline cria o arquivo com as notas", () => {
    const p = file();
    const g = new BaselineGate({ gate: true, update: true }, p);
    g.record("narnia-chat-title", { schema: 1, judge: 0.9 }, { versionId: "v1" });
    const out: string[] = [];
    expect(g.finish((l) => out.push(l))).toBe(false);
    const saved = JSON.parse(readFileSync(p, "utf8"));
    expect(saved["narnia-chat-title"]).toMatchObject({
      scores: { judge: 0.9, schema: 1 },
      versionId: "v1",
    });
  });

  it("rodada incompleta (erro do modelo ou sem notas) reprova o gate e nunca vira linha de base (2026-10-16)", () => {
    const p = file(JSON.stringify({ "narnia-x": { scores: { schema: 1 }, updatedAt: "t" } }));
    const g = new BaselineGate({ gate: true, update: true }, p);
    g.record("narnia-cv-generate", {}, { versionId: "v1", errors: 3 });
    g.record("narnia-x", { schema: 1 }, { versionId: "v2" });
    const out: string[] = [];
    expect(g.finish((l) => out.push(l))).toBe(true);
    expect(out.join("\n")).toMatch(/narnia-cv-generate.*incompleta/);
    expect(out.join("\n")).toMatch(/não atualizada/);
    const saved = JSON.parse(readFileSync(p, "utf8"));
    expect(saved["narnia-cv-generate"]).toBeUndefined();
    expect(saved["narnia-x"].updatedAt).toBe("t");
  });

  it("queda reprova com --gate e não atualiza a linha de base", () => {
    const p = file(JSON.stringify({ "chat:salario": { scores: { graders: 1 }, updatedAt: "t" } }));
    const g = new BaselineGate({ gate: true, update: true }, p);
    g.record("chat:salario", { graders: 0.5 });
    const out: string[] = [];
    expect(g.finish((l) => out.push(l))).toBe(true);
    expect(out.join("\n")).toMatch(/chat:salario · graders: 50% \(linha de base 100%\)/);
    expect(JSON.parse(readFileSync(p, "utf8"))["chat:salario"].scores.graders).toBe(1);
  });

  it("sem --gate a regressão só é relatada", () => {
    const p = file(JSON.stringify({ k: { scores: { a: 1 }, updatedAt: "t" } }));
    const g = new BaselineGate({ gate: false, update: false }, p);
    g.record("k", { a: 0 });
    expect(g.finish(() => undefined)).toBe(false);
    expect(g.regressions).toHaveLength(1);
  });
});

describe("F06/M5 · nota só para consulta", () => {
  it("gate: false grava a nota sem bloquear", () => {
    const d = mkdtempSync(join(tmpdir(), "narnia-baseline-"));
    try {
      const p = join(d, "b.json");
      writeFileSync(p, JSON.stringify({ k: { scores: { a: 1 }, updatedAt: "t" } }));
      const g = new BaselineGate({ gate: true, update: true }, p);
      g.record("k", { a: 0 }, { gate: false });
      expect(g.finish(() => undefined)).toBe(false);
      expect(JSON.parse(readFileSync(p, "utf8")).k.scores.a).toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
