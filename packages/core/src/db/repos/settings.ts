import type { Db } from "../open";

export interface SettingsRepo {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  getFactsVersion(): number;
  /** ÚNICO ponto que incrementa `facts_version` (F01 §3; usado por F02, F06 e F10). */
  bumpFactsVersion(): number;
}

export function settingsRepo(db: Db): SettingsRepo {
  const getStmt = db.prepare("select value_json from settings where key = ?");
  const setStmt = db.prepare(
    "insert into settings (key, value_json) values (?, ?) on conflict (key) do update set value_json = excluded.value_json",
  );
  const bumpStmt = db.prepare(
    "update settings set value_json = cast(cast(value_json as integer) + 1 as text) where key = 'facts_version' returning value_json",
  );
  return {
    get<T>(key: string) {
      const row = getStmt.get(key) as { value_json: string } | undefined;
      return row ? (JSON.parse(row.value_json) as T) : undefined;
    },
    set(key, value) {
      setStmt.run(key, JSON.stringify(value));
    },
    getFactsVersion() {
      return (this.get<number>("facts_version") ?? 0) as number;
    },
    bumpFactsVersion() {
      const row = bumpStmt.get() as { value_json: string };
      return Number(row.value_json);
    },
  };
}
