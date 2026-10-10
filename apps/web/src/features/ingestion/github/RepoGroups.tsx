import type { RepoGroup, RepoPreviewItem } from "@narnia-jobs/shared";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { t } from "../../../i18n";
import { cn } from "../../../lib/cn";

/** Acima disso a análise pode demorar bastante e custar mais (F03-2): aviso, sem bloquear. */
export const SELECTION_WARNING_ABOVE = 10;

const special = (r: RepoPreviewItem) => r.isFork || r.isArchived;

function RepoRow({
  repo,
  checked,
  onToggle,
}: {
  repo: RepoPreviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const id = `repo-${repo.fullName}`;
  return (
    <li
      data-variant={special(repo) ? "special" : "normal"}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2",
        special(repo) ? "border-dashed border-warn/60 bg-warn/5" : "border-border",
      )}
    >
      <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={checked} onChange={onToggle} />
        <span className="truncate">{repo.fullName}</span>
      </label>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-fg">
        {repo.isPrivate ? <Badge tone="info">{t("github.repos.private")}</Badge> : null}
        {repo.isFork ? <Badge tone="warn">{t("github.repos.fork")}</Badge> : null}
        {repo.isArchived ? <Badge tone="warn">{t("github.repos.archived")}</Badge> : null}
        {repo.language ? <span>{repo.language}</span> : null}
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer"
          aria-label={t("github.repos.openRepo", { name: repo.fullName })}
          className="rounded p-1 hover:bg-muted"
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </li>
  );
}

/**
 * Seletor agrupado (F03-2): Pessoais expandido, uma linha por organização (recolhida); pré-seleção vinda da API,
 * contador "N de M" e "Marcar todos" por grupo; forks e arquivados destacados.
 */
export function RepoGroups({
  groups,
  selected,
  onChange,
}: {
  groups: RepoGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.kind === "personal"])),
  );
  const toggle = (fullName: string) => {
    const next = new Set(selected);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    onChange(next);
  };
  const markAll = (g: RepoGroup) => {
    const next = new Set(selected);
    for (const r of g.repos) next.add(r.fullName);
    onChange(next);
  };
  const total = selected.size;
  return (
    <div className="flex flex-col gap-3">
      {groups.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("github.repos.empty")}</p>
      ) : null}
      {groups.map((g) => {
        const count = g.repos.filter((r) => selected.has(r.fullName)).length;
        const label = g.kind === "personal" ? t("github.repos.personal") : g.label;
        const expanded = open[g.key] ?? false;
        return (
          <fieldset
            key={g.key}
            aria-label={label}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}
                className="flex items-center gap-1 text-sm font-medium"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {label}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-fg">
                  {t("github.repos.count", { selected: count, total: g.repos.length })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => markAll(g)}>
                  {t("github.repos.markAll")}
                </Button>
              </div>
            </div>
            {expanded ? (
              <ul className="flex flex-col gap-1">
                {g.repos.map((r) => (
                  <RepoRow
                    key={r.fullName}
                    repo={r}
                    checked={selected.has(r.fullName)}
                    onToggle={() => toggle(r.fullName)}
                  />
                ))}
              </ul>
            ) : null}
          </fieldset>
        );
      })}
      {groups.length > 0 ? (
        <span className="text-sm">{t("github.repos.selectedTotal", { count: total })}</span>
      ) : null}
    </div>
  );
}
