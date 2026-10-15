// Navegador headless da busca de vaga por URL (correção do teste do dono, 2026-10-15). O api conecta por
// NARNIA_BROWSER_WS (ws://browser:3000/narnia) com o mesmo playwright-core; este serviço fica numa rede só com o api
// (sem acesso ao redis nem aos dados) e o api filtra cada requisição da página pelo anti-SSRF (apps/api/src/postings).
import { chromium } from "playwright-core";

const server = await chromium.launchServer({
  executablePath: "/usr/bin/chromium",
  host: "0.0.0.0",
  port: 3000,
  wsPath: "/narnia",
  headless: true,
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
});
console.log(`[browser] pronto em ${server.wsEndpoint()}`);
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    await server.close();
    process.exit(0);
  });
