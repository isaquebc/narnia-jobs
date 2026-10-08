import { useState } from "react";
import { useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";
import type { ProfileRecord } from "../../lib/api";
import { formatDate } from "../../lib/format";

export interface ProfileActions {
  activate: (id: string) => void;
  archive: (id: string) => void;
  unarchive: (id: string) => void;
  rename: (id: string, name: string) => void;
}

function ProfileListItem({ p, actions }: { p: ProfileRecord; actions: ProfileActions }) {
  const tz = useTimezone();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const archived = Boolean(p.archivedAt);
  return (
    <li aria-label={p.name}>
      <Card className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) actions.rename(p.id, name.trim());
                setRenaming(false);
              }}
            >
              <Input
                aria-label={t("profiles.renamePrompt")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
              />
              <Button type="submit" size="sm">
                {t("app.save")}
              </Button>
            </form>
          ) : (
            <h3 className="text-base font-medium">{p.name}</h3>
          )}
          <div className="flex gap-1">
            {p.isActive ? <Badge tone="ok">{t("profiles.active")}</Badge> : null}
            {archived ? <Badge tone="warn">{t("profiles.archived")}</Badge> : null}
          </div>
        </div>
        <p className="text-sm">{p.targetTitle}</p>
        <p className="text-xs text-muted-fg">
          {t(`profile.seniorities.${p.seniority}`)} · {p.area} · {p.market}
        </p>
        <p className="text-xs text-muted-fg">
          {p.cardUpdatedAt
            ? t("profiles.cardUpdatedAt", { date: formatDate(p.cardUpdatedAt, tz) })
            : t("profiles.cardNever")}
        </p>
        <div className="flex flex-wrap gap-2">
          <NavLink
            to="/perfis/$id/enfases"
            params={{ id: p.id }}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
          >
            {t("profiles.open")}
          </NavLink>
          {!p.isActive && !archived ? (
            <Button variant="outline" size="sm" onClick={() => actions.activate(p.id)}>
              {t("profiles.activate")}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setRenaming((r) => !r)}>
            {t("profiles.rename")}
          </Button>
          {!archived ? (
            <NavLink
              to="/perfis/novo"
              search={{ cloneFrom: p.id }}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
            >
              {t("profiles.clone")}
            </NavLink>
          ) : null}
          {archived ? (
            <Button variant="outline" size="sm" onClick={() => actions.unarchive(p.id)}>
              {t("profiles.unarchive")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => actions.archive(p.id)}>
              {t("profiles.archive")}
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}

export function ProfileList({
  profiles,
  actions,
}: {
  profiles: ProfileRecord[];
  actions: ProfileActions;
}) {
  if (profiles.length === 0) return <p className="text-sm text-muted-fg">{t("profiles.none")}</p>;
  return (
    <ul aria-label={t("profiles.title")} className="grid grid-cols-2 gap-3">
      {profiles.map((p) => (
        <ProfileListItem key={p.id} p={p} actions={actions} />
      ))}
    </ul>
  );
}
