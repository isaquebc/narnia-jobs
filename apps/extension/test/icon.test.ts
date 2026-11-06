import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos, usado também pelo build.mjs
import { iconPixels } from "../icon.mjs";

/** Pixel (x, y) de uma imagem RGBA de lado `size`. */
const at = (px: Uint8Array, size: number, x: number, y: number) =>
  Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));

describe("ícone da extensão: a porta do logo", () => {
  it("cantos transparentes, fundo na cor do narnia, batente da porta claro e interior da porta no fundo", () => {
    const size = 128;
    const px = iconPixels(size);
    expect(px.length).toBe(size * size * 4);
    expect(at(px, size, 0, 0)[3]).toBe(0);
    // fundo: perto da borda, dentro do quadrado arredondado
    expect(at(px, size, 64, 10)).toEqual([15, 92, 90, 255]);
    // batente esquerdo da porta: x = 11/34, y = 22/34
    const jamb = at(px, size, Math.round((11 / 34) * size), Math.round((22 / 34) * size));
    expect(Math.min(...jamb.slice(0, 3))).toBeGreaterThan(200);
    // dentro da porta, longe do batente e da maçaneta: fundo
    expect(at(px, size, Math.round((14 / 34) * size), Math.round((23 / 34) * size))).toEqual([
      15, 92, 90, 255,
    ]);
  });
});
