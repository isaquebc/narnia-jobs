import { describe, expect, it } from "vitest";
import {
  formatDateOnly,
  formatInUserTz,
  isDateOnly,
  isValidTimeZone,
  nowUtc,
  toUtcIso,
} from "../src/index";

describe("M2/shared · time.ts (UTC no dado, fuso do usuário na exibição)", () => {
  it("nowUtc devolve ISO 8601 em UTC com sufixo Z", () => {
    expect(nowUtc()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("toUtcIso normaliza Date, epoch e string com offset para UTC", () => {
    expect(toUtcIso(new Date(Date.UTC(2026, 0, 15, 12, 0, 0)))).toBe("2026-01-15T12:00:00.000Z");
    expect(toUtcIso(Date.UTC(2026, 0, 15, 12))).toBe("2026-01-15T12:00:00.000Z");
    expect(toUtcIso("2026-01-15T09:00:00-03:00")).toBe("2026-01-15T12:00:00.000Z");
  });

  it("toUtcIso rejeita entrada inválida", () => {
    expect(() => toUtcIso("ontem")).toThrow();
  });

  it("formatInUserTz converte para America/Sao_Paulo (UTC-3, sem horário de verão)", () => {
    expect(formatInUserTz("2026-01-15T12:00:00.000Z", "America/Sao_Paulo")).toBe(
      "15/01/2026 09:00",
    );
    expect(formatInUserTz("2026-07-15T12:00:00.000Z", "America/Sao_Paulo")).toBe(
      "15/07/2026 09:00",
    );
  });

  it("formatInUserTz respeita o horário de verão de Europe/Lisbon", () => {
    expect(formatInUserTz("2026-01-15T12:00:00.000Z", "Europe/Lisbon")).toBe("15/01/2026 12:00");
    expect(formatInUserTz("2026-07-15T12:00:00.000Z", "Europe/Lisbon")).toBe("15/07/2026 13:00");
  });

  it("formatInUserTz em UTC não desloca e aceita formato customizado", () => {
    expect(formatInUserTz("2026-01-15T12:00:00.000Z", "UTC")).toBe("15/01/2026 12:00");
    expect(formatInUserTz("2026-01-15T12:00:00.000Z", "UTC", "YYYY-MM-DD HH:mm:ss")).toBe(
      "2026-01-15 12:00:00",
    );
  });

  it("formatInUserTz atravessa a meia-noite ao converter", () => {
    expect(formatInUserTz("2026-01-15T01:30:00.000Z", "America/Sao_Paulo")).toBe(
      "14/01/2026 22:30",
    );
  });

  it("formatInUserTz rejeita fuso inválido", () => {
    expect(() => formatInUserTz("2026-01-15T12:00:00.000Z", "Brasilia")).toThrow(/fuso/i);
  });

  it("datas sem hora não sofrem conversão de fuso", () => {
    expect(isDateOnly("2026-01-15")).toBe(true);
    expect(isDateOnly("2026-01")).toBe(true);
    expect(isDateOnly("2026-01-15T12:00:00Z")).toBe(false);
    expect(formatDateOnly("2026-01-15", "pt-BR")).toBe("15/01/2026");
    expect(formatDateOnly("2026-01-15", "en-US")).toBe("01/15/2026");
    expect(formatDateOnly("2026-01", "pt-BR")).toBe("01/2026");
    expect(formatDateOnly("2026", "pt-BR")).toBe("2026");
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isValidTimeZone("Marte/Olympus")).toBe(false);
  });
});
