import { fieldElements } from "./form";

/**
 * Preencher na página (F12-14, pedido do dono 2026-10-23): só quando a pessoa clica (um campo ou todos) e nunca envia.
 * O valor entra pelo setter nativo, com `input` e `change`, para formulários React/Vue verem a mudança; escolha só entre
 * as opções da página (por valor ou texto). Arquivo e referência desconhecida ficam em `failed`.
 */
export interface FillItem {
  ref: string;
  value: string;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

const YES = new Set(["sim", "yes", "true", "1", "x"]);

function fire(el: Element) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Setter nativo: o React guarda o valor anterior no próprio elemento e ignora `el.value = …` sozinho. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  fire(el);
}

function labelText(input: Element): string {
  const wrapping = input.closest("label");
  const id = input.getAttribute("id");
  const byFor = id
    ? (input.getRootNode() as Document).querySelector?.(`label[for="${CSS.escape(id)}"]`)
    : null;
  return norm((wrapping ?? byFor)?.textContent ?? (input as HTMLInputElement).value ?? "");
}

function fillOne(el: Element, value: string): boolean {
  const v = norm(value);
  if (el instanceof HTMLSelectElement) {
    const opt = Array.from(el.options).find(
      (o) => o.value !== "" && (o.value === value || norm(o.textContent ?? "") === v),
    );
    if (!opt) return false;
    el.value = opt.value;
    fire(el);
    return true;
  }
  if (el instanceof HTMLTextAreaElement) {
    setValue(el, value);
    return true;
  }
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    if (type === "file") return false;
    if (type === "radio" || type === "checkbox") {
      const group = el.name
        ? Array.from(
            (el.closest("form") ?? (el.getRootNode() as Document)).querySelectorAll(
              `input[type="${type}"][name="${CSS.escape(el.name)}"]`,
            ),
          )
        : [el];
      if (type === "checkbox" && group.length < 2) {
        el.checked = YES.has(v);
        fire(el);
        return true;
      }
      const wanted = value.split(/\s*;\s*/).map(norm);
      const hits = group.filter((g) => {
        const i = g as HTMLInputElement;
        return wanted.includes(norm(i.value)) || wanted.includes(labelText(i));
      }) as HTMLInputElement[];
      if (!hits.length) return false;
      for (const h of hits) {
        if (!h.checked) h.click();
      }
      return true;
    }
    setValue(el, value);
    return true;
  }
  if ((el.getAttribute("contenteditable") ?? "false") !== "false") {
    el.textContent = value;
    fire(el);
    return true;
  }
  if (el.getAttribute("role") === "radiogroup") {
    const item = Array.from(el.querySelectorAll("[role=radio]")).find(
      (o) => norm(o.textContent ?? "") === v,
    );
    if (!item) return false;
    (item as HTMLElement).click();
    return true;
  }
  return false;
}

export function fillForm(doc: Document, items: FillItem[]): { filled: string[]; failed: string[] } {
  const elements = fieldElements(doc);
  const filled: string[] = [];
  const failed: string[] = [];
  for (const it of items) {
    const el = elements[Number(it.ref.slice(1)) - 1];
    let ok = false;
    try {
      ok = !!el && fillOne(el, it.value);
    } catch {
      ok = false;
    }
    (ok ? filled : failed).push(it.ref);
  }
  return { filled, failed };
}
