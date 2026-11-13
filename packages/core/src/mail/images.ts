import { lookup } from "node:dns/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Recognizer } from "../pdf/ocr";

/**
 * Imagens do corpo do e-mail com OCR (F15/M4, plano §2.4, F15-5). Algumas empresas mandam as fases do processo numa
 * imagem hospedada fora do e-mail; o narnia só a abre quando o e-mail está ligado a uma candidatura já feita e vem de
 * remetente confiável ou do domínio da vaga ou da empresa (quem chama decide). Aqui: quais imagens valem a pena, a
 * proteção do download (só endereço público, tamanho, tipo, tempo) e a leitura local (Tesseract, sem modelo).
 */
export const MAIL_IMAGES_MAX = 3;
export const MAIL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Lado mínimo: ícones, logos pequenos e pixels de rastreio ficam de fora. */
export const MAIL_IMAGE_MIN_SIDE = 200;
const FETCH_TIMEOUT_MS = 15_000;

export interface MailImageRead {
  url: string;
  /** Texto lido; `null` quando não abriu. */
  text: string | null;
  /** Por que não leu (pequena, não é imagem, endereço interno, erro). */
  skipped: string | null;
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
const attrValue = (tag: string, name: string): string | null => {
  const m = attr(tag, name);
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
};
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"');

/**
 * As imagens do HTML que valem ler, na ordem do e-mail: `http(s)`, sem repetir, sem as declaradas pequenas
 * (`width`/`height` abaixo do mínimo, como os pixels de rastreio), no máximo `MAIL_IMAGES_MAX`.
 */
export function mailImageUrls(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrValue(tag, "src");
    if (!src) continue;
    const url = decode(src.trim());
    if (!/^https?:\/\//i.test(url) || out.includes(url)) continue;
    const small = ["width", "height"].some((k) => {
      const v = Number.parseInt(attrValue(tag, k) ?? "", 10);
      return Number.isFinite(v) && v > 0 && v < MAIL_IMAGE_MIN_SIDE;
    });
    if (small) continue;
    out.push(url);
    if (out.length >= MAIL_IMAGES_MAX) break;
  }
  return out;
}

/** Endereço que não é da internet pública (rede local, o próprio computador, link-local, CGNAT, multicast). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1] as string);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

/** Largura e altura pelo cabeçalho (PNG, GIF, JPEG); `null` se não reconhece. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47)
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF")
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] as number;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

export type ImageFetch = (url: string) => Promise<{ type: string; body: Buffer } | null>;
export type HostResolver = (host: string) => Promise<string[]>;

const resolveHost: HostResolver = async (host) =>
  isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);

/**
 * Baixa sem cookies nem credenciais, sem seguir redirecionamento para fora da checagem (cada salto é conferido), com
 * tempo e tamanho limitados.
 */
export function safeImageFetch(resolve: HostResolver = resolveHost): ImageFetch {
  return async (start) => {
    let url = start;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const host = u.hostname.replace(/^\[|\]$/g, "");
      const addrs = isIP(host) ? [host] : await resolve(host);
      if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error("endereço interno");
      const res = await fetch(url, {
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "image/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAIL_IMAGE_MAX_BYTES) throw new Error("imagem grande demais");
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAIL_IMAGE_MAX_BYTES) throw new Error("imagem grande demais");
      return { type, body };
    }
    return null;
  };
}

/** Baixa e lê as imagens; erro numa não para as outras. */
export async function readMailImages(input: {
  html: string;
  fetchImage: ImageFetch;
  recognizer: () => Promise<Recognizer>;
}): Promise<MailImageRead[]> {
  const urls = mailImageUrls(input.html);
  const out: MailImageRead[] = [];
  if (!urls.length) return out;
  let rec: Recognizer | null = null;
  const dir = mkdtempSync(join(tmpdir(), "narnia-mail-img-"));
  try {
    for (const [i, url] of urls.entries()) {
      try {
        const got = await input.fetchImage(url);
        if (!got) {
          out.push({ url, text: null, skipped: "não abriu" });
          continue;
        }
        const size = imageSize(got.body);
        const isImage = /^image\//i.test(got.type) || !!size;
        if (!isImage) {
          out.push({ url, text: null, skipped: "não é imagem" });
          continue;
        }
        if (size && (size.width < MAIL_IMAGE_MIN_SIDE || size.height < MAIL_IMAGE_MIN_SIDE / 2)) {
          out.push({ url, text: null, skipped: "pequena" });
          continue;
        }
        const path = join(dir, `img-${i}`);
        writeFileSync(path, got.body);
        rec ??= await input.recognizer();
        const r = await rec.recognize(path);
        const text = r.text
          .replace(/\r\n?/g, "\n")
          .replace(/[ \t]+/g, " ")
          .trim();
        out.push({ url, text: text || null, skipped: text ? null : "sem texto" });
      } catch (e) {
        out.push({ url, text: null, skipped: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    if (rec) await rec.terminate().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/** O texto que vai ao classificador, uma imagem por bloco, com teto. */
export const imagesText = (reads: MailImageRead[]) =>
  reads
    .filter((r) => r.text)
    .map((r) => r.text)
    .join("\n---\n")
    .slice(0, 4000);
