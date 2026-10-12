import { type ReactNode, useMemo } from "react";
import { NavLink } from "../../components/shell/NavLink";

/**
 * Markdown mínimo e seguro para as mensagens do recrutador (F04-25): gera só elementos React a partir do texto, nunca
 * HTML cru, então nada que o modelo escreva vira tag ou script. Cobre o que o recrutador usa: títulos, parágrafos,
 * negrito, itálico, código, listas, blocos de código e links (só http/https, abrindo em nova aba) e caminhos internos
 * do app (`/ingestao/<id>`, `/perfis/...`) que viram links de navegação.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div className="flex flex-col gap-2 text-sm leading-relaxed">{blocks}</div>;
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(\/(?:ingestao|perfis|evidencias|pendencias|chat)\/[A-Za-z0-9/_-]+)/g;
const SAFE_URL = /^https?:\/\/[^\s]+$/i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const token = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 font-mono text-xs">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    } else if (m[3]) {
      out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
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
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parseBlocks(text: string): ReactNode[] {
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
      const content = inline(heading[2] as string, k);
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
      const lis = items.map((it, j) => <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`)}</li>);
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
    out.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return out;
}
