import { isValidTimeZone } from "./schemas/common";
import { localToUtc } from "./time";

/**
 * Leitor de `.ics` (F14-3, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.0.2): o convite oficial da empresa vira a
 * etapa na agenda por código, sem modelo. Cobre RFC 5545 no que convites de Google Calendar, Outlook/Teams e Zoom
 * usam: linhas dobradas, parâmetros, `TZID` (IANA e os nomes do Windows mais comuns), UTC, dia inteiro, escapes,
 * `METHOD` (REQUEST, CANCEL), `SEQUENCE` e o link da chamada.
 */
export interface IcsEvent {
  uid: string | null;
  sequence: number;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  organizer: string | null;
  /** Instantes em UTC (ISO). */
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** Fuso do convite (IANA) quando veio com `TZID`; null em UTC ou flutuante. */
  timeZone: string | null;
  /** O `TZID` não foi reconhecido: o horário foi lido como UTC e precisa de confirmação. */
  timeZoneUnknown: boolean;
  /** Link da chamada (Meet, Teams, Zoom) achado no convite. */
  conferenceUrl: string | null;
}

export interface IcsCalendar {
  method: string | null;
  events: IcsEvent[];
}

/** Nomes de fuso do Windows (Outlook) → IANA. */
const WINDOWS_TZ: Record<string, string> = {
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Fortaleza",
  "Bahia Standard Time": "America/Bahia",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/Manaus",
  "Tocantins Standard Time": "America/Araguaina",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "GTB Standard Time": "Europe/Bucharest",
  UTC: "UTC",
};

const CONFERENCE =
  /https:\/\/(meet\.google\.com\/[a-z-]+|[\w.-]*teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>\\]+|[\w.-]*zoom\.us\/j\/[^\s"<>\\]+)/i;

/** Escapes do RFC 5545 numa passada (revisão do M3: com substituições em sequência `\;` e `\\n` saíam errados). */
const unescapeText = (v: string) =>
  v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Divide por `;` fora de aspas (`CN="Silva; João"`). */
function splitParams(head: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Desdobra as linhas nos bytes (CRLF/LF seguido de espaço ou tab) antes de decodificar o UTF-8. */
function unfoldBytes(b: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    const c = b[i] as number;
    if (c === 13 && b[i + 1] === 10 && (b[i + 2] === 32 || b[i + 2] === 9)) {
      i += 2;
      continue;
    }
    if (c === 10 && (b[i + 1] === 32 || b[i + 1] === 9)) {
      i += 1;
      continue;
    }
    out.push(c);
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(out)).replace(/\r\n/g, "\n");
}

interface Line {
  name: string;
  params: Record<string, string>;
  value: string;
}

function lines(input: string | Uint8Array): Line[] {
  // em bytes, desdobra antes de decodificar: o Outlook dobra a cada 75 octetos, às vezes no meio de um caractere
  const unfolded =
    typeof input === "string"
      ? input.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "")
      : unfoldBytes(input);
  const out: Line[] = [];
  for (const raw of unfolded.split("\n")) {
    if (!raw.trim()) continue;
    // o valor começa no primeiro ":" fora de aspas (parâmetros podem ter ":" entre aspas)
    let i = 0;
    let quoted = false;
    for (; i < raw.length; i++) {
      if (raw[i] === '"') quoted = !quoted;
      else if (raw[i] === ":" && !quoted) break;
    }
    const head = raw.slice(0, i);
    const value = raw.slice(i + 1);
    const [name = "", ...ps] = splitParams(head);
    const params: Record<string, string> = {};
    for (const p of ps) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: name.toUpperCase(), params, value });
  }
  return out;
}

/** Fusos declarados no próprio arquivo (`VTIMEZONE`): o deslocamento do bloco STANDARD, para TZID personalizado. */
type Offsets = Map<string, number>;

const offsetMinutes = (v: string) => {
  const m = v.trim().match(/^([+-])(\d{2})(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
};

function toUtc(
  l: Line,
  offsets: Offsets = new Map(),
): { iso: string; allDay: boolean; timeZone: string | null; unknown: boolean } | null {
  const v = l.value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || l.params.VALUE === "DATE") {
    const d = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!d) return null;
    const iso = `${d[1]}-${d[2]}-${d[3]}T00:00:00.000Z`;
    return Number.isNaN(Date.parse(iso))
      ? null
      : { iso, allDay: true, timeZone: null, unknown: false };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // revisão do M3: segundos preservados; data inválida (mês 13) deixa só este campo vazio, o resto do convite vale
  const asUtc = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`);
  if (Number.isNaN(asUtc)) return null;
  if (z)
    return { iso: new Date(asUtc).toISOString(), allDay: false, timeZone: null, unknown: false };
  const tzid = l.params.TZID?.replace(/^\//, "") ?? null;
  const tz = tzid ? (isValidTimeZone(tzid) ? tzid : (WINDOWS_TZ[tzid] ?? null)) : null;
  try {
    if (tz) {
      const base = Date.parse(localToUtc(`${y}-${mo}-${d}T${h}:${mi}`, tz));
      return {
        iso: new Date(base + Number(s) * 1000).toISOString(),
        allDay: false,
        timeZone: tz,
        unknown: false,
      };
    }
  } catch {
    return null;
  }
  const custom = tzid ? offsets.get(tzid) : undefined;
  if (custom !== undefined)
    return {
      iso: new Date(asUtc - custom * 60_000).toISOString(),
      allDay: false,
      timeZone: null,
      unknown: false,
    };
  return { iso: new Date(asUtc).toISOString(), allDay: false, timeZone: null, unknown: !!tzid };
}

export function parseIcs(text: string | Uint8Array): IcsCalendar {
  const ls = lines(text);
  const cal: IcsCalendar = { method: null, events: [] };
  // VTIMEZONE: TZID → deslocamento do bloco STANDARD (o Outlook usa nomes próprios, "Customized Time Zone")
  const offsets: Offsets = new Map();
  {
    let tzid: string | null = null;
    let inStandard = false;
    for (const l of ls) {
      const v = l.value.trim().toUpperCase();
      if (l.name === "BEGIN" && v === "VTIMEZONE") tzid = null;
      else if (l.name === "TZID" && !inStandard) tzid = l.value.trim();
      else if (l.name === "BEGIN" && v === "STANDARD") inStandard = true;
      else if (l.name === "END" && v === "STANDARD") inStandard = false;
      else if (l.name === "TZOFFSETTO" && inStandard && tzid) {
        const off = offsetMinutes(l.value);
        if (off !== null) offsets.set(tzid, off);
      }
    }
  }
  let ev: (IcsEvent & { depth: number }) | null = null;
  let nested = 0;
  for (const l of ls) {
    if (l.name === "METHOD" && !ev) cal.method = l.value.trim().toUpperCase();
    if (l.name === "BEGIN" && l.value.trim().toUpperCase() === "VEVENT") {
      ev = {
        uid: null,
        sequence: 0,
        status: null,
        summary: null,
        description: null,
        location: null,
        organizer: null,
        start: null,
        end: null,
        allDay: false,
        timeZone: null,
        timeZoneUnknown: false,
        conferenceUrl: null,
        depth: 0,
      };
      nested = 0;
      continue;
    }
    if (!ev) continue;
    if (l.name === "BEGIN") nested++;
    else if (l.name === "END" && l.value.trim().toUpperCase() === "VEVENT") {
      const { depth: _d, ...done } = ev;
      const text = [done.description, done.location].filter(Boolean).join("\n");
      done.conferenceUrl ??= text.match(CONFERENCE)?.[0] ?? null;
      cal.events.push(done);
      ev = null;
      continue;
    } else if (l.name === "END") nested--;
    if (nested > 0) continue; // VALARM e afins
    switch (l.name) {
      case "UID":
        ev.uid = l.value.trim();
        break;
      case "SEQUENCE":
        ev.sequence = Number(l.value) || 0;
        break;
      case "STATUS":
        ev.status = l.value.trim().toUpperCase();
        break;
      case "SUMMARY":
        ev.summary = unescapeText(l.value).trim();
        break;
      case "DESCRIPTION":
        ev.description = unescapeText(l.value).trim();
        break;
      case "LOCATION":
        ev.location = unescapeText(l.value).trim();
        break;
      case "ORGANIZER":
        ev.organizer = l.params.CN ?? l.value.replace(/^mailto:/i, "");
        break;
      case "X-GOOGLE-CONFERENCE":
      case "URL":
        if (CONFERENCE.test(l.value)) ev.conferenceUrl = l.value.match(CONFERENCE)?.[0] ?? null;
        break;
      case "DTSTART":
      case "DTEND": {
        const t = toUtc(l, offsets);
        if (!t) break;
        if (l.name === "DTSTART") {
          ev.start = t.iso;
          ev.allDay = t.allDay;
          ev.timeZone = t.timeZone;
          ev.timeZoneUnknown = t.unknown;
        } else ev.end = t.iso;
        break;
      }
    }
  }
  return cal;
}
