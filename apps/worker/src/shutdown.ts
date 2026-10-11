/**
 * Desligamento gracioso do worker (plano de comunicação C7): no SIGTERM, `close()` da BullMQ para de pegar jobs e
 * espera o ativo terminar; este limite impede que um job travado segure o encerramento para sempre.
 * Limitação: em dev o `tsx watch` mata o processo 5 s depois de pedir o encerramento, então só a cópia separada da
 * instância do dono (`.owner-src`, atualizada pelo `promote`) evita que uma edição de código interrompa o job dela.
 */
export const WORKER_DRAIN_MS_DEFAULT = 60_000;

export async function drainThenClose(o: {
  close: () => Promise<void>;
  timeoutMs: number;
  log: (line: string) => void;
}): Promise<"drained" | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((res) => {
    timer = setTimeout(() => res("timeout"), o.timeoutMs);
  });
  const result = await Promise.race([o.close().then(() => "drained" as const), timeout]);
  if (timer) clearTimeout(timer);
  if (result === "timeout")
    o.log(`[worker] o job ativo não terminou em ${o.timeoutMs} ms; encerrando assim mesmo`);
  return result;
}
