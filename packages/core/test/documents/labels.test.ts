import { describe, expect, it } from "vitest";
import { languageName } from "../../src/documents/labels";

/** Nome do idioma no idioma do documento (dono, 2026-10-19): os dados guardam como a pessoa escreveu. */
describe("languageName", () => {
  it("traduz os idiomas comuns nos dois sentidos, sem ligar para acento e caixa", () => {
    expect(languageName("en-US", "Português")).toBe("Portuguese");
    expect(languageName("en-US", "portugues")).toBe("Portuguese");
    expect(languageName("en-US", "Inglês")).toBe("English");
    expect(languageName("en-US", "Espanhol")).toBe("Spanish");
    expect(languageName("en-US", "Alemão")).toBe("German");
    expect(languageName("pt-BR", "English")).toBe("Inglês");
    expect(languageName("pt-BR", "french")).toBe("Francês");
    expect(languageName("pt-BR", "Português")).toBe("Português");
  });

  it("idioma desconhecido fica como nos dados", () => {
    expect(languageName("en-US", "Tupi-guarani")).toBe("Tupi-guarani");
  });
});
