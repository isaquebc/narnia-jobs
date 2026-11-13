import { describe, expect, it, vi } from "vitest";
import {
  imageSize,
  imagesText,
  isPrivateAddress,
  mailImageUrls,
  readMailImages,
  safeImageFetch,
} from "../../src/mail/images";

/** F15/M4 · imagens do corpo com OCR: quais abrir, proteção do download e leitura local. */
const png = (w: number, h: number) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

describe("F15/M4 · imagens do e-mail", () => {
  it("escolhe as imagens http(s) do HTML, sem repetir, sem pixel de rastreio, no máximo 3", () => {
    const html = `
      <img src="https://cdn.example/banner.jpg?a=1&amp;b=2">
      <img src="https://t.example/pixel.gif" width="1" height="1">
      <img src='https://cdn.example/banner.jpg?a=1&b=2'>
      <img src="cid:logo@x">
      <img src="https://cdn.example/2.png"><img src="https://cdn.example/3.png"><img src="https://cdn.example/4.png">`;
    expect(mailImageUrls(html)).toEqual([
      "https://cdn.example/banner.jpg?a=1&b=2",
      "https://cdn.example/2.png",
      "https://cdn.example/3.png",
    ]);
  });

  it("endereços internos ficam de fora (IPv4, IPv6, mapeado)", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.10",
      "172.20.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "142.250.79.110", "2800:3f0:4001::200e"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("lê o tamanho de PNG, GIF e JPEG pelo cabeçalho", () => {
    expect(imageSize(png(600, 400))).toEqual({ width: 600, height: 400 });
    const gif = Buffer.from("GIF89a\x58\x02\x90\x01xxxx", "latin1");
    expect(imageSize(gif)).toEqual({ width: 600, height: 400 });
    const jpg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0, 0, 0,
    ]);
    expect(imageSize(jpg)).toEqual({ width: 600, height: 400 });
    expect(imageSize(Buffer.from("<html>"))).toBeNull();
  });

  it("download recusa host que resolve para a rede interna (inclusive depois de redirecionar)", async () => {
    const f = safeImageFetch(async (h) => (h === "interno.example" ? ["10.0.0.5"] : ["8.8.8.8"]));
    await expect(f("http://interno.example/a.png")).rejects.toThrow("endereço interno");
    await expect(f("http://127.0.0.1/a.png")).rejects.toThrow("endereço interno");
    const real = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://interno.example/x.png" } }),
    ) as never;
    try {
      await expect(f("https://publico.example/a.png")).rejects.toThrow("endereço interno");
    } finally {
      globalThis.fetch = real;
    }
  });

  it("lê as grandes, pula as pequenas e o que não é imagem; erro numa não para as outras", async () => {
    const recognize = vi.fn(async () => ({ text: " Application  >  Offer \r\n", confidence: 0.9 }));
    const terminate = vi.fn(async () => {});
    const reads = await readMailImages({
      html: `<img src="https://a.example/1.png"><img src="https://a.example/2.png"><img src="https://a.example/3.png">`,
      fetchImage: async (url) => {
        if (url.endsWith("1.png")) return { type: "image/png", body: png(600, 400) };
        if (url.endsWith("2.png")) return { type: "image/png", body: png(120, 40) };
        throw new Error("rede caiu");
      },
      recognizer: async () => ({ recognize, terminate }),
    });
    expect(reads).toEqual([
      { url: "https://a.example/1.png", text: "Application > Offer", skipped: null },
      { url: "https://a.example/2.png", text: null, skipped: "pequena" },
      { url: "https://a.example/3.png", text: null, skipped: "rede caiu" },
    ]);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalled();
    expect(imagesText(reads)).toBe("Application > Offer");
  });
});
