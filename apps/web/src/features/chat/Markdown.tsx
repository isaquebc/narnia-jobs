import type { ChatCitation } from "@narnia-jobs/shared";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "../../components/shell/NavLink";
import { t } from "../../i18n";

/**
 * Markdown mínimo e seguro para as mensagens do recrutador (F04-25): gera só elementos React a partir do texto, nunca
 * HTML cru, então nada que o modelo escreva vira tag ou script. Cobre o que o recrutador usa: títulos, parágrafos,
 * negrito, itálico, código, listas, blocos de código e links (só http/https, abrindo em nova aba) e caminhos internos
 * do app (`/ingestao/<id>`, `/perfis/...`) que viram links de navegação.
 */
export function Markdown({
  text,
  citations,
  uncited,
}: {
  text: string;
  /** Citações conferidas pela API (R5); sem elas (resposta chegando), só o número. */
  citations?: ChatCitation[] | undefined;
  uncited?: string[] | undefined;
}) {
  const blocks = useMemo(() => {
    // número de cada fonte na ordem em que aparece; a mesma fonte repete o número
    const order = new Map<string, number>();
    for (const m of text.matchAll(CITATION))
      for (const r of refsOf(m[0])) if (!order.has(r)) order.set(r, order.size + 1);
    const byRef = new Map((citations ?? []).map((c) => [`${c.kind}:${c.ref}`, c]));
    return parseBlocks(text, { order, byRef, checked: citations !== undefined });
  }, [text, citations]);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks}
      {uncited && uncited.length > 0 ? <Uncited sentences={uncited} /> : null}
    </div>
  );
}

interface Ctx {
  order: Map<string, number>;
  byRef: Map<string, ChatCitation>;
  checked: boolean;
}

const CITATION = /\[(?:[frv]:[0-9a-f]{6,32})(?:\s*[,;]\s*[frv]:[0-9a-f]{6,32})*\]/gi;
const refsOf = (token: string) =>
  token
    .slice(1, -1)
    .split(/[,;]/)
    .map((x) => x.trim().toLowerCase());

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(\/(?:ingestao|perfis|evidencias|pendencias|chat)\/[A-Za-z0-9/_-]+)|(\[(?:[frv]:[0-9a-f]{6,32})(?:\s*[,;]\s*[frv]:[0-9a-f]{6,32})*\])/gi;
const SAFE_URL = /^https?:\/\/[^\s]+$/i;

function inline(text: string, key: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    // o espaço antes da citação sai: o número encosta na palavra
    if (start > last)
      out.push(m[6] ? text.slice(last, start).replace(/\s+$/, "") : text.slice(last, start));
    const token = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 font-mono text-xs">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={k}>{inline(token.slice(2, -2), k, ctx)}</strong>);
    } else if (m[3]) {
      out.push(<em key={k}>{inline(token.slice(1, -1), k, ctx)}</em>);
    } else if (m[4]) {
      const label = token.slice(1, token.indexOf("]("));
      const url = token.slice(token.indexOf("](") + 2, -1);
      out.push(
        SAFE_URL.test(url) ? (
          <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="underline">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (m[5]) {
      out.push(
        <NavLink key={k} to={token} className="underline">
          {token}
        </NavLink>,
      );
    } else if (m[6]) {
      for (const [j, r] of refsOf(token).entries())
        out.push(
          <Cite
            key={`${k}-${j}`}
            n={ctx.order.get(r) ?? 0}
            citation={ctx.byRef.get(r)}
            checked={ctx.checked}
          />,
        );
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parseBlocks(text: string, ctx: Ctx): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith("```")) {
        code.push(lines[i] as string);
        i++;
      }
      i++;
      out.push(
        <pre key={key()} className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const k = key();
      const content = inline(heading[2] as string, k, ctx);
      out.push(
        (heading[1] as string).length === 1 ? (
          <h3 key={k} className="text-base font-semibold">
            {content}
          </h3>
        ) : (
          <h4 key={k} className="font-semibold">
            {content}
          </h4>
        ),
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      while (i < lines.length && itemRe.test(lines[i] as string)) {
        items.push((itemRe.exec(lines[i] as string) as RegExpExecArray)[1] as string);
        i++;
      }
      const k = key();
      // biome-ignore lint/suspicious/noArrayIndexKey: itens de uma mensagem já renderizada, sem reordenação
      const lis = items.map((it, j) => <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`, ctx)}</li>);
      out.push(
        ordered ? (
          <ol key={k} className="list-decimal pl-5">
            {lis}
          </ol>
        ) : (
          <ul key={k} className="list-disc pl-5">
            {lis}
          </ul>
        ),
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i] as string) &&
      !(lines[i] as string).trimStart().startsWith("```") &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i] as string)
    ) {
      para.push(lines[i] as string);
      i++;
    }
    const k = key();
    out.push(<p key={k}>{inline(para.join(" "), k, ctx)}</p>);
  }
  return out;
}

/** Número da fonte no texto; o balão mostra o fato, a vaga (link do app) ou a pesquisa (link externo). */
function Cite({
  n,
  citation,
  checked,
}: {
  n: number;
  citation: ChatCitation | undefined;
  checked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const missing = checked && !citation?.valid;
  const label = missing
    ? t("chat.citationMissing")
    : `${t("chat.citation", { n })}${citation?.label ? `: ${citation.label}` : ""}`;
  return (
    <span ref={box} className="relative inline-block align-super">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={!checked}
        onClick={() => setOpen((o) => !o)}
        className={`ml-0.5 rounded px-1 text-[0.7rem] font-semibold leading-none ${
          missing ? "bg-danger/15 text-danger" : "bg-muted text-muted-fg"
        } focus-visible:outline focus-visible:outline-2 enabled:hover:text-fg`}
      >
        {missing ? "?" : n}
      </button>
      {open ? (
        <span
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-1 flex w-72 max-w-[80vw] flex-col gap-1 rounded-md border bg-card p-3 text-xs leading-snug shadow-lg"
        >
          {missing || !citation ? (
            <span>{t("chat.citationMissingHint")}</span>
          ) : citation.url ? (
            citation.url.startsWith("/") ? (
              <NavLink to={citation.url} className="font-semibold underline">
                {citation.label}
              </NavLink>
            ) : (
              <a
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                {citation.label}
              </a>
            )
          ) : (
            <span className="font-semibold">{citation.label}</span>
          )}
          {citation?.valid && citation.detail ? (
            <span className="text-muted-fg">{citation.detail}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Frases com número ou dado dos fatos sem citação (R5): fechadas por padrão, abrem embaixo da resposta. */
function Uncited({ sentences }: { sentences: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-muted-fg">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="underline decoration-dotted"
      >
        {sentences.length === 1
          ? t("chat.uncitedOne")
          : t("chat.uncitedMany", { n: sentences.length })}
      </button>
      {open ? (
        <>
          <p className="mt-1">{t("chat.uncitedHint")}</p>
          <ul aria-label={t("chat.uncitedList")} className="mt-1 list-disc pl-5">
            {sentences.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
