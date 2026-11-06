// Build da extensão (F12-10): esbuild gera dist/ pronto para "Carregar sem compactação" no Chrome.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { iconPng } from "./icon.mjs";

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
    permission: "src/permission.ts",
    popup: "src/popup.ts",
    "page-bridge": "src/page-bridge.ts",
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
for (const f of ["options.html", "options.css", "permission.html", "popup.html"])
  copyFileSync(join(root, "src", f), join(out, f));
for (const size of [16, 32, 48, 128])
  writeFileSync(join(out, "icons", `${size}.png`), iconPng(size));
console.log(`extensão do Chrome gerada (versão ${version})`);
