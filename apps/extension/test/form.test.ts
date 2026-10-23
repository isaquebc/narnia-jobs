// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { type FormField, readForm } from "../src/capture/form";

/**
 * F12/M3 · leitor de formulário (§4.3): campos visíveis com rótulo (label[for], label em volta, aria-labelledby,
 * aria-label, texto vizinho), tipo, opções, obrigatório, limite, ajuda e seção, na ordem da página. Entra no Shadow DOM
 * aberto; quadros de outra origem ficam listados para pedir permissão. Senhas, cartões e campos ocultos ficam de fora,
 * e nenhum valor digitado sai do navegador. Fixtures fictícias no estilo de Gupy, Greenhouse, Lever e Workday.
 */
function page(body: string) {
  document.body.innerHTML = body;
  return document;
}

const byLabel = (fields: FormField[], label: RegExp) => {
  const f = fields.find((x) => x.label && label.test(x.label));
  if (!f) throw new Error(`sem campo ${label}: ${fields.map((x) => x.label).join(" | ")}`);
  return f;
};

describe("F12/M3 · readForm", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("estilo Gupy: rótulo por texto vizinho, obrigatório pelo asterisco, select, rádios, LGPD", () => {
    const { fields } = readForm(
      page(`
      <h2>Dados pessoais</h2>
      <div class="field"><span>Nome completo *</span><div><input name="fullName" value="Ana"></div></div>
      <div class="field"><span>Celular</span><input type="tel" name="phone"></div>
      <h2>Informações adicionais</h2>
      <div class="field"><p>Raça/cor</p><select name="race"><option value="">Selecione</option>
        <option value="1">Branca</option><option value="2">Preta</option><option value="9">Prefiro não informar</option></select></div>
      <div class="field"><p>Você tem disponibilidade para mudança? *</p>
        <label><input type="radio" name="move" value="s"> Sim</label>
        <label><input type="radio" name="move" value="n"> Não</label></div>
      <label><input type="checkbox" name="lgpd"> Li e aceito a política de privacidade (LGPD)</label>
      <button type="submit">Enviar</button>`),
    );
    expect(fields.map((f) => f.ref)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    expect(byLabel(fields, /Nome completo/)).toMatchObject({
      control: "text",
      required: true,
      section: "Dados pessoais",
      name: "fullName",
    });
    expect(byLabel(fields, /Celular/)).toMatchObject({ control: "tel", required: false });
    expect(byLabel(fields, /Raça/)).toMatchObject({
      control: "select",
      section: "Informações adicionais",
      options: [
        { value: "1", label: "Branca" },
        { value: "2", label: "Preta" },
        { value: "9", label: "Prefiro não informar" },
      ],
    });
    expect(byLabel(fields, /mudança/)).toMatchObject({
      control: "radio",
      required: true,
      options: [
        { value: "s", label: "Sim" },
        { value: "n", label: "Não" },
      ],
    });
    expect(byLabel(fields, /LGPD/)).toMatchObject({ control: "checkbox", options: [] });
    // nada digitado sai do navegador
    expect(JSON.stringify(fields)).not.toContain("Ana");
  });

  it("estilo Greenhouse: label[for], ajuda por aria-describedby, limite, arquivo, fieldset com caixas", () => {
    const { fields } = readForm(
      page(`
      <form id="application">
        <label for="first_name">First Name<span class="asterisk">*</span></label>
        <input id="first_name" name="job_application[first_name]" required>
        <label for="resume">Resume/CV</label><input type="file" id="resume" accept=".pdf">
        <label for="q1">Why do you want to join us?</label>
        <textarea id="q1" maxlength="1000" aria-describedby="q1-help"></textarea>
        <div id="q1-help">Up to 1000 characters.</div>
        <fieldset><legend>Which languages do you speak?</legend>
          <label><input type="checkbox" name="langs[]" value="en">English</label>
          <label><input type="checkbox" name="langs[]" value="pt">Portuguese</label>
        </fieldset>
      </form>`),
    );
    expect(byLabel(fields, /First Name/)).toMatchObject({ control: "text", required: true });
    expect(byLabel(fields, /First Name/).label).toBe("First Name*");
    expect(byLabel(fields, /Resume/)).toMatchObject({ control: "file" });
    expect(byLabel(fields, /Why do you want/)).toMatchObject({
      control: "textarea",
      maxLength: 1000,
      help: "Up to 1000 characters.",
    });
    expect(byLabel(fields, /languages/)).toMatchObject({
      control: "checkboxes",
      section: "Which languages do you speak?",
      options: [
        { value: "en", label: "English" },
        { value: "pt", label: "Portuguese" },
      ],
    });
  });

  it("Greenhouse real: arquivo com rótulo genérico (Attach) usa o rótulo do grupo", () => {
    const { fields } = readForm(
      page(`<div role="group" aria-labelledby="upload-label-resume" aria-required="true">
        <div id="upload-label-resume" class="label">Resume/CV<span>*</span></div>
        <button type="button">Attach</button><label for="resume">Attach</label>
        <input id="resume" type="file" accept=".pdf"></div>
        <label for="nome">Nome</label><input id="nome">`),
    );
    expect(fields[0]).toMatchObject({ control: "file", label: "Resume/CV*", required: true });
  });

  it("estilo Lever: label envolvendo o campo e texto de rótulo em div", () => {
    const { fields } = readForm(
      page(`
      <ul><li class="application-question"><label><div class="application-label">LinkedIn URL</div>
        <div class="application-field"><input type="url" name="urls[LinkedIn]"></div></label></li>
      <li class="application-question"><div class="application-label">Pronouns</div>
        <div class="application-field"><input type="text" name="pronouns" placeholder="e.g. they/them"></div></li></ul>`),
    );
    expect(byLabel(fields, /LinkedIn/)).toMatchObject({ control: "url" });
    expect(byLabel(fields, /Pronouns/)).toMatchObject({ placeholder: "e.g. they/them" });
  });

  it("estilo Workday: Shadow DOM aberto, aria-labelledby, radiogroup e combobox próprios", () => {
    const doc = page(`<div id="host"></div><div id="host2"></div>`);
    const root = (doc.getElementById("host") as HTMLElement).attachShadow({ mode: "open" });
    root.innerHTML = `
      <div id="lbl-city">City</div><input aria-labelledby="lbl-city" aria-required="true">
      <div id="lbl-auth">Are you legally authorized to work in Brazil?</div>
      <div role="radiogroup" aria-labelledby="lbl-auth">
        <div role="radio" aria-checked="false">Yes</div><div role="radio" aria-checked="false">No</div>
      </div>`;
    const root2 = (doc.getElementById("host2") as HTMLElement).attachShadow({ mode: "open" });
    root2.innerHTML = `<button role="combobox" aria-label="How did you hear about us?" aria-haspopup="listbox">Select One</button>`;
    const { fields } = readForm(doc);
    expect(byLabel(fields, /City/)).toMatchObject({ control: "text", required: true });
    expect(byLabel(fields, /authorized/)).toMatchObject({
      control: "radio",
      options: [
        { value: "Yes", label: "Yes" },
        { value: "No", label: "No" },
      ],
    });
    expect(byLabel(fields, /hear about us/)).toMatchObject({ control: "combobox" });
  });

  it("fora: oculto, senha, cartão, busca, botões, desabilitado; contenteditable entra", () => {
    const { fields } = readForm(
      page(`
      <form role="search"><input type="search" aria-label="Buscar vagas"></form>
      <input type="hidden" name="csrf" value="tok">
      <label>Senha <input type="password" name="pwd"></label>
      <label>Número do cartão <input name="cc" autocomplete="cc-number"></label>
      <div style="display:none"><label>Escondido <input name="h"></label></div>
      <label hidden>Também escondido <input name="h2"></label>
      <label>Desabilitado <input name="d" disabled></label>
      <input type="submit" value="Enviar"><button>Próximo</button>
      <div aria-label="Carta de apresentação" contenteditable="true"></div>`),
    );
    expect(fields.map((f) => f.label)).toEqual(["Carta de apresentação"]);
    expect(fields[0]?.control).toBe("richtext");
  });

  it("quadros: lê os da mesma origem e lista os de outra origem para pedir permissão", () => {
    const doc = page(`<label>Nome <input name="n"></label>
      <iframe src="https://boards.greenhouse.io/embed/job_app?for=acme"></iframe>
      <iframe src="about:blank" id="same"></iframe>`);
    const same = doc.getElementById("same") as HTMLIFrameElement;
    (same.contentDocument as Document).body.innerHTML =
      `<label>E-mail <input type="email"></label>`;
    const r = readForm(doc);
    expect(r.fields.map((f) => f.label)).toEqual(["Nome", "E-mail"]);
    expect(r.frames).toEqual(["https://boards.greenhouse.io"]);
  });
});
