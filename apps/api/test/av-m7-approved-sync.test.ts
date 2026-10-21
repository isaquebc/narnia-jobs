import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ApprovedCase, serializeApproved } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { syncApproved } from "../src/evals/approved-sync";

/** M7 (AV-6) · as versões aprovadas do git aparecem no Phoenix como experimento "aprovada", sem rodar o modelo. */
const approved = (exampleId: string): ApprovedCase => ({
  exampleId,
  versionId: "abcdef1234567890",
  commit: "c0ffee1",
  approvedAt: "2026-10-21T10:00:00Z",
  output: { messages: [{ role: "assistant", content: `saída ${exampleId}` }] },
  evaluations: [{ name: "idioma", kind: "CODE", label: "passou", score: 1, explanation: "ok" }],
});

function fakePhoenix(existing: Array<{ name: string; metadata: Record<string, unknown> }> = []) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const path = url.replace("http://px", "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body) posts.push({ path, body });
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (path.startsWith("/v1/datasets?name="))
      return json({
        data: path.includes("narnia-sem-dataset")
          ? []
          : [{ id: "D1", name: decodeURIComponent(path.split("=")[1] ?? "") }],
      });
    if (path === "/v1/datasets/D1/experiments" && !body)
      return json({ data: existing, next_cursor: null });
    if (path === "/v1/datasets/D1/examples")
      return json({
        data: {
          examples: [
            { id: "EX-a", input: { id: "a" } },
            { id: "EX-b", input: { id: "b" } },
          ],
        },
      });
    if (path === "/v1/datasets/D1/experiments") return json({ data: { id: "XP1" } });
    if (path === "/v1/experiments/XP1/runs") return json({ data: { id: `R${posts.length}` } });
    return json({ data: {} });
  };
  return { fetch, posts };
}

describe("M7 · versões aprovadas no Phoenix", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const approvedDir = (files: Record<string, ApprovedCase[]>) => {
    const d = mkdtempSync(join(tmpdir(), "narnia-approved-"));
    dirs.push(d);
    mkdirSync(join(d, "approved"));
    for (const [key, cases] of Object.entries(files))
      writeFileSync(join(d, "approved", `${key}.jsonl`), serializeApproved(cases));
    return join(d, "approved");
  };

  it("ingere cada arquivo como experimento 'aprovada' com saídas e notas", async () => {
    const dir = approvedDir({ "narnia-chat-title": [approved("a"), approved("b")] });
    const px = fakePhoenix();
    const r = await syncApproved({ baseUrl: "http://px", fetch: px.fetch, dir });
    expect(r).toEqual({ ingested: 1, skipped: 0 });
    const exp = px.posts.find((p) => p.path === "/v1/datasets/D1/experiments");
    expect(exp?.body.name).toBe("aprovada · abcdef12 · c0ffee1");
    const meta = exp?.body.metadata as Record<string, unknown> | undefined;
    expect(meta?.approvedHash).toMatch(/^[0-9a-f]{64}$/);
    const runs = px.posts.filter((p) => p.path === "/v1/experiments/XP1/runs");
    expect(runs.map((r) => r.body.dataset_example_id)).toEqual(["EX-a", "EX-b"]);
    expect(px.posts.filter((p) => p.path === "/v1/experiment_evaluations")).toHaveLength(2);
  });

  it("idempotente: arquivo já ingerido (mesmo hash) não cria outro experimento", async () => {
    const dir = approvedDir({ "narnia-chat-title": [approved("a")] });
    const first = fakePhoenix();
    await syncApproved({ baseUrl: "http://px", fetch: first.fetch, dir });
    const meta = first.posts.find((p) => p.path === "/v1/datasets/D1/experiments")?.body
      .metadata as Record<string, unknown>;
    const again = fakePhoenix([{ name: "aprovada · x", metadata: meta }]);
    const r = await syncApproved({ baseUrl: "http://px", fetch: again.fetch, dir });
    expect(r).toEqual({ ingested: 0, skipped: 1 });
    expect(again.posts).toHaveLength(0);
  });

  it("sem dataset no Phoenix (ex.: narnia-chat antes da primeira rodada) ou sem pasta: pula", async () => {
    const dir = approvedDir({ "narnia-sem-dataset": [approved("a")] });
    const px = fakePhoenix();
    expect(await syncApproved({ baseUrl: "http://px", fetch: px.fetch, dir })).toEqual({
      ingested: 0,
      skipped: 1,
    });
    expect(
      await syncApproved({ baseUrl: "http://px", fetch: px.fetch, dir: join(dir, "nada") }),
    ).toEqual({ ingested: 0, skipped: 0 });
  });
});
