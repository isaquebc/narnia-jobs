import {
  ContractTypeSchema,
  type FieldSource,
  POSTING_ROLES,
  type Posting,
  type PostingFieldName,
  type PostingPatch,
  PostingSenioritySchema,
} from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useApi } from "../../app/context";
import { useFormGuard } from "../../app/FormGuard";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Tooltip } from "../../components/ui/tooltip";
import { postingKeys } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";

type Draft = Record<PostingFieldName, string>;

const LIST_FIELDS: PostingFieldName[] = [
  "benefits",
  "responsibilities",
  "skillsRequired",
  "skillsNice",
];
const NUMBER_FIELDS: PostingFieldName[] = ["salaryMin", "salaryMax"];

function toDraft(p: Posting): Draft {
  const d = {} as Draft;
  for (const k of Object.keys(p) as Array<keyof Posting>) {
    const v = p[k];
    if (LIST_FIELDS.includes(k as PostingFieldName))
      d[k as PostingFieldName] = (v as string[]).join("\n");
    else if (typeof v === "string" || typeof v === "number") d[k as PostingFieldName] = String(v);
    else d[k as PostingFieldName] = "";
  }
  return d;
}

/** Só o que mudou, com o "tratamento prévio" de cada tipo (listas por linha, números, vazio = null). */
export function draftPatch(original: Draft, draft: Draft): PostingPatch {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(draft) as PostingFieldName[]) {
    if (draft[k] === original[k]) continue;
    const v = draft[k].trim();
    if (LIST_FIELDS.includes(k))
      patch[k] = v
        .split("\n")
        .map((x) => x.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean);
    else if (NUMBER_FIELDS.includes(k)) {
      const n = Number(v.replace(/\./g, "").replace(",", "."));
      patch[k] = v && Number.isFinite(n) ? n : null;
    } else if (k === "currency" || k === "state" || k === "country")
      patch[k] = v ? v.toUpperCase() : null;
    else patch[k] = v || null;
  }
  return patch as PostingPatch;
}

/** Selo de origem do campo (F06-6): heurística, modelo, os dois concordando ou o usuário. */
export function SourceBadge({ source }: { source: FieldSource | undefined }) {
  if (!source) return null;
  const tone = source === "both" ? "ok" : source === "user" ? "info" : "neutral";
  return (
    <Tooltip content={t(`postings.sourceHint.${source}` as TKey)}>
      <span>
        <Badge tone={tone}>{t(`postings.source.${source}` as TKey)}</Badge>
      </span>
    </Tooltip>
  );
}

/** Dados da vaga (F06 §1.3): todos os campos editáveis, cada um com a origem; a JD também. */
export function PostingForm({ posting }: { posting: Posting }) {
  const api = useApi();
  const qc = useQueryClient();
  const guard = useFormGuard();
  const { setDirty: setGuardDirty } = guard;
  useEffect(() => () => setGuardDirty(false), [setGuardDirty]);
  const [original, setOriginal] = useState(() => toDraft(posting));
  const [draft, setDraft] = useState(original);
  const [saved, setSaved] = useState(false);
  // vaga atualizada por fora (extração, recrutador) sem edição local pendente: a tela acompanha
  const dirty = (Object.keys(draft) as PostingFieldName[]).some((k) => draft[k] !== original[k]);
  const version = posting.updatedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a versão da vaga dispara (edição local pendente espera)
  useEffect(() => {
    if (dirty) return;
    const next = toDraft(posting);
    setOriginal(next);
    setDraft(next);
  }, [version]);
  const save = useMutation({
    mutationFn: () => api.patchPosting(posting.id, draftPatch(original, draft)),
    onSuccess: async () => {
      setSaved(true);
      guard.setDirty(false);
      await qc.invalidateQueries({ queryKey: postingKeys.all });
    },
  });
  const set = (k: PostingFieldName) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
    guard.setDirty(true);
  };
  const field = (k: PostingFieldName, label: TKey, input: ReactNode, hint?: string) => (
    <Field
      key={k}
      label={t(label)}
      htmlFor={`posting-${k}`}
      hint={
        <span className="flex items-center gap-2">
          <SourceBadge source={posting.fieldSources[k]} />
          {hint}
        </span>
      }
    >
      {input}
    </Field>
  );
  const text = (k: PostingFieldName, label: TKey, type = "text") =>
    field(
      k,
      label,
      <Input
        id={`posting-${k}`}
        type={type}
        value={draft[k]}
        onChange={(e) => set(k)(e.target.value)}
      />,
    );
  const select = (k: PostingFieldName, label: TKey, options: Array<[string, string]>) =>
    field(
      k,
      label,
      <Select id={`posting-${k}`} value={draft[k]} onChange={(e) => set(k)(e.target.value)}>
        <option value="">{t("postings.fields.none")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>,
    );
  const area = (k: PostingFieldName, label: TKey, rows = 4, hint?: string) =>
    field(
      k,
      label,
      <Textarea
        id={`posting-${k}`}
        rows={rows}
        value={draft[k]}
        onChange={(e) => set(k)(e.target.value)}
      />,
      hint,
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const listHint = t("postings.fields.listHint");
  return (
    <Card>
      <CardTitle className="mb-3 text-base">{t("postings.fields.title")}</CardTitle>
      <form
        className="flex flex-col gap-3"
        onSubmit={submit}
        aria-label={t("postings.fields.title")}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {text("company", "postings.fields.company")}
          {text("client", "postings.fields.client")}
          {text("title", "postings.fields.jobTitle")}
          {select(
            "role",
            "postings.fields.role",
            POSTING_ROLES.map((r) => [r, t(`postings.role.${r}` as TKey)]),
          )}
          {select(
            "seniority",
            "postings.fields.seniority",
            PostingSenioritySchema.options.map((s) => [s, t(`postings.seniority.${s}` as TKey)]),
          )}
          {select("workMode", "postings.fields.workMode", [
            ["remote", t("postings.workMode.remote")],
            ["hybrid", t("postings.workMode.hybrid")],
            ["onsite", t("postings.workMode.onsite")],
          ])}
          {text("city", "postings.fields.city")}
          {text("state", "postings.fields.state")}
          {text("country", "postings.fields.country")}
          {select(
            "contractType",
            "postings.fields.contractType",
            ContractTypeSchema.options.map((c) => [c, t(`profile.contracts.${c}` as TKey)]),
          )}
          {text("currency", "postings.fields.currency")}
          {select("salaryPeriod", "postings.fields.salaryPeriod", [
            ["monthly", t("postings.period.monthly")],
            ["yearly", t("postings.period.yearly")],
            ["hourly", t("postings.period.hourly")],
          ])}
          {text("salaryMin", "postings.fields.salaryMin")}
          {text("salaryMax", "postings.fields.salaryMax")}
          {text("postingUrl", "postings.fields.postingUrl", "url")}
          {text("companyUrl", "postings.fields.companyUrl", "url")}
          {text("publishedAt", "postings.fields.publishedAt")}
        </div>
        {area("companySummary", "postings.fields.companySummary", 2)}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {area("skillsRequired", "postings.fields.skillsRequired", 5, listHint)}
          {area("skillsNice", "postings.fields.skillsNice", 5, listHint)}
          {area("responsibilities", "postings.fields.responsibilities", 5, listHint)}
          {area("benefits", "postings.fields.benefits", 5, listHint)}
        </div>
        {area("jdText", "postings.fields.jdText", 12)}
        {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
        {saved ? <Alert tone="ok">{t("postings.fields.saved")}</Alert> : null}
        <div>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {t("app.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
