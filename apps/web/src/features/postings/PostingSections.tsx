import type { ContactOrigin, Posting, PostingContact, PostingNote } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { postingKeys } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";

const ORIGINS: ContactOrigin[] = ["linkedin", "whatsapp", "email", "other"];

/**
 * Formulário de contato (F06 §1.1; LinkedIn e duplicata, 2026-10-19): na lista completa (em linha) e na modal do topo
 * da página. Mesmo LinkedIn ou e-mail de outro contato da vaga volta 409 com a mensagem do servidor.
 */
export function ContactForm({
  postingId,
  onSaved,
  layout = "inline",
}: {
  postingId: string;
  onSaved?: () => void;
  layout?: "inline" | "stack";
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState<ContactOrigin>("linkedin");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api.addPostingContact(postingId, {
        name: name.trim(),
        origin,
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedinUrl: linkedin.trim() || null,
      }),
    onSuccess: async () => {
      setName("");
      setEmail("");
      setPhone("");
      setLinkedin("");
      await qc.invalidateQueries({ queryKey: postingKeys.all });
      onSaved?.();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) add.mutate();
  };
  const stack = layout === "stack";
  const ids = useId();
  const field = (label: string, key: string, input: ReactNode) =>
    stack ? (
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${ids}-${key}`}>{label}</label>
        {input}
      </div>
    ) : (
      input
    );
  return (
    <form
      className={stack ? "flex flex-col gap-3" : "grid grid-cols-1 gap-2 sm:grid-cols-3"}
      onSubmit={submit}
    >
      {field(
        t("postings.contacts.name"),
        "name",
        <Input
          id={`${ids}-name`}
          aria-label={t("postings.contacts.name")}
          placeholder={stack ? undefined : t("postings.contacts.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />,
      )}
      {field(
        t("postings.contacts.origin"),
        "origin",
        <Select
          id={`${ids}-origin`}
          aria-label={t("postings.contacts.origin")}
          value={origin}
          onChange={(e) => setOrigin(e.target.value as ContactOrigin)}
        >
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {t(`postings.contacts.origins.${o}` as TKey)}
            </option>
          ))}
        </Select>,
      )}
      {field(
        t("postings.contacts.linkedin"),
        "linkedin",
        <Input
          id={`${ids}-linkedin`}
          aria-label={t("postings.contacts.linkedin")}
          placeholder={
            stack ? t("postings.contacts.linkedinHint") : t("postings.contacts.linkedin")
          }
          inputMode="url"
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
        />,
      )}
      {field(
        t("postings.contacts.email"),
        "email",
        <Input
          id={`${ids}-email`}
          aria-label={t("postings.contacts.email")}
          placeholder={stack ? undefined : t("postings.contacts.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />,
      )}
      {field(
        t("postings.contacts.phone"),
        "phone",
        <Input
          id={`${ids}-phone`}
          aria-label={t("postings.contacts.phone")}
          placeholder={stack ? undefined : t("postings.contacts.phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />,
      )}
      {add.isError ? (
        <Alert tone="danger" className={stack ? undefined : "sm:col-span-3"}>
          {add.error instanceof ApiError && add.error.status === 409
            ? add.error.message
            : (describeError(add.error).hint ?? describeError(add.error).title)}
        </Alert>
      ) : null}
      <div className={stack ? "flex justify-end gap-2" : undefined}>
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          {stack ? t("postings.contacts.save") : t("postings.contacts.add")}
        </Button>
      </div>
    </form>
  );
}

/** Link do perfil no LinkedIn do contato (só http(s), já validado pelo servidor). */
export function ContactLinkedin({ contact }: { contact: PostingContact }) {
  if (!contact.linkedinUrl || !/^https?:\/\//i.test(contact.linkedinUrl)) return null;
  return (
    <a
      href={contact.linkedinUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("postings.contacts.openLinkedin", { name: contact.name })}
      className="text-xs underline"
    >
      LinkedIn
    </a>
  );
}

/** Contatos (F06 §1.1): todas as pessoas com quem o usuário falou sobre a vaga. */
export function ContactsCard({
  postingId,
  contacts,
}: {
  postingId: string;
  contacts: PostingContact[];
}) {
  const api = useApi();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePostingContact(postingId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: postingKeys.all }),
  });
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="text-base">{t("postings.contacts.title")}</CardTitle>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("postings.contacts.empty")}</p>
      ) : (
        <ul aria-label={t("postings.contacts.title")} className="flex flex-col gap-1 text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <Badge>{t(`postings.contacts.origins.${c.origin}` as TKey)}</Badge>
              {c.pinned ? <Badge tone="info">{t("postings.contacts.pinned")}</Badge> : null}
              <ContactLinkedin contact={c} />
              {c.email ? <span className="text-muted-fg">{c.email}</span> : null}
              {c.phone ? <span className="text-muted-fg">{c.phone}</span> : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("postings.contacts.remove", { name: c.name })}
                onClick={() => remove.mutate(c.id)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ContactForm postingId={postingId} />
    </Card>
  );
}

function NoteItem({
  postingId,
  note,
  highlight,
}: {
  postingId: string;
  note: PostingNote;
  highlight: boolean;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView?.({ block: "center" });
  }, [highlight]);
  const refresh = () => qc.invalidateQueries({ queryKey: postingKeys.all });
  const save = useMutation({
    mutationFn: () => api.patchPostingNote(postingId, note.id, body.trim()),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (action: "confirm" | "reject") => api.decidePostingNote(postingId, note.id, action),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.deletePostingNote(postingId, note.id),
    onSuccess: refresh,
  });
  return (
    <li
      ref={ref}
      aria-label={
        note.author === "user" ? t("postings.notes.byUser") : t("postings.notes.byRecruiter")
      }
      className={`flex flex-col gap-1 rounded-md border p-2 text-sm ${highlight ? "border-primary" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-fg">
        <span>
          {note.author === "user" ? t("postings.notes.byUser") : t("postings.notes.byRecruiter")} ·{" "}
          {formatDate(note.updatedAt, tz)}
        </span>
        {!editing ? (
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {t("postings.notes.edit")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove.mutate()}>
              {t("postings.notes.remove")}
            </Button>
          </span>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) save.mutate();
          }}
        >
          <Textarea
            aria-label={t("postings.notes.edit")}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="flex gap-2">
            <Button type="submit" size="sm" disabled={!body.trim() || save.isPending}>
              {t("postings.notes.save")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              {t("postings.notes.cancel")}
            </Button>
          </span>
        </form>
      ) : (
        <p className="whitespace-pre-wrap">{note.body}</p>
      )}
      {note.pendingBody !== null ? (
        <section
          aria-label={t("postings.notes.pendingTitle")}
          className="flex flex-col gap-2 rounded-md bg-warn/10 p-2"
        >
          <p className="font-medium">{t("postings.notes.pendingTitle")}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-fg">{t("postings.notes.before")}</p>
              <p className="whitespace-pre-wrap">{note.body}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-fg">{t("postings.notes.after")}</p>
              <p className="whitespace-pre-wrap">{note.pendingBody}</p>
            </div>
          </div>
          <span className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => decide.mutate("confirm")}
              disabled={decide.isPending}
            >
              {t("postings.notes.confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => decide.mutate("reject")}
              disabled={decide.isPending}
            >
              {t("postings.notes.reject")}
            </Button>
          </span>
        </section>
      ) : null}
    </li>
  );
}

/** Notas (F06 §1.3): usuário e recrutador; edição do recrutador numa nota do usuário espera confirmação (F06-17). */
export function NotesCard({
  postingId,
  notes,
  focusNoteId,
}: {
  postingId: string;
  notes: PostingNote[];
  focusNoteId?: string | undefined;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api.addPostingNote(postingId, body.trim()),
    onSuccess: async () => {
      setBody("");
      await qc.invalidateQueries({ queryKey: postingKeys.all });
    },
  });
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="text-base">{t("postings.notes.title")}</CardTitle>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("postings.notes.empty")}</p>
      ) : (
        <ul aria-label={t("postings.notes.title")} className="flex flex-col gap-2">
          {notes.map((n) => (
            <NoteItem key={n.id} postingId={postingId} note={n} highlight={n.id === focusNoteId} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <Textarea
          aria-label={t("postings.notes.add")}
          rows={3}
          value={body}
          placeholder={t("postings.notes.placeholder")}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>
            {t("postings.notes.add")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Modal da duplicata (F06-9): % de certeza, diff lado a lado e as três decisões. */
export function DuplicateDialog({
  posting,
  onDecided,
}: {
  posting: Posting;
  onDecided: (r: { keptId: string | null; removedId: string | null }) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const dup = posting.duplicate;
  const [open, setOpen] = useState(true);
  const decide = useMutation({
    mutationFn: (action: "update" | "new" | "cancel") => api.decideDuplicate(posting.id, action),
    onSuccess: async (r) => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: postingKeys.all });
      onDecided(r);
    },
  });
  if (!dup || dup.decision !== null) return null;
  const pct = dup.confidence;
  return (
    <>
      <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("postings.duplicate.banner", { pct })}</span>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("postings.duplicate.open")}
        </Button>
      </Alert>
      <Dialog open={open} onOpenChange={setOpen} title={t("postings.duplicate.title")} wide>
        <p className="mb-2 text-sm">
          {t("postings.duplicate.description", { rationale: dup.rationale })}
        </p>
        <p className="mb-3 text-sm font-medium">{t("postings.duplicate.confidence", { pct })}</p>
        {dup.differences.length === 0 ? (
          <p className="mb-3 text-sm text-muted-fg">{t("postings.duplicate.noDiff")}</p>
        ) : (
          <table className="mb-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-muted-fg">
                <th className="py-1 pr-2">{t("postings.duplicate.field")}</th>
                <th className="py-1 pr-2">{t("postings.duplicate.saved")}</th>
                <th className="py-1">{t("postings.duplicate.incoming")}</th>
              </tr>
            </thead>
            <tbody>
              {dup.differences.map((d) => (
                <tr key={d.field} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-medium">{d.field}</td>
                  <td className="whitespace-pre-wrap py-1 pr-2 text-danger">{d.saved}</td>
                  <td className="whitespace-pre-wrap py-1 text-ok">{d.incoming}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => decide.mutate("update")} disabled={decide.isPending}>
            {t("postings.duplicate.update")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => decide.mutate("new")}
            disabled={decide.isPending}
          >
            {t("postings.duplicate.new")}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => decide.mutate("cancel")}
            disabled={decide.isPending}
          >
            {t("postings.duplicate.cancel")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
