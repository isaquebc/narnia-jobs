import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Fontes dos templates padrão (F05-3): Inter, Source Serif 4 e IBM Plex Mono (OFL-1.1, pacotes `@fontsource`), inline
 * no HTML como `data:` porque o Chromium roda em outro container, sem acesso a arquivos nem à rede. Subconjunto
 * `latin` (inclui os acentos do português).
 */
export type FontFamily = "inter" | "source-serif-4" | "ibm-plex-mono";

const NAMES: Record<FontFamily, string> = {
  inter: "Inter",
  "source-serif-4": "Source Serif 4",
  "ibm-plex-mono": "IBM Plex Mono",
};

const require = createRequire(import.meta.url);
const cache = new Map<string, string>();

function face(family: FontFamily, weight: number, style: "normal" | "italic"): string {
  const key = `${family}-${weight}-${style}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = require.resolve(
    `@fontsource/${family}/files/${family}-latin-${weight}-${style}.woff2`,
  );
  const b64 = readFileSync(file).toString("base64");
  const css = `@font-face{font-family:"${NAMES[family]}";font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  cache.set(key, css);
  return css;
}

export function fontFaces(specs: Array<[FontFamily, number, ("normal" | "italic")?]>): string {
  return specs.map(([f, w, s]) => face(f, w, s ?? "normal")).join("");
}

export const fontName = (f: FontFamily) => `"${NAMES[f]}"`;
