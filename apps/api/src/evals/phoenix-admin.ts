/**
 * Administração do Phoenix local pela API dele (avaliações, decisão AV-2): registra a ponte da assinatura como
 * provedor Anthropic customizado (GraphQL) e guarda/apaga a chave de API da Anthropic como segredo do Phoenix (REST),
 * para quem preferir pagar por token no Playground. O Phoenix local não tem autenticação (só 127.0.0.1 e a rede dos
 * containers).
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Nome do provedor customizado no Phoenix (AI Providers). */
export const PHOENIX_BRIDGE_PROVIDER = "narnia-assinatura";
const ANTHROPIC_SECRET = "ANTHROPIC_API_KEY";

/** Origem do Phoenix: `NARNIA_PHOENIX_URL` ou a do endpoint OTLP (`http://phoenix:6006/v1/traces`). */
export function phoenixBaseUrl(env: Record<string, string | undefined>): string | null {
  const explicit = env.NARNIA_PHOENIX_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const otel = env.NARNIA_OTEL_ENDPOINT?.trim();
  if (!otel) return null;
  try {
    return new URL(otel).origin;
  } catch {
    return null;
  }
}

/** Endereço da ponte visto de dentro do Phoenix (serviço `api` do compose). */
export function bridgeUrlForPhoenix(env: Record<string, string | undefined>): string {
  return (
    env.NARNIA_BRIDGE_URL?.trim() || `http://api:${env.PORT ?? "3100"}/bridge/anthropic`
  ).replace(/\/+$/, "");
}

export interface PhoenixStatus {
  reachable: boolean;
  providerRegistered: boolean;
  /** Id (GraphQL) do provedor da ponte; as versões de prompt apontam para ele. */
  providerId: string | null;
  anthropicKeySet: boolean;
}

export interface PhoenixAdmin {
  status(): Promise<PhoenixStatus>;
  registerBridge(input: { key: string; bridgeUrl: string }): Promise<void>;
  setAnthropicKey(value: string | null): Promise<void>;
}

const STATUS_QUERY = `{
  generativeModelCustomProviders(first: 100) { edges { node { id name } } }
  secrets(keys: ["${ANTHROPIC_SECRET}"]) { edges { node { key } } }
}`;
const CREATE = `mutation($input: CreateGenerativeModelCustomProviderMutationInput!) {
  createGenerativeModelCustomProvider(input: $input) { provider { id } }
}`;
const PATCH = `mutation($input: PatchGenerativeModelCustomProviderMutationInput!) {
  patchGenerativeModelCustomProvider(input: $input) { provider { id } }
}`;

interface StatusData {
  generativeModelCustomProviders: { edges: Array<{ node: { id: string; name: string } }> };
  secrets: { edges: Array<{ node: { key: string } }> };
}

export function createPhoenixAdmin(o: { baseUrl: string; fetch?: FetchLike }): PhoenixAdmin {
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
  const read = () => gql<StatusData>(STATUS_QUERY);
  return {
    async status() {
      try {
        const d = await read();
        const provider = d.generativeModelCustomProviders.edges.find(
          (e) => e.node.name === PHOENIX_BRIDGE_PROVIDER,
        );
        return {
          reachable: true,
          providerRegistered: Boolean(provider),
          providerId: provider?.node.id ?? null,
          anthropicKeySet: d.secrets.edges.some((e) => e.node.key === ANTHROPIC_SECRET),
        };
      } catch {
        return {
          reachable: false,
          providerRegistered: false,
          providerId: null,
          anthropicKeySet: false,
        };
      }
    },
    async registerBridge({ key, bridgeUrl }) {
      const existing = (await read()).generativeModelCustomProviders.edges.find(
        (e) => e.node.name === PHOENIX_BRIDGE_PROVIDER,
      );
      const clientConfig = {
        anthropic: {
          anthropicAuthenticationMethod: { apiKey: key },
          anthropicClientKwargs: { baseUrl: bridgeUrl },
        },
      };
      const description =
        "narnia-jobs: ponte pela sua assinatura do Claude (Agent SDK); sem tools; consome a cota da assinatura.";
      if (existing)
        await gql(PATCH, {
          input: { id: existing.node.id, provider: "anthropic", description, clientConfig },
        });
      else
        await gql(CREATE, {
          input: {
            name: PHOENIX_BRIDGE_PROVIDER,
            description,
            provider: "anthropic",
            clientConfig,
          },
        });
    },
    async setAnthropicKey(value) {
      const r = await f(`${o.baseUrl}/v1/secrets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secrets: [{ key: ANTHROPIC_SECRET, value }] }),
      });
      if (!r.ok) throw new Error(`Phoenix /v1/secrets → ${r.status} ${await r.text()}`);
    },
  };
}
