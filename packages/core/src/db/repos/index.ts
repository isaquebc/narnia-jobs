import type { Db } from "../open";
import { type DigestsRepo, digestsRepo } from "./digests";
import { type FactSourcesRepo, factSourcesRepo } from "./fact-sources";
import { type FactsRepo, factsRepo } from "./facts";
import { type IngestionRunsRepo, ingestionRunsRepo } from "./ingestion-runs";
import { type JobsRepo, jobsRepo } from "./jobs";
import { type ProfilesRepo, profilesRepo } from "./profiles";
import { type ProposalsRepo, proposalsRepo } from "./proposals";
import { type ReadingsRepo, readingsRepo } from "./readings";
import { type SalaryReferencesRepo, salaryReferencesRepo } from "./salary-references";
import { type SettingsRepo, settingsRepo } from "./settings";
import { type SourceFilesRepo, sourceFilesRepo } from "./source-files";
import { type UsageEventsRepo, usageEventsRepo } from "./usage-events";
import { type UsersRepo, usersRepo } from "./users";

export interface Repos {
  db: Db;
  settings: SettingsRepo;
  users: UsersRepo;
  profiles: ProfilesRepo;
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
}

/** Repositórios finos em SQL puro sobre uma conexão migrada (decisão F01-2). */
export function createRepos(db: Db): Repos {
  const settings = settingsRepo(db);
  const users = usersRepo(db);
  const facts = factsRepo(db, settings, users);
  const factSources = factSourcesRepo(db);
  const sourceFiles = sourceFilesRepo(db);
  const ingestionRuns = ingestionRunsRepo(db);
  return {
    db,
    settings,
    users,
    profiles: profilesRepo(db),
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
    }),
    jobs: jobsRepo(db),
    usageEvents: usageEventsRepo(db),
    salaryReferences: salaryReferencesRepo(db),
  };
}

export * from "./digests";
export * from "./fact-sources";
export * from "./facts";
export * from "./ingestion-runs";
export * from "./jobs";
export * from "./profiles";
export * from "./proposals";
export * from "./readings";
export * from "./salary-references";
export * from "./settings";
export * from "./source-files";
export * from "./usage-events";
export * from "./users";
