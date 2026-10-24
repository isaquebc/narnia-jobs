import { Link, useRouter } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";

/**
 * Janela da extensão (F12): sem o menu do narnia, os links abrem na janela normal do Chrome (`target="_blank"`)
 * em vez de navegar dentro dela.
 */
export const ExternalLinksContext = createContext(false);

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
  ariaLabel,
  onClick,
  children,
}: {
  to: string;
  /** Nome acessível quando o conteúdo é só um ícone (sino de notificações). */
  ariaLabel?: string;
  /** Parâmetros de caminho (`$id`) da rota de destino. */
  params?: Record<string, string>;
  /** Query string tipada pela rota de destino (ex.: pré-preenchimento de `/perfis/novo`). */
  search?: Record<string, string | undefined>;
  className?: string;
  /** Ação extra ao clicar (ex.: marcar a pendência como vista antes de navegar, CM-3). */
  onClick?: () => void;
  children: ReactNode;
}) {
  const router = useRouter({ warn: false });
  const external = useContext(ExternalLinksContext);
  if (!router || external) {
    return (
      <a
        href={withSearch(withParams(to, params), search)}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        className={className}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        {...(onClick ? { onClick } : {})}
      >
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
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(onClick ? { onClick } : {})}
      activeProps={{ className: `${className ?? ""} active` }}
    >
      {children}
    </Link>
  );
}
