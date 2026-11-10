import type { Recording, RecordingState } from "@narnia-jobs/shared";
import type { Db } from "../open";
import type { Row } from "../sql";

/** Entrevistas gravadas (F13/M1, migração 0037). Arquivos e regras ficam em `core/src/recordings`. */
export interface RecordingInsert {
  id: string;
  profileId: string;
  jobApplicationId: string | null;
  stageId: string | null;
  title: string | null;
  fileName: string;
  mime: string;
  ext: string;
  size: number;
}

export interface RecordingPatch {
  state?: RecordingState;
  received?: number;
  hasVideo?: boolean;
  durationS?: number | null;
  error?: string | null;
}

export interface RecordingsRepo {
  create(input: RecordingInsert, now?: Date): Recording;
  get(id: string): Recording | null;
  /** Extensão do arquivo final (`video.<ext>`), fora do contrato público. */
  ext(id: string): string | null;
  listByApplication(applicationId: string): Recording[];
  listByProfile(profileId: string): Recording[];
  update(id: string, patch: RecordingPatch, now?: Date): Recording;
  remove(id: string): void;
}

const map = (r: Row): Recording => ({
  id: String(r.id),
  profileId: String(r.profile_id),
  jobApplicationId: r.job_application_id === null ? null : String(r.job_application_id),
  stageId: r.stage_id === null ? null : String(r.stage_id),
  title: r.title === null ? null : String(r.title),
  state: String(r.state) as RecordingState,
  fileName: String(r.file_name),
  mime: String(r.mime),
  size: Number(r.size),
  received: Number(r.received),
  hasVideo: Number(r.has_video) === 1,
  durationS: r.duration_s === null ? null : Number(r.duration_s),
  error: r.error === null ? null : String(r.error),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export function recordingsRepo(db: Db): RecordingsRepo {
  const row = (id: string) =>
    db.prepare("select * from recorded_interview where id = ?").get(id) as Row | undefined;
  const get = (id: string) => {
    const r = row(id);
    return r ? map(r) : null;
  };
  return {
    create(input, now = new Date()) {
      const at = now.toISOString();
      db.prepare(
        `insert into recorded_interview
           (id, profile_id, job_application_id, stage_id, title, state, file_name, mime, ext, size, received, has_video,
            created_at, updated_at)
         values (?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?, 0, 0, ?, ?)`,
      ).run(
        input.id,
        input.profileId,
        input.jobApplicationId,
        input.stageId,
        input.title,
        input.fileName,
        input.mime,
        input.ext,
        input.size,
        at,
        at,
      );
      return get(input.id) as Recording;
    },
    get,
    ext(id) {
      const r = row(id);
      return r ? String(r.ext) : null;
    },
    listByApplication(applicationId) {
      return (
        db
          .prepare(
            "select * from recorded_interview where job_application_id = ? order by created_at desc, id desc",
          )
          .all(applicationId) as Row[]
      ).map(map);
    },
    listByProfile(profileId) {
      return (
        db
          .prepare(
            "select * from recorded_interview where profile_id = ? order by created_at desc, id desc",
          )
          .all(profileId) as Row[]
      ).map(map);
    },
    update(id, patch, now = new Date()) {
      const sets: string[] = [];
      const args: Array<string | number | null> = [];
      const put = (col: string, v: string | number | null) => {
        sets.push(`${col} = ?`);
        args.push(v);
      };
      if (patch.state !== undefined) put("state", patch.state);
      if (patch.received !== undefined) put("received", patch.received);
      if (patch.hasVideo !== undefined) put("has_video", patch.hasVideo ? 1 : 0);
      if (patch.durationS !== undefined) put("duration_s", patch.durationS);
      if (patch.error !== undefined) put("error", patch.error);
      put("updated_at", now.toISOString());
      db.prepare(`update recorded_interview set ${sets.join(", ")} where id = ?`).run(...args, id);
      const r = get(id);
      if (!r) throw new Error(`entrevista ${id} não existe`);
      return r;
    },
    remove(id) {
      db.prepare("delete from recorded_interview where id = ?").run(id);
    },
  };
}
