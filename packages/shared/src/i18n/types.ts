/** Estrutura de i18n (decisão global 5): dicionários por idioma, nenhuma string fixa em componente. */

export type Dictionary = { [key: string]: string | Dictionary };

/** Caminhos "a.b.c" até as folhas (strings) de um dicionário. */
export type DictionaryPath<D, Prefix extends string = ""> = {
  [K in keyof D & string]: D[K] extends string
    ? `${Prefix}${K}`
    : D[K] extends Dictionary
      ? DictionaryPath<D[K], `${Prefix}${K}.`>
      : never;
}[keyof D & string];

export type TranslateParams = Record<string, string | number>;

export interface TranslatorOptions {
  /** Chamado uma única vez por chave ausente (depuração/telemetria). */
  onMissing?: (key: string) => void;
}

export type Translator<D extends Dictionary> = (
  key: DictionaryPath<D>,
  params?: TranslateParams,
) => string;

function lookup(dict: Dictionary, path: string): string | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of path.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function createTranslator<D extends Dictionary>(
  dict: D,
  options: TranslatorOptions = {},
): Translator<D> {
  const reported = new Set<string>();
  return (key, params) => {
    const value = lookup(dict, key);
    if (value === undefined) {
      if (!reported.has(key)) {
        reported.add(key);
        options.onMissing?.(key);
      }
      return key;
    }
    return interpolate(value, params);
  };
}
