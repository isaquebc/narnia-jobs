import { z } from "zod";

/** F14 · estado da conexão com o Gmail (Configurações). O segredo e o token nunca aparecem aqui. */
export const GmailStatusSchema = z.object({
  status: z.enum(["not_configured", "disconnected", "connected", "needs_reconnect"]),
  email: z.string().nullable(),
  connectedAt: z.string().nullable(),
  clientSource: z.enum(["env", "settings"]).nullable(),
  clientIdHint: z.string().nullable(),
  reason: z.string().nullable(),
  connecting: z.boolean(),
  lastError: z.string().nullable(),
  callbackPort: z.number().int(),
  redirectUri: z.string(),
});
export type GmailStatusView = z.infer<typeof GmailStatusSchema>;

/** A conexão com o Gmail mudou (conectou, falhou, desconectou): Configurações recarrega. */
export const GmailUpdatedEventSchema = z.object({ type: z.literal("gmail.updated") });
