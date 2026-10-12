import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPersona,
  createRepos,
  getCard,
  migrate,
  openDatabase,
  renderRecruiterPrompt,
  seedFixture,
} from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { pluginDir, readRecruiterTemplate, stripFrontmatter } from "../src/plugin";

/** F04 M2 · `plugin/`: fonte única da persona (F04-1), hook `SessionStart` e varredura de prompt fora do plugin. */
const ROOT = new URL("../../../", import.meta.url).pathname;
const PLUGIN = pluginDir();

describe("F04/M2 · plugin: arquivos e template", () => {
  it("manifesto, template do .mcp.json e skills existem", () => {
    for (const f of [
      ".claude-plugin/plugin.json",
      ".mcp.json.template",
      "agents/recrutador.md",
      "skills/recrutador/SKILL.md",
      "skills/perfil/SKILL.md",
      "skills/clarificar/SKILL.md",
      "hooks/hooks.json",
      "hooks/session-start.sh",
    ])
      expect(existsSync(join(PLUGIN, f)), f).toBe(true);
    expect(JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin/plugin.json"), "utf8")).name).toBe(
      "narnia-jobs",
    );
  });

  it("o agente só tem as tools do servidor narnia-jobs e as de pesquisa", () => {
    const raw = readFileSync(join(PLUGIN, "agents/recrutador.md"), "utf8");
    const tools = /^tools:\s*(.+)$/m
      .exec(raw)?.[1]
      ?.split(",")
      .map((s) => s.trim());
    expect(tools?.sort()).toEqual(["WebFetch", "WebSearch", "mcp__narnia-jobs__*"]);
  });

  it("o template renderiza sem placeholder sobrando, com persona, cartão e domínios", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const profile = repos.profiles.get(ids.profileId);
    if (!profile) throw new Error("perfil semeado ausente");
    const text = renderRecruiterPrompt(stripFrontmatter(readRecruiterTemplate()), {
      persona: buildPersona(profile),
      card: getCard(repos, ids.profileId).text,
      trustedDomains: repos.trustedDomains.list(),
    });
    expect(text).not.toMatch(/\{\{/);
    expect(text).not.toMatch(/^---/);
    expect(text).toContain("Resumo");
    expect(text).toContain("gov.br");
  });

  it("hooks.json chama o session-start.sh pela raiz do plugin", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks/hooks.json"), "utf8"));
    const cmd = hooks.hooks.SessionStart[0].hooks[0].command as string;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: é o texto literal que o Claude Code expande no hooks.json
    expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh");
  });
});

describe("F04/M2 · hook SessionStart (session-start.sh)", () => {
  let server: Server | null = null;
  let dir = "";
  afterEach(() => {
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const run = (env: Record<string, string>) =>
    spawnSync("bash", [join(PLUGIN, "hooks/session-start.sh")], {
      env: { PATH: process.env.PATH ?? "", CLAUDE_PLUGIN_ROOT: PLUGIN, ...env },
      encoding: "utf8",
      timeout: 15_000,
    });

  it("na sessão do chat web (NARNIA_SESSION_HAS_CARD=1) não injeta nada", () => {
    const r = run({
      NARNIA_SESSION_HAS_CARD: "1",
      NARNIA_API_URL: "http://127.0.0.1:9",
      NARNIA_TOKEN: "x",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("com a API no ar imprime persona + cartão, autenticando pelo token", async () => {
    // o formato da resposta real é coberto contra a rota do app em audit-c-plugin.test.ts; aqui, só a autenticação
    let auth = "";
    let url = "";
    server = createServer((req, res) => {
      auth = String(req.headers.authorization ?? "");
      url = String(req.url ?? "");
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("PERSONA E CARTÃO DO PERFIL");
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    // assíncrono: o servidor falso roda neste processo e não responderia com o spawnSync bloqueando o event loop
    const r = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn("bash", [join(PLUGIN, "hooks/session-start.sh")], {
        env: {
          PATH: process.env.PATH ?? "",
          CLAUDE_PLUGIN_ROOT: PLUGIN,
          NARNIA_API_URL: `http://127.0.0.1:${port}`,
          NARNIA_TOKEN: "tok",
        },
      });
      let stdout = "";
      child.stdout.on("data", (b) => {
        stdout += String(b);
      });
      child.on("close", (status) => resolve({ status, stdout }));
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PERSONA E CARTÃO DO PERFIL");
    expect(auth).toBe("Bearer tok");
    expect(url).toBe("/api/profiles/active/persona-card?format=text");
  });

  it("lê porta e token do .narnia-env gerado pelo install-plugin quando o ambiente não traz", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-plugin-"));
    execFileSync("cp", ["-r", `${PLUGIN}/.`, dir]);
    writeFileSync(
      join(dir, ".narnia-env"),
      "NARNIA_API_URL=http://127.0.0.1:9\nNARNIA_TOKEN=do-arquivo\n",
    );
    const r = spawnSync("bash", [join(dir, "hooks/session-start.sh")], {
      env: { PATH: process.env.PATH ?? "", CLAUDE_PLUGIN_ROOT: dir },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("127.0.0.1:9");
  });

  it("com a API fora imprime aviso visível e não falha a sessão", () => {
    const r = run({ NARNIA_API_URL: "http://127.0.0.1:9", NARNIA_TOKEN: "x" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/narnia-jobs fora do ar/);
    expect(r.stdout).toMatch(/sem o seu perfil/);
  });
});

describe("F04/M2 · nenhum texto de persona fora do plugin e dos pacotes", () => {
  // auditoria E2 (19c): a varredura cobre apps/ e packages/; os prompts das chamadas estruturadas do provider
  // (extração, análise de repositório, síntese) não são persona do recrutador e ficam de fora
  it("apps/ e packages/ não contêm marcadores do prompt do recrutador nem das notas do chat", () => {
    const markers = [
      /Você é o recrutador/i,
      /Nunca invente/i,
      /Regras de honestidade/i,
      /pergunta objetiva por vez/i,
      /esta conversa clarifica/i,
      /entrevista de descoberta: pergunte/i,
    ];
    const skip = join(ROOT, "packages/providers/src/claude-code/prompts");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (["node_modules", "dist", "coverage", "test", "test-results", "report"].includes(name))
          continue;
        const p = join(d, name);
        if (p === skip) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|md|json|sh)$/.test(name)) {
          const s = readFileSync(p, "utf8");
          if (markers.some((m) => m.test(s))) hits.push(p.replace(ROOT, ""));
        }
      }
    };
    walk(join(ROOT, "apps"));
    walk(join(ROOT, "packages"));
    expect(hits).toEqual([]);
  });
});

describe("F04/M2 · imagem de produção leva o plugin (a rota do hook lê o template em runtime)", () => {
  it("o estágio runtime copia plugin/ e o .dockerignore não exclui os .md do plugin", () => {
    const dockerfile = readFileSync(join(ROOT, "docker/Dockerfile"), "utf8");
    const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtime).toMatch(/COPY --chown=node:node plugin \/app\/plugin/);
    expect(readFileSync(join(ROOT, ".dockerignore"), "utf8")).toMatch(/^!plugin\/\*\*$/m);
  });
});
