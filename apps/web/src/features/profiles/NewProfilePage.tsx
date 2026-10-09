import type { ProfileCreateRequest } from "@narnia-jobs/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApi } from "../../app/context";
import { useFormGuard } from "../../app/FormGuard";
import { describeError, ErrorState } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Select } from "../../components/ui/input";
import { useProfiles } from "../../hooks/useProfiles";
import { t } from "../../i18n";
import { ProfileForm, type ProfileFormInitial } from "../onboarding/components/ProfileForm";

export interface NewProfileSearch {
  cloneFrom?: string;
  suggestionId?: string;
  title?: string;
  seniority?: string;
  area?: string;
  market?: string;
}

const SENIORITIES = ["junior", "pleno", "senior", "staff", "manager", "director"] as const;
type Seniority = (typeof SENIORITIES)[number];
const asSeniority = (v: string | undefined): Seniority | undefined =>
  (SENIORITIES as readonly string[]).includes(v ?? "") ? (v as Seniority) : undefined;

/** `/perfis/novo` (F02 §4): do zero, clonando (ênfases/narrativa/persona copiadas, carreira pedida de novo, F02-8)
 * ou a partir de uma sugestão (alvo pré-preenchido). */
export function NewProfilePage({
  search,
  onDone,
}: {
  search: NewProfileSearch;
  onDone?: (profileId: string) => void;
}) {
  const api = useApi();
  const router = useRouter({ warn: false });
  const guard = useFormGuard();
  const { setDirty: setGuardDirty } = guard;
  useEffect(() => () => setGuardDirty(false), [setGuardDirty]);
  const { profiles, create, clone } = useProfiles();
  const [cloneFrom, setCloneFrom] = useState<string>(search.cloneFrom ?? "");
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  const country = user.data?.user?.country ?? "BR";
  const reference = useQuery({
    queryKey: ["salary-reference", country],
    queryFn: () => api.getSalaryReference(country),
    enabled: Boolean(user.data),
  });
  const source = useQuery({
    queryKey: ["profile", cloneFrom, "clone-source"],
    queryFn: () => api.getProfile(cloneFrom),
    enabled: cloneFrom !== "",
  });

  const done = (id: string) => {
    guard.setDirty(false);
    if (onDone) onDone(id);
    else if (router) void router.navigate({ to: "/perfis" });
  };
  const submit = useMutation({
    mutationFn: async (body: ProfileCreateRequest) =>
      cloneFrom ? clone.mutateAsync({ sourceId: cloneFrom, body }) : create.mutateAsync(body),
    onSuccess: (profile) => done(profile.id),
  });

  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} />;
  if (!user.data || (cloneFrom && !source.data))
    return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;

  const fromSuggestion =
    search.suggestionId && search.title ? { ...search, title: search.title } : null;
  const initial: ProfileFormInitial | undefined = source.data
    ? {
        name: `Cópia de ${source.data.name}`,
        targetTitle: source.data.targetTitle,
        altTitles: source.data.altTitles,
        seniority: source.data.seniority,
        area: source.data.area,
        goal: source.data.goal,
        market: source.data.market,
        docLocale: source.data.docLocale,
      }
    : fromSuggestion
      ? {
          name: fromSuggestion.title,
          targetTitle: fromSuggestion.title,
          ...(asSeniority(fromSuggestion.seniority)
            ? { seniority: asSeniority(fromSuggestion.seniority) as Seniority }
            : {}),
          ...(fromSuggestion.area ? { area: fromSuggestion.area } : {}),
          ...(fromSuggestion.market ? { market: fromSuggestion.market } : {}),
        }
      : undefined;
  const banner = fromSuggestion ? (
    <Alert>{t("profiles.fromSuggestion", { title: fromSuggestion.title })}</Alert>
  ) : (
    <Alert>{t("profiles.newHint")}</Alert>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("profiles.newTitle")}</h1>
        <p className="text-sm text-muted-fg">{t("profiles.hint")}</p>
      </div>
      <Card className="flex flex-col gap-4">
        <Field label={t("profiles.cloneFrom")} htmlFor="clone-from">
          <Select
            id="clone-from"
            value={cloneFrom}
            onChange={(e) => setCloneFrom(e.target.value)}
            className="w-80"
          >
            <option value="">{t("profiles.cloneNone")}</option>
            {profiles
              .filter((p) => !p.archivedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.targetTitle}
                </option>
              ))}
          </Select>
        </Field>
        <ProfileForm
          key={cloneFrom || fromSuggestion?.suggestionId || "blank"}
          suggestion={null}
          {...(initial ? { initial } : {})}
          userCountry={country}
          reference={reference.data?.reference ?? null}
          submitting={submit.isPending}
          externalError={submit.isError ? describeError(submit.error).title : null}
          submitLabel={t("profiles.createShort")}
          banner={banner}
          onDirty={() => guard.setDirty(true)}
          onSubmit={(body) =>
            submit.mutate(
              fromSuggestion && !cloneFrom
                ? { ...body, suggestionId: fromSuggestion.suggestionId }
                : body,
            )
          }
        />
      </Card>
    </div>
  );
}
