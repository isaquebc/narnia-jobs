import { join } from "node:path";
import {
  conceptEmbedder,
  createSemanticSearch,
  type Embedder,
  factIndexOverflow,
  type Repos,
  type SemanticSearchPort,
  syncFactVectors,
  transformersEmbedder,
} from "@narnia-jobs/core";
import type { Notification } from "@narnia-jobs/shared";

/**
 * Busca por sentido (F04-fix-fundamentacao, R6, FF-5, FF-7): opcional, ligada em Configurações. Ligar baixa o modelo
 * para `<dados>/models/` (só na primeira vez), carrega e vetoriza os fatos em segundo plano; a `fact_search` só usa a
 * busca por sentido com o status `ready`. O alerta aparece quando o índice no contexto do recrutador corta fatos e a
 * busca está desligada. Só o api carrega o modelo (é onde a `fact_search` roda, nos modos A e B).
 */
export const SEMANTIC_KEY = "search.semantic";

export type SemanticStatus = "off" | "loading" | "indexing" | "ready" | "error";

export interface SemanticView {
  enabled: boolean;
  status: SemanticStatus;
  /** Download do modelo (0 a 1), durante `loading`. */
  progress: number | null;
  error: string | null;
  model: string;
  /** Fatos que não cabem no índice do contexto. */
  cutFacts: number;
  alert: boolean;
  vectors: number;
}

/** Conceitos do vetorizador do mock (testes e e2e): nada é baixado. */
const MOCK_CONCEPTS = [
  ["fintech", "pagamentos", "banco digital", "meios de pagamento"],
  ["faculdade", "graduação", "ciência da computação", "bacharelado", "universidade"],
  ["monitoramento", "observabilidade", "métricas", "alertas"],
  ["banco de dados", "postgresql", "sqlite", "mysql", "sql"],
];

export type EmbedderFactory = (o?: {
  onProgress?: (fraction: number) => void;
}) => Embedder & { load?: () => Promise<void> };

export function defaultEmbedderFactory(o: { dataDir: string; mock: boolean }): EmbedderFactory {
  if (o.mock || process.env.NARNIA_EMBEDDER === "concepts")
    return () => conceptEmbedder(MOCK_CONCEPTS);
  return (f) =>
    transformersEmbedder({
      cacheDir: join(o.dataDir, "models"),
      ...(f?.onProgress ? { onProgress: f.onProgress } : {}),
    });
}

export class SemanticSearchService {
  private status: SemanticStatus = "off";
  private progress: number | null = null;
  private error: string | null = null;
  private port: SemanticSearchPort | null = null;
  private run = 0;
  private embedder: (Embedder & { load?: () => Promise<void> }) | null = null;

  constructor(
    private readonly deps: {
      repos: Repos;
      factory: EmbedderFactory;
      log?: (msg: string) => void;
      /** Retransmite a notificação do alerta (WS). */
      emit?: (ev: { notification: Notification; created: boolean }) => void;
    },
  ) {}

  /**
   * Alerta do limite (FF-7): pendência aberta enquanto o índice corta fatos e a busca está desligada; resolvida quando
   * deixa de cortar ou a busca é ligada. Conferido no boot, ao ler o estado e quando os fatos mudam.
   */
  syncAlert(): void {
    const { repos } = this.deps;
    const cut = factIndexOverflow(repos);
    if (!this.enabled() && cut > 0) {
      const ev = repos.notifications.upsert({
        kind: "search.index_full",
        subjectKind: "search",
        subjectId: "semantic",
        severity: "info",
        title: "Seus fatos não cabem mais no contexto do recrutador",
        body: `${cut} fatos ficam só na busca por termos. Ligue a busca por sentido para o recrutador achá-los pelo assunto.`,
        actionUrl: "/configuracoes#busca-por-sentido",
      });
      if (ev.created) this.deps.emit?.(ev);
      return;
    }
    for (const n of repos.notifications.resolveSubject("search", "semantic", ["search.index_full"]))
      this.deps.emit?.({ notification: n, created: false });
  }

  enabled(): boolean {
    return this.deps.repos.settings.get<{ enabled?: boolean }>(SEMANTIC_KEY)?.enabled === true;
  }

  /** No boot: se estava ligada, carrega de novo em segundo plano. */
  boot(): void {
    this.syncAlert();
    if (this.enabled()) void this.start();
  }

  /** Porta da `fact_search`; `null` enquanto não estiver pronta. */
  search(): SemanticSearchPort | null {
    return this.status === "ready" ? this.port : null;
  }

  async setEnabled(on: boolean): Promise<void> {
    this.deps.repos.settings.set(SEMANTIC_KEY, { enabled: on });
    this.syncAlert();
    if (on) {
      if (this.status === "off" || this.status === "error") void this.start();
      return;
    }
    this.run++;
    this.port = null;
    this.embedder = null;
    this.status = "off";
    this.progress = null;
    this.error = null;
    this.deps.repos.db.prepare("delete from fact_vector").run();
  }

  view(): SemanticView {
    this.syncAlert();
    const enabled = this.enabled();
    const cutFacts = factIndexOverflow(this.deps.repos);
    const vectors = (
      this.deps.repos.db.prepare("select count(*) as n from fact_vector").get() as { n: number }
    ).n;
    return {
      enabled,
      status: this.status,
      progress: this.progress,
      error: this.error,
      model: this.embedder?.model ?? this.deps.factory().model,
      cutFacts,
      alert: !enabled && cutFacts > 0,
      vectors,
    };
  }

  private async start(): Promise<void> {
    const run = ++this.run;
    const embedder = this.deps.factory({
      onProgress: (p) => {
        if (run === this.run) this.progress = p;
      },
    });
    this.embedder = embedder;
    this.status = "loading";
    this.error = null;
    this.progress = null;
    try {
      await embedder.load?.();
      if (run !== this.run) return;
      this.status = "indexing";
      const r = await syncFactVectors(this.deps.repos, embedder);
      if (run !== this.run) return;
      this.port = createSemanticSearch(this.deps.repos, embedder);
      this.status = "ready";
      this.deps.log?.(`busca por sentido pronta (${embedder.model}; ${r.added} vetores novos)`);
    } catch (e) {
      if (run !== this.run) return;
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
      this.deps.log?.(`busca por sentido falhou: ${this.error}`);
    }
  }
}
