import { newId } from "../../ids";
import type { Db } from "../open";
import type { Row } from "../sql";

/** Etapa sugerida (ou movida sozinha) por um e-mail de atualização ou convite (F14-2, plano §2.4). */
export interface StageSuggestion {
  id: string;
  mailMessageId: string;
  applicationId: string;
  fromStageId: string | null;
  toStageId: string | null;
  toStageName: string;
  hint: string | null;
  company: string | null;
  platform: string | null;
  /** 0–100 */
  confidence: number;
  mode: "suggested" | "auto";
  decision: "approved" | "rejected" | "undone" | "corrected" | null;
  decidedAt: string | null;
  /** Corrigida à mão: o nome da etapa que a pessoa escolheu. */
  correctedStageName: string | null;
  /** Etapa em que a candidatura ficou (automático ou aprovação). */
  appliedStageId: string | null;
  createdAt: string;
}

export type StageSuggestionCreate = Omit<
  StageSuggestion,
  "id" | "decision" | "decidedAt" | "correctedStageName" | "appliedStageId" | "createdAt"
>;

export interface StageSuggestionsRepo {
  create(input: StageSuggestionCreate, at: string): StageSuggestion;
  get(id: string): StageSuggestion | null;
  /** Abertas (sugestões sem decisão), da mais nova para a mais antiga; de uma candidatura ou de todas. */
  open(applicationId?: string): StageSuggestion[];
  byMail(mailMessageId: string): StageSuggestion[];
  /** Todas de uma candidatura, da mais nova para a mais antiga. */
  forApplication(applicationId: string): StageSuggestion[];
  remove(id: string): void;
  setApplied(id: string, stageId: string | null): void;
  decide(
    id: string,
    decision: NonNullable<StageSuggestion["decision"]>,
    at: string,
    correctedStageName?: string | null,
  ): void;
  /** Decididas (inclusive automáticas sem desfazer, que contam como acerto) com confiança ≥ `minConfidence`. */
  decided(minConfidence: number): StageSuggestion[];
  /** Vocabulário aprendido: decisões aprovadas ou corrigidas desta dica, na empresa ou plataforma. */
  learned(hint: string, company: string | null, platform: string | null): StageSuggestion[];
}

const map = (r: Row): StageSuggestion => ({
  id: String(r.id),
  mailMessageId: String(r.mail_message_id),
  applicationId: String(r.job_application_id),
  fromStageId: r.from_stage_id == null ? null : String(r.from_stage_id),
  toStageId: r.to_stage_id == null ? null : String(r.to_stage_id),
  toStageName: String(r.to_stage_name),
  hint: r.hint == null ? null : String(r.hint),
  company: r.company == null ? null : String(r.company),
  platform: r.platform == null ? null : String(r.platform),
  confidence: Number(r.confidence),
  mode: String(r.mode) as StageSuggestion["mode"],
  decision: r.decision == null ? null : (String(r.decision) as StageSuggestion["decision"]),
  decidedAt: r.decided_at == null ? null : String(r.decided_at),
  correctedStageName: r.corrected_stage_name == null ? null : String(r.corrected_stage_name),
  appliedStageId: r.applied_stage_id == null ? null : String(r.applied_stage_id),
  createdAt: String(r.created_at),
});

export function stageSuggestionsRepo(db: Db): StageSuggestionsRepo {
  const q = (sql: string) => db.prepare(sql);
  const get = (id: string) => {
    const r = q("select * from stage_suggestion where id = ?").get(id) as Row | undefined;
    return r ? map(r) : null;
  };
  return {
    create(i, at) {
      const id = newId();
      q(
        `insert into stage_suggestion (id, mail_message_id, job_application_id, from_stage_id, to_stage_id, to_stage_name,
           hint, company, platform, confidence, mode, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        i.mailMessageId,
        i.applicationId,
        i.fromStageId,
        i.toStageId,
        i.toStageName,
        i.hint,
        i.company,
        i.platform,
        i.confidence,
        i.mode,
        at,
      );
      return get(id) as StageSuggestion;
    },
    get,
    open(applicationId) {
      const rows = applicationId
        ? q(
            "select * from stage_suggestion where decision is null and mode = 'suggested' and job_application_id = ? order by created_at desc",
          ).all(applicationId)
        : q(
            "select * from stage_suggestion where decision is null and mode = 'suggested' order by created_at desc",
          ).all();
      return (rows as Row[]).map(map);
    },
    byMail(mailMessageId) {
      return (
        q("select * from stage_suggestion where mail_message_id = ? order by created_at").all(
          mailMessageId,
        ) as Row[]
      ).map(map);
    },
    forApplication(applicationId) {
      return (
        q(
          "select * from stage_suggestion where job_application_id = ? order by created_at desc, rowid desc",
        ).all(applicationId) as Row[]
      ).map(map);
    },
    setApplied(id, stageId) {
      q("update stage_suggestion set applied_stage_id = ? where id = ?").run(stageId, id);
    },
    remove(id) {
      q("delete from stage_suggestion where id = ?").run(id);
    },
    decide(id, decision, at, correctedStageName = null) {
      q(
        "update stage_suggestion set decision = ?, decided_at = ?, corrected_stage_name = ? where id = ?",
      ).run(decision, at, correctedStageName, id);
    },
    decided(minConfidence) {
      return (
        q(
          `select * from stage_suggestion where confidence >= ? and (decision is not null or mode = 'auto')
             order by created_at desc`,
        ).all(minConfidence) as Row[]
      ).map(map);
    },
    learned(hint, company, platform) {
      return (
        q(
          `select * from stage_suggestion where lower(hint) = lower(?) and decision in ('approved', 'corrected')
             and ((company is not null and lower(company) = lower(?)) or (platform is not null and platform = ?))
             order by decided_at desc`,
        ).all(hint, company ?? "", platform ?? "") as Row[]
      ).map(map);
    },
  };
}
