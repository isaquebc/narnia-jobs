import type { ChatSettingsDto, TrustTag } from "@narnia-jobs/shared";
import { useEffect, useState } from "react";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { useChatSettings, useTrustedDomains } from "../../hooks/useChat";
import { type TKey, t } from "../../i18n";

const TAGS: TrustTag[] = ["official", "survey", "jobboard", "other"];
const MODELS = ["sonnet", "haiku", "opus"];

/** Configurações › Chat (F04 §4): preferências das conversas e lista de domínios confiáveis (F04-3, F04-4, F04-5, F04-9). */
export function ChatSettingsSection() {
  const { settings, save } = useChatSettings();
  const domains = useTrustedDomains();
  const [form, setForm] = useState<ChatSettingsDto | null>(null);
  const [pattern, setPattern] = useState("");
  const [tag, setTag] = useState<TrustTag>("jobboard");
  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);
  const num = (k: keyof ChatSettingsDto) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [k]: Number(e.target.value) } : f));

  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">{t("chat.settings.title")}</h3>
      {form ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("chat.settings.maxLive")} htmlFor="chat-max-live">
            <Input
              id="chat-max-live"
              type="number"
              min={1}
              value={form.maxLiveSessions}
              onChange={num("maxLiveSessions")}
            />
          </Field>
          <Field label={t("chat.settings.hibernate")} htmlFor="chat-hibernate">
            <Input
              id="chat-hibernate"
              type="number"
              min={5}
              value={form.hibernateAfterMin}
              onChange={num("hibernateAfterMin")}
            />
          </Field>
          <Field label={t("chat.settings.maxTurns")} htmlFor="chat-max-turns">
            <Input
              id="chat-max-turns"
              type="number"
              min={1}
              value={form.maxTurns}
              onChange={num("maxTurns")}
            />
          </Field>
          <Field label={t("chat.settings.defaultModel")} htmlFor="chat-model">
            <Select
              id="chat-model"
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
        </div>
      ) : null}
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
      {save.isSuccess ? <Alert tone="ok">{t("chat.settings.saved")}</Alert> : null}
      <div>
        <Button
          disabled={!form || save.isPending}
          onClick={() =>
            form &&
            save.mutate({
              maxLiveSessions: form.maxLiveSessions,
              hibernateAfterMin: form.hibernateAfterMin,
              maxTurns: form.maxTurns,
              defaultModel: form.defaultModel,
            })
          }
        >
          {t("chat.settings.save")}
        </Button>
      </div>

      <h4 className="text-sm font-semibold">{t("chat.settings.domains")}</h4>
      <p className="text-xs text-muted-fg">{t("chat.settings.domainsHint")}</p>
      <ul className="flex flex-col gap-1">
        {domains.domains.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span>{d.pattern}</span>
              <Badge tone="neutral">{t(`chat.settings.tag.${d.trustTag}` as TKey)}</Badge>
              {d.builtin ? <Badge tone="info">{t("chat.settings.builtin")}</Badge> : null}
            </span>
            <span className="flex items-center gap-2">
              <Switch
                checked={d.enabled}
                onCheckedChange={(v) => domains.toggle.mutate({ id: d.id, enabled: v })}
                label={t("chat.settings.enabled", { pattern: d.pattern })}
              />
              {!d.builtin ? (
                <Button size="sm" variant="ghost" onClick={() => domains.remove.mutate(d.id)}>
                  {t("chat.settings.remove", { pattern: d.pattern })}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {domains.add.isError ? (
        <Alert tone="danger">{describeError(domains.add.error).title}</Alert>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pattern.trim()) return;
          domains.add.mutate(
            { pattern: pattern.trim(), trustTag: tag },
            { onSuccess: () => setPattern("") },
          );
        }}
      >
        <Field label={t("chat.settings.newDomain")} htmlFor="chat-new-domain">
          <Input
            id="chat-new-domain"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="*.gov.br"
          />
        </Field>
        <Field label={t("chat.settings.trustTag")} htmlFor="chat-new-tag">
          <Select
            id="chat-new-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value as TrustTag)}
          >
            {TAGS.map((tg) => (
              <option key={tg} value={tg}>
                {t(`chat.settings.tag.${tg}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit">{t("chat.settings.add")}</Button>
        <Button type="button" variant="outline" onClick={() => domains.restore.mutate()}>
          {t("chat.settings.restore")}
        </Button>
      </form>
    </Card>
  );
}
