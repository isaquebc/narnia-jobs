import type {
  BudgetUnit,
  GithubIngestionCreateRequest,
  GithubPreviewResponse,
  IngestionDepth,
  IngestionMode,
} from "@narnia-jobs/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../../app/context";
import { describeError } from "../../../components/ErrorState";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { useGithubAuth } from "../../../hooks/useGithubAuth";
import { t } from "../../../i18n";
import { BudgetInput, fromTokens, toTokens } from "../BudgetInput";
import { EstimateCard } from "../EstimateCard";
import { PlanUsageCard } from "../PlanUsageCard";
import { GithubConnectCard } from "./GithubConnectCard";
import { RepoGroups, SELECTION_WARNING_ABOVE } from "./RepoGroups";

const DEPTHS: IngestionDepth[] = ["quick", "balanced", "deep"];
export const MODELS = ["haiku", "sonnet", "opus"] as const;
const defaultModel = (d: IngestionDepth) => (d === "deep" ? "sonnet" : "haiku");

/**
 * Ingestão do GitHub (F03 §4): conexão, modo público/privado, seleção agrupada, profundidade, modelo, plano,
 * orçamento e estimativa; "Iniciar análise" cria a execução, que passa pela confirmação (F03-13).
 */
export function GithubSource() {
  const api = useApi();
  const navigate = useNavigate();
  const auth = useGithubAuth();
  const connected = Boolean(auth.data?.connected);
  const [mode, setMode] = useState<IngestionMode | null>(null);
  const [login, setLogin] = useState("");
  const [previewData, setPreviewData] = useState<GithubPreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<IngestionDepth>("balanced");
  const [model, setModel] = useState<string>(defaultModel("balanced"));
  const [unit, setUnit] = useState<BudgetUnit>("thousand");
  const [amount, setAmount] = useState<string>("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (auth.data?.login && !login) setLogin(auth.data.login);
  }, [auth.data?.login, login]);

  const preview = useMutation({
    mutationFn: () =>
      api.previewGithub(
        mode === "public" ? { mode, login: login.trim() } : { mode: mode ?? "private" },
      ),
    onSuccess: (p) => {
      setPreviewData(p);
      setSelected(
        new Set(p.groups.flatMap((g) => g.repos.filter((r) => r.selected).map((r) => r.fullName))),
      );
    },
  });

  const repos = useMemo(
    () =>
      (previewData?.groups ?? [])
        .flatMap((g) => g.repos)
        .map((r) => r.fullName)
        .filter((n) => selected.has(n)),
    [previewData, selected],
  );

  const plan = useQuery({
    queryKey: ["plan", "usage"],
    queryFn: () => api.getPlanUsage(),
    enabled: Boolean(previewData),
  });

  const baseBody = (): GithubIngestionCreateRequest => ({
    source: "github",
    mode: mode ?? "private",
    repos,
    depth,
    model,
    ...(mode === "public" && login.trim() ? { login: login.trim() } : {}),
  });

  const estimate = useQuery({
    queryKey: ["ingestion", "estimate", mode, repos, depth, model, login],
    queryFn: () => api.estimateIngestion(baseBody()),
    enabled: Boolean(previewData) && repos.length > 0,
  });

  useEffect(() => {
    if (estimate.data && !touched)
      setAmount(String(fromTokens(estimate.data.recommendedBudget, unit)));
  }, [estimate.data, touched, unit]);

  const start = useMutation({
    mutationFn: () => {
      const value = Number(amount);
      return api.createGithubIngestion({
        ...baseBody(),
        ...(Number.isFinite(value) && value > 0
          ? { budget: { amount: toTokens(value, unit), unit } }
          : {}),
      });
    },
    onSuccess: (run) => navigate({ to: "/ingestao/$runId", params: { runId: run.id } }),
  });

  const canList = mode === "public" ? login.trim().length > 0 : connected;

  return (
    <div className="flex flex-col gap-4">
      <GithubConnectCard />
      <Card className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t("github.mode.legend")}</legend>
          {(["public", "private"] as const).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="github-mode"
                  checked={mode === m}
                  aria-describedby={`github-mode-${m}-hint`}
                  onChange={() => {
                    setMode(m);
                    setPreviewData(null);
                  }}
                />
                {t(`github.mode.${m}`)}
              </label>
              <span id={`github-mode-${m}-hint`} className="text-xs text-muted-fg">
                {t(`github.mode.${m}Hint`)}
              </span>
            </div>
          ))}
        </fieldset>
        {mode === "public" ? (
          <Field label={t("github.login")} htmlFor="github-login">
            <Input
              id="github-login"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="w-64"
            />
          </Field>
        ) : null}
        {mode === "private" && !connected ? (
          <Alert tone="warn">{t("github.mode.privateNeedsLogin")}</Alert>
        ) : null}
        {mode ? (
          <div>
            <Button
              variant="outline"
              disabled={!canList || preview.isPending}
              onClick={() => preview.mutate()}
            >
              {t("github.list")}
            </Button>
          </div>
        ) : null}
        {preview.isError ? <Alert tone="danger">{describeError(preview.error).title}</Alert> : null}
        {previewData ? (
          <RepoGroups groups={previewData.groups} selected={selected} onChange={setSelected} />
        ) : null}
        {repos.length > SELECTION_WARNING_ABOVE ? (
          <Alert tone="warn">
            {t("github.repos.tooMany", { count: repos.length, limit: SELECTION_WARNING_ABOVE })}
          </Alert>
        ) : null}
      </Card>

      {previewData ? (
        <Card className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t("github.depth.legend")}</legend>
            {DEPTHS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="github-depth"
                  checked={depth === d}
                  onChange={() => {
                    setDepth(d);
                    setModel(defaultModel(d));
                  }}
                />
                {t(`github.depth.${d}`)}
              </label>
            ))}
          </fieldset>
          <Field label={t("github.model")} htmlFor="github-model">
            <select
              id="github-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 w-48 rounded-md border border-border bg-card px-2 text-sm"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <PlanUsageCard usage={plan.data?.usage} />
            <EstimateCard estimate={estimate.data} loading={estimate.isFetching} />
          </div>
          <BudgetInput
            value={amount}
            unit={unit}
            onValueChange={(v) => {
              setTouched(true);
              setAmount(v);
            }}
            onUnitChange={(u) => {
              const current = Number(amount);
              if (Number.isFinite(current) && current > 0) {
                setAmount(String(fromTokens(toTokens(current, unit), u)));
              }
              setUnit(u);
            }}
          />
          {start.isError ? <Alert tone="danger">{describeError(start.error).title}</Alert> : null}
          <div>
            <Button disabled={repos.length === 0 || start.isPending} onClick={() => start.mutate()}>
              {t("github.start")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
