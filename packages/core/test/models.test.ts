import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../src/db";
import {
  DEFAULT_EXTRACTION_MODELS,
  localeFromLanguage,
  resolveExtractionModels,
} from "../src/models";

describe("M4/core modelos por tarefa (settings.models.extraction) e locale", () => {
  it("padrões haiku/haiku/sonnet (decisão F01-5) e override parcial vindo de settings", () => {
    const repos = createRepos(
      (() => {
        const db = openDatabase(":memory:");
        migrate(db);
        return db;
      })(),
    );
    expect(resolveExtractionModels(repos.settings)).toEqual(DEFAULT_EXTRACTION_MODELS);
    expect(DEFAULT_EXTRACTION_MODELS).toEqual({
      document: "haiku",
      facts: "haiku",
      digest: "sonnet",
    });
    repos.settings.set("models", { extraction: { facts: "sonnet" } });
    expect(resolveExtractionModels(repos.settings)).toEqual({
      document: "haiku",
      facts: "sonnet",
      digest: "sonnet",
    });
  });

  it("localeFromLanguage mapeia pt→pt-BR, en→en-US, unknown→pt-BR", () => {
    expect(localeFromLanguage("pt")).toBe("pt-BR");
    expect(localeFromLanguage("en")).toBe("en-US");
    expect(localeFromLanguage("unknown")).toBe("pt-BR");
  });
});
