import { type SalaryReference, SalaryReferenceSchema } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { withTransaction } from "../open";
import type { Row } from "../sql";

export type SalaryReferenceInput = Omit<SalaryReference, "id" | "isCurrent">;

export interface SalaryReferencesRepo {
  current(country: string, indicator?: string): SalaryReference | null;
  /** Insere e torna corrente, desmarcando a anterior do mesmo país + indicador. */
  insert(input: SalaryReferenceInput): SalaryReference;
  list(country: string): SalaryReference[];
}

function map(r: Row): SalaryReference {
  return SalaryReferenceSchema.parse({
    id: r.id,
    country: r.country,
    source: r.source,
    indicator: r.indicator,
    value: r.value,
    currency: r.currency,
    period: r.period,
    referenceMonth: r.reference_month,
    sourceUrl: r.source_url,
    fetchedAt: r.fetched_at,
    isCurrent: r.is_current === 1,
  });
}

export function salaryReferencesRepo(db: Db): SalaryReferencesRepo {
  const current = db.prepare(
    "select * from salary_reference where country = ? and indicator = ? and is_current = 1 order by reference_month desc limit 1",
  );
  const unset = db.prepare(
    "update salary_reference set is_current = 0 where country = ? and indicator = ?",
  );
  const insert = db.prepare(
    `insert into salary_reference (id, country, source, indicator, value, currency, period, reference_month, source_url, fetched_at, is_current)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const get = db.prepare("select * from salary_reference where id = ?");
  const list = db.prepare(
    "select * from salary_reference where country = ? order by reference_month desc, rowid desc",
  );
  return {
    current(country, indicator = "salario_minimo_necessario") {
      const row = current.get(country, indicator) as Row | undefined;
      return row ? map(row) : null;
    },
    insert(input) {
      return withTransaction(db, () => {
        unset.run(input.country, input.indicator);
        const id = newId();
        insert.run(
          id,
          input.country,
          input.source,
          input.indicator,
          input.value,
          input.currency,
          input.period,
          input.referenceMonth,
          input.sourceUrl,
          input.fetchedAt,
        );
        return map(get.get(id) as Row);
      });
    },
    list(country) {
      return (list.all(country) as Row[]).map(map);
    },
  };
}
