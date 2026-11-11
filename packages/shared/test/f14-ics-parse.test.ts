import { describe, expect, it } from "vitest";
import { buildIcs, parseIcs } from "../src";

/**
 * F14/M3 · leitor de `.ics` (F14-3): convites sintéticos no formato do Google Calendar, do Outlook/Teams e do Zoom;
 * cancelamento e remarcação; ida e volta com o gerador da F07.
 */
const google = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Sao_Paulo:20261112T140000",
  "DTEND;TZID=America/Sao_Paulo:20261112T150000",
  "UID:abc123@google.com",
  'ORGANIZER;CN="Ana (Acme)":mailto:ana@acme.example',
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Entrevista técnica\\, Dev Backend",
  "DESCRIPTION:Participe com o Google Meet: https://meet.google.com/abc-defg-hij\\nOu ligue: +55 11 ",
  " 0000-0000",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:Lembrete",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("F14/M3 · leitor de .ics", () => {
  it("Google Calendar: fuso IANA vira UTC, escapes, linha dobrada, organizador e o link do Meet; o alarme não mistura", () => {
    const c = parseIcs(google);
    expect(c.method).toBe("REQUEST");
    expect(c.events).toHaveLength(1);
    const e = c.events[0];
    expect(e).toMatchObject({
      uid: "abc123@google.com",
      sequence: 0,
      status: "CONFIRMED",
      summary: "Entrevista técnica, Dev Backend",
      organizer: "Ana (Acme)",
      start: "2026-11-12T17:00:00.000Z",
      end: "2026-11-12T18:00:00.000Z",
      allDay: false,
      timeZone: "America/Sao_Paulo",
      timeZoneUnknown: false,
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(e?.description).toContain("+55 11 0000-0000");
    expect(e?.description).not.toContain("Lembrete");
  });

  it("Outlook/Teams: nome de fuso do Windows e link do Teams", () => {
    const c = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        'DTSTART;TZID="E. South America Standard Time":20261113T093000',
        'DTEND;TZID="E. South America Standard Time":20261113T100000',
        "UID:040000008200E00074C5B7101A82E008",
        "SEQUENCE:1",
        "SUMMARY:Conversa com o time",
        "LOCATION:Reunião do Microsoft Teams",
        "DESCRIPTION:Clique aqui: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=y",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    expect(c.events[0]).toMatchObject({
      start: "2026-11-13T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
      sequence: 1,
    });
    expect(c.events[0]?.conferenceUrl).toMatch(
      /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//,
    );
  });

  it("UTC, dia inteiro, fuso desconhecido e cancelamento", () => {
    const utc = parseIcs(
      "BEGIN:VEVENT\nUID:z\nDTSTART:20261114T120000Z\nURL:https://acme.zoom.us/j/123456\nEND:VEVENT",
    );
    expect(utc.events[0]).toMatchObject({
      start: "2026-11-14T12:00:00.000Z",
      conferenceUrl: "https://acme.zoom.us/j/123456",
    });
    const day = parseIcs("BEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261115\nEND:VEVENT");
    expect(day.events[0]).toMatchObject({ start: "2026-11-15T00:00:00.000Z", allDay: true });
    const odd = parseIcs(
      "BEGIN:VEVENT\nUID:o\nDTSTART;TZID=Fuso Inventado:20261115T100000\nEND:VEVENT",
    );
    expect(odd.events[0]).toMatchObject({
      timeZoneUnknown: true,
      start: "2026-11-15T10:00:00.000Z",
    });
    const cancel = parseIcs(
      "BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:abc\nSEQUENCE:2\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR",
    );
    expect(cancel).toMatchObject({
      method: "CANCEL",
      events: [{ uid: "abc", sequence: 2, status: "CANCELLED" }],
    });
  });

  it("ida e volta com o gerador da F07", () => {
    const ics = buildIcs({
      id: "ev1",
      title: "Entrevista com o gestor",
      startsAt: "2026-11-12T17:00:00.000Z",
      durationMin: 45,
      location: null,
      link: "https://meet.google.com/aaa-bbbb-ccc",
      notes: "Linha 1\nLinha 2",
      sequence: 3,
      appUrl: "http://127.0.0.1:5173/candidaturas/a1",
    });
    const e = parseIcs(ics).events[0];
    expect(e).toMatchObject({
      sequence: 3,
      start: "2026-11-12T17:00:00.000Z",
      end: "2026-11-12T17:45:00.000Z",
    });
    expect(e?.summary).toBe("Entrevista com o gestor");
    expect(e?.uid).toContain("ev1");
    expect(e?.conferenceUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");
  });
});

describe("F14/M3 · revisão do leitor de .ics", () => {
  it("escapes numa passada, segundos, parâmetro com ; entre aspas", () => {
    const c = parseIcs(
      [
        "BEGIN:VEVENT",
        'ORGANIZER;CN="Silva; João":mailto:joao@acme.example',
        "DTSTART:20261114T120030Z",
        "LOCATION:Sala 1; prédio B\\, 3º andar",
        "DESCRIPTION:C:\\\\temp\\\\novo\\nlinha 2",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(c.events[0]).toMatchObject({
      organizer: "Silva; João",
      start: "2026-11-14T12:00:30.000Z",
      location: "Sala 1; prédio B, 3º andar",
      description: "C:\\temp\\novo\nlinha 2",
    });
  });

  it("TZID personalizado do Outlook com VTIMEZONE; data inválida não derruba o convite", () => {
    const c = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VTIMEZONE",
        "TZID:Customized Time Zone",
        "BEGIN:STANDARD",
        "DTSTART:16010101T000000",
        "TZOFFSETFROM:-0300",
        "TZOFFSETTO:-0300",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:x",
        "DTSTART;TZID=Customized Time Zone:20261113T093000",
        "DTEND;TZID=Customized Time Zone:20261313T100000",
        "SUMMARY:Conversa",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    expect(c.events[0]).toMatchObject({
      start: "2026-11-13T12:30:00.000Z",
      end: null,
      summary: "Conversa",
      timeZoneUnknown: false,
    });
  });

  it("bytes dobrados no meio de um caractere UTF-8 são desdobrados antes de decodificar", () => {
    const head = new TextEncoder().encode("BEGIN:VEVENT\r\nSUMMARY:Entrevista t");
    const e = new TextEncoder().encode("é");
    const tail = new TextEncoder().encode("cnica\r\nEND:VEVENT\r\n");
    const bytes = new Uint8Array([...head, e[0] as number, 13, 10, 32, e[1] as number, ...tail]);
    expect(parseIcs(bytes).events[0]?.summary).toBe("Entrevista técnica");
  });
});
