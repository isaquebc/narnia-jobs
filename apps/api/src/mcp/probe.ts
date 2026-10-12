import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type FetchLike = (url: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * F04/M5: `initialize` + `tools/list` autenticados contra o `/mcp` da instância; devolve quantas tools existem.
 * Usado pelo `doctor` (dentro do api) e, no host, para conferir o que o Claude Code vai enxergar.
 */
export async function probeMcp(
  baseUrl: string,
  token: string,
  fetchFn?: FetchLike,
): Promise<number> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl.replace(/\/$/, "")}/mcp`),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      ...(fetchFn ? { fetch: fetchFn } : {}),
    },
  );
  const client = new Client({ name: "narnia-jobs-doctor", version: "0.0.0" });
  try {
    // o tipo do transporte do SDK não satisfaz exactOptionalPropertyTypes do projeto; em runtime é o mesmo objeto
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    const { tools } = await client.listTools();
    return tools.length;
  } finally {
    await client.close().catch(() => undefined);
  }
}
