import type { FormSnapshot } from "./capture/form";
import type { PageSnapshot } from "./capture/page";
import { enterUrl, type Fetch, sendCapture, sendCaptureForm } from "./client";
import type { Pairing } from "./storage";

/**
 * Clique no ícone (F12/M2), sem depender do Chrome para os testes: sem pareamento abre as opções; pareada, lê a aba,
 * manda a captura e abre a janela do narnia (F12-2). Aba que não dá para ler (páginas do Chrome, loja de extensões)
 * ou envio recusado abrem a janela com o aviso; narnia fora do ar ou dispositivo revogado marcam o ícone e abrem as
 * opções, que mostram o estado da conexão. Num formulário (F12/M3), os campos vão junto; formulário só num quadro de
 * outro site abre a página da extensão que pede permissão para lê-lo.
 */

/** A aba lida: a página (vaga) e os campos de formulário, se houver (F12/M3). */
export type TabCapture = PageSnapshot & { form?: FormSnapshot };

export interface FlowDeps {
  loadPairing(): Promise<Partial<Pairing>>;
  readTab(tabId: number): Promise<TabCapture>;
  fetch: Fetch;
  openWindow(url: string): Promise<void>;
  openOptions(): Promise<void>;
  setBadge(text: string, title: string): Promise<void>;
  /**
   * Formulário num quadro de outro site: a página da extensão pede a permissão (precisa do clique da pessoa). Com
   * `captureId`, a releitura depois da permissão entra nessa captura (botão da janela).
   */
  openPermission(tabId: number, origins: string[], captureId?: string): Promise<void>;
  /** A última captura aberta na janela a partir desta aba do Chrome (pedido do dono, 2026-10-27). */
  recallCapture(tabId: number): Promise<string | null>;
  rememberCapture(tabId: number, captureId: string): Promise<void>;
  /** A aba ainda existe (a leitura falhou por falta de acesso, não porque ela foi fechada). */
  tabExists(tabId: number): Promise<boolean>;
}

/** Menos que isso não é formulário de candidatura (busca, newsletter, login). */
export const MIN_FORM_FIELDS = 2;

/**
 * Plataformas que embutem o formulário de candidatura num quadro: só por elas vale pedir permissão (um vídeo ou
 * anúncio numa página de vaga não é formulário).
 */
const FORM_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "ashbyhq.com",
  "gupy.io",
  "recruitee.com",
  "bamboohr.com",
  "jobvite.com",
  "icims.com",
  "workable.com",
  "teamtailor.com",
  "breezy.hr",
  "pinpointhq.com",
  "inhire.app",
  "solides.jobs",
  "kenoby.com",
  "quickin.io",
];

export function formFrames(origins: string[]): string[] {
  return origins.filter((o) => {
    try {
      const host = new URL(o).hostname;
      return FORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  });
}

export const DEFAULT_TITLE = "narnia-jobs";

/**
 * O que a pessoa escolheu no menu (F12-15): `posting` lê só a vaga (mesmo com um formulário na página, ex.: só ver o
 * fit), `form` ajuda no formulário, `auto` decide pelos campos (clique sem menu, e2e).
 */
export type CaptureMode = "auto" | "posting" | "form";

export async function onIconClick(
  tab: { id?: number | undefined },
  deps: FlowDeps,
  mode: CaptureMode = "auto",
): Promise<"options" | "window" | "permission"> {
  const p = await deps.loadPairing();
  if (!p.token || !p.instance || tab.id === undefined) {
    await deps.openOptions();
    return "options";
  }
  const open = async (next: string) => {
    await deps.openWindow(enterUrl(p.instance as string, p.token as string, next));
    return "window" as const;
  };
  let page: TabCapture;
  try {
    page = await deps.readTab(tab.id);
  } catch {
    return open("/candidatura?erro=leitura");
  }
  // o formulário está num quadro de outro site (Greenhouse, Lever, Workday embutidos) e a página não tem outro
  if (mode === "posting") page = { url: page.url, title: page.title, html: page.html };
  const blocked = formFrames(page.form?.frames ?? []);
  if (page.form && page.form.fields.length < MIN_FORM_FIELDS && blocked.length > 0) {
    await deps.openPermission(tab.id, blocked);
    return "permission";
  }
  // pedido do dono (2026-10-27): o formulário aberto na mesma aba de uma vaga já na janela entra na captura dela, sem
  // outra aba na janela; recusado (parece outra vaga, já tem formulário, vaga não salva), segue numa captura nova
  const previous =
    mode !== "posting" && page.form?.fields.length ? await deps.recallCapture(tab.id) : null;
  if (previous && page.form) {
    const a = await sendCaptureForm(
      deps.fetch,
      p.instance,
      p.token,
      previous,
      { url: page.url, title: page.title, html: page.html, form: page.form },
      false,
    );
    if (a.ok) {
      await deps.setBadge("", DEFAULT_TITLE);
      return open(`/candidatura?captura=${encodeURIComponent(previous)}&aba=${tab.id}`);
    }
  }
  const r = await sendCapture(deps.fetch, p.instance, p.token, { ...page, mode });
  if (r.ok) {
    await deps.setBadge("", DEFAULT_TITLE);
    await deps.rememberCapture(tab.id, r.id);
    // a aba de origem vai junto: a janela volta para ela e preenche nela (F12-14, F12-17)
    return open(`/candidatura?captura=${encodeURIComponent(r.id)}&aba=${tab.id}`);
  }
  if (r.reason === "unexpected") return open("/candidatura?erro=envio");
  await deps.setBadge("!", r.message);
  await deps.openOptions();
  return "options";
}

export type ReadFormResult =
  | { ok: true; applicationId: string; step?: number; added?: boolean }
  | { ok: true; permission: true }
  | { ok: false; code: string; error: string };

/**
 * Botão "Procurar o formulário nesta aba" (pedido do dono, 2026-10-27): lê de novo a aba do Chrome da vaga (a pessoa
 * pode ter ido ao formulário nela) e manda o formulário para a captura da vaga. O Chrome só deixa ler a aba enquanto
 * ela segue no site em que a pessoa clicou no ícone; noutro site, o clique no ícone (Ajudar no formulário) entra nesta
 * captura.
 */
export async function readFormInto(
  tabId: number,
  captureId: string,
  deps: FlowDeps,
): Promise<ReadFormResult> {
  const p = await deps.loadPairing();
  if (!p.token || !p.instance)
    return { ok: false, code: "unpaired", error: "A extensão não está conectada ao narnia." };
  let page: TabCapture;
  try {
    page = await deps.readTab(tabId);
  } catch {
    if (!(await deps.tabExists(tabId)))
      return {
        ok: false,
        code: "tab_closed",
        error:
          "A aba da vaga foi fechada. Abra o formulário numa aba e use o ícone do narnia › Ajudar no formulário.",
      };
    await deps.rememberCapture(tabId, captureId);
    return {
      ok: false,
      code: "no_access",
      error:
        "O Chrome só deixa o narnia ler esta página depois do seu clique: na aba do formulário, clique no ícone do narnia › Ajudar no formulário. Ele entra aqui, nesta vaga.",
    };
  }
  const fields = page.form?.fields.length ?? 0;
  const blocked = formFrames(page.form?.frames ?? []);
  if (fields < MIN_FORM_FIELDS && blocked.length > 0) {
    await deps.openPermission(tabId, blocked, captureId);
    return { ok: true, permission: true };
  }
  if (!page.form || fields < 1)
    return {
      ok: false,
      code: "no_form",
      error:
        "Não achei um formulário nesta aba. Se ele está em outra página, abra-a nesta mesma aba e tente de novo.",
    };
  const r = await sendCaptureForm(
    deps.fetch,
    p.instance,
    p.token,
    captureId,
    { url: page.url, title: page.title, html: page.html, form: page.form },
    true,
  );
  return r.ok ? r : { ok: false, code: r.code, error: r.message };
}
