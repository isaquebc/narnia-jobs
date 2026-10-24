import type { ApplicationFormView, DocumentKind } from "@narnia-jobs/shared";
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
import { bridgeRequest, extensionAvailable } from "./bridge";
import { CaptureDocuments } from "./CaptureFollowUp";

/**
 * Janela da extensão no modo formulário (F12/M3, §4.7): as perguntas do formulário de candidatura na ordem da página,
 * por seção, com o tipo, as opções e o limite. Campos óbvios (nome, e-mail, telefone, links, cidade) trazem o valor dos
 * dados da pessoa; as outras, a resposta sugerida (F12/M4) ou a lacuna. Copiar e Preencher (F12-14), e o campo do
 * currículo anexa o PDF do CV da vaga. Consentimento e autodeclaração ficam com a pessoa (F12-12). Nada é enviado.
 * F12-18: as perguntas abertas chegam escritas como a pessoa, com o que o narnia supôs para ela conferir. F12-19: toda
 * resposta é editável antes de preencher; Preencher usa o texto da caixa, e sair dela guarda a edição.
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

/** O valor guardado: a edição da pessoa (F12-19), o dos dados (campo óbvio) ou a resposta sugerida (F12/M4). */
const savedValue = (q: Question) =>
  (q.answer?.source === "edited" ? q.answer.answer : null) ?? q.prefill ?? q.answer?.answer ?? "";

/** O que a pessoa responde pela janela: nunca consentimento, autodeclaração nem arquivo (F12-12). */
const editable = (q: Question) => !["consent", "self_declaration", "file"].includes(q.kind);

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
  const fillable = (x: Question) => editable(x) && currentValue(x).trim() !== "";
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
  const [fillMessage, setFillMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(
    null,
  );
  const send = async (items: FillItem[]) => {
    setFillMessage(null);
    if (!extensionAvailable() || page.tabId === null) {
      setFillMessage({ tone: "warn", text: t("application.fillUnavailable") });
      return;
    }
    const r = await bridgeRequest({ type: "narnia.fill", tabId: page.tabId, url: page.url, items });
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
      {a.status === "locating" ? <Progress text={t("application.locating")} /> : null}
      {a.status === "error" ? (
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
      {a.status === "ready" ? (
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
          {!a.postingId ? <Alert tone="info">{t("application.needsPosting")}</Alert> : null}
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
                section={x.section && x.section !== a.questions[i - 1]?.section ? x.section : null}
                answering={a.answersStatus === "answering"}
                hasPosting={a.postingId !== null}
                value={currentValue(x)}
                onChange={(text) => setDrafts((d) => ({ ...d, [x.id]: text }))}
                onCommit={(text) => commit(x, text)}
                onFill={fillable(x) ? () => void fill([x]) : null}
                onAttach={
                  x.kind === "file" && docFor(fileKind(x))
                    ? { kind: fileKind(x), run: () => void attach(x) }
                    : null
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
      {/* pedido do dono (2026-10-23): o CV e a carta da vaga ligada, para anexar, ou o botão de gerar */}
      {a.postingId ? <PostingDocuments postingId={a.postingId} profileId={a.profileId} /> : null}
    </article>
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
  section,
  answering,
  hasPosting,
  value,
  onChange,
  onCommit,
  onFill,
  onAttach,
}: {
  n: number;
  q: Question;
  section: string | null;
  answering: boolean;
  hasPosting: boolean;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
  onAttach: { kind: DocumentKind; run: () => void } | null;
}) {
  const details = [
    q.options.length ? q.options.map((o) => o.label).join(" · ") : null,
    q.maxChars ? t("application.maxChars", { n: q.maxChars }) : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1">
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
}: {
  q: Question;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
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
      {value.trim() ? (
        <span className="flex justify-end gap-1">
          <CopyButton text={value.trim()} />
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
  answering,
  hasPosting,
}: {
  q: Question;
  value: string;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onFill: (() => void) | null;
  onAttach: { kind: DocumentKind; run: () => void } | null;
  answering: boolean;
  hasPosting: boolean;
}) {
  const hint = (text: string) => <span className="text-xs text-muted-fg">{text}</span>;
  if (q.kind === "consent") return hint(t("application.consent"));
  if (q.kind === "self_declaration") return hint(t("application.selfDeclaration"));
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
    ? q.prefill || a?.source === "edited"
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
              <ul className="list-disc pl-4">
                {a.assumptions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {a?.source === "edited" ? (
        <span>
          <Badge tone="neutral">{t("application.edited")}</Badge>
        </span>
      ) : null}
      <EditableValue q={q} value={value} onChange={onChange} onCommit={onCommit} onFill={onFill} />
    </div>
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
