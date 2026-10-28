import { describe, expect, it } from "vitest";
import { localInputFromUtc, localToUtc } from "../src/time";

/** F07/M5 · agenda: o que a pessoa digita (data e hora no fuso dela) vira UTC, e volta igual para o formulário. */
describe("F07/M5 · fuso da agenda", () => {
  it("quinta 14:00 em São Paulo é 17:00 UTC", () => {
    expect(localToUtc("2026-10-29T14:00", "America/Sao_Paulo")).toBe("2026-10-29T17:00:00.000Z");
    expect(localInputFromUtc("2026-10-29T17:00:00.000Z", "America/Sao_Paulo")).toBe(
      "2026-10-29T14:00",
    );
  });

  it("horário de verão de outra zona: Lisboa antes e depois da virada (25/10/2026)", () => {
    expect(localToUtc("2026-10-24T14:00", "Europe/Lisbon")).toBe("2026-10-24T13:00:00.000Z");
    expect(localToUtc("2026-10-26T14:00", "Europe/Lisbon")).toBe("2026-10-26T14:00:00.000Z");
  });

  it("entrada inválida ou fuso inválido é erro", () => {
    expect(() => localToUtc("29/10/2026 14:00", "America/Sao_Paulo")).toThrow();
    expect(() => localToUtc("2026-10-29T14:00", "Marte/Base")).toThrow();
  });
});
