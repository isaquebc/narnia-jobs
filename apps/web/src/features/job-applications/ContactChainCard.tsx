import type { PostingContact } from "@narnia-jobs/shared";
import { useState } from "react";
import { useTimezone } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { usePosting } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { ContactForm, ContactLinkedin } from "../postings/PostingSections";

/** Ordem da cadeia: data da conversa (sem data, no fim), depois a criação. */
export function orderChain(contacts: PostingContact[]): PostingContact[] {
  return [...contacts].sort(
    (a, b) =>
      (a.contactedOn ?? "9999").localeCompare(b.contactedOn ?? "9999") ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Pessoas e cadeia de contatos da candidatura (F07/M6, §1): os contatos da vaga em ordem, com papel, canal, data, quem
 * indicou quem e o resumo; o recrutador registra os mesmos pela `posting.contact_add` quando a conversa é sobre a vaga.
 */
export function ContactChainCard({ postingId }: { postingId: string }) {
  const tz = useTimezone();
  const { detail } = usePosting(postingId);
  const [adding, setAdding] = useState(false);
  const contacts = detail.data?.contacts ?? [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const chain = orderChain(contacts);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{t("postings.contacts.chainTitle")}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          {t("postings.contacts.add")}
        </Button>
      </div>
      {detail.data && chain.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("postings.contacts.chainEmpty")}</p>
      ) : null}
      <ol aria-label={t("postings.contacts.chain")} className="flex flex-col gap-2 text-sm">
        {chain.map((c, i) => {
          const ref = c.referredById ? byId.get(c.referredById) : null;
          return (
            <li key={c.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {i + 1}. {c.name}
                </span>
                {c.role ? <Badge>{t(`postings.contacts.roles.${c.role}` as TKey)}</Badge> : null}
                <span className="text-xs text-muted-fg">
                  {t(`postings.contacts.origins.${c.origin}` as TKey)}
                  {c.contactedOn ? ` · ${formatDate(c.contactedOn, tz)}` : ""}
                </span>
                <ContactLinkedin contact={c} />
              </span>
              {ref ? (
                <span className="text-xs text-muted-fg">
                  {t("postings.contacts.referredByName", { name: ref.name })}
                </span>
              ) : null}
              {c.summary ? <span className="whitespace-pre-wrap text-xs">{c.summary}</span> : null}
            </li>
          );
        })}
      </ol>
      <Dialog open={adding} onOpenChange={setAdding} title={t("postings.contacts.add")}>
        <ContactForm
          postingId={postingId}
          layout="stack"
          contacts={contacts}
          onSaved={() => setAdding(false)}
        />
      </Dialog>
    </Card>
  );
}
