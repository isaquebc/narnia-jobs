import type { PromptDef } from "./prompt-catalog";

/**
 * Sincronização dos prompts do repositório com o Phoenix (M2, decisão AV-4): prompt que não existe é criado; prompt
 * cujo conteúdo mudou (hash na metadata da última versão) ganha versão nova; o resto fica como está. A versão nova
 * leva a tag `production` (a que o app usa) e, com a ponte registrada, já aponta para ela no Playground.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PRODUCTION_TAG = "production";
/** Teto de saída das versões (o Playground exige `max_tokens`). */
const MAX_TOKENS = 16000;

export interface SyncOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** Provedor customizado da ponte (`narnia-assinatura`); null = provedor Anthropic padrão do Phoenix. */
  customProviderId: string | null;
  /** Commit do código que gerou a versão (descrição e metadata). */
  commit: string | null;
}

export interface SyncResult {
  name: string;
  action: "created" | "updated" | "unchanged";
}

const LIST = `{ prompts(first: 500) { edges { node { id name } } } }`;
const CREATE = `mutation($input: CreateChatPromptInput!) { createChatPrompt(input: $input) { id } }`;
const VERSION = `mutation($input: CreateChatPromptVersionInput!) { createChatPromptVersion(input: $input) { id } }`;

export function promptVersionInput(
  p: PromptDef,
  o: Pick<SyncOptions, "customProviderId" | "commit">,
) {
  return {
    description: `${p.description}${o.commit ? ` (commit ${o.commit})` : ""}`,
    metadata: {
      hash: p.hash,
      commit: o.commit,
      kind: p.kind,
      sources: p.sources,
      tools: p.tools,
      variables: p.variables,
    },
    templateFormat: "MUSTACHE",
    template: {
      messages: p.messages.map((m) => ({ role: m.role, content: [{ text: { text: m.content } }] })),
    },
    invocationParameters: { anthropic: { maxTokens: MAX_TOKENS } },
    ...(p.jsonSchema
      ? {
          responseFormat: {
            type: "json_schema",
            jsonSchema: { name: p.schemaName ?? "saida", schema: p.jsonSchema },
          },
        }
      : {}),
    modelProvider: "ANTHROPIC",
    modelName: p.modelName,
    ...(o.customProviderId ? { customProviderId: o.customProviderId } : {}),
  };
}

export async function syncPrompts(defs: PromptDef[], o: SyncOptions): Promise<SyncResult[]> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const gql = async <T>(query: string, variables?: unknown): Promise<T> => {
    const r = await f(`${o.baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    if (!r.ok) throw new Error(`Phoenix GraphQL → ${r.status}`);
    const body = (await r.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length)
      throw new Error(`Phoenix: ${body.errors.map((e) => e.message).join("; ")}`);
    return body.data as T;
  };
  const existing = new Map(
    (
      await gql<{ prompts: { edges: Array<{ node: { id: string; name: string } }> } }>(LIST)
    ).prompts.edges.map((e) => [e.node.name, e.node.id]),
  );
  const tag = {
    name: PRODUCTION_TAG,
    description: "Versão que o narnia-jobs usa (sincronizada do repositório).",
  };
  const out: SyncResult[] = [];
  for (const p of defs) {
    const id = existing.get(p.name);
    if (!id) {
      await gql(CREATE, {
        input: {
          name: p.name,
          description: p.description,
          metadata: { kind: p.kind },
          promptVersion: promptVersionInput(p, o),
          tags: [tag],
        },
      });
      out.push({ name: p.name, action: "created" });
      continue;
    }
    const latest = await f(`${o.baseUrl}/v1/prompts/${encodeURIComponent(p.name)}/latest`);
    const hash = latest.ok
      ? ((await latest.json()) as { data?: { metadata?: { hash?: string } } }).data?.metadata?.hash
      : undefined;
    if (hash === p.hash) {
      out.push({ name: p.name, action: "unchanged" });
      continue;
    }
    await gql(VERSION, {
      input: { promptId: id, promptVersion: promptVersionInput(p, o), tags: [tag] },
    });
    out.push({ name: p.name, action: "updated" });
  }
  return out;
}
