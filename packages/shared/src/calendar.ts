/**
 * Exportar uma etapa da candidatura para o calendário sem conectar conta (F07/M5, §2.3): o link do modelo do Google
 * Calendar e o arquivo `.ics` (RFC 5545). Funções puras: a web monta o link, a api serve o `.ics` e as tools do
 * recrutador devolvem os dois.
 */
export interface CalendarEventInput {
  id: string;
  title: string;
  /** Início em UTC (ISO). */
  startsAt: string;
  durationMin: number;
  location: string | null;
  link: string | null;
  notes: string | null;
  /** Sobe a cada edição: reimportar o `.ics` atualiza o evento em vez de duplicar. */
  sequence: number;
  /** Página da candidatura na interface. */
  appUrl: string;
}

/** `2026-10-29T17:00:00.000Z` → `20261029T170000Z`. */
const basic = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function range(e: CalendarEventInput): [string, string] {
  const start = new Date(e.startsAt);
  return [basic(start), basic(new Date(start.getTime() + e.durationMin * 60_000))];
}

function details(e: CalendarEventInput): string {
  return [e.notes, e.link ? `Link: ${e.link}` : null, `Candidatura no narnia-jobs: ${e.appUrl}`]
    .filter(Boolean)
    .join("\n\n");
}

export function googleCalendarUrl(e: CalendarEventInput): string {
  const [start, end] = range(e);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${start}/${end}`,
    details: details(e),
  });
  if (e.location ?? e.link) q.set("location", (e.location ?? e.link) as string);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** TEXT (RFC 5545 §3.3.11): barra, ponto e vírgula, vírgula e quebra de linha escapados. */
const text = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, ";").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Dobra a linha em pedaços de até 75 octetos (§3.1), sem partir um caractere UTF-8. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // a continuação começa com um espaço
    if (size + n > limit) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs(e: CalendarEventInput, now = new Date()): string {
  const [start, end] = range(e);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//narnia-jobs//candidaturas//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@narnia-jobs`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${basic(now)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${text(e.title)}`,
    `DESCRIPTION:${text(details(e))}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.link ? [`URL:${e.link}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
