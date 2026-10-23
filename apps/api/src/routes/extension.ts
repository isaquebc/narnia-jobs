import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzePostingText,
  findLikelyPosting,
  isDeviceToken,
  MIN_APPLICATION_FIELDS,
  type Repos,
} from "@narnia-jobs/core";
import {
  type ExtensionCapture,
  ExtensionCaptureCreateRequestSchema,
  type ExtensionCaptureReading,
  ExtensionPairRequestSchema,
} from "@narnia-jobs/shared";
import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { COOKIE_NAME, tokenMatches } from "../auth";
import { SessionLimitError } from "../chat/session-manager";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { extractPosting } from "../postings/fetch";
import type { QueueAdapter } from "../queue";
import { enqueueLocate } from "../services/applications";
import { intakePosting } from "../services/postings";
import { validate } from "./validate";

/** Tentativas erradas de pareamento aceitas por minuto, somadas (a rota é pública). */
const MAX_FAILURES_PER_MINUTE = 10;

/**
 * Extensão do navegador (F12/M1, F12-4, F12-9): Configurações gera o código de pareamento; a página de opções da
 * extensão o troca por um token de dispositivo (rota pública, com limite de tentativas) e testa a conexão em `/me`.
 */
export function extensionRoutes(deps: {
  repos: Repos;
  version: string;
  /** Token do dono: `/enter` não troca o cookie de quem já está autenticado. */
  token: string;
  dataDir: string;
  queue?: QueueAdapter | undefined;
  bus?: EventBus | undefined;
  /** Abre a conversa da análise da vaga (F06 §1.1, `SessionManager.openPostingAnalysis`). */
  openAnalysis?: ((postingId: string) => { id: string }) | undefined;
}) {
  const app = new Hono();
  const startAnalysis = captureAnalysisStarter(deps);
  const deviceOf = (c: Context) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
    return isDeviceToken(bearer) ? deps.repos.extension.findByToken(bearer) : null;
  };
  let failures: number[] = [];

  app.post("/api/extension/pairing", (c) => c.json(deps.repos.extension.createPairing()));

  app.post("/api/extension/pair", validate("json", ExtensionPairRequestSchema), (c) => {
    const now = Date.now();
    failures = failures.filter((at) => now - at < 60_000);
    if (failures.length >= MAX_FAILURES_PER_MINUTE)
      return apiError(c, 429, "too_many_attempts", "Muitas tentativas; espere um minuto.");
    const body = c.req.valid("json");
    const paired = deps.repos.extension.pair(body.code, body.name);
    if (!paired) {
      failures.push(now);
      return apiError(
        c,
        400,
        "invalid_code",
        "Código inválido ou vencido. Gere um novo em Configurações › Extensão do navegador.",
      );
    }
    return c.json(paired);
  });

  app.get("/api/extension/devices", (c) => c.json({ devices: deps.repos.extension.listDevices() }));

  app.delete("/api/extension/devices/:id", (c) =>
    deps.repos.extension.revoke(c.req.param("id"))
      ? c.body(null, 204)
      : apiError(c, 404, "not_found", "Dispositivo não encontrado"),
  );

  app.get("/api/extension/me", (c) => c.json({ device: deviceOf(c), version: deps.version }));

  // F12/M2: a aba lida pela extensão (HTML renderizado, sem scripts nem estilos) passa pelo extrator da F06
  app.post(
    "/api/extension/captures",
    validate("json", ExtensionCaptureCreateRequestSchema),
    async (c) => {
      const b = c.req.valid("json");
      const read = extractPosting(b.html, b.url, "extension");
      const capture = deps.repos.extension.createCapture({
        kind: "page",
        url: b.url,
        title: b.title ?? null,
        payload: read.ok
          ? {
              ok: true,
              text: read.text,
              title: read.title,
              company: read.company,
              siteName: read.siteName,
            }
          : { ok: false, code: read.code, message: read.message },
        deviceId: deviceOf(c)?.id ?? null,
      });
      mkdirSync(join(deps.dataDir, "captures"), { recursive: true });
      writeFileSync(capturePath(deps.dataDir, capture.id), b.html);
      // F12/M3: página com formulário de candidatura vira um formulário e o worker organiza as perguntas
      if (b.form && b.form.fields.length >= MIN_APPLICATION_FIELDS) {
        const likely = findLikelyPosting(deps.repos.postings.list(), {
          url: b.url,
          title: read.ok ? read.title : null,
          company: read.ok ? read.company : null,
        });
        const form = deps.repos.applications.create({
          captureId: capture.id,
          postingId: likely?.id ?? null,
          profileId: deps.repos.profiles.active()?.id ?? null,
          url: b.url,
          title: b.title ?? null,
          fields: b.form.fields,
        });
        if (deps.queue) await enqueueLocate(deps.queue, form.id);
      }
      return c.json({ id: capture.id }, 201);
    },
  );

  app.get("/api/extension/captures/:id", (c) => {
    const capture = deps.repos.extension.getCapture(c.req.param("id"));
    if (!capture) return apiError(c, 404, "not_found", "Captura não encontrada");
    const p = capture.payload as CapturePayload;
    const reading = readingOf(p);
    const likely = capture.postingId
      ? null
      : findLikelyPosting(deps.repos.postings.list(), {
          url: capture.url,
          title: reading.title,
          company: reading.company,
        });
    const body: ExtensionCapture = {
      id: capture.id,
      url: capture.url,
      title: capture.title,
      createdAt: capture.createdAt,
      reading,
      postingId: capture.postingId,
      duplicate: likely ? { id: likely.id, title: likely.title, company: likely.company } : null,
      analysis: {
        requested: capture.analysisRequestedAt !== null,
        sessionId: capture.analysisSessionId,
        error: capture.analysisError,
      },
      applicationId: deps.repos.applications.byCapture(capture.id)?.id ?? null,
    };
    return c.json({ capture: body });
  });

  // "Salvar vaga" (F12/M2): o fluxo da F06 com o texto já lido; a captura fica ligada à vaga (salvar de novo devolve ela)
  app.post("/api/extension/captures/:id/posting", async (c) => {
    const capture = deps.repos.extension.getCapture(c.req.param("id"));
    if (!capture) return apiError(c, 404, "not_found", "Captura não encontrada");
    const existing = capture.postingId ? deps.repos.postings.get(capture.postingId) : null;
    if (existing) return c.json({ posting: existing, job: null }, 200);
    const p = capture.payload as CapturePayload;
    if (!p.ok) return apiError(c, 422, p.code, p.message);
    if (!deps.queue) return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    let html: string | null = null;
    try {
      html = readFileSync(capturePath(deps.dataDir, capture.id), "utf8");
    } catch {
      html = null;
    }
    const r = await intakePosting(
      { repos: deps.repos, queue: deps.queue, dataDir: deps.dataDir, bus: deps.bus },
      {
        text: p.text,
        url: capture.url,
        fields: { title: p.title ?? undefined, company: p.company ?? undefined },
        html,
      },
    );
    if (!r.ok) return apiError(c, 422, r.code, r.message);
    deps.repos.extension.linkCapturePosting(capture.id, r.posting.id);
    // pedido do dono (2026-10-23): salvar também analisa; a análise abre quando a extração termina
    // (`watchCaptureAnalyses`), ou já, se a vaga não ficou extraindo
    deps.repos.extension.requestCaptureAnalysis(capture.id);
    if (r.posting.status !== "extracting") startAnalysis(capture.id, r.posting.id);
    return c.json({ posting: r.posting, job: r.job }, 201);
  });

  // "Analisar de novo" na janela: abre a conversa da análise agora
  app.post("/api/extension/captures/:id/analyze", (c) => {
    const capture = deps.repos.extension.getCapture(c.req.param("id"));
    if (!capture) return apiError(c, 404, "not_found", "Captura não encontrada");
    if (!capture.postingId) return apiError(c, 422, "not_saved", "Salve a vaga antes de analisar.");
    deps.repos.extension.requestCaptureAnalysis(capture.id);
    const r = startAnalysis(capture.id, capture.postingId);
    if (!r.ok) return apiError(c, r.code === "session_limit" ? 409 : 422, r.code, r.message);
    return c.json({ session: r.session }, 201);
  });

  // janela popup (F12-2, §4.3): o token do dispositivo vira o cookie da web, a menos que o navegador já esteja
  // autenticado (o dono com o cookie dele no mesmo Chrome); só redireciona para dentro do narnia
  app.get("/api/extension/enter", (c) => {
    const given = c.req.query("device") ?? "";
    if (!isDeviceToken(given) || !deps.repos.extension.findByToken(given))
      return apiError(c, 401, "unauthorized", "Token inválido");
    const current = getCookie(c, COOKIE_NAME);
    const authenticated =
      tokenMatches(deps.token, current) ||
      (!!current && isDeviceToken(current) && !!deps.repos.extension.findByToken(current));
    if (!authenticated)
      setCookie(c, COOKIE_NAME, given, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    return c.redirect(safeNext(c.req.query("next")), 302);
  });

  return app;
}

type CapturePayload =
  | {
      ok: true;
      text: string;
      title: string | null;
      company: string | null;
      siteName: string | null;
    }
  | { ok: false; code: string; message: string };

const capturePath = (dataDir: string, id: string) => join(dataDir, "captures", `${id}.html`);

function readingOf(p: CapturePayload): ExtensionCaptureReading {
  if (!p.ok)
    return {
      ok: false,
      title: null,
      company: null,
      siteName: null,
      location: null,
      description: null,
      chars: 0,
      message: p.message,
    };
  const f = analyzePostingText(p.text).fields;
  const workMode = { remote: "remoto", hybrid: "híbrido", onsite: "presencial" } as const;
  const location =
    [[f.city, f.state].filter(Boolean).join(" - "), f.workMode ? workMode[f.workMode] : null]
      .filter(Boolean)
      .join(" · ") || null;
  // a descrição pula o cabeçalho que o JSON-LD monta (cargo, empresa, local), já mostrado acima dela
  const lines = p.text.split("\n");
  const body = lines.filter(
    (l, i) => !(i === 0 && l === p.title) && !/^(Empresa|Local|Contrato|Publicada em): /.test(l),
  );
  const description = body.join("\n").trim();
  return {
    ok: true,
    title: p.title,
    company: p.company,
    siteName: p.siteName,
    location,
    description: description || null,
    chars: p.text.length,
    message: null,
  };
}

/** Destino do `/enter`: só caminho do próprio narnia (`/…`, nunca `//host` nem esquema). */
function safeNext(next: string | undefined): string {
  return next && /^\/(?![/\\])/.test(next) ? next : "/candidatura";
}

type AnalysisStart =
  | { ok: true; session: { id: string } }
  | { ok: false; code: string; message: string };

/** Abre a análise da vaga para a captura e guarda a conversa, ou o erro (teto de conversas cheio). */
function captureAnalysisStarter(deps: {
  repos: Repos;
  openAnalysis?: ((postingId: string) => { id: string }) | undefined;
}) {
  return (captureId: string, postingId: string): AnalysisStart => {
    if (!deps.openAnalysis)
      return { ok: false, code: "analysis_unavailable", message: "Análise indisponível." };
    try {
      const session = deps.openAnalysis(postingId);
      deps.repos.extension.setCaptureAnalysis(captureId, { sessionId: session.id });
      return { ok: true, session };
    } catch (e) {
      const code =
        e instanceof SessionLimitError
          ? "session_limit"
          : ((e as { code?: string }).code ?? "analysis_failed");
      deps.repos.extension.setCaptureAnalysis(captureId, { error: code });
      return { ok: false, code, message: (e as Error).message };
    }
  };
}

/**
 * "Salvar vaga" também analisa (F12/M2, pedido do dono 2026-10-23): quando a extração da vaga termina (pronta ou com
 * erro, o texto já está salvo), abre a análise das capturas que pediram; vaga com duplicata pendente espera a decisão. Roda no api, então a análise segue mesmo
 * com a janela fechada.
 */
export function watchCaptureAnalyses(deps: {
  repos: Repos;
  bus: EventBus;
  openAnalysis: (postingId: string) => { id: string };
}) {
  const start = captureAnalysisStarter(deps);
  return deps.bus.on((e) => {
    if (e.type !== "posting.updated") return;
    const posting = deps.repos.postings.get(e.postingId);
    if (!posting || posting.status === "extracting") return;
    // parece repetida: espera a decisão (Salvar como nova, Atualizar ou Descartar) para não analisar à toa; a salva
    // que já tem análise não abre outra
    if (posting.duplicate && posting.duplicate.decision === null) return;
    if (deps.repos.jobAnalyses.list(e.postingId).length) return;
    for (const capture of deps.repos.extension.capturesAwaitingAnalysis(e.postingId))
      start(capture.id, e.postingId);
  });
}
