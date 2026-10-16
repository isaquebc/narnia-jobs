import { readFileSync } from "node:fs";

const PROMPTS_DIR = new URL("./prompts/", import.meta.url);
function loadPrompt(name: string): string {
  return readFileSync(new URL(`${name}.md`, PROMPTS_DIR), "utf8").trim();
}

/** Prompts em Markdown, lidos a cada uso (pacotes exportam fonte TS, decisão F01-28). */
export const PROMPTS = {
  readDocument: () => loadPrompt("read-document"),
  extractFacts: () => loadPrompt("extract-facts"),
  buildDigest: () => loadPrompt("build-digest"),
  analyzeProfiles: () => loadPrompt("analyze-profiles"),
  pickFiles: () => loadPrompt("pick-files"),
  analyzeRepo: () => loadPrompt("analyze-repo"),
  synthesizeRun: () => loadPrompt("synthesize-run"),
  checkProposals: () => loadPrompt("check-proposals"),
  chatTitle: () => loadPrompt("chat-title"),
  postingExtract: () => loadPrompt("posting-extract"),
  postingMerge: () => loadPrompt("posting-merge"),
  postingDuplicate: () => loadPrompt("posting-duplicate"),
  cvGenerate: () => loadPrompt("cv-generate"),
  coverLetterGenerate: () => loadPrompt("cover-letter-generate"),
  cvReview: () => loadPrompt("cv-review"),
};
