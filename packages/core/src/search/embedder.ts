/**
 * Vetorizador da busca por sentido (F04-fix-fundamentacao, R6, FF-5): texto → vetor normalizado. O de produção roda um
 * modelo multilíngue local (transformers.js, ONNX na CPU), baixado na ativação para `<dados>/models/`; o de conceitos é
 * determinístico, para os testes e o e2e (nunca baixa nada).
 */
export interface Embedder {
  /** Identifica o modelo: vetor de outro modelo é refeito. */
  readonly model: string;
  /** `query` para a pergunta, `passage` para o fato (o e5 usa prefixos diferentes). */
  embed(texts: string[], role: "query" | "passage"): Promise<Float32Array[]>;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function normalize(v: Float32Array): Float32Array {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / n;
  return v;
}

/**
 * Uma dimensão por conceito (lista de termos) e uma "outros", para o texto sem conceito nenhum. Termos casam sem acento
 * e sem caixa, como trecho do texto.
 */
export function conceptEmbedder(concepts: string[][], model = "conceitos"): Embedder {
  const groups = concepts.map((g) => g.map(fold));
  return {
    model,
    async embed(texts) {
      return texts.map((t) => {
        const text = fold(t);
        const v = new Float32Array(groups.length + 1);
        groups.forEach((g, i) => {
          if (g.some((term) => text.includes(term))) v[i] = 1;
        });
        if (v.every((x) => x === 0)) v[groups.length] = 1;
        return normalize(v);
      });
    },
  };
}

/** Modelo padrão (medição de 2026-11-04: fusão 92% de recall; 113 MB; ~410 MB de RAM carregado). */
export const SEMANTIC_MODEL = "Xenova/multilingual-e5-small";
export const SEMANTIC_MODEL_DTYPE = "q8";

/**
 * A resposta como instância do `Response` global do momento. O `@hono/node-server` troca o `Response` global pela
 * classe dele, o `fetch` do Node devolve o nativo, e o transformers.js só grava no cache o que é `instanceof
 * Response`: sem isso, o download termina e o modelo não é achado ("Unable to get model file path or buffer").
 */
export function asGlobalResponse(r: Response): Response {
  // o tipo diz que `r` já é um Response; em runtime pode ser de outra classe (a troca do servidor)
  if ((r as unknown) instanceof globalThis.Response) return r;
  return new globalThis.Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
  });
}

type Extractor = (
  text: string | string[],
  o: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * O modelo real (transformers.js). Carrega uma vez, no primeiro uso; o download vai para `cacheDir`. O e5 pede os
 * prefixos `query: ` e `passage: `.
 */
export function transformersEmbedder(o: {
  cacheDir: string;
  model?: string;
  dtype?: string;
  /** Avisa o progresso do download (0 a 1). */
  onProgress?: (fraction: number) => void;
}): Embedder & { load(): Promise<void> } {
  const model = o.model ?? SEMANTIC_MODEL;
  let ready: Promise<Extractor> | null = null;
  const load = () => {
    ready ??= (async () => {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = o.cacheDir;
      tf.env.allowLocalModels = false;
      tf.env.fetch = async (input: string | URL | Request, init?: RequestInit) =>
        asGlobalResponse(await fetch(input, init));
      const files = new Map<string, { loaded: number; total: number }>();
      const extractor = await tf.pipeline("feature-extraction", model, {
        dtype: (o.dtype ?? SEMANTIC_MODEL_DTYPE) as never,
        progress_callback: (p: {
          status: string;
          file?: string;
          loaded?: number;
          total?: number;
        }) => {
          if (p.status !== "progress" || !p.file || !o.onProgress) return;
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          const all = [...files.values()];
          const total = all.reduce((s, f) => s + f.total, 0);
          if (total > 0) o.onProgress(all.reduce((s, f) => s + f.loaded, 0) / total);
        },
      });
      return extractor as unknown as Extractor;
    })();
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };
  const prefix = model.includes("e5") ? { query: "query: ", passage: "passage: " } : null;
  return {
    model,
    load: async () => {
      await load();
    },
    async embed(texts, role) {
      if (texts.length === 0) return [];
      const extractor = await load();
      const out: Float32Array[] = [];
      for (const t of texts) {
        const r = await extractor(`${prefix?.[role] ?? ""}${t}`, {
          pooling: "mean",
          normalize: true,
        });
        out.push(Float32Array.from(r.data));
      }
      return out;
    },
  };
}
