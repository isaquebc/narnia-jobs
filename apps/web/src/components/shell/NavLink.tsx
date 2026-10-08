import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

function withSearch(to: string, search?: Record<string, string | undefined>): string {
  if (!search) return to;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) if (v !== undefined && v !== "") params.set(k, v);
  const qs = params.toString();
  return qs ? `${to}?${qs}` : to;
}

/** Link do roteador quando há um router montado; âncora simples fora dele (testes de componente isolados). */
export function NavLink({
  to,
  search,
  className,
  children,
}: {
  to: string;
  /** Query string tipada pela rota de destino (ex.: pré-preenchimento de `/perfis/novo`). */
  search?: Record<string, string | undefined>;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter({ warn: false });
  if (!router) {
    return (
      <a href={withSearch(to, search)} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link
      to={to}
      {...(search ? { search: search as never } : {})}
      className={className}
      activeProps={{ className: `${className ?? ""} active` }}
    >
      {children}
    </Link>
  );
}
