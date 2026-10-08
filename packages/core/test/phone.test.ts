import { describe, expect, it } from "vitest";
import { formatPhone, PhoneError, parsePhone } from "../src/phone";

describe("phone (F01 §3: país + DDD + número → E.164)", () => {
  it("aceita +55 11 999999999 e devolve E.164 com partes", () => {
    expect(parsePhone({ country: "BR", national: "11 99999-9999" })).toEqual({
      e164: "+5511999999999",
      country: "BR",
      national: "11999999999",
    });
  });
  it("aceita número fixo com DDD e número internacional (PT)", () => {
    expect(parsePhone({ country: "BR", national: "1133334444" }).e164).toBe("+551133334444");
    expect(parsePhone({ country: "PT", national: "912345678" }).e164).toBe("+351912345678");
  });
  it("rejeita DDD inválido, número curto e país desconhecido com códigos tipados", () => {
    expect(() => parsePhone({ country: "BR", national: "00999999999" })).toThrow(PhoneError);
    try {
      parsePhone({ country: "BR", national: "9999" });
    } catch (e) {
      expect((e as PhoneError).code).toBe("too_short");
    }
    try {
      parsePhone({ country: "XX", national: "11999999999" });
    } catch (e) {
      expect((e as PhoneError).code).toBe("invalid_country");
    }
    try {
      parsePhone({ country: "BR", national: "00999999999" });
    } catch (e) {
      expect((e as PhoneError).code).toBe("invalid_number");
    }
  });
  it("formata para exibição em pt-BR (nacional) e en-US (internacional)", () => {
    expect(formatPhone("+5511999999999", "pt-BR")).toBe("(11) 99999-9999");
    expect(formatPhone("+5511999999999", "en-US")).toBe("+55 11 99999 9999");
  });
});
