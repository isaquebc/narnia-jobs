import type { Db } from "../open";
import { type ApplicationsRepo, applicationsRepo } from "./applications";
import {
  type ChatMessagesRepo,
  type ChatSessionsRepo,
  chatMessagesRepo,
  chatSessionsRepo,
  type FactSearchRepo,
  factSearchRepo,
  type ResearchSourcesRepo,
  researchSourcesRepo,
  type TrustedDomainsRepo,
  trustedDomainsRepo,
} from "./chat";
import { type DigestsRepo, digestsRepo } from "./digests";
import {
  type CvTemplatesRepo,
  cvTemplatesRepo,
  type DocumentsRepo,
  documentsRepo,
} from "./documents";
import { type EmphasisRepo, emphasisRepo } from "./emphasis";
import { type ExtensionRepo, extensionRepo } from "./extension";
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
import {
  type JobAnalysesRepo,
  jobAnalysesRepo,
  type PostingContactsRepo,
  type PostingNotesRepo,
  type PostingsRepo,
  postingContactsRepo,
  postingNotesRepo,
  postingsRepo,
} from "./postings";
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
  // F04
  chatSessions: ChatSessionsRepo;
  chatMessages: ChatMessagesRepo;
  researchSources: ResearchSourcesRepo;
  trustedDomains: TrustedDomainsRepo;
  factSearch: FactSearchRepo;
  // F06
  postings: PostingsRepo;
  postingContacts: PostingContactsRepo;
  postingNotes: PostingNotesRepo;
  jobAnalyses: JobAnalysesRepo;
  // F05
  documents: DocumentsRepo;
  cvTemplates: CvTemplatesRepo;
  // F12
  extension: ExtensionRepo;
  applications: ApplicationsRepo;
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
    chatSessions: chatSessionsRepo(db),
    chatMessages: chatMessagesRepo(db),
    researchSources: researchSourcesRepo(db),
    trustedDomains: trustedDomainsRepo(db),
    factSearch: factSearchRepo(db),
    postings: postingsRepo(db),
    postingContacts: postingContactsRepo(db),
    postingNotes: postingNotesRepo(db),
    jobAnalyses: jobAnalysesRepo(db),
    documents: documentsRepo(db),
    cvTemplates: cvTemplatesRepo(db),
    extension: extensionRepo(db),
    applications: applicationsRepo(db),
  };
}

export * from "./applications";
export * from "./chat";
export * from "./digests";
export * from "./documents";
export * from "./emphasis";
export * from "./extension";
export * from "./fact-sources";
export * from "./facts";
export * from "./github";
export * from "./ingestion-runs";
export * from "./jobs";
export * from "./notifications";
export * from "./postings";
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
