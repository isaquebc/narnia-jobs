import { ADDRESS_FORMS, type AddressForm, type ProfileMotivation } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/input";
import { t } from "../../i18n";

/**
 * Motivações do perfil (F12-23, pedido do dono 2026-10-26): frases sobre o que move a pessoa, sugeridas pelo histórico
 * e decididas por ela. Aceitar, editar (vira aceita, no texto dela) ou recusar (fica guardada, não volta, e outra é
 * sugerida no lugar). Usado no passo da janela do formulário, antes das respostas, e na página do perfil.
 */
export const motivationsKey = (profileId: string) => ["profile", profileId, "motivations"] as const;

export function useMotivations(profileId: string) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: motivationsKey(profileId),
    queryFn: () => api.listMotivations(profileId),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "profile.motivations.updated" && e.profileId === profileId)
        void qc.invalidateQueries({ queryKey: motivationsKey(profileId) });
    });
  }, [ws, qc, profileId]);
  return q;
}

export function MotivationsEditor({ profileId }: { profileId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const q = useMotivations(profileId);
  const refresh = () => qc.invalidateQueries({ queryKey: motivationsKey(profileId) });
  const patch = useMutation({
    mutationFn: (v: { id: string; text?: string; status?: ProfileMotivation["status"] }) =>
      api.patchMotivation(profileId, v.id, {
        ...(v.text !== undefined ? { text: v.text } : {}),
        ...(v.status !== undefined ? { status: v.status } : {}),
      }),
    onSettled: refresh,
  });
  const add = useMutation({
    mutationFn: (text: string) => api.addMotivation(profileId, text),
    onSettled: refresh,
  });
  const suggest = useMutation({
    mutationFn: () => api.suggestMotivations(profileId),
    onSettled: refresh,
  });
  const [own, setOwn] = useState("");
  const ownId = useId();
  const items = q.data?.items ?? [];
  const shown = items.filter((m) => m.status !== "refused");
  const refused = items.filter((m) => m.status === "refused");
  const failure = [patch, add, suggest].find((m) => m.isError)?.error as Error | undefined;
  return (
    <div className="flex flex-col gap-2">
      {q.data?.suggesting ? (
        <p role="status" className="text-xs text-muted-fg">
          {t("motivations.suggesting")}
        </p>
      ) : null}
      {shown.length === 0 && q.data && !q.data.suggesting ? (
        <p className="text-xs text-muted-fg">{t("motivations.empty")}</p>
      ) : null}
      {shown.length ? (
        <ul aria-label={t("motivations.list")} className="flex flex-col gap-1.5">
          {shown.map((m) => (
            <MotivationItem
              key={m.id}
              m={m}
              onAccept={() => patch.mutate({ id: m.id, status: "accepted" })}
              onRefuse={() => patch.mutate({ id: m.id, status: "refused" })}
              onSave={(text) => patch.mutate({ id: m.id, text })}
            />
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const text = own.trim();
          if (!text) return;
          add.mutate(text);
          setOwn("");
        }}
      >
        <label htmlFor={ownId} className="text-xs text-muted-fg">
          {t("motivations.own")}
        </label>
        <span className="flex gap-1">
          <Input
            id={ownId}
            value={own}
            maxLength={140}
            placeholder={t("motivations.ownPlaceholder")}
            onChange={(e) => setOwn(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!own.trim()}>
            {t("motivations.add")}
          </Button>
        </span>
      </form>
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={suggest.isPending || q.data?.suggesting}
          onClick={() => suggest.mutate()}
        >
          {t("motivations.more")}
        </Button>
        {refused.length ? (
          <details className="text-xs text-muted-fg">
            <summary>{t("motivations.refused", { n: refused.length })}</summary>
            <ul className="list-disc pl-4">
              {refused.map((m) => (
                <li key={m.id}>{m.text}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </span>
      {failure ? (
        <Alert tone="danger">{t("motivations.failed", { detail: failure.message })}</Alert>
      ) : null}
    </div>
  );
}

/** Uma frase: sugestão com aceitar, editar e recusar; aceita com editar e recusar. */
function MotivationItem({
  m,
  onAccept,
  onRefuse,
  onSave,
}: {
  m: ProfileMotivation;
  onAccept: () => void;
  onRefuse: () => void;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-1 rounded bg-muted/40 px-2 py-1.5 text-sm">
      {editing ? (
        <PhraseEditor
          initial={m.text}
          onSave={(text) => {
            onSave(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <span className="flex items-start justify-between gap-2">
            <span>{m.text}</span>
            <Badge tone={m.status === "accepted" ? "ok" : "neutral"}>
              {m.status === "accepted" ? t("motivations.accepted") : t("motivations.suggested")}
            </Badge>
          </span>
          <span className="flex flex-wrap gap-1">
            {m.status === "suggested" ? (
              <Button size="sm" variant="outline" onClick={onAccept}>
                {t("motivations.accept")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("motivations.edit")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onRefuse}>
              {t("motivations.refuse")}
            </Button>
          </span>
        </>
      )}
    </li>
  );
}

/** Caixa de editar uma frase (motivação ou suposição): até 140 caracteres. */
export function PhraseEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <Input
        aria-label={t("motivations.field")}
        value={text}
        maxLength={140}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="flex gap-1">
        <Button type="submit" size="sm" disabled={!text.trim()}>
          {t("motivations.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("motivations.cancel")}
        </Button>
      </span>
    </form>
  );
}

/** Forma de tratamento (F12-23): do cadastro, para as frases e as respostas escritas como a pessoa. */
export function AddressSelect() {
  const api = useApi();
  const qc = useQueryClient();
  const id = useId();
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  const set = useMutation({
    mutationFn: (address: AddressForm) => api.setAddressForm(address),
    onSettled: () => qc.invalidateQueries({ queryKey: ["user"] }),
  });
  const current = (ADDRESS_FORMS as readonly string[]).includes(user.data?.user?.pronouns ?? "")
    ? (user.data?.user?.pronouns as AddressForm)
    : "neutro";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {t("motivations.address")}
      </label>
      <Select id={id} value={current} onChange={(e) => set.mutate(e.target.value as AddressForm)}>
        {ADDRESS_FORMS.map((a) => (
          <option key={a} value={a}>
            {t(`motivations.addressOptions.${a}`)}
          </option>
        ))}
      </Select>
      <span className="text-xs text-muted-fg">{t("motivations.addressHint")}</span>
    </div>
  );
}

/** Seção da aba Narrativa do perfil (F12-23): o tratamento e as motivações, fora do formulário. */
export function MotivationsSection({ profileId }: { profileId: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-2xl flex-col gap-2">
      <h2 id={headingId} className="text-base font-semibold">
        {t("motivations.title")}
      </h2>
      <p className="text-sm text-muted-fg">{t("motivations.profileHint")}</p>
      <AddressSelect />
      <MotivationsEditor profileId={profileId} />
    </section>
  );
}
