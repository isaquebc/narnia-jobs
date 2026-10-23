import type { ApplicationFormView } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { CopyButton } from "../../components/ui/copy-button";
import { type TKey, t } from "../../i18n";

/**
 * Janela da extensão no modo formulário (F12/M3, §4.7): as perguntas do formulário de candidatura na ordem da página,
 * por seção, com o tipo, as opções e o limite. Campos óbvios (nome, e-mail, telefone, links, cidade) trazem o valor dos
 * dados da pessoa para copiar; consentimento e autodeclaração ficam com ela (F12-12). Nada é preenchido na página.
 */
const external = { target: "_blank", rel: "noreferrer" } as const;
const applicationKey = (id: string) => ["extension", "application", id] as const;

type Question = ApplicationFormView["questions"][number];

export function ApplicationWindow({ id }: { id: string }) {
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
        {a.posting ? (
          <span className="text-sm">
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
          <span className="text-sm text-muted-fg">{t("application.noPosting")}</span>
        )}
      </header>
      {a.status === "locating" ? (
        <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
          />
          {t("application.locating")}
        </div>
      ) : null}
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
          <ol aria-label={t("application.list")} className="flex flex-col gap-3">
            {a.questions.map((x, i) => (
              <QuestionItem
                key={x.id}
                n={i + 1}
                q={x}
                section={x.section && x.section !== a.questions[i - 1]?.section ? x.section : null}
              />
            ))}
          </ol>
          {again}
        </>
      ) : null}
      {relocate.isError ? <Alert tone="danger">{(relocate.error as Error).message}</Alert> : null}
    </article>
  );
}

function QuestionItem({ n, q, section }: { n: number; q: Question; section: string | null }) {
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
        <Answer q={q} />
      </div>
    </li>
  );
}

function Answer({ q }: { q: Question }) {
  if (q.profileField)
    return q.prefill ? (
      <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
        <span className="break-all">{q.prefill}</span>
        <CopyButton text={q.prefill} />
      </div>
    ) : (
      <span className="text-xs text-muted-fg">{t("application.noData")}</span>
    );
  if (q.kind === "consent")
    return <span className="text-xs text-muted-fg">{t("application.consent")}</span>;
  if (q.kind === "self_declaration")
    return <span className="text-xs text-muted-fg">{t("application.selfDeclaration")}</span>;
  if (q.kind === "file")
    return <span className="text-xs text-muted-fg">{t("application.file")}</span>;
  return <span className="text-xs text-muted-fg">{t("application.soon")}</span>;
}
