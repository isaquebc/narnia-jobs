import { z } from "zod";

/**
 * F13 · análise de entrevista gravada. Serviço `media` (Python, perfil Docker opcional): estado visto pelo api, para a
 * tela de Configurações e para recusar envios quando ele não está pronto (plans/plan-v0/tasks/F13 §6.1.1, R2 e R4).
 *
 * - `off`: sem `NARNIA_MEDIA_URL` ou o serviço não responde (perfil desligado); a tela mostra como ligar.
 * - `needs_token`: no ar, sem token do Hugging Face (a separação de vozes precisa dele, F13-5).
 * - `ready`: no ar e com token.
 * O token nunca aparece aqui: só se está configurado.
 */
export const MediaStateSchema = z.enum(["off", "needs_token", "ready"]);
export type MediaState = z.infer<typeof MediaStateSchema>;

export const MediaStatusSchema = z.object({
  state: MediaStateSchema,
  /** Comando que liga o serviço (no computador, fora do app). */
  enableCommand: z.string(),
  version: z.string().nullable(),
  busy: z.boolean(),
  steps: z.array(z.string()),
});
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const MediaTokenRequestSchema = z.object({ token: z.string().min(1).max(300) });
export type MediaTokenRequest = z.infer<typeof MediaTokenRequestSchema>;
