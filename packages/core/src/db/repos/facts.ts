import {
  type AchievementDataSchema,
  type EducationDataSchema,
  type EmphasisFactKind,
  type ExperienceDataSchema,
  type LanguageDataSchema,
  nowUtc,
  type ProjectDataSchema,
  type SkillDataSchema,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import { newId } from "../../ids";
import type { Db } from "../open";
import { bool, json, num, omit, type Row, str } from "../sql";
import type { SettingsRepo } from "./settings";
import type { UsersRepo } from "./users";

/** Metadados comuns a todo fato (F01 §3 / 04 §D): fonte, confiança e verificação pelo usuário. */
export interface FactMeta {
  sourceId?: string | null;
  confidence: number;
  verified: boolean;
}
interface FactRecordMeta {
  id: string;
  sourceId: string | null;
  confidence: number;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExperienceData = z.infer<typeof ExperienceDataSchema>;
export type AchievementInput = Omit<z.infer<typeof AchievementDataSchema>, "experienceIndex"> & {
  experienceId: string;
};
export type EducationData = z.infer<typeof EducationDataSchema>;
export type SkillData = z.infer<typeof SkillDataSchema>;
export type LanguageData = z.infer<typeof LanguageDataSchema>;
export type ProjectData = z.infer<typeof ProjectDataSchema>;

export type ExperienceRecord = ExperienceData & FactRecordMeta;
export type AchievementRecord = AchievementInput & FactRecordMeta;
export type EducationRecord = EducationData & FactRecordMeta;
export type SkillRecord = SkillData & FactRecordMeta & { nameNormalized: string };
export type LanguageRecord = LanguageData & FactRecordMeta;
/** F03: projeto pode vir de um repositório do GitHub. */
export type ProjectInput = ProjectData & { repoId?: string | null };
export type ProjectRecord = ProjectInput & FactRecordMeta;

/** Hooks de escrita (F02 §2.9-5): `onRemove` limpa ênfase e relevância do fato apagado. */
export interface FactsHooks {
  onRemove?: (kind: EmphasisFactKind, id: string) => void;
}

interface BaseRepo<I, R> {
  insert(input: I & FactMeta): R;
  get(id: string): R | null;
  list(): R[];
  update(id: string, patch: Partial<I & FactMeta>): R;
  remove(id: string): void;
  count(): number;
}

export interface FactsRepo {
  experiences: BaseRepo<ExperienceData, ExperienceRecord>;
  achievements: BaseRepo<AchievementInput, AchievementRecord> & {
    listByExperience(experienceId: string): AchievementRecord[];
  };
  education: BaseRepo<EducationData, EducationRecord>;
  skills: BaseRepo<SkillData, SkillRecord>;
  languages: BaseRepo<LanguageData, LanguageRecord>;
  /** F02-9: tabela nasce vazia; F03 preenche pelo GitHub. */
  projects: BaseRepo<ProjectInput, ProjectRecord>;
  counts(): {
    experiences: number;
    achievements: number;
    education: number;
    skills: number;
    languages: number;
    projects: number;
  };
}

export function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function meta(r: Row): FactRecordMeta {
  return {
    id: String(r.id),
    sourceId: str(r.source_id),
    confidence: Number(r.confidence),
    verified: bool(r.verified),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Fábrica genérica: tabela, colunas e mapeamentos; toda escrita incrementa `facts_version`. */
function makeRepo<I extends object, R extends FactRecordMeta>(
  db: Db,
  settings: SettingsRepo,
  table: EmphasisFactKind,
  columns: string[],
  toRow: (input: I & FactMeta, ctx: { userId: string }) => Record<string, unknown>,
  fromRow: (r: Row) => R,
  userId: () => string,
  extraOrder = "created_at, rowid",
  hooks: FactsHooks = {},
): BaseRepo<I, R> {
  const allCols = [
    "id",
    ...columns,
    "source_id",
    "confidence",
    "verified",
    "created_at",
    "updated_at",
  ];
  const insert = db.prepare(
    `insert into ${table} (${allCols.join(", ")}) values (${allCols.map((c) => `@${c}`).join(", ")})`,
  );
  const update = db.prepare(
    `update ${table} set ${[...columns, "source_id", "confidence", "verified", "updated_at"]
      .map((c) => `${c} = @${c}`)
      .join(", ")} where id = @id`,
  );
  const getStmt = db.prepare(`select * from ${table} where id = ?`);
  const listStmt = db.prepare(`select * from ${table} order by ${extraOrder}`);
  const delStmt = db.prepare(`delete from ${table} where id = ?`);
  const countStmt = db.prepare(`select count(*) as n from ${table}`);

  function params(input: I & FactMeta, id: string, createdAt: string, updatedAt: string) {
    return {
      id,
      ...toRow(input, { userId: userId() }),
      source_id: input.sourceId ?? null,
      confidence: input.confidence,
      verified: input.verified ? 1 : 0,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  const repo: BaseRepo<I, R> = {
    insert(input) {
      const now = nowUtc();
      const id = newId();
      insert.run(params(input, id, now, now));
      settings.bumpFactsVersion();
      return repo.get(id) as R;
    },
    get(id) {
      const row = getStmt.get(id) as Row | undefined;
      return row ? fromRow(row) : null;
    },
    list() {
      return (listStmt.all() as Row[]).map(fromRow);
    },
    update(id, patch) {
      const current = repo.get(id);
      if (!current) throw new Error(`${table} não encontrado: ${id}`);
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const { id: _id, createdAt, updatedAt: _u, ...rest } = current;
      const merged = { ...rest, ...defined } as unknown as I & FactMeta;
      update.run(omit(params(merged, id, createdAt, nowUtc()), ["created_at"]));
      settings.bumpFactsVersion();
      return repo.get(id) as R;
    },
    remove(id) {
      delStmt.run(id);
      hooks.onRemove?.(table, id);
      settings.bumpFactsVersion();
    },
    count() {
      return (countStmt.get() as { n: number }).n;
    },
  };
  return repo;
}

export function factsRepo(
  db: Db,
  settings: SettingsRepo,
  users: UsersRepo,
  hooks: FactsHooks = {},
): FactsRepo {
  const uid = () => users.ensureId();

  const experiences = makeRepo<ExperienceData, ExperienceRecord>(
    db,
    settings,
    "experience",
    [
      "user_id",
      "company",
      "title",
      "employment_type",
      "start_date",
      "end_date",
      "is_current",
      "location",
      "summary",
      "tech_json",
    ],
    (i, ctx) => ({
      user_id: ctx.userId,
      company: i.company,
      title: i.title,
      employment_type: i.employmentType ?? null,
      start_date: i.startDate,
      end_date: i.endDate ?? null,
      is_current: i.isCurrent ? 1 : 0,
      location: i.location ?? null,
      summary: i.summary ?? null,
      tech_json: JSON.stringify(i.tech ?? []),
    }),
    (r) => ({
      ...meta(r),
      company: String(r.company),
      title: String(r.title),
      ...(str(r.employment_type)
        ? { employmentType: str(r.employment_type) as ExperienceData["employmentType"] }
        : {}),
      startDate: String(r.start_date),
      ...(str(r.end_date) ? { endDate: String(r.end_date) } : {}),
      isCurrent: bool(r.is_current),
      ...(str(r.location) ? { location: String(r.location) } : {}),
      ...(str(r.summary) ? { summary: String(r.summary) } : {}),
      tech: json<string[]>(r.tech_json, []),
    }),
    uid,
    "start_date desc, rowid",
    hooks,
  );

  const achievementsBase = makeRepo<AchievementInput, AchievementRecord>(
    db,
    settings,
    "achievement",
    ["experience_id", "text", "metric"],
    (i) => ({ experience_id: i.experienceId, text: i.text, metric: i.metric ?? null }),
    (r) => ({
      ...meta(r),
      experienceId: String(r.experience_id),
      text: String(r.text),
      ...(str(r.metric) ? { metric: String(r.metric) } : {}),
    }),
    uid,
    undefined,
    hooks,
  );
  const byExp = db.prepare(
    "select * from achievement where experience_id = ? order by created_at, rowid",
  );

  const education = makeRepo<EducationData, EducationRecord>(
    db,
    settings,
    "education",
    ["user_id", "institution", "course", "degree", "start_date", "end_date", "status"],
    (i, ctx) => ({
      user_id: ctx.userId,
      institution: i.institution,
      course: i.course,
      degree: i.degree ?? null,
      start_date: i.startDate ?? null,
      end_date: i.endDate ?? null,
      status: i.status,
    }),
    (r) => ({
      ...meta(r),
      institution: String(r.institution),
      course: String(r.course),
      ...(str(r.degree) ? { degree: String(r.degree) } : {}),
      ...(str(r.start_date) ? { startDate: String(r.start_date) } : {}),
      ...(str(r.end_date) ? { endDate: String(r.end_date) } : {}),
      status: String(r.status) as EducationData["status"],
    }),
    uid,
    undefined,
    hooks,
  );

  const skills = makeRepo<SkillData, SkillRecord>(
    db,
    settings,
    "skill",
    ["user_id", "name", "name_normalized", "category", "level"],
    (i, ctx) => ({
      user_id: ctx.userId,
      name: i.name.trim(),
      name_normalized: normalizeSkillName(i.name),
      category: i.category,
      level: i.level ?? null,
    }),
    (r) => ({
      ...meta(r),
      name: String(r.name),
      nameNormalized: String(r.name_normalized),
      category: String(r.category) as SkillData["category"],
      ...(num(r.level) !== null ? { level: num(r.level) as number } : {}),
    }),
    uid,
    "name_normalized, rowid",
    hooks,
  );

  const languages = makeRepo<LanguageData, LanguageRecord>(
    db,
    settings,
    "language",
    ["user_id", "name", "level"],
    (i, ctx) => ({ user_id: ctx.userId, name: i.name, level: i.level }),
    (r) => ({ ...meta(r), name: String(r.name), level: String(r.level) as LanguageData["level"] }),
    uid,
    undefined,
    hooks,
  );

  const projects = makeRepo<ProjectInput, ProjectRecord>(
    db,
    settings,
    "project",
    [
      "user_id",
      "name",
      "description",
      "url",
      "role",
      "start_date",
      "end_date",
      "tech_json",
      "repo_id",
    ],
    (i, ctx) => ({
      user_id: ctx.userId,
      name: i.name,
      description: i.description ?? null,
      url: i.url ?? null,
      role: i.role ?? null,
      start_date: i.startDate ?? null,
      end_date: i.endDate ?? null,
      tech_json: JSON.stringify(i.tech ?? []),
      repo_id: i.repoId ?? null,
    }),
    (r) => ({
      ...meta(r),
      name: String(r.name),
      ...(str(r.description) ? { description: String(r.description) } : {}),
      ...(str(r.url) ? { url: String(r.url) } : {}),
      ...(str(r.role) ? { role: String(r.role) } : {}),
      ...(str(r.start_date) ? { startDate: String(r.start_date) } : {}),
      ...(str(r.end_date) ? { endDate: String(r.end_date) } : {}),
      tech: json<string[]>(r.tech_json, []),
      repoId: str(r.repo_id),
    }),
    uid,
    undefined,
    hooks,
  );

  return {
    experiences,
    achievements: {
      ...achievementsBase,
      listByExperience(experienceId) {
        return (byExp.all(experienceId) as Row[]).map(
          (r) => achievementsBase.get(String(r.id)) as AchievementRecord,
        );
      },
    },
    education,
    skills,
    languages,
    projects,
    counts() {
      return {
        experiences: experiences.count(),
        achievements: achievementsBase.count(),
        education: education.count(),
        skills: skills.count(),
        languages: languages.count(),
        projects: projects.count(),
      };
    },
  };
}
