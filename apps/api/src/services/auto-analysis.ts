import type { Repos } from "@narnia-jobs/core";
import type { EventBus } from "../events";

/**
 * Pré-análise automática do feed (F14-6, F14-7): a tarefa agendada `postings.auto_analyze` (worker) marca as vagas
 * acima do corte, dentro do teto do dia; a análise é uma conversa e só existe no processo do api, então este
 * observador abre uma por vez (a seguinte só quando a anterior gravou a análise ou parou há mais de 30 min). Roda no
 * boot, a cada evento de vaga ou de execução agendada, e de 10 em 10 minutos.
 */
const STALE_MS = 30 * 60_000;

export function watchAutoAnalyses(deps: {
  repos: Repos;
  bus: EventBus;
  openAnalysis: (postingId: string) => unknown;
  intervalMs?: number;
  /** Espera depois do último evento antes de checar (padrão 2 s). */
  debounceMs?: number;
  log?: (m: string) => void;
  now?: () => number;
}): () => void {
  const now = deps.now ?? (() => Date.now());
  const session = (postingId: string) =>
    deps.repos.db
      .prepare(
        "select state, last_activity_at from chat_session where posting_id = ? and category = 'job' order by created_at desc limit 1",
      )
      .get(postingId) as { state: string; last_activity_at: string } | undefined;
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    try {
      // revisão do M4: só as pedidas e ainda sem análise, direto do SQL (sem reler o feed a cada evento)
      const pending = deps.repos.postings.autoAnalysisPending();
      const inFlight = pending.some((p) => {
        const s = session(p.id);
        return s?.state === "live" && now() - Date.parse(s.last_activity_at) < STALE_MS;
      });
      if (inFlight) return;
      const next = pending.find((p) => !session(p.id));
      if (next) deps.openAnalysis(next.id);
    } catch (e) {
      deps.log?.(`[api] pré-análise automática: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  };
  // vários eventos seguidos (uma rodada de extrações) viram uma checagem só
  let debounce: NodeJS.Timeout | null = null;
  const soon = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(tick, deps.debounceMs ?? 2000);
    debounce.unref?.();
  };
  const off = deps.bus.on((e) => {
    if (e.type === "posting.updated" || e.type === "scheduled_run.updated") soon();
  });
  const timer = setInterval(tick, deps.intervalMs ?? 10 * 60_000);
  timer.unref?.();
  tick();
  return () => {
    off();
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
  };
}
