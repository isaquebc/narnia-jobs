import type { PostingContact } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { postingKeys } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { ContactForm, ContactLinkedin } from "./PostingSections";

/** O fixado (se houver) e os dois últimos adicionados; o fixado não conta no limite nem se repete. */
export function recentContacts(contacts: PostingContact[], limit = 2): PostingContact[] {
  const pinned = contacts.find((c) => c.pinned) ?? null;
  const latest = contacts
    .filter((c) => c.id !== pinned?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return pinned ? [pinned, ...latest] : latest;
}

/**
 * Página da vaga › contatos no topo (pedido do dono, 2026-10-19): o fixado e os dois últimos, fixar ou soltar, e
 * "Adicionar contato" numa modal (com o link do LinkedIn). Sem contatos, um card de adicionar. A lista completa
 * continua mais abaixo, no card Contatos.
 */
export function PostingContactsSummary({
  postingId,
  contacts,
}: {
  postingId: string;
  contacts: PostingContact[];
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const pin = useMutation({
    mutationFn: (v: { id: string; pinned: boolean }) =>
      api.pinPostingContact(postingId, v.id, v.pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: postingKeys.all }),
  });
  const shown = recentContacts(contacts);
  const hidden = contacts.length - shown.length;
  const addButton = (variant: "outline" | "primary") => (
    <Button
      type="button"
      size="sm"
      variant={variant === "outline" ? "outline" : undefined}
      onClick={() => setAdding(true)}
    >
      {t("postings.contacts.add")}
    </Button>
  );
  return (
    <section aria-label={t("postings.contacts.recent")}>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("postings.contacts.title")}</CardTitle>
          {shown.length > 0 ? addButton("outline") : null}
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-3">
            <p className="text-sm text-muted-fg">{t("postings.contacts.emptyCard")}</p>
            {addButton("primary")}
          </div>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge>{t(`postings.contacts.origins.${c.origin}` as TKey)}</Badge>
                {c.pinned ? <Badge tone="info">{t("postings.contacts.pinned")}</Badge> : null}
                <ContactLinkedin contact={c} />
                {c.email ? <span className="text-xs text-muted-fg">{c.email}</span> : null}
                {c.phone ? <span className="text-xs text-muted-fg">{c.phone}</span> : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={pin.isPending}
                  aria-label={t(c.pinned ? "postings.contacts.unpin" : "postings.contacts.pin", {
                    name: c.name,
                  })}
                  onClick={() => pin.mutate({ id: c.id, pinned: !c.pinned })}
                >
                  {t(c.pinned ? "postings.contacts.unpinShort" : "postings.contacts.pinShort")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <p className="text-xs text-muted-fg">{t("postings.contacts.more", { count: hidden })}</p>
        ) : null}
      </Card>
      <Dialog open={adding} onOpenChange={setAdding} title={t("postings.contacts.add")}>
        <ContactForm postingId={postingId} layout="stack" onSaved={() => setAdding(false)} />
      </Dialog>
    </section>
  );
}
