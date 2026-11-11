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

/** F14/M2 · janela da primeira leitura e o que já foi lido (por estado). */
export const MailSettingsSchema = z.object({
  since: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
});
export type MailSettingsView = z.infer<typeof MailSettingsSchema>;

/** F14/M3 · remetente na lista (confiável ou bloqueado) ou sugerido pelo histórico. */
export const MailSenderSchema = z.object({
  value: z.string(),
  override: z.enum(["trusted", "blocked"]).nullable(),
  overrideOrigin: z.enum(["manual", "extension", "review"]).nullable(),
  seenCount: z.number(),
  okCount: z.number(),
  rejectedCount: z.number(),
  lastSeenAt: z.string().nullable(),
});
export type MailSenderView = z.infer<typeof MailSenderSchema>;
export interface MailSendersView {
  trusted: MailSenderView[];
  blocked: MailSenderView[];
  suggestions: MailSenderView[];
}

/** A conexão com o Gmail mudou (conectou, falhou, desconectou): Configurações recarrega. */
export const GmailUpdatedEventSchema = z.object({ type: z.literal("gmail.updated") });
