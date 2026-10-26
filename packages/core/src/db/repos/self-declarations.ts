import type { SelfDeclarationTopic } from "@narnia-jobs/shared";
import type { Db } from "../open";
import type { Row } from "../sql";

/** Autodeclaração (F12-12, F12-22): fora dos fatos; reaproveitada nos formulários de candidatura. */
export interface SelfDeclarationRecord {
  topic: SelfDeclarationTopic;
  value: string;
  updatedAt: string;
}

export interface SelfDeclarationsRepo {
  get(topic: SelfDeclarationTopic): SelfDeclarationRecord | null;
  list(): SelfDeclarationRecord[];
  set(topic: SelfDeclarationTopic, value: string, now?: Date): void;
  remove(topic: SelfDeclarationTopic): void;
}

const map = (r: Row): SelfDeclarationRecord => ({
  topic: String(r.topic) as SelfDeclarationTopic,
  value: String(r.value),
  updatedAt: String(r.updated_at),
});

export function selfDeclarationsRepo(db: Db): SelfDeclarationsRepo {
  return {
    get(topic) {
      const r = db.prepare("select * from self_declaration where topic = ?").get(topic) as
        | Row
        | undefined;
      return r ? map(r) : null;
    },
    list() {
      return (db.prepare("select * from self_declaration order by topic").all() as Row[]).map(map);
    },
    set(topic, value, now = new Date()) {
      db.prepare(
        `insert into self_declaration (topic, value, updated_at) values (?, ?, ?)
         on conflict (topic) do update set value = excluded.value, updated_at = excluded.updated_at`,
      ).run(topic, value, now.toISOString());
    },
    remove(topic) {
      db.prepare("delete from self_declaration where topic = ?").run(topic);
    },
  };
}
