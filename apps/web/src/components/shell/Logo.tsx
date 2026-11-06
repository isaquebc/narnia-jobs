/**
 * Logo do narnia-jobs: uma porta (o guarda-roupa de Nárnia) num quadrado arredondado. Mesmo desenho de
 * `public/favicon.svg` e `docs/assets/logo.svg`; aqui as cores seguem o tema (claro e escuro). Decorativo: quem o usa
 * põe o nome do app em texto ao lado.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 34" className={className} aria-hidden="true" data-logo="narnia-jobs">
      <rect x="1" y="1" width="32" height="32" rx="9" fill="var(--primary)" />
      <path
        d="M11 26V15a6 6 0 0 1 12 0v11"
        fill="none"
        stroke="var(--primary-fg)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="20" cy="20" r="1.6" fill="#e08a62" />
    </svg>
  );
}
