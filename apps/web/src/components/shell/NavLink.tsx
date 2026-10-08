import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Link do roteador quando há um router montado; âncora simples fora dele (testes de componente isolados). */
export function NavLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter({ warn: false });
  if (!router) {
    return (
      <a href={to} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} activeProps={{ className: `${className ?? ""} active` }}>
      {children}
    </Link>
  );
}
