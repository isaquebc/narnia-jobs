import { describe, expect, it, vi } from "vitest";
import { createTranslator, type Dictionary } from "../src/index";

const dict = {
  common: { save: "Salvar", hello: "Olá, {name}!" },
  onboarding: { step: "Passo {current} de {total}" },
} satisfies Dictionary;

describe("M2/shared · i18n (estrutura; só pt-BR em F01)", () => {
  it("resolve chaves aninhadas por caminho com ponto", () => {
    const t = createTranslator(dict);
    expect(t("common.save")).toBe("Salvar");
  });

  it("interpola parâmetros", () => {
    const t = createTranslator(dict);
    expect(t("common.hello", { name: "Ana" })).toBe("Olá, Ana!");
    expect(t("onboarding.step", { current: 2, total: 5 })).toBe("Passo 2 de 5");
  });

  it("chave ausente devolve a própria chave e avisa uma vez", () => {
    const onMissing = vi.fn();
    const t = createTranslator(dict, { onMissing });
    // @ts-expect-error chave inexistente é erro de tipo; em runtime devolve a chave
    expect(t("common.nope")).toBe("common.nope");
    // @ts-expect-error idem
    t("common.nope");
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith("common.nope");
  });

  it("parâmetro ausente mantém o marcador visível para depuração", () => {
    const t = createTranslator(dict);
    expect(t("common.hello")).toBe("Olá, {name}!");
  });
});
