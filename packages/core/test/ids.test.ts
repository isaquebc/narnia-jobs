import { describe, expect, it } from "vitest";
import { newId, withSeededIds } from "../src/ids";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ids (F01-19: UUID v7)", () => {
  it("gera UUID v7 únicos e ordenáveis por tempo", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(UUID_V7);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});

/**
 * R5: a fixture do sandbox das avaliações precisa dos mesmos ids em toda amostra (o juiz vê o índice de uma amostra só
 * e as citações `[f:…]` das outras pareciam inventadas). Dentro de `withSeededIds`, a sequência depende só da semente.
 */
describe("withSeededIds (ids determinísticos da fixture das avaliações)", () => {
  it("mesma semente, mesma sequência de UUID v7 válidos, únicos e ordenados", async () => {
    const run = () => withSeededIds("fixture", async () => [newId(), newId(), newId()]);
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    for (const id of a) expect(id).toMatch(UUID_V7);
    expect(new Set(a).size).toBe(3);
    expect([...a].sort()).toEqual(a);
  });

  it("semente diferente, ids diferentes; a parte final (id curto) também muda", async () => {
    const [a] = await withSeededIds("um", async () => [newId()]);
    const [b] = await withSeededIds("dois", async () => [newId()]);
    expect(a?.slice(-6)).not.toBe(b?.slice(-6));
  });

  it("vale através de await e não vaza para fora do escopo", async () => {
    const inside = await withSeededIds("x", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return newId();
    });
    const again = await withSeededIds("x", async () => newId());
    expect(inside).toBe(again);
    expect(newId()).not.toBe(inside);
  });
});
