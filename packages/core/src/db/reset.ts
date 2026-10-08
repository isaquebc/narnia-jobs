import type { Db } from "./open";

/** Tabelas que sobrevivem ao reset: histórico de migrations e referências salariais semeadas. */
const KEEP = new Set(["schema_migrations", "salary_reference", "settings"]);

export interface ResetResult {
  tables: string[];
}

/**
 * Apaga todos os dados do usuário (M7, só para testes e2e com provider mock): todas as tabelas exceto as de `KEEP`,
 * zera `facts_version` e remove as demais chaves de `settings` (onboarding, modelos). Nunca exposto fora do mock.
 */
export function resetDatabase(db: Db): ResetResult {
  const tables = (
    db
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map((r) => r.name)
    .filter((name) => !KEEP.has(name));
  db.exec("pragma foreign_keys = off");
  db.exec("begin immediate");
  try {
    for (const name of tables) db.exec(`delete from "${name}"`);
    db.exec("delete from settings where key <> 'facts_version'");
    db.exec("update settings set value_json = '0' where key = 'facts_version'");
    db.exec("commit");
  } catch (e) {
    db.exec("rollback");
    throw e;
  } finally {
    db.exec("pragma foreign_keys = on");
  }
  return { tables };
}
