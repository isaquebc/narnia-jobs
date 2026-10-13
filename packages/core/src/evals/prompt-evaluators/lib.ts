/**
 * Base dos avaliadores de código dos prompts (avaliações no Phoenix, M3). Este arquivo e cada avaliador são publicados
 * no Phoenix como um arquivo TypeScript único, sem imports (o sandbox Deno roda sem rede e sem npm): por isso aqui só
 * há funções puras, nomes únicos e nenhum import. A publicação junta este arquivo com o avaliador e um `evaluate()`.
 */
export interface EvalParams {
  /** Saída do modelo: `{ messages: [{ role, content }] }` (Phoenix), texto ou objeto. */
  output: unknown;
  /** Variáveis do template (exemplo do dataset). */
  input?: Record<string, unknown> | undefined;
  /** Saída esperada do exemplo (opcional). */
  reference?: unknown;
  metadata?: Record<string, unknown> | undefined;
}

export interface EvalResult {
  label: "passou" | "falhou";
  score: number;
  explanation: string;
}

export function result(passed: boolean, explanation: string, score?: number): EvalResult {
  return { label: passed ? "passou" : "falhou", score: score ?? (passed ? 1 : 0), explanation };
}

/** Texto da resposta: última mensagem do Phoenix, o próprio texto ou o objeto serializado. */
export function textOf(output: unknown): string {
  if (typeof output === "string") return output;
  const messages = (output as { messages?: Array<{ content?: unknown }> } | null)?.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const content = messages[messages.length - 1]?.content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }
  return JSON.stringify(output ?? "");
}

/** JSON da resposta (aceita bloco ```json```); undefined se não houver. */
export function jsonOf(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray((output as { messages?: unknown }).messages)
  )
    return output;
  const text = textOf(output).trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  for (const candidate of [text, fenced?.[1]]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // tenta o próximo
    }
  }
  return undefined;
}

/** Texto de comparação: minúsculas, sem acento repetido de espaço, aspas uniformes. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valores de todas as chaves `key` (em qualquer profundidade). */
export function collectByKey(value: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const v of value) collectByKey(v, key, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === key) out.push(v);
      collectByKey(v, key, out);
    }
  return out;
}

/** Strings de todas as chaves `keys` (ou todas, sem lista). */
export function collectStrings(value: unknown, keys?: string[], out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) collectStrings(v, keys, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && (!keys || keys.includes(k))) out.push(v);
      else collectStrings(v, keys, out);
    }
  return out;
}

/** Texto das fontes do exemplo (`input.<campo>`), juntas. */
export function sourceText(input: Record<string, unknown> | undefined, fields: string[]): string {
  return fields.map((f) => String(input?.[f] ?? "")).join("\n");
}

export function yearsIn(text: string): string[] {
  return [...new Set(text.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
}

type Schema = Record<string, unknown>;

/** Validador de JSON Schema enxuto (o subconjunto que os schemas do narnia-jobs usam). */
export function validateSchema(schema: Schema, value: unknown, path = "$"): string[] {
  const variants = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants)) {
    const ok = variants.some((v) => validateSchema(v, value, path).length === 0);
    return ok ? [] : [`${path}: não casa com nenhuma das opções`];
  }
  const errors: string[] = [];
  const types =
    schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeOk = (t: unknown) =>
    t === "null"
      ? value === null
      : t === "array"
        ? Array.isArray(value)
        : t === "integer"
          ? Number.isInteger(value)
          : t === "object"
            ? typeof value === "object" && value !== null && !Array.isArray(value)
            : typeof value === t;
  if (types.length > 0 && !types.some(typeOk)) return [`${path}: esperado ${types.join("|")}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    errors.push(`${path}: fora do enum (${schema.enum.join(", ")})`);
  if ("const" in schema && schema.const !== value)
    errors.push(`${path}: esperado ${JSON.stringify(schema.const)}`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      errors.push(`${path}: menos de ${schema.minLength} caracteres`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      errors.push(`${path}: mais de ${schema.maxLength} caracteres`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      errors.push(`${path}: menor que ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      errors.push(`${path}: maior que ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errors.push(`${path}: menos de ${schema.minItems} itens`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      errors.push(`${path}: mais de ${schema.maxItems} itens`);
    const items = schema.items as Schema | undefined;
    if (items)
      value.forEach((v, i) => {
        errors.push(...validateSchema(items, v, `${path}[${i}]`));
      });
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const k of (schema.required ?? []) as string[])
      if (!(k in obj) || obj[k] === undefined) errors.push(`${path}.${k}: obrigatório`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errors.push(...validateSchema(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}.${k}: campo não previsto`);
    }
  }
  return errors;
}

/** Lista curta para a explicação. */
export function listShort(items: string[], max = 5): string {
  const shown = items.slice(0, max).map((s) => (s.length > 80 ? `${s.slice(0, 77)}…` : s));
  return items.length > max ? `${shown.join("; ")} (+${items.length - max})` : shown.join("; ");
}
