import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPostingFromIntake, POSTING_TASKS, type Repos } from "@narnia-jobs/core";
import type { Job, Posting, PostingFields } from "@narnia-jobs/shared";
import type { EventBus } from "../events";
import { type FetchFailure, type FetchPostingOptions, fetchPostingPage } from "../postings/fetch";
import type { QueueAdapter } from "../queue";

/**
 * Entrada da vaga (F06 §2.1), usada pela rota e pelas tools do recrutador (M5): texto colado ou URL (busca no servidor,
 * snapshot do HTML para auditoria), heurística na hora e a extração pelo modelo enfileirada. Texto curto demais não
 * vira extração: o usuário completa os campos aos poucos (§1.2).
 */
export const MIN_JD_CHARS = 200;

export interface IntakeDeps {
  repos: Repos;
  queue: QueueAdapter;
  dataDir: string;
  bus?: EventBus | undefined;
  fetchOptions?: FetchPostingOptions | undefined;
}

export type IntakeResult =
  | { ok: true; posting: Posting; job: Job | null }
  | { ok: false; code: FetchFailure | "text_too_short" | "empty"; message: string };

export async function intakePosting(
  deps: IntakeDeps,
  input: {
    text?: string | null;
    url?: string | null;
    fields?: { [K in keyof PostingFields]?: PostingFields[K] | undefined };
  },
): Promise<IntakeResult> {
  let text = input.text?.trim() || null;
  const url = input.url?.trim() || null;
  let html: string | null = null;
  let fields = Object.fromEntries(
    Object.entries(input.fields ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<PostingFields>;
  if (!text && url) {
    const page = await fetchPostingPage(url, deps.fetchOptions);
    if (!page.ok) return page;
    text = page.text;
    html = page.html;
    if (page.siteName && !fields.company) fields = { ...fields, company: page.siteName };
  }
  if (text && text.length < MIN_JD_CHARS)
    return {
      ok: false,
      code: "text_too_short",
      message: `O texto tem menos de ${MIN_JD_CHARS} caracteres: cole a descrição completa ou preencha os campos da vaga.`,
    };
  if (!text && !Object.values(fields).some((v) => v !== null && v !== undefined && v !== ""))
    return { ok: false, code: "empty", message: "Informe o texto, o link ou algum dado da vaga." };
  const posting = createPostingFromIntake(deps.repos, { text, url, fields });
  if (html) {
    const rel = join("snapshots", "postings", `${posting.id}.html`);
    mkdirSync(join(deps.dataDir, "snapshots", "postings"), { recursive: true });
    writeFileSync(join(deps.dataDir, rel), html);
    deps.repos.postings.setRawPath(posting.id, rel);
  }
  const job = text ? await enqueueExtraction(deps, posting) : null;
  deps.bus?.emit({ type: "posting.updated", postingId: posting.id });
  return { ok: true, posting: deps.repos.postings.get(posting.id) as Posting, job };
}

/** Enfileira a extração (modelo + merge + duplicata); a chave muda a cada pedido (refazer depois de editar a JD). */
export async function enqueueExtraction(deps: IntakeDeps, posting: Posting): Promise<Job> {
  deps.repos.postings.setStatus(posting.id, "extracting");
  const { job } = await deps.queue.enqueueTask({
    queue: "extract",
    type: POSTING_TASKS.extract,
    key: `${posting.id}-${Date.now()}`,
    payload: { postingId: posting.id },
  });
  return job;
}
