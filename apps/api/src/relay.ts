import { WsEventSchema } from "@narnia-jobs/shared";
import IORedis from "ioredis";
import type { EventBus } from "./events";

/** Mensagens do canal Redis (`<prefix>:ws`) → bus. Valida o formato e descarta duplicatas consecutivas. */
export function createRelayHandler(bus: EventBus): (raw: string) => void {
  let last: string | null = null;
  return (raw) => {
    if (raw === last) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = WsEventSchema.safeParse(parsed);
    if (!result.success) return;
    last = raw;
    bus.emit(result.data);
  };
}

export function startRedisRelay(opts: { redisUrl: string; prefix: string; bus: EventBus }) {
  const sub = new IORedis(opts.redisUrl, { maxRetriesPerRequest: null });
  const handler = createRelayHandler(opts.bus);
  const channel = `${opts.prefix}:ws`;
  void sub.subscribe(channel);
  sub.on("message", (_channel: string, raw: string) => handler(raw));
  return { close: () => sub.quit() };
}
