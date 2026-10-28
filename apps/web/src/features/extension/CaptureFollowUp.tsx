import type { DocumentKind, ExtensionCapture } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { documentKeys, isDocumentActive, useDocuments } from "../../hooks/useDocuments";
import { usePosting } from "../../hooks/usePostings";
import { useProfiles } from "../../hooks/useProfiles";
import { type TKey, t } from "../../i18n";
import { ApiError, type DocumentView, type PostingAnalysisView } from "../../lib/api";
import { ApplyButton } from "../job-applications/ApplyButton";
import { DuplicateDialog } from "../postings/PostingSections";
import { bridgeRequest, extensionAvailable } from "./bridge";

/**
 * Janela da extensão depois de "Salvar vaga" (F12/M2, pedido do dono 2026-10-23): na mesma janela, as etapas (lendo os
 * detalhes da vaga, analisando), o resultado resumido da análise e o CV e/ou a carta com andamento e download. A
 * análise abre sozinha no api quando a extração termina, então ela segue mesmo com a janela fechada. Vaga que parece
 * repetida mostra a comparação aqui mesmo, e a análise espera a decisão.
 */
const external = { target: "_blank", rel: "noreferrer" } as const;

/** Sem CV pronto, o Aplicar leva a gerar o CV na página da vaga (outra aba; a janela continua). */
export const openGenerateCv = (postingId: string) =>
  window.open(`/vagas/${postingId}?gerar=cv`, "_blank", "noreferrer");
const captureKey = (id: string) => ["extension", "capture", id] as const;

export function CaptureFollowUp({
  capture,
  tabId = null,
}: {
  capture: ExtensionCapture;
  tabId?: number | null;
}) {
  const postingId = capture.postingId as string;
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const { detail, analyses } = usePosting(postingId);
  const sessionId = capture.analysis.sessionId;
  const session = useQuery({
    queryKey: ["chat", "session", sessionId],
    queryFn: () => api.getChatSession(sessionId as string),
    enabled: sessionId !== null,
  });
  // a captura ganha a conversa da análise quando a extração termina; a conversa avisa quando o turno acaba
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      // `application.updated`: o formulário entrou nesta aba (pedido do dono, 2026-10-27)
      if (
        e.type === "posting.updated" ||
        e.type === "chat.session_updated" ||
        e.type === "application.updated"
      ) {
        void qc.invalidateQueries({ queryKey: captureKey(capture.id) });
        void qc.invalidateQueries({ queryKey: ["chat", "session"] });
      }
    });
  }, [ws, qc, capture.id]);
  const retry = useMutation({
    mutationFn: () => api.analyzeCapture(capture.id),
    onSettled: () => qc.invalidateQueries({ queryKey: captureKey(capture.id) }),
  });

  const latest = analyses.data?.analyses[0] ?? null;
  const status = detail.data?.posting.status;
  const busy = session.data?.session.busy ?? false;
  const posting = detail.data?.posting;
  let step:
    | "reading"
    | "duplicate"
    | "starting"
    | "analyzing"
    | "incomplete"
    | "error"
    | "idle"
    | "done";
  if (latest) step = "done";
  // parece repetida: o api só abre a análise depois da decisão (Salvar como nova, Atualizar ou Descartar)
  else if (posting?.duplicate && posting.duplicate.decision === null) step = "duplicate";
  else if (capture.analysis.error) step = "error";
  else if (!detail.data || status === "extracting") step = "reading";
  else if (sessionId && (busy || session.isPending)) step = "analyzing";
  else if (sessionId) step = "incomplete";
  else step = capture.analysis.requested ? "starting" : "idle";

  const retryButton = (label: TKey) => (
    <div>
      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {t(label)}
      </Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="flex flex-col gap-2 rounded-md border border-ok/40 bg-ok/10 p-3 text-sm"
      >
        <span>{t("capture.saved")}</span>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            href={`/vagas/${postingId}`}
            {...external}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("capture.open")}
          </a>
          {/* F07/M4: a candidatura nasce daqui também (sem CV, a vaga abre em outra aba no "Gerar CV") */}
          <ApplyButton postingId={postingId} onGenerateCv={() => openGenerateCv(postingId)} />
        </div>
      </div>
      {step === "duplicate" && posting ? (
        <div className="flex flex-col gap-2">
          <DuplicateDialog
            posting={posting}
            onDecided={() => qc.invalidateQueries({ queryKey: captureKey(capture.id) })}
          />
          <span className="text-xs text-muted-fg">{t("capture.step.duplicate")}</span>
        </div>
      ) : null}
      {step === "reading" || step === "starting" || step === "analyzing" ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
            {t(`capture.step.${step}` as TKey)}
          </span>
          {step === "analyzing" ? (
            <>
              <span className="text-xs text-muted-fg">{t("capture.step.analyzingHint")}</span>
              <a
                href={`/chat/${sessionId}`}
                {...external}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("capture.followChat")}
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {step === "incomplete" ? (
        <Alert tone="warn" className="flex flex-col gap-2">
          <span>{t("capture.step.incomplete")}</span>
          <a
            href={`/chat/${sessionId}`}
            {...external}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("capture.openChat")}
          </a>
          {retryButton("capture.analyzeAgain")}
        </Alert>
      ) : null}
      {step === "error" ? (
        <Alert tone="warn" className="flex flex-col gap-2">
          <span>
            {capture.analysis.error === "session_limit"
              ? t("capture.step.sessionLimit")
              : t("capture.step.error")}
          </span>
          {retryButton("capture.analyzeAgain")}
        </Alert>
      ) : null}
      {step === "idle" ? retryButton("capture.analyze") : null}
      {retry.isError ? <Alert tone="danger">{(retry.error as Error).message}</Alert> : null}
      {latest ? <AnalysisSummary postingId={postingId} view={latest} /> : null}
      {latest ? (
        <CaptureDocuments
          postingId={postingId}
          recommendedProfileId={latest.recommendedProfileId}
        />
      ) : null}
      {latest && tabId !== null && extensionAvailable() ? (
        <FindForm captureId={capture.id} tabId={tabId} />
      ) : null}
    </div>
  );
}

/**
 * Candidatar-se sem duplicar a vaga (pedido do dono, 2026-10-27): a extensão lê de novo a mesma aba do Chrome (a
 * pessoa vai ao formulário nela) e o formulário entra nesta aba da janela, ligado a esta vaga.
 */
function FindForm({ captureId, tabId }: { captureId: string; tabId: number }) {
  const qc = useQueryClient();
  const titleId = useId();
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const read = useMutation({
    mutationFn: () => bridgeRequest({ type: "narnia.readForm", tabId, captureId }),
    onMutate: () => setMessage(null),
    onSuccess: async (r) => {
      if (!r.ok) setMessage({ tone: "warn", text: r.error });
      else if (r.permission) setMessage({ tone: "info", text: t("capture.findForm.permission") });
      else await qc.invalidateQueries({ queryKey: captureKey(captureId) });
    },
  });
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t("capture.findForm.title")}
      </h2>
      <p className="text-xs text-muted-fg">{t("capture.findForm.hint")}</p>
      <div>
        <Button size="sm" disabled={read.isPending} onClick={() => read.mutate()}>
          {read.isPending ? t("capture.findForm.reading") : t("capture.findForm.button")}
        </Button>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </section>
  );
}

function AnalysisSummary({ postingId, view }: { postingId: string; view: PostingAnalysisView }) {
  const { profiles } = useProfiles();
  const titleId = useId();
  const a = view.analysis;
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
  const ordered = [...a.profiles].sort(
    (x, y) =>
      Number(y.profileId === a.recommendedProfileId) -
      Number(x.profileId === a.recommendedProfileId),
  );
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t("capture.analysis.title")}
      </h2>
      <p className="text-sm">{a.summary}</p>
      <ul className="flex flex-col gap-1">
        {ordered.map((p) => (
          <li key={p.profileId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {t("capture.analysis.fit", { profile: nameOf(p.profileId), fit: p.fit })}
            </span>
            {p.profileId === a.recommendedProfileId ? (
              <Badge tone="ok">{t("capture.analysis.recommended")}</Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {a.matches.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-muted-fg">
            {t("capture.analysis.matches")}
          </span>
          <ul className="list-disc pl-5 text-sm">
            {a.matches.slice(0, 4).map((m) => (
              <li key={m.requirement}>{m.requirement}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.gaps.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-muted-fg">
            {t("capture.analysis.gaps")}
          </span>
          <ul className="flex flex-col gap-1 text-sm">
            {a.gaps.slice(0, 4).map((g) => (
              <li key={g.requirement} className="flex flex-wrap items-center gap-2">
                <span>{g.requirement}</span>
                <Badge
                  tone={
                    g.severity === "blocking"
                      ? "danger"
                      : g.severity === "important"
                        ? "warn"
                        : "info"
                  }
                >
                  {t(`capture.analysis.severity.${g.severity}` as TKey)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <a
        href={`/vagas/${postingId}`}
        {...external}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("capture.analysis.full")}
      </a>
    </section>
  );
}

const KINDS: DocumentKind[] = ["cv", "cover_letter"];

export function CaptureDocuments({
  postingId,
  recommendedProfileId,
}: {
  postingId: string;
  recommendedProfileId: string | null;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { profiles, active } = useProfiles();
  const { documents } = useDocuments({ postingId });
  const titleId = useId();
  const selectId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const profileId = chosen ?? recommendedProfileId ?? active?.id ?? profiles[0]?.id ?? "";
  const [pending, setPending] = useState<{ kinds: DocumentKind[]; message: string } | null>(null);
  const run = useMutation({
    mutationFn: ({ kinds, acceptLanguage }: { kinds: DocumentKind[]; acceptLanguage: boolean }) =>
      api.generateDocument({
        kind: kinds.includes("cv") ? "cv" : "cover_letter",
        profileId,
        postingId,
        ...(kinds.length === 2 ? { withCoverLetter: true } : {}),
        ...(acceptLanguage ? { acceptLanguage: true } : {}),
      }),
    onSuccess: async () => {
      setPending(null);
      await qc.invalidateQueries({ queryKey: documentKeys.all });
    },
    onError: (e, vars) => {
      if (e instanceof ApiError && e.code === "language_not_covered")
        setPending({ kinds: vars.kinds, message: e.message });
    },
  });
  // o mais recente de cada tipo para o perfil escolhido (a lista vem do mais novo para o mais velho)
  const byKind = (kind: DocumentKind) =>
    documents.find((d) => d.document.kind === kind && d.document.profileId === profileId) ?? null;
  const missing = KINDS.filter((k) => !byKind(k));
  const generate = (kinds: DocumentKind[]) => run.mutate({ kinds, acceptLanguage: false });
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t("capture.docs.title")}
      </h2>
      {profiles.length > 1 ? (
        <label htmlFor={selectId} className="flex flex-col gap-1 text-sm">
          {t("capture.docs.profile")}
          <Select id={selectId} value={profileId} onChange={(e) => setChosen(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === recommendedProfileId
                  ? t("capture.docs.recommendedOption", { name: p.name })
                  : p.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <ul className="flex flex-col gap-2">
        {KINDS.map((kind) => {
          const view = byKind(kind);
          return view ? <DocumentRow key={kind} kind={kind} view={view} /> : null;
        })}
      </ul>
      {pending ? (
        <Alert tone="warn" className="flex flex-col gap-2">
          <span>{pending.message}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => run.mutate({ kinds: pending.kinds, acceptLanguage: true })}
            >
              {t("capture.docs.acceptLanguage")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("documents.cancel")}
            </Button>
          </div>
        </Alert>
      ) : missing.length ? (
        <div className="flex flex-wrap gap-2">
          {missing.length === 2 ? (
            <Button size="sm" disabled={run.isPending} onClick={() => generate(KINDS)}>
              {t("capture.docs.both")}
            </Button>
          ) : null}
          {missing.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={missing.length === 2 ? "outline" : "primary"}
              disabled={run.isPending}
              onClick={() => generate([k])}
            >
              {t(`capture.docs.generate.${k}` as TKey)}
            </Button>
          ))}
        </div>
      ) : null}
      {run.isError && !pending ? <Alert tone="danger">{(run.error as Error).message}</Alert> : null}
    </section>
  );
}

function DocumentRow({ kind, view }: { kind: DocumentKind; view: DocumentView }) {
  const api = useApi();
  const current = view.current;
  const status = current?.status ?? "queued";
  const active = isDocumentActive(status);
  const label = t(`documents.kinds.${kind}` as TKey);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2 text-xs text-muted-fg">
          {active ? (
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
          ) : null}
          {active
            ? t("capture.docs.generating", {
                stage: t(`documents.status.${status}` as TKey),
              })
            : t(`documents.status.${status}` as TKey)}
        </span>
      </span>
      {current?.pdfPath ? (
        <a
          href={api.documentPdfUrl(view.document.id, current.version)}
          download
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t(`capture.docs.download.${kind}` as TKey)}
        </a>
      ) : null}
    </li>
  );
}
