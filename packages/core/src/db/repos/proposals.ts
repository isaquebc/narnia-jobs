import {
  type FactKind,
  type FactProposal,
  FactProposalSchema,
  type Link,
  nowUtc,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { withTransaction } from "../open";
import { json, type Row, str } from "../sql";
import type { FactSourceKind, FactSourcesRepo } from "./fact-sources";
import type { FactsRepo } from "./facts";
import type { IngestionRunsRepo } from "./ingestion-runs";
import type { SourceFilesRepo } from "./source-files";
import type { UserPatch, UsersRepo } from "./users";

export type ProposalDecision = "pending" | "accepted" | "edited" | "rejected" | "skipped";

export interface ProposalRecord {
  id: string;
  runId: string;
  index: number;
  kind: FactKind;
  proposal: FactProposal;
  decision: ProposalDecision;
  editedData: Record<string, unknown> | null;
  targetId: string | null;
  decidedAt: string | null;
}

export interface ReviewDecision {
  proposalId: string;
  decision: "accept" | "edit" | "reject";
  /** Campos editados pelo usuário (merge sobre `proposal.data`); obrigatório para `edit`. */
  editedData?: Record<string, unknown>;
}

export interface ReviewResult {
  accepted: number;
  edited: number;
  rejected: number;
  /** Conquistas cuja experiência não foi aceita; nada é criado. */
  skipped: number;
  sourceId: string | null;
}

export class ProposalReviewError extends Error {
  readonly code: "unknown_proposal" | "foreign_proposal" | "missing_edit";
  constructor(code: ProposalReviewError["code"], message: string) {
    super(message);
    this.name = "ProposalReviewError";
    this.code = code;
  }
}

export interface ProposalsRepo {
  insertMany(runId: string, proposals: FactProposal[]): string[];
  listByRun(runId: string): ProposalRecord[];
  /**
   * Aplica as decisões da tela de revisão (F01 §2.5): aceitar/editar cria fatos `verified = 1` com `fact_source`;
   * identidade atualiza o usuário único; conquistas resolvem `experienceIndex` para a experiência aceita no mesmo run.
   * Propostas já decididas são ignoradas (idempotente). Lança `ProposalReviewError` para proposta de outro run.
   */
  review(runId: string, decisions: ReviewDecision[]): ReviewResult;
}

function map(r: Row): ProposalRecord {
  const payload = json<FactProposal>(r.payload_json, {} as FactProposal);
  return {
    id: String(r.id),
    runId: String(r.run_id),
    index: Number(r.idx),
    kind: String(r.kind) as FactKind,
    proposal: payload,
    decision: String(r.decision) as ProposalDecision,
    editedData: json<Record<string, unknown> | null>(r.edited_payload_json, null),
    targetId: str(r.target_id),
    decidedAt: str(r.decided_at),
  };
}

interface Deps {
  facts: FactsRepo;
  users: UsersRepo;
  factSources: FactSourcesRepo;
  runs: IngestionRunsRepo;
  files: SourceFilesRepo;
}

export function proposalsRepo(db: Db, deps: Deps): ProposalsRepo {
  const insert = db.prepare(
    "insert into ingestion_proposal (id, run_id, idx, kind, payload_json, confidence) values (?, ?, ?, ?, ?, ?)",
  );
  const byRun = db.prepare("select * from ingestion_proposal where run_id = ? order by idx");
  const decide = db.prepare(
    "update ingestion_proposal set decision = ?, edited_payload_json = ?, target_id = ?, decided_at = ? where id = ?",
  );

  return {
    insertMany(runId, proposals) {
      return withTransaction(db, () => {
        const ids: string[] = [];
        proposals.forEach((p, idx) => {
          const id = newId();
          insert.run(id, runId, idx, p.kind, JSON.stringify(p), p.confidence);
          ids.push(id);
        });
        return ids;
      });
    },
    listByRun(runId) {
      return (byRun.all(runId) as Row[]).map(map);
    },
    review(runId, decisions) {
      return withTransaction(db, () => {
        const all = (byRun.all(runId) as Row[]).map(map);
        const byId = new Map(all.map((p) => [p.id, p]));
        const wanted = new Map<string, ReviewDecision>();
        for (const d of decisions) {
          const p = byId.get(d.proposalId);
          if (!p) {
            // existe em outro run? então é "foreign"; senão, desconhecida
            const exists = db
              .prepare("select run_id from ingestion_proposal where id = ?")
              .get(d.proposalId) as { run_id: string } | undefined;
            throw new ProposalReviewError(
              exists ? "foreign_proposal" : "unknown_proposal",
              exists
                ? `Proposta ${d.proposalId} pertence a outro run (${exists.run_id})`
                : `Proposta desconhecida: ${d.proposalId}`,
            );
          }
          if (d.decision === "edit" && !d.editedData) {
            throw new ProposalReviewError("missing_edit", `Edição sem dados: ${d.proposalId}`);
          }
          wanted.set(d.proposalId, d);
        }

        const run = deps.runs.get(runId);
        const file = run ? deps.files.get(run.fileId) : null;
        const result: ReviewResult = {
          accepted: 0,
          edited: 0,
          rejected: 0,
          skipped: 0,
          sourceId: null,
        };
        const ensureSource = () => {
          if (!result.sourceId) {
            const kind: FactSourceKind = file?.kind === "text" ? "text" : "cv";
            result.sourceId = deps.factSources.create({ kind, fileId: file?.id ?? null, runId }).id;
          }
          return result.sourceId;
        };
        const now = nowUtc();

        // experienceIndex → id da experiência aceita (deste review ou de um anterior)
        const experienceIds = new Map<number, string>();
        let ordinal = 0;
        const expOrdinal = new Map<string, number>();
        for (const p of all) {
          if (p.kind === "experience") {
            expOrdinal.set(p.id, ordinal);
            if (p.targetId) experienceIds.set(ordinal, p.targetId);
            ordinal++;
          }
        }

        const apply = (p: ProposalRecord, d: ReviewDecision) => {
          if (p.decision !== "pending") return; // idempotente: já decidida
          if (d.decision === "reject") {
            decide.run("rejected", null, null, now, p.id);
            result.rejected++;
            return;
          }
          const data =
            d.decision === "edit"
              ? { ...(p.proposal.data as object), ...d.editedData }
              : p.proposal.data;
          const valid = FactProposalSchema.parse({
            kind: p.kind,
            confidence: p.proposal.confidence,
            data,
          });
          const meta = { sourceId: ensureSource(), confidence: valid.confidence, verified: true };
          let targetId: string | null = null;
          switch (valid.kind) {
            case "identity": {
              const { links, phoneRaw: _phoneRaw, ...rest } = valid.data;
              const patch = Object.fromEntries(
                Object.entries(rest).filter(([, v]) => v !== undefined),
              ) as UserPatch;
              const u = deps.users.upsert(patch);
              if (links?.length) deps.users.appendLinks(links);
              targetId = u.id;
              break;
            }
            case "experience": {
              const rec = deps.facts.experiences.insert({ ...valid.data, ...meta });
              targetId = rec.id;
              experienceIds.set(expOrdinal.get(p.id) as number, rec.id);
              break;
            }
            case "achievement": {
              const expId = experienceIds.get(valid.data.experienceIndex);
              if (!expId) {
                decide.run("skipped", null, null, now, p.id);
                result.skipped++;
                return;
              }
              const { experienceIndex: _i, ...rest } = valid.data;
              targetId = deps.facts.achievements.insert({
                ...rest,
                experienceId: expId,
                ...meta,
              }).id;
              break;
            }
            case "education":
              targetId = deps.facts.education.insert({ ...valid.data, ...meta }).id;
              break;
            case "skill":
              targetId = deps.facts.skills.insert({ ...valid.data, ...meta }).id;
              break;
            case "language":
              targetId = deps.facts.languages.insert({ ...valid.data, ...meta }).id;
              break;
            case "link": {
              const u = deps.users.appendLinks([valid.data as Link]);
              targetId = u.id;
              break;
            }
          }
          const decision: ProposalDecision = d.decision === "edit" ? "edited" : "accepted";
          decide.run(
            decision,
            d.decision === "edit" ? JSON.stringify(d.editedData) : null,
            targetId,
            now,
            p.id,
          );
          if (decision === "edited") result.edited++;
          else result.accepted++;
        };

        // ordem: tudo que não é conquista primeiro (experiências precisam existir), conquistas depois
        const ordered = [...all].sort(
          (a, b) =>
            (a.kind === "achievement" ? 1 : 0) - (b.kind === "achievement" ? 1 : 0) ||
            a.index - b.index,
        );
        for (const p of ordered) {
          const d = wanted.get(p.id);
          if (d) apply(p, d);
        }
        return result;
      });
    },
  };
}
