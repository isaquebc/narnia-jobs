import { describe, expect, it } from "vitest";
import { buildIcs, type CalendarEventInput, googleCalendarUrl } from "../src/calendar";

/**
 * F07/M5 · exportar uma etapa para o calendário sem conectar conta: link do Google (modelo pré-preenchido) e `.ics`
 * (RFC 5545) com UID estável e SEQUENCE que sobe a cada edição (reimportar atualiza o evento).
 */
const ev: CalendarEventInput = {
  id: "ev1",
  title: "Entrevista técnica · Acme, Inc.",
  startsAt: "2026-10-29T17:00:00.000Z",
  durationMin: 90,
  location: "Google Meet",
  link: "https://meet.example/abc",
  notes: "Levar exemplos de\nsistemas de pagamento; revisar o case",
  sequence: 2,
  appUrl: "http://127.0.0.1:5173/candidaturas/a1",
};

/** Desdobra as linhas (RFC 5545 §3.1) e lê as propriedades do VEVENT. */
function parse(ics: string): Record<string, string> {
  const lines = ics.replace(/\r\n[ \t]/g, "").split("\r\n");
  const out: Record<string, string> = {};
  let inside = false;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") inside = true;
    else if (l === "END:VEVENT") inside = false;
    else if (inside) {
      const i = l.indexOf(":");
      out[l.slice(0, i)] = l.slice(i + 1);
    }
  }
  return out;
}

describe("F07/M5 · .ics", () => {
  it("UID estável, início e fim em UTC com Z, SEQUENCE e texto escapado", () => {
    const ics = buildIcs(ev, new Date("2026-10-28T12:00:00.000Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const p = parse(ics);
    expect(p.UID).toBe("ev1@narnia-jobs");
    expect(p.SEQUENCE).toBe("2");
    expect(p.DTSTART).toBe("20261029T170000Z");
    expect(p.DTEND).toBe("20261029T183000Z");
    expect(p.DTSTAMP).toBe("20261028T120000Z");
    expect(p.SUMMARY).toBe("Entrevista técnica · Acme\\, Inc.");
    expect(p.DESCRIPTION).toContain("Levar exemplos de\\nsistemas de pagamento; revisar o case");
    expect(p.DESCRIPTION).toContain("http://127.0.0.1:5173/candidaturas/a1");
    expect(p.LOCATION).toBe("Google Meet");
    expect(p.URL).toBe("https://meet.example/abc");
  });

  it("linhas longas dobradas em até 75 octetos", () => {
    const ics = buildIcs({ ...ev, notes: "é".repeat(200) }, new Date("2026-10-28T12:00:00.000Z"));
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(parse(ics).DESCRIPTION).toContain("é".repeat(200));
  });
});

describe("F07/M5 · link do Google Calendar", () => {
  it("modelo com título, datas em UTC (formato básico), detalhes com o link da candidatura e local", () => {
    const url = new URL(googleCalendarUrl(ev));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(ev.title);
    expect(url.searchParams.get("dates")).toBe("20261029T170000Z/20261029T183000Z");
    expect(url.searchParams.get("details")).toContain("http://127.0.0.1:5173/candidaturas/a1");
    expect(url.searchParams.get("details")).toContain("https://meet.example/abc");
    expect(url.searchParams.get("location")).toBe("Google Meet");
  });
});
