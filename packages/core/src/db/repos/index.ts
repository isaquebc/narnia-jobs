import type { Db } from "../open";
import { type DigestsRepo, digestsRepo } from "./digests";
import { type EmphasisRepo, emphasisRepo } from "./emphasis";
import { type FactSourcesRepo, factSourcesRepo } from "./fact-sources";
import { type FactsRepo, factsRepo } from "./facts";
import {
  type GithubMetricsRepo,
  githubMetricsRepo,
  type RepoAnalysesRepo,
  type RepoDigestsRepo,
  type ReposRepo,
  repoAnalysesRepo,
  repoDigestsRepo,
  reposRepo,
} from "./github";
import { type IngestionRunsRepo, ingestionRunsRepo } from "./ingestion-runs";
import { type JobsRepo, jobsRepo } from "./jobs";
import { type NotificationsRepo, notificationsRepo } from "./notifications";
import { type ProfilesRepo, profilesRepo } from "./profiles";
import { type ProposalsRepo, proposalsRepo } from "./proposals";
import { type ReadingsRepo, readingsRepo } from "./readings";
import { type RelevanceRepo, relevanceRepo } from "./relevance";
import { type SalaryReferencesRepo, salaryReferencesRepo } from "./salary-references";
import { type SettingsRepo, settingsRepo } from "./settings";
import { type SnapshotsRepo, snapshotsRepo } from "./snapshots";
import { type SourceFilesRepo, sourceFilesRepo } from "./source-files";
import { type SuggestionsRepo, suggestionsRepo } from "./suggestions";
import { type UsageEventsRepo, usageEventsRepo } from "./usage-events";
import { type UsersRepo, usersRepo } from "./users";

export interface Repos {
  db: Db;
  settings: SettingsRepo;
  users: UsersRepo;
  profiles: ProfilesRepo;
  emphasis: EmphasisRepo;
  relevance: RelevanceRepo;
  suggestions: SuggestionsRepo;
  facts: FactsRepo;
  factSources: FactSourcesRepo;
  sourceFiles: SourceFilesRepo;
  readings: ReadingsRepo;
  digests: DigestsRepo;
  ingestionRuns: IngestionRunsRepo;
  proposals: ProposalsRepo;
  jobs: JobsRepo;
  usageEvents: UsageEventsRepo;
  salaryReferences: SalaryReferencesRepo;
  // F03
  repos: ReposRepo;
  repoAnalyses: RepoAnalysesRepo;
  repoDigests: RepoDigestsRepo;
  githubMetrics: GithubMetricsRepo;
  snapshots: SnapshotsRepo;
  notifications: NotificationsRepo;
}

/** Repositórios finos em SQL puro sobre uma conexão migrada (decisão F01-2). */
export function createRepos(db: Db): Repos {
  const settings = settingsRepo(db);
  const users = usersRepo(db);
  const emphasis = emphasisRepo(db);
  const relevance = relevanceRepo(db);
  // F02 §2.9-5: apagar um fato limpa ênfase e relevância dele em todos os perfis
  const facts = factsRepo(db, settings, users, {
    onRemove: (kind, id) => {
      emphasis.removeFact(kind, id);
      relevance.removeFact(kind, id);
    },
  });
  const factSources = factSourcesRepo(db);
  const sourceFiles = sourceFilesRepo(db);
  const ingestionRuns = ingestionRunsRepo(db);
  const githubRepos = reposRepo(db);
  return {
    db,
    settings,
    users,
    profiles: profilesRepo(db, { emphasis }),
    emphasis,
    relevance,
    suggestions: suggestionsRepo(db, users),
    facts,
    factSources,
    sourceFiles,
    readings: readingsRepo(db),
    digests: digestsRepo(db),
    ingestionRuns,
    proposals: proposalsRepo(db, {
      facts,
      users,
      factSources,
      runs: ingestionRuns,
      files: sourceFiles,
      repos: githubRepos,
    }),
    jobs: jobsRepo(db),
    usageEvents: usageEventsRepo(db),
    salaryReferences: salaryReferencesRepo(db),
    repos: githubRepos,
    repoAnalyses: repoAnalysesRepo(db),
    repoDigests: repoDigestsRepo(db),
    githubMetrics: githubMetricsRepo(db),
    snapshots: snapshotsRepo(db),
    notifications: notificationsRepo(db),
  };
}

export * from "./digests";
export * from "./emphasis";
export * from "./fact-sources";
export * from "./facts";
export * from "./github";
export * from "./ingestion-runs";
export * from "./jobs";
export * from "./notifications";
export * from "./profiles";
export * from "./proposals";
export * from "./readings";
export * from "./relevance";
export * from "./salary-references";
export * from "./settings";
export * from "./snapshots";
export * from "./source-files";
export * from "./suggestions";
export * from "./usage-events";
export * from "./users";
