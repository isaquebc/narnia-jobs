/**
 * Leitor de formulário (F12/M3, §4.3): os campos que a pessoa vê, na ordem da página, com o rótulo (label[for], label
 * em volta, aria-labelledby, aria-label, texto vizinho), o tipo, as opções, se é obrigatório, o limite, a ajuda e a
 * seção. Entra no Shadow DOM aberto (Workday) e nos quadros da mesma origem; os de outra origem ficam em `frames`
 * para a extensão pedir permissão. Senhas, cartões, campos ocultos e valores digitados nunca saem do navegador.
 * Nada é preenchido: a referência (`ref`) só liga a pergunta ao campo.
 */
export type FieldControl =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "checkboxes"
  | "file"
  | "richtext"
  | "combobox";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormField {
  ref: string;
  control: FieldControl;
  label: string | null;
  name: string | null;
  placeholder: string | null;
  help: string | null;
  section: string | null;
  required: boolean;
  maxLength: number | null;
  options: FieldOption[];
  autocomplete: string | null;
}

export interface FormSnapshot {
  fields: FormField[];
  /** Origens de quadros (iframes) que não deu para ler sem permissão. */
  frames: string[];
}

const MAX_FIELDS = 300;
const MAX_OPTIONS = 200;
const MAX_TEXT = 300;

const SKIP_TYPES = new Set(["hidden", "password", "submit", "button", "reset", "image", "search"]);
const CONTROLS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const CARD = /(^|[^a-z])(card|cart[aã]o|cvv|cvc)([^a-z]|$)/i;

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_TEXT) : null;
};

/** Texto do elemento sem o texto dos campos dentro dele (opções de select, botões). */
function textOf(el: Element): string | null {
  const copy = el.cloneNode(true) as Element;
  for (const c of copy.querySelectorAll("input, select, textarea, button, option, script, style"))
    c.remove();
  return clean(copy.textContent);
}

const hasControl = (el: Element) =>
  CONTROLS.has(el.tagName) ||
  el.querySelector(
    "input, select, textarea, [contenteditable], [role=radiogroup], [role=combobox]",
  ) !== null;

/** Raiz onde procurar ids (documento ou Shadow DOM). */
const rootOf = (el: Element) => el.getRootNode() as Document | ShadowRoot;

function byIds(el: Element, attr: string): string | null {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? [];
  if (!ids.length) return null;
  const root = rootOf(el);
  return clean(
    ids
      .map((id) => root.getElementById?.(id))
      .filter((x): x is HTMLElement => !!x)
      .map((x) => textOf(x) ?? "")
      .join(" "),
  );
}

/** Pai atravessando o Shadow DOM (o pai do topo da sombra é o elemento hospedeiro). */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function hidden(el: Element): boolean {
  const check = (el as { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === "function" && !check.call(el)) return true;
  for (let e: Element | null = el; e; e = parentOf(e)) {
    if (e.hasAttribute("hidden") || e.getAttribute("aria-hidden") === "true") return true;
    const style = e.ownerDocument.defaultView?.getComputedStyle(e);
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
}

/** Texto antes do campo no mesmo bloco: o rótulo dos formulários feitos sem `label` (React, Gupy). */
function neighborText(el: Element): string | null {
  let child: Element = el;
  for (let depth = 0; depth < 4; depth++) {
    const parent = parentOf(child);
    if (!parent) return null;
    for (let s = child.previousElementSibling; s; s = s.previousElementSibling) {
      if (hasControl(s)) return null;
      const t = textOf(s);
      if (t) return t;
    }
    child = parent;
  }
  return null;
}

/** Rótulo de botão de arquivo ("Attach", "Anexar"): o de verdade fica no grupo em volta. */
const GENERIC =
  /^(attach|anexar|upload|enviar( arquivo)?|escolher arquivo|choose file|browse|selecionar arquivo)$/i;

function labelFor(el: Element): string | null {
  const own = ownLabel(el);
  if (own && !GENERIC.test(own)) return own;
  const group = el.closest("[role=group]");
  return (
    (group && (byIds(group, "aria-labelledby") ?? clean(group.getAttribute("aria-label")))) || own
  );
}

function ownLabel(el: Element): string | null {
  const labelled = byIds(el, "aria-labelledby");
  if (labelled) return labelled;
  const id = el.getAttribute("id");
  if (id) {
    const root = rootOf(el);
    const label = root.querySelector?.(`label[for="${CSS.escape(id)}"]`);
    if (label) return textOf(label);
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const t = textOf(wrapping);
    if (t) return t;
  }
  return (
    clean(el.getAttribute("aria-label")) ?? clean(el.getAttribute("title")) ?? neighborText(el)
  );
}

/** Rótulo de um grupo de opções: legenda do fieldset, aria-labelledby ou o texto antes da primeira opção. */
function groupLabel(first: Element): string | null {
  const fieldset = first.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend) return textOf(legend);
  const group = first.closest("[role=radiogroup], [role=group]");
  if (group) {
    const t = byIds(group, "aria-labelledby") ?? clean(group.getAttribute("aria-label"));
    if (t) return t;
  }
  return neighborText(first.closest("label") ?? first);
}

function optionLabel(input: Element): string {
  const wrapping = input.closest("label");
  const id = input.getAttribute("id");
  const byFor = id ? rootOf(input).querySelector?.(`label[for="${CSS.escape(id)}"]`) : null;
  return (
    (wrapping && textOf(wrapping)) ||
    (byFor && textOf(byFor)) ||
    clean(input.nextSibling?.textContent) ||
    (input as HTMLInputElement).value ||
    ""
  );
}

const required = (el: Element, label: string | null) =>
  el.hasAttribute("required") ||
  el.getAttribute("aria-required") === "true" ||
  el.closest("[role=group]")?.getAttribute("aria-required") === "true" ||
  /\*\s*$/.test(label ?? "");

function maxLength(el: Element): number | null {
  const n = Number(el.getAttribute("maxlength"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inputControl(type: string): FieldControl {
  if (type === "email" || type === "tel" || type === "url" || type === "number") return type;
  if (type === "date" || type === "month" || type === "datetime-local") return "date";
  if (type === "file" || type === "radio" || type === "checkbox") return type;
  return "text";
}

/** Elementos na ordem da página, entrando no Shadow DOM aberto. */
function* walk(node: Document | ShadowRoot | Element): Generator<Element> {
  for (const child of Array.from(node.children)) {
    yield child;
    if (child.shadowRoot) yield* walk(child.shadowRoot);
    yield* walk(child);
  }
}

const HEADING = /^H[1-4]$/;

function excluded(el: Element): boolean {
  if (el.closest("[role=search]")) return true;
  if ((el as HTMLInputElement).disabled) return true;
  const ac = el.getAttribute("autocomplete") ?? "";
  if (ac.startsWith("cc-")) return true;
  return CARD.test(`${el.getAttribute("name") ?? ""} ${el.getAttribute("id") ?? ""}`);
}

export function readForm(doc: Document): FormSnapshot {
  const { fields, frames } = scanForm(doc);
  return { fields, frames };
}

/** Os elementos de cada campo, na mesma ordem das referências de `readForm` (para preencher, F12-14). */
export function fieldElements(doc: Document): Element[] {
  return scanForm(doc).elements;
}

function scanForm(doc: Document): FormSnapshot & { elements: Element[] } {
  const elements: Element[] = [];
  const fields: FormField[] = [];
  const frames = new Set<string>();
  const seenGroups = new Set<string>();
  const origin = doc.location?.origin ?? "";

  const add = (f: Omit<FormField, "ref" | "section">, el: Element, heading: string | null) => {
    if (fields.length >= MAX_FIELDS) return;
    const legendEl = el.closest("fieldset")?.querySelector("legend");
    const legend = legendEl ? textOf(legendEl) : null;
    fields.push({ ref: `f${fields.length + 1}`, section: legend ?? heading, ...f });
    elements.push(el);
  };

  const read = (root: Document) => {
    let heading: string | null = null;
    for (const el of walk(root)) {
      const tag = el.tagName;
      if (HEADING.test(tag) || el.getAttribute("role") === "heading") {
        heading = textOf(el) ?? heading;
        continue;
      }
      if (tag === "IFRAME") {
        const src = el.getAttribute("src") ?? "";
        let frameOrigin: string | null = null;
        try {
          frameOrigin = /^https?:/i.test(src) ? new URL(src, root.location.href).origin : null;
        } catch {
          frameOrigin = null;
        }
        if (frameOrigin && frameOrigin !== origin) {
          frames.add(frameOrigin);
          continue;
        }
        const inner = (el as HTMLIFrameElement).contentDocument;
        if (inner) read(inner);
        continue;
      }
      const role = el.getAttribute("role");
      const isControl =
        CONTROLS.has(tag) ||
        role === "radiogroup" ||
        role === "combobox" ||
        role === "listbox" ||
        (el.getAttribute("contenteditable") ?? "false") !== "false";
      if (!isControl || excluded(el) || hidden(el)) continue;
      const base = {
        name: clean(el.getAttribute("name")),
        placeholder: clean(el.getAttribute("placeholder")),
        help: byIds(el, "aria-describedby"),
        maxLength: maxLength(el),
        autocomplete: clean(el.getAttribute("autocomplete")),
      };

      if (tag === "INPUT") {
        const input = el as HTMLInputElement;
        const type = (input.getAttribute("type") ?? "text").toLowerCase();
        if (SKIP_TYPES.has(type)) continue;
        if (role === "combobox") {
          const label = labelFor(el);
          add(
            { ...base, control: "combobox", label, required: required(el, label), options: [] },
            el,
            heading,
          );
          continue;
        }
        if (type === "radio" || type === "checkbox") {
          const name = input.name;
          const scope = el.closest("form") ?? rootOf(el);
          const group = name
            ? Array.from(
                scope.querySelectorAll(`input[type="${type}"][name="${CSS.escape(name)}"]`),
              )
            : [el];
          if (type === "checkbox" && group.length < 2) {
            const label = labelFor(el);
            add(
              { ...base, control: "checkbox", label, required: required(el, label), options: [] },
              el,
              heading,
            );
            continue;
          }
          const key = `${type}:${name}`;
          if (seenGroups.has(key)) continue;
          seenGroups.add(key);
          const first = group[0] as Element;
          const label = groupLabel(first);
          add(
            {
              ...base,
              control: type === "radio" ? "radio" : "checkboxes",
              label,
              required: group.some((g) => g.hasAttribute("required")) || required(first, label),
              options: group.slice(0, MAX_OPTIONS).map((g) => ({
                value: (g as HTMLInputElement).value,
                label: optionLabel(g),
              })),
            },
            first,
            heading,
          );
          continue;
        }
        const label = labelFor(el);
        add(
          {
            ...base,
            control: inputControl(type),
            label,
            required: required(el, label),
            options: [],
          },
          el,
          heading,
        );
        continue;
      }
      if (tag === "TEXTAREA") {
        const label = labelFor(el);
        add(
          { ...base, control: "textarea", label, required: required(el, label), options: [] },
          el,
          heading,
        );
        continue;
      }
      if (tag === "SELECT") {
        const select = el as HTMLSelectElement;
        const label = labelFor(el);
        const options = Array.from(select.options)
          .filter((o) => o.value !== "")
          .slice(0, MAX_OPTIONS)
          .map((o) => ({ value: o.value, label: clean(o.textContent) ?? o.value }));
        add(
          {
            ...base,
            control: select.multiple ? "multiselect" : "select",
            label,
            required: required(el, label),
            options,
          },
          el,
          heading,
        );
        continue;
      }
      if (role === "radiogroup" || role === "listbox") {
        const items = Array.from(
          el.querySelectorAll(role === "radiogroup" ? "[role=radio]" : "[role=option]"),
        );
        const label = labelFor(el);
        add(
          {
            ...base,
            control:
              role === "radiogroup"
                ? "radio"
                : el.getAttribute("aria-multiselectable") === "true"
                  ? "multiselect"
                  : "select",
            label,
            required: required(el, label),
            options: items.slice(0, MAX_OPTIONS).map((o) => {
              const t = textOf(o) ?? "";
              return { value: o.getAttribute("data-value") ?? t, label: t };
            }),
          },
          el,
          heading,
        );
        continue;
      }
      if (role === "combobox") {
        const label = labelFor(el);
        add(
          { ...base, control: "combobox", label, required: required(el, label), options: [] },
          el,
          heading,
        );
        continue;
      }
      // contenteditable: só o de fora (o editor rico pode ter blocos editáveis dentro)
      const outer = parentOf(el)?.closest("[contenteditable]");
      if (outer && outer.getAttribute("contenteditable") !== "false") continue;
      const label = labelFor(el);
      add(
        { ...base, control: "richtext", label, required: required(el, label), options: [] },
        el,
        heading,
      );
    }
  };

  read(doc);
  return { fields, frames: [...frames], elements };
}
