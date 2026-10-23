// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fillForm } from "../src/capture/fill";
import { readForm } from "../src/capture/form";

/**
 * F12-14 (pedido do dono, 2026-10-23) · preencher na página: só quando a pessoa clica, campo a campo ou todos; nunca
 * envia. Os eventos de digitação disparam para formulários React/Vue verem o valor; opção só entre as da página;
 * arquivo e campo desconhecido ficam de fora.
 */
function page(body: string) {
  document.body.innerHTML = body;
  return document;
}

describe("F12-14 · fillForm", () => {
  it("texto, e-mail, texto longo, select, rádio, caixa e editor; eventos disparados", () => {
    const doc = page(`
      <label for="n">Nome</label><input id="n">
      <label for="e">E-mail</label><input id="e" type="email">
      <label for="m">Motivo</label><textarea id="m"></textarea>
      <label for="s">Início</label><select id="s"><option value="">Selecione</option>
        <option value="30">Até 30 dias</option><option value="60">Até 60 dias</option></select>
      <fieldset><legend>Viagens?</legend>
        <label><input type="radio" name="v" value="s"> Sim</label><label><input type="radio" name="v" value="n"> Não</label></fieldset>
      <label><input type="checkbox" id="c"> Aceito receber novidades</label>
      <div aria-label="Carta" contenteditable="true"></div>
      <label for="f">CV</label><input id="f" type="file">`);
    const { fields } = readForm(doc);
    expect(fields.map((f) => f.ref)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]);
    const events: string[] = [];
    (doc.getElementById("n") as HTMLInputElement).addEventListener("input", () =>
      events.push("input"),
    );
    (doc.getElementById("n") as HTMLInputElement).addEventListener("change", () =>
      events.push("change"),
    );
    const r = fillForm(doc, [
      { ref: "f1", value: "Ana Maria Exemplo" },
      { ref: "f2", value: "ana@example.com" },
      { ref: "f3", value: "Porque sim." },
      { ref: "f4", value: "Até 60 dias" },
      { ref: "f5", value: "n" },
      { ref: "f6", value: "sim" },
      { ref: "f7", value: "Olá" },
      { ref: "f8", value: "cv.pdf" },
      { ref: "f99", value: "x" },
    ]);
    expect((doc.getElementById("n") as HTMLInputElement).value).toBe("Ana Maria Exemplo");
    expect(events).toEqual(["input", "change"]);
    expect((doc.getElementById("e") as HTMLInputElement).value).toBe("ana@example.com");
    expect((doc.getElementById("m") as HTMLTextAreaElement).value).toBe("Porque sim.");
    expect((doc.getElementById("s") as HTMLSelectElement).value).toBe("60");
    expect((doc.querySelector('input[value="n"]') as HTMLInputElement).checked).toBe(true);
    expect((doc.getElementById("c") as HTMLInputElement).checked).toBe(true);
    expect(doc.querySelector("[contenteditable]")?.textContent).toBe("Olá");
    expect(r.filled).toEqual(["f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
    expect(r.failed).toEqual(["f8", "f99"]);
  });

  it("opção que não existe na página não é escolhida", () => {
    const doc =
      page(`<label for="s">Início</label><select id="s"><option value="1">Imediato</option></select>
      <label for="t">Cargo</label><input id="t">`);
    readForm(doc);
    const r = fillForm(doc, [{ ref: "f1", value: "Daqui a um ano" }]);
    expect(r.failed).toEqual(["f1"]);
    expect((doc.getElementById("s") as HTMLSelectElement).value).toBe("1");
  });
});
