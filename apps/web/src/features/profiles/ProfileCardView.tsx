import { useTimezone } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { useProfileCard } from "../../hooks/useProfileCard";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { CardText } from "./CardText";

/** Aba Cartão (F02 §4, F02-1): texto, tokens, "atualizado em", estado e botão Atualizar cartão. */
export function ProfileCardView({ profileId }: { profileId: string }) {
  const tz = useTimezone();
  const card = useProfileCard(profileId);
  if (card.isError) return <ErrorState error={card.error} onRetry={() => void card.refetch()} />;
  if (!card.data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const c = card.data;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{t("card.title")}</CardTitle>
        {c.valid ? <Badge tone="ok">{t("card.valid")}</Badge> : null}
      </div>
      <p className="text-sm text-muted-fg">{t("card.hint")}</p>
      {!c.valid ? <Alert tone="warn">{t("card.stale")}</Alert> : null}
      <CardText text={c.text} className="rounded-md border border-border p-3" />
      <p className="text-xs text-muted-fg">
        {t("card.tokens", { tokens: c.tokensEst, chars: c.text.length })}
      </p>
      <p className="text-xs text-muted-fg">
        {t("card.updatedAt", { date: formatDate(c.builtAt, tz) })}
      </p>
      <div>
        <Button
          variant="outline"
          onClick={() => card.rebuild.mutate()}
          disabled={card.rebuild.isPending}
        >
          {card.rebuild.isPending ? t("card.rebuilding") : t("card.rebuild")}
        </Button>
      </div>
    </Card>
  );
}
