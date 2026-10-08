import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

function withParams(to: string, params?: Record<string, string>): string {
  if (!params) return to;
  let out = to;
  for (const [k, v] of Object.entries(params)) out = out.replace(`$${k}`, encodeURIComponent(v));
  return out;
}

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
  params,
  search,
  className,
  children,
}: {
  to: string;
  /** Parâmetros de caminho (`$id`) da rota de destino. */
  params?: Record<string, string>;
  /** Query string tipada pela rota de destino (ex.: pré-preenchimento de `/perfis/novo`). */
  search?: Record<string, string | undefined>;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter({ warn: false });
  if (!router) {
    return (
      <a href={withSearch(withParams(to, params), search)} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link
      to={to}
      {...(params ? { params: params as never } : {})}
      {...(search ? { search: search as never } : {})}
      className={className}
      activeProps={{ className: `${className ?? ""} active` }}
    >
      {children}
    </Link>
  );
}
