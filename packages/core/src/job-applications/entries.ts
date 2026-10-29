import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHMENT_MAX_BYTES,
  type JobApplication,
  type JobApplicationEntry,
  type JobApplicationEntryPatch,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { newId } from "../ids";
import { JobApplicationError, notAfterToday } from "./index";

/**
 * Notas e anexos datados da candidatura (F07/M3, §0-5). Os arquivos ficam numa pasta plana,
 * `<dados>/job-applications/<id do anexo>`, para o backup copiar os que faltam como faz com os uploads; o nome original
 * e o tipo ficam no banco. Registrar, editar ou apagar é atividade (conta para o arquivamento e desarquiva).
 */
export const ATTACHMENTS_DIR = "job-applications";

export const attachmentPath = (dataDir: string, attachmentId: string) =>
  join(dataDir, ATTACHMENTS_DIR, attachmentId);

export interface EntryFile {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** Tamanho declarado (o upload pode ser recusado antes de ler os bytes). */
  size?: number;
}

const mustApplication = (repos: Repos, id: string) => {
  if (!repos.jobApplications.get(id))
    throw new JobApplicationError("not_found", "Candidatura não encontrada");
};

const mustEntry = (repos: Repos, applicationId: string, entryId: string) => {
  const e = repos.jobApplicationEntries.get(entryId);
  if (!e || e.applicationId !== applicationId)
    throw new JobApplicationError("not_found", "Nota não encontrada");
  return e;
};

const unlink = (dataDir: string, ids: string[]) => {
  for (const id of ids) rmSync(attachmentPath(dataDir, id), { force: true });
};

export function addJobApplicationEntry(
  repos: Repos,
  dataDir: string,
  applicationId: string,
  input: { occurredOn: string; body: string | null; files: EntryFile[] },
  now = new Date(),
): JobApplicationEntry {
  mustApplication(repos, applicationId);
  const body = input.body?.trim() || null;
  if (!body && input.files.length === 0)
    throw new JobApplicationError("entry_empty", "Escreva a nota ou anexe um arquivo");
  notAfterToday(input.occurredOn, now);
  if (input.files.some((f) => (f.size ?? f.bytes.byteLength) > ATTACHMENT_MAX_BYTES))
    throw new JobApplicationError(
      "file_too_large",
      "Arquivo acima de 100 MB: guarde o link na nota",
    );
  if (input.files.length > 0) mkdirSync(join(dataDir, ATTACHMENTS_DIR), { recursive: true });
  const attachments = input.files.map((f) => {
    const id = newId();
    writeFileSync(attachmentPath(dataDir, id), f.bytes);
    return {
      id,
      fileName: f.name || "arquivo",
      mime: f.type || "application/octet-stream",
      size: f.bytes.byteLength,
    };
  });
  try {
    const entry = repos.jobApplicationEntries.create(
      { applicationId, occurredOn: input.occurredOn, body, attachments },
      now,
    );
    repos.jobApplications.touch(applicationId, now);
    return entry;
  } catch (e) {
    unlink(
      dataDir,
      attachments.map((a) => a.id),
    );
    throw e;
  }
}

export function updateJobApplicationEntry(
  repos: Repos,
  applicationId: string,
  entryId: string,
  patch: JobApplicationEntryPatch,
  now = new Date(),
): JobApplicationEntry {
  const cur = mustEntry(repos, applicationId, entryId);
  if (patch.occurredOn) notAfterToday(patch.occurredOn, now);
  const body = patch.body === undefined ? undefined : patch.body?.trim() || null;
  if (body === null && cur.attachments.length === 0)
    throw new JobApplicationError("entry_empty", "Escreva a nota ou anexe um arquivo");
  const out = repos.jobApplicationEntries.update(
    entryId,
    {
      ...(patch.occurredOn ? { occurredOn: patch.occurredOn } : {}),
      ...(body !== undefined ? { body } : {}),
    },
    now,
  );
  repos.jobApplications.touch(applicationId, now);
  return out;
}

export function removeJobApplicationEntry(
  repos: Repos,
  dataDir: string,
  applicationId: string,
  entryId: string,
  now = new Date(),
): void {
  const e = mustEntry(repos, applicationId, entryId);
  repos.jobApplicationEntries.remove(entryId);
  unlink(
    dataDir,
    e.attachments.map((a) => a.id),
  );
  repos.jobApplications.touch(applicationId, now);
}

/** Apaga a candidatura com as notas e os arquivos dela (a vaga e os documentos ficam). */
export function removeJobApplication(repos: Repos, dataDir: string, applicationId: string): void {
  const ids = repos.jobApplicationEntries.attachmentIds(applicationId);
  repos.jobApplications.remove(applicationId);
  unlink(dataDir, ids);
}

/**
 * Desclassificação (pedido do dono, 2026-10-29): o e-mail colado vira nota datada (decisão do dono: nota, não campo
 * próprio), a candidatura vai para Encerrado com o motivo `rejected` e a etapa em que parou fica registrada (o nome,
 * para o funil contar mesmo se o pipeline mudar depois). Tudo é conferido antes de gravar.
 */
export function rejectJobApplication(
  repos: Repos,
  dataDir: string,
  applicationId: string,
  input: { occurredOn: string; message: string; stageId: string | null },
  now = new Date(),
): JobApplication {
  const app = repos.jobApplications.get(applicationId);
  if (!app) throw new JobApplicationError("not_found", "Candidatura não encontrada");
  if (app.column === "closed")
    throw new JobApplicationError("already_closed", "A candidatura já está encerrada");
  const message = input.message.trim();
  if (!message) throw new JobApplicationError("entry_empty", "Cole o e-mail ou escreva o motivo");
  const stage = input.stageId === null ? null : app.stages.find((s) => s.id === input.stageId);
  if (stage === undefined)
    throw new JobApplicationError("stage_not_found", "Etapa não encontrada no processo");
  notAfterToday(input.occurredOn, now);
  const entry = addJobApplicationEntry(
    repos,
    dataDir,
    applicationId,
    { occurredOn: input.occurredOn, body: message, files: [] },
    now,
  );
  return repos.jobApplications.update(
    applicationId,
    {
      column: "closed",
      closedReason: "rejected",
      closedStage: stage?.name ?? null,
      closedEntryId: entry.id,
    },
    now,
  );
}
