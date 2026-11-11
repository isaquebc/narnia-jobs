import { describe, expect, it } from "vitest";
import { popupView } from "../src/popup-view";

/**
 * F14/M1 · RT-I4: o menu do ícone de hoje (F12-15) fica igual em qualquer página fora do Gmail: "Analisar a vaga",
 * "Ajudar no formulário" e "Abrir o narnia"; sem pareamento, só "Conectar".
 */
const paired = { instance: "http://127.0.0.1:5173", token: "nxd_abc", deviceName: "Chrome" };

describe("F14/M1 · RT-I4 · menu do ícone", () => {
  it("sem pareamento: modo unpaired, sem ações", () => {
    expect(popupView({}, "https://vagas.example/1")).toEqual({ mode: "unpaired", actions: [] });
    expect(popupView({ instance: "http://x" }, undefined).mode).toBe("unpaired");
  });

  it("pareada, numa página de vaga: as três ações de hoje, nessa ordem", () => {
    expect(popupView(paired, "https://vagas.example/1")).toEqual({
      mode: "paired",
      actions: ["posting", "form", "open"],
    });
  });

  it("pareada, sem URL da aba (chrome://, aba sem permissão): as mesmas três ações", () => {
    expect(popupView(paired, undefined).actions).toEqual(["posting", "form", "open"]);
  });
});
