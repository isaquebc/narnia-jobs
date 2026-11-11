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

/**
 * F14/M4 · classificação e extração de um e-mail de vagas pelo modelo (`narnia-mail-classify`, Haiku, sem tools). Um
 * prompt só para todas as classes (alerta, candidatura recebida, negativa, atualização, convite, contato de
 * recrutador); o código decide o que fazer com cada uma. Datas e horários só quando estão escritos no e-mail.
 */
export const MAIL_CLASSES = [
  "job_alert",
  "application_received",
  "rejection",
  "update",
  "interview_invite",
  "recruiter_contact",
  "not_job",
] as const;
export const MailClassSchema = z.enum(MAIL_CLASSES);
export type MailClass = z.infer<typeof MailClassSchema>;

export const MailJobSchema = z.object({
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
});

export const MailClassifyOutputSchema = z.object({
  class: MailClassSchema,
  /** 0 a 100: o quanto o e-mail deixa a classe clara. */
  confidence: z.number().int().min(0).max(100),
  /** Empresa e vaga a que o e-mail se refere (candidatura, negativa, atualização, convite, contato). */
  company: z.string().nullable(),
  title: z.string().nullable(),
  postingUrl: z.string().nullable(),
  /** Alerta: as vagas do e-mail, na ordem. */
  jobs: z.array(MailJobSchema),
  /** Atualização ou convite: a próxima etapa com as palavras do e-mail ("Entrevista técnica"). */
  stageHint: z.string().nullable(),
  /** Convite: data e hora como escritas (ISO 8601 com o deslocamento quando o e-mail diz o fuso). */
  interview: z
    .object({
      startsAt: z.string().nullable(),
      timeZone: z.string().nullable(),
      durationMin: z.number().int().nullable(),
      link: z.string().nullable(),
      location: z.string().nullable(),
    })
    .nullable(),
  /** Uma frase em português sobre o que o e-mail diz. */
  summary: z.string(),
});
export type MailClassifyOutput = z.infer<typeof MailClassifyOutputSchema>;
