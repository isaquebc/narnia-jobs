// Build da extensão (F12-10): esbuild gera dist/ pronto para "Carregar sem compactação" no Chrome.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
// NARNIA_EXTENSION_OUT e NARNIA_EXTENSION_EXTRA_HOSTS só no e2e (narnia em http://web, extensão fora de dist/)
const out = process.env.NARNIA_EXTENSION_OUT ?? join(root, "dist");
const extraHosts = (process.env.NARNIA_EXTENSION_EXTRA_HOSTS ?? "").split(",").filter(Boolean);
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    options: "src/options.ts",
    capture: "src/capture/inject.ts",
  },
  absWorkingDir: root,
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome120",
  define: { __NARNIA_EXTRA_HOSTS__: JSON.stringify(extraHosts) },
  logLevel: "warning",
});
// o manifesto vem de src/manifest.ts (testado): compila para um módulo temporário e importa
await build({
  entryPoints: ["src/manifest.ts"],
  absWorkingDir: root,
  outfile: join(out, ".manifest.mjs"),
  format: "esm",
  logLevel: "warning",
});
const { buildManifest } = await import(join(out, ".manifest.mjs"));
writeFileSync(
  join(out, "manifest.json"),
  `${JSON.stringify(buildManifest(version, extraHosts), null, 2)}\n`,
);
rmSync(join(out, ".manifest.mjs"), { force: true });
for (const f of ["options.html", "options.css"]) copyFileSync(join(root, "src", f), join(out, f));
for (const size of [16, 32, 48, 128]) writeFileSync(join(out, "icons", `${size}.png`), icon(size));
console.log(`extensão do Chrome gerada (versão ${version})`);

/** Ícone sem dependências: círculo na cor do narnia com um ponto claro no centro, em PNG RGBA. */
function icon(size) {
  const rows = [];
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const [r, g, b, a] =
        d <= 0.3 ? [247, 246, 242, 255] : d <= 0.95 ? [15, 94, 87, 255] : [0, 0, 0, 0];
      row.push(r, g, b, a);
    }
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
