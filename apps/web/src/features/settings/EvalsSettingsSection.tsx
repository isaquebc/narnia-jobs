import type { BridgeSettingsDto, EvalsSettingsResponse } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";

const MODELS = ["sonnet", "haiku", "opus"];
const KEY = ["settings", "evals"];

/**
 * Configurações › Avaliações (decisão AV-2): a ponte pela assinatura que o Phoenix usa como provedor Anthropic
 * customizado (liga/desliga, modelo padrão, concorrência, chave) e o Phoenix (registrar a ponte, chave de API opcional).
 */
export function EvalsSettingsSection() {
  const api = useApi();
  const qc = useQueryClient();
  const titleId = useId();
  const tz = useTimezone();
  const status = useQuery({ queryKey: KEY, queryFn: () => api.getEvalsSettings() });
  const [form, setForm] = useState<BridgeSettingsDto | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const s = status.data;
  useEffect(() => {
    if (s && !form) setForm(s.bridge.settings);
  }, [s, form]);
  const done = (v: EvalsSettingsResponse) => qc.setQueryData(KEY, v);
  const save = useMutation({
    mutationFn: (p: BridgeSettingsDto) => api.putBridgeSettings(p),
    onSuccess: done,
  });
  const rotate = useMutation({ mutationFn: () => api.rotateBridgeKey(), onSuccess: done });
  const register = useMutation({ mutationFn: () => api.registerPhoenixBridge(), onSuccess: done });
  const sync = useMutation({ mutationFn: () => api.syncPhoenixPrompts(), onSuccess: done });
  const keyMut = useMutation({
    mutationFn: (k: string | null) => api.putPhoenixAnthropicKey(k),
    onSuccess: (v) => {
      setApiKey("");
      done(v);
    },
  });
  const failed = [save, rotate, register, sync, keyMut].find((m) => m.error)?.error;
  const last = s?.prompts.lastSync;

  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      <h3 id={titleId} className="text-sm font-semibold">
        {t("evals.settings.title")}
      </h3>
      <p className="text-xs text-muted-fg">{t("evals.settings.hint")}</p>
      {status.error ? <Alert tone="danger">{describeError(status.error).title}</Alert> : null}
      {s && form ? (
        <>
          <Switch
            id="bridge-enabled"
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            label={t("evals.settings.enabled")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("evals.settings.defaultModel")} htmlFor="bridge-model">
              <Select
                id="bridge-model"
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("evals.settings.concurrency")}
              htmlFor="bridge-concurrency"
              hint={t("evals.settings.concurrencyHint")}
            >
              <Input
                id="bridge-concurrency"
                type="number"
                min={1}
                max={8}
                value={form.concurrency}
                onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {t("evals.settings.save")}
            </Button>
            {save.isSuccess ? (
              <span className="text-xs text-muted-fg">{t("evals.settings.saved")}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("evals.settings.url")}</span>
            <code className="rounded bg-muted px-2 py-1 text-xs">{s.bridge.url}</code>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("evals.settings.key")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs">
                {showKey ? s.bridge.key : "•".repeat(24)}
              </code>
              <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? t("evals.settings.hideKey") : t("evals.settings.showKey")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => rotate.mutate()}
                disabled={rotate.isPending}
              >
                {t("evals.settings.rotate")}
              </Button>
            </div>
            <span className="text-xs text-muted-fg">{t("evals.settings.rotateHint")}</span>
          </div>
          {s.phoenix.reachable ? (
            <Alert tone={s.phoenix.providerRegistered ? "ok" : "warn"}>
              {s.phoenix.providerRegistered
                ? t("evals.settings.registered", { name: s.phoenix.providerName })
                : t("evals.settings.notRegistered")}
            </Alert>
          ) : (
            <Alert tone="warn">{t("evals.settings.phoenixDown")}</Alert>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => register.mutate()}
              disabled={!s.phoenix.reachable || register.isPending}
            >
              {s.phoenix.providerRegistered
                ? t("evals.settings.reRegister")
                : t("evals.settings.register")}
            </Button>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <span>{t("evals.settings.prompts", { count: s.prompts.count })}</span>
            <span className="text-xs text-muted-fg">
              {!last
                ? t("evals.settings.promptsNever")
                : last.error
                  ? t("evals.settings.promptsError", {
                      date: formatDate(last.at, tz),
                      error: last.error,
                    })
                  : t("evals.settings.promptsLast", {
                      date: formatDate(last.at, tz),
                      created: last.created,
                      updated: last.updated,
                      unchanged: last.unchanged,
                      evCreated: last.evaluatorsCreated,
                      evUpdated: last.evaluatorsUpdated,
                    })}
            </span>
            <div>
              <Button
                variant="secondary"
                onClick={() => sync.mutate()}
                disabled={!s.phoenix.reachable || sync.isPending}
              >
                {t("evals.settings.promptsSync")}
              </Button>
            </div>
          </div>
          <Field
            label={t("evals.settings.apiKey")}
            htmlFor="phoenix-anthropic-key"
            hint={t("evals.settings.apiKeyHint")}
          >
            <Input
              id="phoenix-anthropic-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={!s.phoenix.reachable}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => keyMut.mutate(apiKey.trim())}
              disabled={!s.phoenix.reachable || !apiKey.trim() || keyMut.isPending}
            >
              {t("evals.settings.apiKeySave")}
            </Button>
            {s.phoenix.anthropicKeySet ? (
              <>
                <span className="text-xs text-muted-fg">{t("evals.settings.apiKeySet")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => keyMut.mutate(null)}
                  disabled={keyMut.isPending}
                >
                  {t("evals.settings.apiKeyDelete")}
                </Button>
              </>
            ) : null}
          </div>
          {failed ? <Alert tone="danger">{describeError(failed).title}</Alert> : null}
        </>
      ) : null}
    </Card>
  );
}
