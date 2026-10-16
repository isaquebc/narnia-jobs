import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, type ButtonProps } from "./button";

/**
 * Menu suspenso simples (F05: "Gerar" › CV · Cover letter): botão com `aria-haspopup="menu"`, itens `menuitem`, fecha
 * com Esc, com clique fora e ao escolher; seta para baixo abre e foca o primeiro item.
 */
export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

export function Menu({
  label,
  items,
  variant,
  size = "sm",
  icon,
}: {
  label: string;
  items: MenuItem[];
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative inline-block">
      <Button
        type="button"
        size={size}
        {...(variant ? { variant } : {})}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {label}
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 min-w-[12rem] rounded-md border border-border bg-card p-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
