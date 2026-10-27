import type { ExtensionCapture } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { ActivityTray } from "../../components/shell/ActivityTray";
import { ExternalLinksContext } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Button, buttonClass } from "../../components/ui/button";
import { t } from "../../i18n";
import { ApplicationWindow } from "./ApplicationWindow";
import { bridgeRequest, extensionAvailable } from "./bridge";
import { CaptureFollowUp } from "./CaptureFollowUp";
import { menuState, type TabState, tabState, useWindowTabs, type WindowTab } from "./windowTabs";

/**
 * Janela da extensão (F12-2, F12/M2): aberta numa janela popup do Chrome sobre a página lida, sem o menu do narnia.
 * Modo vaga: o que o extrator da F06 tirou da página, o aviso de vaga já salva e "Salvar vaga", que também analisa
 * (`CaptureFollowUp`). Modo formulário (F12/M3): as perguntas do formulário (`ApplicationWindow`). Cada página aberta
 * pela extensão vira uma aba (F12-16) e "Ir para a página" volta à aba analisada (F12-17). Links abrem fora da janela
 * (`target="_blank"` cai na janela normal do Chrome). As abas ficam num menu com o andamento de cada uma (pedido do
 * dono, 2026-10-27).
 */
export function CaptureWindow({
  captureId,
  error,
  tabId,
}: {
  captureId?: string | undefined;
  error?: string | undefined;
  tabId?: number | undefined;
}) {
  const navigate = useNavigate();
  const { tabs, setLabel, close, setActivity } = useWindowTabs({
    captureId: error ? undefined : captureId,
    tabId,
  });
  useTabsActivity(tabs, captureId, setActivity);
  const current = tabs.find((x) => x.captureId === captureId);
  const go = (tab: WindowTab) =>
    void navigate({
      to: "/candidatura",
      search: { captura: tab.captureId, ...(tab.tabId !== null ? { aba: tab.tabId } : {}) },
    } as never);
  const closeTab = (tab: WindowTab) => {
    close(tab.captureId);
    if (tab.captureId !== captureId) return;
    const next = tabs.find((x) => x.captureId !== tab.captureId);
    if (next) go(next);
  };
  return (
    <ExternalLinksContext.Provider value={true}>
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
            {t("capture.title")}
          </p>
          {/* a bandeja do app, em overlay (pedido do dono, 2026-10-24) */}
          <ActivityTray overlay />
        </div>
        {tabs.length > 0 ? (
          <TabsMenu tabs={tabs} current={captureId} onSelect={go} onClose={closeTab} />
        ) : null}
        {captureId && !error ? (
          <CaptureView
            id={captureId}
            tabId={current?.tabId ?? tabId ?? null}
            onLabel={(label) => setLabel(captureId, label)}
          />
        ) : (
          <Alert tone="warn">
            {error === "envio" ? t("capture.sendFailed") : t("capture.readFailed")}
          </Alert>
        )}
      </div>
    </ExternalLinksContext.Provider>
  );
}

/** Eventos que mudam o andamento de uma aba: a janela relê o api (e a cada 5 s enquanto alguma processa). */
const ACTIVITY_EVENTS = new Set([
  "posting.updated",
  "chat.session_updated",
  "application.updated",
  "document.updated",
  "profile.motivations.updated",
]);

function useTabsActivity(
  tabs: WindowTab[],
  current: string | undefined,
  setActivity: (items: Array<{ id: string; busy: boolean }>, selected: string | undefined) => void,
) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const ids = tabs.map((x) => x.captureId);
  const anyBusy = tabs.some((x) => x.busy);
  const q = useQuery({
    queryKey: ["extension", "activity", ids],
    queryFn: () => api.getCaptureActivity(ids),
    enabled: ids.length > 0,
    refetchInterval: anyBusy ? 5_000 : false,
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (ACTIVITY_EVENTS.has(e.type))
        void qc.invalidateQueries({ queryKey: ["extension", "activity"] });
    });
  }, [ws, qc]);
  // a aba aberta conta como vista; o andamento novo marca as que pararam sem ser vistas
  useEffect(() => {
    setActivity(q.data?.items ?? [], current);
  }, [q.data, current, setActivity]);
}

const STATE_KEYS: Record<
  TabState,
  "capture.tabState.busy" | "capture.tabState.unseen" | "capture.tabState.seen"
> = {
  busy: "capture.tabState.busy",
  unseen: "capture.tabState.unseen",
  seen: "capture.tabState.seen",
};

/** Processando (carregando), terminou sem você ver (bolinha verde) ou vista (check verde). */
function StateIcon({ state }: { state: TabState }) {
  const label = t(STATE_KEYS[state]);
  if (state === "busy")
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
      />
    );
  if (state === "unseen")
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-ok"
      />
    );
  return (
    <span role="img" aria-label={label} title={label} className="shrink-0 text-ok">
      ✓
    </span>
  );
}

/** As abas da janela num menu (pedido do dono, 2026-10-27): a aberta no botão, as outras na lista. */
function TabsMenu({
  tabs,
  current,
  onSelect,
  onClose,
}: {
  tabs: WindowTab[];
  current: string | undefined;
  onSelect: (tab: WindowTab) => void;
  onClose: (tab: WindowTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = tabs.find((x) => x.captureId === current);
  const name = selected?.label ?? t("capture.loading");
  const summary = menuState(tabs);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("capture.tabsTrigger", { name })}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-sm"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-xs text-muted-fg">{tabs.length}</span>
        {summary ? <StateIcon state={summary} /> : null}
        <span aria-hidden className="text-muted-fg">
          ▾
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label={t("capture.tabs")}
          className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-80 flex-col overflow-y-auto rounded-md border border-border bg-bg py-1 shadow-lg"
        >
          {tabs.map((x) => {
            const label = x.label ?? t("capture.loading");
            const isCurrent = x.captureId === current;
            return (
              <li
                key={x.captureId}
                className={`flex items-center gap-2 px-2 text-sm ${isCurrent ? "bg-primary/10" : ""}`}
              >
                <StateIcon state={tabState(x)} />
                <button
                  type="button"
                  aria-current={isCurrent ? "page" : undefined}
                  className="min-w-0 flex-1 truncate py-1.5 text-left"
                  onClick={() => {
                    setOpen(false);
                    onSelect(x);
                  }}
                >
                  {label}
                </button>
                <button
                  type="button"
                  aria-label={t("capture.closeTab", { name: label })}
                  className="px-1.5 py-1 text-muted-fg hover:text-fg"
                  onClick={() => onClose(x)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function CaptureView({
  id,
  tabId,
  onLabel,
}: {
  id: string;
  tabId: number | null;
  onLabel: (label: string) => void;
}) {
  const api = useApi();
  const q = useQuery({
    queryKey: ["extension", "capture", id],
    queryFn: () => api.getExtensionCapture(id),
  });
  const capture = q.data?.capture;
  const label = capture
    ? (capture.reading.title ??
      (capture.applicationId
        ? t("capture.formTab", { host: host(capture.url) })
        : host(capture.url)))
    : null;
  useEffect(() => {
    if (label) onLabel(label);
  }, [label, onLabel]);
  if (q.isPending) return <p className="text-sm text-muted-fg">{t("capture.loading")}</p>;
  if (q.isError || !capture) return <Alert tone="warn">{t("capture.notFound")}</Alert>;
  // o formulário pode estar em outra página da mesma aba (pedido do dono, 2026-10-27): voltar e preencher vão nela
  const page = { url: capture.applicationUrl ?? capture.url, tabId };
  return (
    <>
      <PageLink page={page} />
      {/* F12/M3: página com formulário de candidatura abre no modo formulário */}
      {capture.applicationId ? (
        <ApplicationWindow id={capture.applicationId} page={page} />
      ) : (
        <>
          {capture.mode === "form" ? <Alert tone="info">{t("capture.noForm")}</Alert> : null}
          <PostingCapture capture={capture} tabId={tabId} />
        </>
      )}
    </>
  );
}

/** Voltar à página analisada (F12-17): a extensão foca a aba; sem ela (ou aba fechada), o link abre fora. */
function PageLink({ page }: { page: { url: string; tabId: number | null } }) {
  const [message, setMessage] = useState<string | null>(null);
  const goToPage = async () => {
    setMessage(null);
    if (extensionAvailable() && page.tabId !== null) {
      const r = await bridgeRequest({ type: "narnia.focus", tabId: page.tabId, url: page.url });
      if (!r.ok) setMessage(r.error);
      return;
    }
    window.open(page.url, "_blank", "noopener");
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={() => void goToPage()}>
        {t("capture.goToPage")}
      </Button>
      {message ? <span className="w-full text-danger">{message}</span> : null}
    </div>
  );
}

const external = { target: "_blank", rel: "noreferrer" } as const;

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function PostingCapture({ capture, tabId }: { capture: ExtensionCapture; tabId: number | null }) {
  const api = useApi();
  const qc = useQueryClient();
  // salvar liga a captura à vaga e pede a análise: a captura recarregada passa a mostrar o acompanhamento
  const save = useMutation({
    mutationFn: () => api.saveCapturePosting(capture.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extension", "capture", capture.id] }),
  });
  const r = capture.reading;
  const saved = capture.postingId !== null;
  const meta = [r.siteName, t("capture.readFrom", { host: host(capture.url) })]
    .filter(Boolean)
    .join(" · ");
  if (!r.ok)
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warn">{r.message}</Alert>
        <p className="text-xs text-muted-fg">{meta}</p>
        <a href="/vagas" {...external} className={buttonClass({ variant: "outline", size: "sm" })}>
          {t("capture.paste")}
        </a>
      </div>
    );
  const dup = capture.duplicate;
  const description = r.description ? (
    <p className="whitespace-pre-line break-words rounded-md border border-border bg-muted/40 p-3 text-sm">
      {r.description}
    </p>
  ) : null;
  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold leading-tight">{r.title ?? t("capture.noTitle")}</h1>
        {r.company ? <span className="text-sm font-medium">{r.company}</span> : null}
        {r.location ? <span className="text-sm text-muted-fg">{r.location}</span> : null}
        <span className="text-xs text-muted-fg">{meta}</span>
      </header>
      {saved ? (
        <>
          <CaptureFollowUp capture={capture} tabId={tabId} />
          {/* salva, a descrição fica recolhida: o que importa agora é a análise e os documentos */}
          {description ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-fg">{t("capture.description")}</summary>
              <div className="mt-2">{description}</div>
            </details>
          ) : null}
        </>
      ) : (
        <>
          {description}
          {dup ? (
            <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t("capture.duplicate", {
                  name: [dup.title, dup.company].filter(Boolean).join(" · "),
                })}
              </span>
              <a
                href={`/vagas/${dup.id}`}
                {...external}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("capture.openDuplicate")}
              </a>
            </Alert>
          ) : null}
          {/* a descrição pode ser longa: o botão fica sempre à vista no pé da janela */}
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-bg px-4 py-3">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? t("capture.saving") : t("capture.save")}
            </Button>
            {save.isError ? (
              <Alert tone="danger">
                {t("capture.saveFail", { message: (save.error as Error).message })}
              </Alert>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}
