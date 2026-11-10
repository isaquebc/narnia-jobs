import { type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

/**
 * F13/M5 · relatório da entrevista gravada: uma leitura por anotação, três treinos, ficha de cada pessoa e perguntas e
 * citações em turnos que existem (a checagem por código do app corrige, mas o prompt precisa acertar sozinho).
 */
export function interviewReportChecks(p: EvalParams): EvalResult {
  const out = jsonOf(p.output) as Record<string, unknown> | null;
  if (!out || typeof out !== "object") return result(false, "resposta não é JSON");
  let brief: { events?: Array<{ key: string; type: string }>; persons?: Array<{ key: string }> } =
    {};
  try {
    brief = JSON.parse(String(p.input?.brief_json ?? "{}"));
  } catch {
    // sem o resumo, só as checagens de forma
  }
  const turns = new Set(
    [...String(p.input?.transcript ?? "").matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1])),
  );
  const problems: string[] = [];
  const notes = (out.notes as Array<{ event: string }> | undefined) ?? [];
  const missingNotes = (brief.events ?? [])
    .filter((e) => e.type === "note" && !notes.some((n) => n.event === e.key))
    .map((e) => e.key);
  if (missingNotes.length) problems.push(`anotações sem leitura: ${missingNotes.join(", ")}`);
  const drills = (out.drills as unknown[] | undefined) ?? [];
  if (drills.length !== 3) problems.push(`${drills.length} treinos (esperado: 3)`);
  const people = new Set(
    ((out.people as Array<{ person: string }> | undefined) ?? []).map((x) => x.person),
  );
  const noCard = (brief.persons ?? []).map((x) => x.key).filter((k) => !people.has(k));
  if (noCard.length) problems.push(`sem ficha: ${noCard.join(", ")}`);
  const badTurns: number[] = [];
  for (const key of ["shouldNotHaveSaid", "worked"])
    for (const x of (out[key] as Array<{ turn: number }> | undefined) ?? [])
      if (!turns.has(x.turn)) badTurns.push(x.turn);
  for (const a of (out.answers as
    | Array<{ questionTurn: number; answerTurns: number[] }>
    | undefined) ?? [])
    for (const t of [a.questionTurn, ...(a.answerTurns ?? [])]) if (!turns.has(t)) badTurns.push(t);
  if (turns.size && badTurns.length)
    problems.push(`turnos inexistentes: ${listShort(badTurns.map(String))}`);
  return problems.length
    ? result(false, problems.join("; "), Math.max(0, 1 - problems.length / 4))
    : result(true, "anotações com leitura, 3 treinos, fichas e turnos válidos");
}

/** F13/M5 · quadros: um item por arquivo pedido, com o mesmo nome. */
export function interviewFramesChecks(p: EvalParams): EvalResult {
  const out = jsonOf(p.output) as { frames?: Array<{ file: string }> } | null;
  let asked: Array<{ file: string }> = [];
  try {
    asked = JSON.parse(String(p.input?.frames_json ?? "[]"));
  } catch {
    // sem a lista, nada a comparar
  }
  const got = new Set((out?.frames ?? []).map((f) => f.file));
  const missing = asked.map((f) => f.file).filter((f) => !got.has(f));
  return missing.length
    ? result(
        false,
        `quadros sem descrição: ${listShort(missing)}`,
        1 - missing.length / Math.max(1, asked.length),
      )
    : result(true, `${asked.length} quadros descritos`);
}
