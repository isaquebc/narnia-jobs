import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useFormGuard } from "../../app/FormGuard";
import { useProfiles } from "../../hooks/useProfiles";
import { t } from "../../i18n";
import { Button } from "../ui/button";
import { NavLink } from "./NavLink";

/** Seletor de perfil ativo no topo do shell (F02 §4): troca pela API, respeita formulário sujo. */
export function ProfileSwitcher() {
  const { profiles, active, activate } = useProfiles();
  const guard = useFormGuard();
  const [open, setOpen] = useState(false);
  const visible = profiles.filter((p) => !p.archivedAt);

  function choose(id: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    if (!guard.canLeave()) return;
    setOpen(false);
    activate.mutate(id);
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-label={t("profiles.switcher")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="max-w-72"
      >
        <span className="truncate">
          {activate.isPending
            ? t("profiles.switching")
            : active
              ? active.name
              : t("shell.noProfile")}
        </span>
        <ChevronDown size={14} />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={t("profiles.switcher")}
          className="absolute left-0 z-30 mt-2 w-80 rounded-lg border border-border bg-card p-2 shadow-lg"
        >
          {visible.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-fg">{t("profiles.none")}</p>
          ) : (
            <ul className="flex flex-col">
              {visible.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={p.isActive}
                    onClick={() => choose(p.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="w-4">{p.isActive ? <Check size={14} /> : null}</span>
                    <span className="flex flex-col">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-fg">{p.targetTitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <NavLink to="/perfis/novo" className="rounded-md px-2 py-1 hover:bg-muted">
              {t("profiles.newProfile")}
            </NavLink>
            <NavLink to="/perfis" className="rounded-md px-2 py-1 hover:bg-muted">
              {t("profiles.manage")}
            </NavLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}
