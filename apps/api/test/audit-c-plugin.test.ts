import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerType, serve } from "@hono/node-server";
import { recruiterContext, seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { pluginDir } from "../src/plugin";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Auditoria pós-F04 · bloco C (modo B, terminal). Tudo contra a ROTA REAL do app servida por HTTP local: o hook e o
 * `stage_plugin` falam com o mesmo código que o dono usa (lição do projeto: dados de teste pelo caminho de produção;
 * o teste antigo do hook usava um JSON montado à mão e escondeu que o hook nunca lia a resposta real).
 */
const ROOT = new URL("../../../", import.meta.url).pathname;
const PLUGIN = pluginDir();

let t: TestApp | null = null;
let server: ServerType | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
  t?.cleanup();
  t = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function liveApp(): Promise<{ t: TestApp; url: string }> {
  t = makeTestApp();
  const app = t.app;
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((r) => server?.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { t, url: `http://127.0.0.1:${port}` };
}

function tmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** Roda um script sem bloquear o event loop (o servidor do teste roda neste processo). */
function sh(
  args: string[],
  env: Record<string, string>,
  input?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", args, {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: tmp("narnia-home-"), ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr.on("data", (b) => {
      stderr += String(b);
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };

describe("auditoria C · rota persona-card em texto e como agente", () => {
  it("?format=text devolve o texto puro e o hash do cartão no header", async () => {
    const { t } = await liveApp();
    const ids = seedFixture(t.repos, "engineer");
    const json = (await (await t.api("/api/profiles/active/persona-card")).json()) as {
      text: string;
      cardHash: string;
    };
    const r = await t.api("/api/profiles/active/persona-card?format=text");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    // recrutador global (F06-8): o hash é o dos cartões de todos os perfis
    expect(r.headers.get("x-narnia-card-hash")).toBe(recruiterContext(t.repos).hash);
    expect(await (await t.api("/api/profiles/active/persona-card?format=text")).text()).toContain(
      `id ${ids.profileId}`,
    );
    expect(await r.text()).toBe(json.text);
  });

  it("?format=agent gera o agente do plugin sem placeholder, com as tools do servidor pedido e o cartão via tool", async () => {
    const { t } = await liveApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api(
      "/api/profiles/active/persona-card?format=agent&server=narnia-jobs-claude",
    );
    expect(r.status).toBe(200);
    const md = await r.text();
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toMatch(/^name: recrutador$/m);
    expect(md).toMatch(/^tools: mcp__narnia-jobs-claude__\*, WebSearch, WebFetch$/m);
    expect(md).not.toMatch(/\{\{/);
    expect(md).toContain("profile_get_card");
    expect(md).toContain("gov.br");
    // o cartão envelheceria no arquivo instalado: o agente busca o atual pela tool
    expect(md).not.toContain("Ana Maria Exemplo");
  });

  it("?format=agent recusa nome de servidor inválido", async () => {
    const { t } = await liveApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api("/api/profiles/active/persona-card?format=agent&server=a%20b%22");
    expect(r.status).toBe(400);
  });
});

describe("auditoria C · hook SessionStart contra a rota real", () => {
  it("imprime persona e cartão do perfil ativo, sem aviso de fora do ar", async () => {
    const { t, url } = await liveApp();
    seedFixture(t.repos, "engineer");
    const r = await sh([join(PLUGIN, "hooks/session-start.sh")], {
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      NARNIA_API_URL: url,
      NARNIA_TOKEN: TOKEN,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/fora do ar/);
    expect(r.stdout).toContain("Ana Maria Exemplo");
    expect(r.stdout).toContain("gov.br");
    expect(r.stdout).not.toMatch(/\{\{/);
  });
});

describe("auditoria C · stage_plugin (start.sh) contra a rota real", () => {
  const stage = (url: string, dir: string) =>
    sh(
      [
        "-c",
        'source ./start.sh; stage_plugin ./plugin "$1" "$2" "$3" narnia-jobs-claude-local narnia-jobs-claude',
        "_",
        dir,
        url,
        TOKEN,
      ],
      {},
    );

  it("nenhum arquivo instalado tem placeholder; agente com as tools do servidor da instância; token só em arquivos 0600", async () => {
    const { t, url } = await liveApp();
    seedFixture(t.repos, "engineer");
    const dir = join(tmp("narnia-stage-"), "stage");
    const r = await stage(url, dir);
    expect(r.status, r.stderr).toBe(0);
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = walk(dir);
    const withPlaceholder = files.filter((f) => /\{\{/.test(readFileSync(f, "utf8")));
    expect(withPlaceholder).toEqual([]);
    expect(files.some((f) => f.endsWith(".mcp.json.template"))).toBe(false);
    const agent = readFileSync(join(dir, "plugin/agents/recrutador.md"), "utf8");
    expect(agent).toMatch(/^tools: mcp__narnia-jobs-claude__\*, WebSearch, WebFetch$/m);
    // o especializado (F06-8) vai cru do repositório, só com o nome do servidor da instância
    const specialist = readFileSync(join(dir, "plugin/agents/recrutador-especializado.md"), "utf8");
    expect(specialist).toMatch(/^tools: mcp__narnia-jobs-claude__\*$/m);
    const headers = join(dir, "mcp-headers.json");
    expect(JSON.parse(readFileSync(headers, "utf8"))).toEqual({
      Authorization: `Bearer ${TOKEN}`,
    });
    expect((statSync(headers).mode & 0o777).toString(8)).toBe("600");
    // o token só aparece nos dois arquivos 0600
    const withToken = files.filter((f) => readFileSync(f, "utf8").includes(TOKEN));
    expect(withToken.map((f) => f.replace(`${dir}/`, "")).sort()).toEqual([
      "mcp-headers.json",
      "plugin/.narnia-env",
    ]);
  });

  it("com a API fora do ar falha com mensagem clara (não instala agente cru)", async () => {
    const dir = join(tmp("narnia-stage-"), "stage");
    const r = await stage("http://127.0.0.1:9", dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/agente do recrutador/);
  });
});

/** Linhas no formato do transcript do Claude Code 2.1.x (chaves conferidas num transcript real, 2026-10-12). */
function transcriptLine(o: {
  id: string;
  model?: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  text?: string;
}) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    sessionId: "sess-1",
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model ?? "claude-sonnet-5-5",
      content: [{ type: "text", text: o.text ?? 'diz "model":"x" e "output_tokens":999' }],
      usage: {
        input_tokens: o.input,
        cache_creation_input_tokens: o.cacheWrite ?? 0,
        cache_read_input_tokens: o.cacheRead ?? 0,
        output_tokens: o.output,
        cache_creation: { ephemeral_1h_input_tokens: o.cacheWrite ?? 0 },
        iterations: [{ input_tokens: o.input, output_tokens: o.output, type: "message" }],
      },
    },
    uuid: `u-${Math.random()}`,
    timestamp: "2026-10-12T12:00:00.000Z",
  });
}

describe("auditoria C · uso do modo B pelo hook Stop", () => {
  const writeTranscript = (lines: string[]) => {
    const p = join(tmp("narnia-transcript-"), "t.jsonl");
    writeFileSync(p, `${lines.join("\n")}\n`);
    return p;
  };
  const stop = (url: string, transcript: string, extra: Record<string, string> = {}) =>
    sh(
      [join(PLUGIN, "hooks/usage-stop.sh")],
      { CLAUDE_PLUGIN_ROOT: PLUGIN, NARNIA_API_URL: url, NARNIA_TOKEN: TOKEN, ...extra },
      JSON.stringify({
        session_id: "sess-1",
        transcript_path: transcript,
        hook_event_name: "Stop",
      }),
    );

  it("registra cada mensagem do assistente uma vez (o transcript repete a mesma mensagem por bloco)", async () => {
    const { t, url } = await liveApp();
    const p = writeTranscript([
      JSON.stringify({ type: "user", message: { role: "user", content: "oi" } }),
      transcriptLine({ id: "msg_A", input: 10, output: 5, cacheRead: 100, cacheWrite: 7 }),
      transcriptLine({ id: "msg_A", input: 10, output: 5, cacheRead: 100, cacheWrite: 7 }),
      transcriptLine({ id: "msg_B", model: "claude-haiku-4-5", input: 3, output: 2 }),
    ]);
    const r = await stop(url, p);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
    const rows = t.repos.usageEvents.list(10);
    expect(rows).toHaveLength(2);
    const a = rows.find((x) => x.model === "claude-sonnet-5-5");
    expect(a).toMatchObject({
      origin: "claude-log",
      category: "chat",
      inputTokens: 10,
      outputTokens: 5,
      cacheRead: 100,
      cacheWrite: 7,
    });
    // o Stop roda a cada resposta e relê o transcript inteiro: nada é contado de novo
    await stop(url, p);
    expect(t.repos.usageEvents.list(10)).toHaveLength(2);
  });

  it("na sessão do chat web (modo A) não registra: o app já mede pelo SDK", async () => {
    const { t, url } = await liveApp();
    const p = writeTranscript([transcriptLine({ id: "msg_A", input: 1, output: 1 })]);
    const r = await stop(url, p, { NARNIA_SESSION_HAS_CARD: "1" });
    expect(r.status).toBe(0);
    expect(t.repos.usageEvents.list(10)).toHaveLength(0);
  });

  it("com a API fora do ar não falha nem imprime nada (não atrapalha a sessão)", async () => {
    const p = writeTranscript([transcriptLine({ id: "msg_A", input: 1, output: 1 })]);
    const r = await stop("http://127.0.0.1:9", p);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("hooks.json registra o Stop pela raiz do plugin", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks/hooks.json"), "utf8"));
    const cmd = hooks.hooks.Stop[0].hooks[0].command as string;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: é o texto literal que o Claude Code expande no hooks.json
    expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/usage-stop.sh");
  });
});

describe("auditoria C · POST /api/usage/terminal", () => {
  it("valida a sessão e as linhas; exige token", async () => {
    const { t, url } = await liveApp();
    const ok = await fetch(`${url}/api/usage/terminal?session=sess-9`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain" },
      body: "msg_1\tclaude-sonnet-5-5\t1\t2\t3\t4\nmsg_1\tclaude-sonnet-5-5\t1\t2\t3\t4\n",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ recorded: 1 });
    expect(t.repos.usageEvents.list(5)).toHaveLength(1);
    const bad = await fetch(`${url}/api/usage/terminal?session=a%20b`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain" },
      body: "msg_1\tm\t1\t2\t3\t4\n",
    });
    expect(bad.status).toBe(400);
    const badLine = await fetch(`${url}/api/usage/terminal?session=sess-9`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain" },
      body: "msg_2\tm\tx\t2\t3\t4\n",
    });
    expect(badLine.status).toBe(400);
    const noAuth = await fetch(`${url}/api/usage/terminal?session=sess-9`, {
      method: "POST",
      body: "",
    });
    expect(noAuth.status).toBe(401);
  });
});
