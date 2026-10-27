import {
  type ApplicationFormView,
  assumptionAsMotivation,
  type DocumentKind,
} from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { CopyButton } from "../../components/ui/copy-button";
import { Select, Textarea } from "../../components/ui/input";
import { useDocuments } from "../../hooks/useDocuments";
import { usePosting } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { ChatView } from "../chat/ChatPage";
import { type SessionLimit, SessionLimitDialog, sessionLimitOf } from "../chat/SessionLimitDialog";
import { AddressSelect, MotivationsEditor, PhraseEditor } from "../profiles/MotivationsEditor";
import { bridgeRequest, extensionAvailable } from "./bridge";
import { CaptureDocuments } from "./CaptureFollowUp";

/**
 * Janela da extensão no modo formulário (F12/M3, §4.7): as perguntas do formulário de candidatura na ordem da página,
 * por seção, com o tipo, as opções e o limite. Campos óbvios (nome, e-mail, telefone, links, cidade) trazem o valor dos
 * dados da pessoa; as outras, a resposta sugerida (F12/M4) ou a lacuna. Copiar e Preencher (F12-14), e o campo do
 * currículo anexa o PDF do CV da vaga. Consentimento e autodeclaração ficam com a pessoa (F12-12). Nada é enviado.
 * F12-18: as perguntas abertas chegam escritas como a pessoa, com o que o narnia supôs para ela conferir. F12-19: toda
 * resposta é editável antes de preencher; Preencher usa o texto da caixa, e sair dela guarda a edição. F12/M5: a aba
 * "Conversa" é o chat do recrutador numa conversa própria do formulário (nasce na primeira mensagem); o que ele grava
 * volta para a lista como "Escrita no chat".
 */
const external = { target: "_blank", rel: "noreferrer" } as const;
const applicationKey = (id: string) => ["extension", "application", id] as const;

type Question = ApplicationFormView["questions"][number];
type FillItem = {
  ref: string;
  value: string;
  file?: { name: string; type: string; base64: string };
};

/** A aba do Chrome do formulário: o preenchimento (F12-14) escreve nela, pela extensão. */
export interface FormPage {
  url: string;
  tabId: number | null;
}

/**
 * O valor guardado: a edição da pessoa (F12-19) ou a resposta combinada no chat (F12/M5), o dos dados (campo óbvio)
 * ou a resposta sugerida (F12/M4).
 */
const savedValue = (q: Question) =>
  (q.answer?.source === "edited" || q.answer?.source === "chat" ? q.answer.answer : null) ??
  q.prefill ??
  q.answer?.answer ??
  "";

/** O que a pessoa responde pela janela: nunca consentimento, autodeclaração nem arquivo (F12-12). */
const editable = (q: Question) => !["consent", "self_declaration", "file"].includes(q.kind);

/** Autodeclaração que a pessoa já deu no chat e que casou com uma opção da página (F12-12, pelo código). */
const declared = (q: Question) => q.kind === "self_declaration" && Boolean(q.prefill);

/** Campo de arquivo: carta pelo rótulo; o resto (currículo, CV, resume) recebe o CV. */
const fileKind = (q: Question): DocumentKind =>
  /carta|cover|motiva/i.test(q.question) ? "cover_letter" : "cv";

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function ApplicationWindow({ id, page }: { id: string; page: FormPage }) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: applicationKey(id), queryFn: () => api.getApplication(id) });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "application.updated" && e.applicationId === id)
        void qc.invalidateQueries({ queryKey: applicationKey(id) });
    });
  }, [ws, qc, id]);
  const relocate = useMutation({
    mutationFn: () => api.relocateApplication(id),
    onSettled: () => qc.invalidateQueries({ queryKey: applicationKey(id) }),
  });
  const regenerate = useMutation({
    mutationFn: () => api.generateApplicationAnswers(id),
    onSettled: () => qc.invalidateQueries({ queryKey: applicationKey(id) }),
  });
  // F12-23: suposição do roleplay aceita (vira motivação do perfil) ou recusada (a pergunta é refeita)
  const decide = useMutation({
    mutationFn: (v: {
      questionId: string;
      body: { index: number; action: "accept" | "refuse"; text?: string };
    }) => api.decideAssumption(id, v.questionId, v.body),
    onSuccess: (r) => qc.setQueryData(applicationKey(id), r),
  });
  const postingId = q.data?.application.postingId ?? null;
  const { documents } = useDocuments({ postingId: postingId ?? "sem-vaga" });
  const docFor = (kind: DocumentKind) =>
    documents.find(
      (d) => d.document.kind === kind && d.document.postingId === postingId && d.current?.pdfPath,
    ) ?? null;
  /** O texto nas caixas, antes de guardar (F12-19): é ele que Copiar e Preencher usam. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const dropDraft = (questionId: string) => setDrafts(({ [questionId]: _, ...rest }) => rest);
  const currentValue = (x: Question) => drafts[x.id] ?? savedValue(x);
  // F12/M6: preencher só vale na etapa aberta na aba; as outras ficam para copiar
  const currentStep = q.data?.application.currentStep ?? 1;
  const onPage = (x: Question) => (x.step ?? 1) === currentStep;
  const fillable = (x: Question) => onPage(x) && editable(x) && currentValue(x).trim() !== "";
  const save = useMutation({
    mutationFn: (v: { questionId: string; answer: string }) =>
      api.editApplicationAnswer(id, v.questionId, v.answer),
    onSuccess: (r, v) => {
      qc.setQueryData(applicationKey(id), r);
      dropDraft(v.questionId);
    },
  });
  /** Guarda a edição como versão da pessoa; vazio fica só na caixa, igual ao guardado não grava nada. */
  const commit = (x: Question, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (clean === savedValue(x).trim()) dropDraft(x.id);
    else save.mutate({ questionId: x.id, answer: clean });
  };
  // F12/M5: Perguntas | Conversa; "Ajustar no chat" leva a pergunta para o campo da conversa
  const [view, setView] = useState<"questions" | "chat">("questions");
  const [chatDraft, setChatDraft] = useState("");
  const toChat = (draft: string) => {
    setChatDraft(draft);
    setView("chat");
  };
  const askInChat = (x: Question) =>
    toChat(
      x.kind === "self_declaration"
        ? t("application.declareDraft", { question: x.question })
        : t("application.askDraft", { question: x.question }),
    );
  const [fillMessage, setFillMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(
    null,
  );
  const send = async (items: FillItem[]) => {
    setFillMessage(null);
    if (!extensionAvailable() || page.tabId === null) {
      setFillMessage({ tone: "warn", text: t("application.fillUnavailable") });
      return;
    }
    // o endereço da etapa atual (a captura pode ainda ter o da etapa anterior)
    const url = q.data?.application.url ?? page.url;
    const r = await bridgeRequest({ type: "narnia.fill", tabId: page.tabId, url, items });
    if (!r.ok) setFillMessage({ tone: "warn", text: r.error });
    else if (r.failed?.length)
      setFillMessage({ tone: "warn", text: t("application.fillFailed", { n: r.failed.length }) });
    else
      setFillMessage({
        tone: "ok",
        text:
          items.length === 1
            ? t("application.filledOne")
            : t("application.filled", { n: r.filled?.length ?? items.length }),
      });
  };
  const fill = (questions: Question[]) =>
    send(questions.map((x) => ({ ref: x.fieldRefs[0] as string, value: currentValue(x).trim() })));
  /** Anexa o PDF do CV (ou da carta) da vaga no campo de arquivo (pedido do dono, 2026-10-23). */
  const attach = async (x: Question) => {
    const kind = fileKind(x);
    const doc = docFor(kind);
    if (!doc?.current) return;
    const res = await fetch(api.documentPdfUrl(doc.document.id, doc.current.version), {
      credentials: "same-origin",
    });
    const buffer = await res.arrayBuffer();
    await send([
      {
        ref: x.fieldRefs[0] as string,
        value: "",
        file: {
          name: kind === "cv" ? "curriculo.pdf" : "carta.pdf",
          type: "application/pdf",
          base64: toBase64(buffer),
        },
      },
    ]);
  };
  if (q.isPending) return <p className="text-sm text-muted-fg">{t("capture.loading")}</p>;
  if (q.isError) return <Alert tone="warn">{t("capture.notFound")}</Alert>;
  const a = q.data.application;
  const steps = a.steps ?? [];
  const multiStep = steps.length > 1;
  const locatingStep = steps.find((s) => s.status === "locating" && s.n > 1);
  // a etapa nova organizando não esconde as perguntas das que já estão prontas
  const showQuestions = a.status === "ready" || (a.status === "locating" && a.questions.length > 0);
  const again = (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={relocate.isPending}
        onClick={() => relocate.mutate()}
      >
        {t("application.again")}
      </Button>
    </div>
  );
  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold leading-tight">{t("application.title")}</h1>
        <PostingLink application={a} />
      </header>
      <fieldset aria-label={t("application.views")} className="flex gap-1">
        {(["questions", "chat"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "primary" : "outline"}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "questions" ? t("application.viewQuestions") : t("application.viewChat")}
          </Button>
        ))}
      </fieldset>
      {view === "chat" ? (
        <FormChat
          applicationId={a.id}
          sessionId={a.chatSessionId}
          draft={chatDraft}
          onOpened={() => qc.invalidateQueries({ queryKey: applicationKey(id) })}
        />
      ) : null}
      {view === "questions" && a.status === "locating" ? (
        <Progress
          text={
            locatingStep && a.questions.length
              ? t("application.locatingStep", { n: locatingStep.n })
              : t("application.locating")
          }
        />
      ) : null}
      {view === "questions" && a.status === "error" ? (
        <Alert tone="warn" className="flex flex-col gap-2">
          <span>{t("application.error")}</span>
          {a.error ? (
            <span className="break-words text-xs">
              {t("application.detail", { detail: a.error })}
            </span>
          ) : null}
          {again}
        </Alert>
      ) : null}
      {view === "questions" && showQuestions ? (
        <>
          {a.warning ? (
            <Alert tone="warn" className="flex flex-col gap-1">
              <span>{t("application.fallback")}</span>
              <span className="break-words text-xs">
                {t("application.detail", { detail: a.warning })}
              </span>
            </Alert>
          ) : null}
          {a.answersStatus === "answering" ? <Progress text={t("application.answering")} /> : null}
          {a.answersStatus === "motivations" && a.answersProfileId ? (
            <MotivationsStep
              profileId={a.answersProfileId}
              onDone={() => qc.invalidateQueries({ queryKey: applicationKey(id) })}
            />
          ) : null}
          {a.answersStatus === "error" ? (
            <Alert tone="warn" className="flex flex-col gap-1">
              <span>{t("application.answersError")}</span>
              {a.answersError ? (
                <span className="break-words text-xs">
                  {t("application.detail", { detail: a.answersError })}
                </span>
              ) : null}
            </Alert>
          ) : null}
          {!a.postingId ? (
            <Alert tone="info" className="flex flex-col gap-2">
              <span>{t("application.needsPosting")}</span>
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toChat(t("application.pasteDraft"))}
                >
                  {t("application.pasteDescription")}
                </Button>
              </span>
            </Alert>
          ) : null}
          {a.questions.some(fillable) ? (
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={() => void fill(a.questions.filter(fillable))}>
                {t("application.fillAll")}
              </Button>
            </div>
          ) : null}
          {fillMessage ? (
            <p
              role="status"
              className={`text-xs ${fillMessage.tone === "ok" ? "text-ok" : "text-danger"}`}
            >
              {fillMessage.text}
            </p>
          ) : null}
          <ol aria-label={t("application.list")} className="flex flex-col gap-3">
            {a.questions.map((x, i) => (
              <QuestionItem
                key={x.id}
                n={i + 1}
                q={x}
                stepTitle={
                  multiStep && (x.step ?? 1) !== (a.questions[i - 1]?.step ?? (i ? 1 : 0))
                    ? t(
                        (x.step ?? 1) === currentStep
                          ? "application.stepCurrent"
                          : "application.step",
                        { n: x.step ?? 1 },
                      )
                    : null
                }
                section={
                  x.section &&
                  (x.section !== a.questions[i - 1]?.section ||
                    (x.step ?? 1) !== (a.questions[i - 1]?.step ?? 1))
                    ? x.section
                    : null
                }
                answering={a.answersStatus === "answering"}
                hasPosting={a.postingId !== null}
                value={currentValue(x)}
                onChange={(text) => setDrafts((d) => ({ ...d, [x.id]: text }))}
                onCommit={(text) => commit(x, text)}
                onFill={fillable(x) || (onPage(x) && declared(x)) ? () => void fill([x]) : null}
                onAsk={
                  (editable(x) && !x.profileField) ||
                  (x.kind === "self_declaration" && !declared(x))
                    ? () => askInChat(x)
                    : null
                }
                onAttach={
                  x.kind === "file" && onPage(x) && docFor(fileKind(x))
                    ? { kind: fileKind(x), run: () => void attach(x) }
                    : null
                }
                onAssumption={(index, action, text) =>
                  decide.mutate({
                    questionId: x.id,
                    body: { index, action, ...(text ? { text } : {}) },
                  })
                }
              />
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {a.postingId && a.answersStatus !== "answering" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={regenerate.isPending}
                onClick={() => regenerate.mutate()}
              >
                {t("application.regenerate")}
              </Button>
            ) : null}
            {again}
          </div>
          {extensionAvailable() && page.tabId !== null ? (
            <NextStep applicationId={a.id} captureId={a.captureId} tabId={page.tabId} />
          ) : null}
        </>
      ) : null}
      {relocate.isError ? <Alert tone="danger">{(relocate.error as Error).message}</Alert> : null}
      {save.isError ? (
        <Alert tone="danger">
          {t("application.saveFailed", { detail: (save.error as Error).message })}
        </Alert>
      ) : null}
      {regenerate.isError ? (
        <Alert tone="danger">{(regenerate.error as Error).message}</Alert>
      ) : null}
      {decide.isError ? (
        <Alert tone="danger">
          {t("motivations.failed", { detail: (decide.error as Error).message })}
        </Alert>
      ) : null}
      {/* pedido do dono (2026-10-23): o CV e a carta da vaga ligada, para anexar, ou o botão de gerar */}
      {view === "questions" && a.postingId ? (
        <PostingDocuments postingId={a.postingId} profileId={a.profileId} />
      ) : null}
    </article>
  );
}

/**
 * Formulário em várias etapas (F12/M6): a extensão lê de novo a mesma aba (a pessoa avançou nela) e a página entra
 * neste formulário como etapa nova, ou vira a atual se já foi lida.
 */
function NextStep({
  applicationId,
  captureId,
  tabId,
}: {
  applicationId: string;
  captureId: string;
  tabId: number;
}) {
  const qc = useQueryClient();
  const titleId = useId();
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const read = useMutation({
    mutationFn: () => bridgeRequest({ type: "narnia.readForm", tabId, captureId }),
    onMutate: () => setMessage(null),
    onSuccess: async (r) => {
      if (!r.ok) setMessage({ tone: "warn", text: r.error });
      else if (r.permission)
        setMessage({ tone: "info", text: t("application.nextStep.permission") });
      else {
        const n = r.step ?? 1;
        setMessage({
          tone: "info",
          text: r.added
            ? t("application.nextStep.added", { n })
            : t("application.nextStep.seen", { n }),
        });
        await qc.invalidateQueries({ queryKey: applicationKey(applicationId) });
      }
    },
  });
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t border-border pt-3">
      <p id={titleId} className="text-xs text-muted-fg">
        {t("application.nextStep.hint")}
      </p>
      <div>
        <Button size="sm" variant="outline" disabled={read.isPending} onClick={() => read.mutate()}>
          {read.isPending ? t("application.nextStep.reading") : t("application.nextStep.button")}
        </Button>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </section>
  );
}

/**
 * Conversa do formulário (F12/M5): o chat do recrutador, como no app. Sem conversa ainda, um campo simples: a primeira
 * mensagem cria a conversa (com o contexto do formulário) e o chat aparece no lugar dele.
 */
function FormChat({
  applicationId,
  sessionId,
  draft,
  onOpened,
}: {
  applicationId: string;
  sessionId: string | null;
  draft: string;
  onOpened: () => void;
}) {
  const api = useApi();
  const [text, setText] = useState(draft);
  const [opened, setOpened] = useState<string | null>(null);
  const [limit, setLimit] = useState<(SessionLimit & { text: string }) | null>(null);
  useEffect(() => {
    if (draft) setText(draft);
  }, [draft]);
  const open = useMutation({
    mutationFn: (message: string) => api.openApplicationChat(applicationId, message),
    onSuccess: (r) => {
      setOpened(r.session.id);
      onOpened();
    },
    onError: (e, message) => {
      setText(message);
      const l = sessionLimitOf(e);
      if (l) setLimit({ ...l, text: message });
    },
  });
  const current = sessionId ?? opened;
  if (current)
    return (
      <div className="flex h-[70vh] min-h-96 flex-col">
        <ChatView sessionId={current} draft={draft} />
      </div>
    );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || open.isPending) return;
    setText("");
    open.mutate(v);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="text-sm text-muted-fg">{t("application.chatHint")}</p>
      <Textarea
        aria-label={t("chat.inputLabel")}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!text.trim() || open.isPending}>
          {t("application.chatSend")}
        </Button>
      </div>
      {open.isError && !limit ? (
        <Alert tone="danger">
          {t("application.chatFailed", { detail: (open.error as Error).message })}
        </Alert>
      ) : null}
      <SessionLimitDialog
        limit={limit}
        onCancel={() => setLimit(null)}
        onChoose={async (id) => {
          const pending = limit?.text ?? "";
          setLimit(null);
          await api.hibernateChat(id);
          setText("");
          open.mutate(pending);
        }}
      />
    </form>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium">
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
      />
      {text}
    </div>
  );
}

function QuestionItem({
  n,
  q,
  stepTitle,
  section,
  answering,
  hasPosting,
  value,
  onChange,
  onCommit,
  onFill,
  onAttach,
  onAsk,
  onAssumption,
}: {
  n: number;
  q: Question;
  /** Primeira pergunta de uma etapa num formulário de várias (F12/M6). */
  stepTitle: string | null;
  section: string | null;
  answering: boolean;
  hasPosting: boolean;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
  onAttach: { kind: DocumentKind; run: () => void } | null;
  onAsk: (() => void) | null;
  onAssumption: AssumptionDecide;
}) {
  const details = [
    q.options.length ? q.options.map((o) => o.label).join(" · ") : null,
    q.maxChars ? t("application.maxChars", { n: q.maxChars }) : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1">
      {stepTitle ? <h2 className="mt-2 text-sm font-semibold">{stepTitle}</h2> : null}
      {section ? (
        <h2 className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-fg">
          {section}
        </h2>
      ) : null}
      <div className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">
            {n}. {q.question}
          </span>
          <span className="flex shrink-0 gap-1">
            {q.required ? <Badge tone="warn">{t("application.required")}</Badge> : null}
            <Badge tone="neutral">{t(`application.kinds.${q.kind}` as TKey)}</Badge>
          </span>
        </div>
        {details.length ? (
          <span className="text-xs text-muted-fg">{details.join(" · ")}</span>
        ) : null}
        <Answer
          q={q}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          onFill={onFill}
          onAttach={onAttach}
          onAsk={onAsk}
          onAssumption={onAssumption}
          answering={answering}
          hasPosting={hasPosting}
        />
      </div>
    </li>
  );
}

/** A resposta numa caixa editável (F12-19); escolha com opções vira a lista das opções da página. */
function EditableValue({
  q,
  value,
  onChange,
  onCommit,
  onFill,
  onAsk,
}: {
  q: Question;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
  onAsk: (() => void) | null;
}) {
  const label = t("application.answerLabel", { question: q.question });
  const choice = (q.kind === "choice" || q.kind === "yes_no") && q.options.length > 0;
  const long = q.kind === "long_text" || value.length > 60;
  return (
    <div className="flex flex-col gap-1.5">
      {choice ? (
        <Select
          aria-label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onCommit(e.target.value);
          }}
        >
          <option value="">{t("application.noneOption")}</option>
          {q.options.map((o) => (
            <option key={o.value} value={o.label}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Textarea
          aria-label={label}
          value={value}
          placeholder={t("application.writeOwn")}
          rows={long ? Math.min(10, Math.max(3, Math.ceil(value.length / 55))) : 1}
          maxLength={q.maxChars ?? undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
      )}
      {value.trim() || onAsk ? (
        <span className="flex flex-wrap justify-end gap-1">
          {onAsk ? (
            <Button size="sm" variant="ghost" onClick={onAsk}>
              {t("application.askInChat")}
            </Button>
          ) : null}
          {value.trim() ? <CopyButton text={value.trim()} /> : null}
          {onFill ? (
            <Button size="sm" variant="outline" onClick={onFill}>
              {t("application.fill")}
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function Answer({
  q,
  value,
  onChange,
  onCommit,
  onFill,
  onAttach,
  onAsk,
  onAssumption,
  answering,
  hasPosting,
}: {
  q: Question;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
  onAttach: { kind: DocumentKind; run: () => void } | null;
  onAsk: (() => void) | null;
  onAssumption: AssumptionDecide;
  answering: boolean;
  hasPosting: boolean;
}) {
  const hint = (text: string) => <span className="text-xs text-muted-fg">{text}</span>;
  if (q.kind === "consent") return hint(t("application.consent"));
  // F12-12: com o que a pessoa declarou no chat, a opção da página e Preencher (só por clique, nunca no "todos")
  if (q.kind === "self_declaration")
    return q.prefill ? (
      <div className="flex flex-col gap-1.5">
        {hint(t("application.declared"))}
        <span className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
          <span>{q.prefill}</span>
          {onFill ? (
            <Button size="sm" variant="outline" onClick={onFill}>
              {t("application.fill")}
            </Button>
          ) : null}
        </span>
      </div>
    ) : (
      <div className="flex flex-col gap-1.5">
        {hint(t("application.selfDeclaration"))}
        {onAsk ? (
          <span>
            <Button size="sm" variant="ghost" onClick={onAsk}>
              {t("application.declareInChat")}
            </Button>
          </span>
        ) : null}
      </div>
    );
  if (q.kind === "file")
    return onAttach ? (
      <div>
        <Button size="sm" variant="outline" onClick={onAttach.run}>
          {onAttach.kind === "cv" ? t("application.attachCv") : t("application.attachLetter")}
        </Button>
      </div>
    ) : (
      hint(t("application.file"))
    );
  const a = q.answer;
  const status = q.profileField
    ? q.prefill || a?.source === "edited" || a?.source === "chat"
      ? null
      : t("application.noData")
    : a?.answer
      ? null
      : a?.gap
        ? t("application.gap", { gap: a.gap })
        : answering
          ? t("application.answeringOne")
          : hasPosting
            ? t("application.noAnswer")
            : t("application.needsPostingShort");
  return (
    <div className="flex flex-col gap-1.5">
      {status ? hint(status) : null}
      {a?.answer && a.source === "roleplay" ? (
        <div className="flex flex-col gap-1 rounded bg-muted/40 px-2 py-1.5 text-xs">
          <span>
            <Badge tone="info">{t("application.roleplay")}</Badge>
          </span>
          {a.assumptions.length ? (
            <>
              <span className="text-muted-fg">{t("application.assumptions")}</span>
              <ul aria-label={t("application.assumptionsList")} className="flex flex-col gap-1">
                {a.assumptions.map((x, i) => (
                  <AssumptionItem
                    key={x}
                    text={x}
                    status={q.assumptionStatus?.[i] ?? null}
                    onDecide={(action, text) => onAssumption(i, action, text)}
                  />
                ))}
              </ul>
              <span className="text-muted-fg">{t("application.assumptionHint")}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {a?.source === "edited" || a?.source === "chat" ? (
        <span>
          <Badge tone="neutral">
            {a.source === "edited" ? t("application.edited") : t("application.fromChat")}
          </Badge>
        </span>
      ) : null}
      <EditableValue
        q={q}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        onFill={onFill}
        onAsk={onAsk}
      />
    </div>
  );
}

type AssumptionDecide = (index: number, action: "accept" | "refuse", text?: string) => void;

/** Uma suposição do roleplay (F12-23): aceitar, editar (aceita no texto da pessoa) ou recusar; decidida mostra o estado. */
function AssumptionItem({
  text,
  status,
  onDecide,
}: {
  text: string;
  status: "accepted" | "refused" | null;
  onDecide: (action: "accept" | "refuse", text?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li>
        <PhraseEditor
          initial={assumptionAsMotivation(text)}
          onSave={(own) => {
            onDecide("accept", own);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  return (
    <li className="flex flex-col gap-1">
      <span>{text}</span>
      {status ? (
        <span>
          <Badge tone={status === "accepted" ? "ok" : "neutral"}>
            {status === "accepted"
              ? t("application.assumptionAccepted")
              : t("application.assumptionRefused")}
          </Badge>
        </span>
      ) : (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onDecide("accept")}>
            {t("application.assumptionAccept")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("application.assumptionEdit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDecide("refuse")}>
            {t("application.assumptionRefuse")}
          </Button>
        </span>
      )}
    </li>
  );
}

/**
 * F12-23: sem as motivações do perfil revisadas, a janela pergunta antes de escrever as respostas abertas; seguir libera
 * as respostas (mesmo sem aceitar nenhuma frase).
 */
function MotivationsStep({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const api = useApi();
  const headingId = useId();
  const review = useMutation({
    mutationFn: () => api.reviewMotivations(profileId),
    onSettled: onDone,
  });
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-md border border-primary/40 p-3 text-sm"
    >
      <h2 id={headingId} className="font-semibold">
        {t("motivations.stepTitle")}
      </h2>
      <p className="text-xs text-muted-fg">{t("motivations.stepHint")}</p>
      <AddressSelect />
      <MotivationsEditor profileId={profileId} />
      <span>
        <Button size="sm" disabled={review.isPending} onClick={() => review.mutate()}>
          {t("motivations.continue")}
        </Button>
      </span>
      {review.isError ? (
        <Alert tone="danger">
          {t("motivations.failed", { detail: (review.error as Error).message })}
        </Alert>
      ) : null}
    </section>
  );
}

function PostingDocuments({
  postingId,
  profileId,
}: {
  postingId: string;
  profileId: string | null;
}) {
  const { analyses } = usePosting(postingId);
  const recommended = analyses.data?.analyses[0]?.recommendedProfileId ?? profileId;
  return <CaptureDocuments postingId={postingId} recommendedProfileId={recommended} />;
}

/**
 * A vaga do formulário: a que a busca achou (mesmo link, id da vaga, cargo e empresa) ou a escolhida aqui, quando ela
 * não achou ou achou outra (testes do dono, 2026-10-23).
 */
function PostingLink({ application: a }: { application: ApplicationFormView }) {
  const api = useApi();
  const qc = useQueryClient();
  const selectId = useId();
  const [choosing, setChoosing] = useState(false);
  const postings = useQuery({
    queryKey: ["postings", "for-application"],
    queryFn: () => api.listPostings(),
    enabled: choosing,
  });
  const link = useMutation({
    mutationFn: (postingId: string | null) => api.linkApplicationPosting(a.id, postingId),
    onSuccess: async () => {
      setChoosing(false);
      await qc.invalidateQueries({ queryKey: applicationKey(a.id) });
    },
  });
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="flex flex-wrap items-center gap-x-2">
        {a.posting ? (
          <span>
            {t("application.posting")}{" "}
            <a
              href={`/vagas/${a.postingId}`}
              {...external}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {[a.posting.title, a.posting.company].filter(Boolean).join(" · ")}
            </a>
          </span>
        ) : (
          <span className="text-muted-fg">{t("application.noPosting")}</span>
        )}
        {!choosing ? (
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setChoosing(true)}
          >
            {a.posting ? t("application.changePosting") : t("application.linkPosting")}
          </button>
        ) : null}
      </span>
      {choosing ? (
        <span className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-xs text-muted-fg">
            {t("application.savedPosting")}
          </label>
          <Select
            id={selectId}
            value={a.postingId ?? ""}
            disabled={postings.isPending || link.isPending}
            onChange={(e) => link.mutate(e.target.value || null)}
          >
            <option value="">{t("application.noneOption")}</option>
            {(postings.data?.postings ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {[p.title, p.company].filter(Boolean).join(" · ")}
              </option>
            ))}
          </Select>
        </span>
      ) : null}
      {link.isError ? <Alert tone="danger">{(link.error as Error).message}</Alert> : null}
    </div>
  );
}
