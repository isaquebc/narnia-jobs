import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RequestLogEntry {
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  [key: string]: unknown;
}

export type JsonlLogger = (entry: RequestLogEntry) => void;

/** Logs próprios em JSONL diário (UTC) em `<dataDir>/logs/<name>-YYYY-MM-DD.jsonl` (03 §15, fonte 2). */
export function createJsonlLogger(dataDir: string, name: string): JsonlLogger {
  const dir = join(dataDir, "logs");
  return (entry) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, `${name}-${entry.ts.slice(0, 10)}.jsonl`),
      `${JSON.stringify(entry)}\n`,
    );
  };
}
