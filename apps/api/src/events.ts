import { EventEmitter } from "node:events";
import type { AnyWsEvent } from "@narnia-jobs/shared";

/** Barramento em processo: eventos de jobs (vindos do Redis) e do provider → clientes WebSocket. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  emit(event: AnyWsEvent): void {
    this.emitter.emit("event", event);
  }
  on(listener: (event: AnyWsEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
