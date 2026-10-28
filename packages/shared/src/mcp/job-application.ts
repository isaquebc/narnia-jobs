import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema } from "../schemas/common";
import {
  CalendarDateSchema,
  JobApplicationClosedReasonSchema,
  JobApplicationColumnSchema,
  JobApplicationEventKindSchema,
  LocalDateTimeSchema,
} from "../schemas/job-application";
import type { ToolDefinition } from "./profile";

/**
 * Tools das candidaturas (F07/M6, skill `candidaturas`): listar, ler, mover de coluna, marcar a etapa, registrar nota e
 * agendar, com o link da candidatura na interface. Criar não tem tool: a candidatura só nasce no botão "Aplicar" da
 * vaga (§0-1). Handlers em `packages/core/src/job-applications/tools.ts`.
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const Line = z.object({ id: IdSchema, line: z.string(), url: z.string() });
const EventOut = z.object({
  id: IdSchema,
  line: z.string(),
  googleCalendarUrl: z.string(),
  icsUrl: z.string(),
});

export const JOB_APPLICATION_TOOLS = {
  "job_application.list": tool(
    "Lista as candidaturas (uma linha por candidatura: empresa, cargo, coluna, etapa x/N e data em que aplicou), da mais recente para a mais antiga. `query` filtra por empresa, cliente, cargo, data ou contato; `archived` mostra as arquivadas.",
    z.object({
      query: z.string().max(200).optional(),
      archived: z.boolean().optional(),
      column: JobApplicationColumnSchema.optional(),
    }),
    z.object({ items: z.array(Line.extend({ column: JobApplicationColumnSchema })) }),
  ),
  "job_application.get": tool(
    "Detalhe de uma candidatura: vaga, coluna, etapas com a atual, CV e carta enviados (versões travadas), contatos em ordem (a cadeia de quem falou com quem), os últimos registros e a agenda.",
    z.object({ id: IdSchema }),
    z.object({
      id: IdSchema,
      postingId: IdSchema,
      line: z.string(),
      column: JobApplicationColumnSchema,
      closedReason: JobApplicationClosedReasonSchema.nullable(),
      appliedOn: z.string(),
      archived: z.boolean(),
      stages: z.array(z.object({ id: IdSchema, name: z.string(), current: z.boolean() })),
      documents: z.array(z.string()),
      contacts: z.array(z.object({ id: IdSchema, line: z.string() })),
      entries: z.array(z.object({ id: IdSchema, line: z.string() })),
      events: z.array(z.object({ id: IdSchema, line: z.string() })),
      url: z.string(),
    }),
  ),
  "job_application.move": tool(
    "Move a candidatura de coluna: applied (Aplicado), first_interview (1ª Entrevista), in_process (Em processo), offer (Oferta) ou closed (Encerrado). Encerrar pede o motivo (hired, declined, rejected, withdrew, no_response).",
    z.object({
      id: IdSchema,
      column: JobApplicationColumnSchema,
      closedReason: JobApplicationClosedReasonSchema.optional(),
    }),
    z.object({ id: IdSchema, line: z.string(), url: z.string() }),
  ),
  "job_application.set_stage": tool(
    "Marca a etapa atual do processo (o x do x/N) pelo id ou pelo nome da etapa, como `job_application_get` mostra.",
    z.object({ id: IdSchema, stage: z.string().min(1) }),
    z.object({ id: IdSchema, line: z.string(), url: z.string() }),
  ),
  "job_application.add_note": tool(
    "Registra uma nota datada na candidatura (o que aconteceu: e-mail, conversa, feedback, próximo passo). Sem data, hoje.",
    z.object({
      id: IdSchema,
      body: z.string().min(1).max(4000),
      occurredOn: CalendarDateSchema.optional(),
    }),
    z.object({ id: IdSchema, url: z.string() }),
  ),
  "job_application.schedule": tool(
    'Agenda um evento da candidatura (entrevista, teste, prazo, retorno) com data e hora no fuso do usuário (`startsLocal` YYYY-MM-DDTHH:mm; converta "quinta 14h" com a data de hoje). Devolve o link para o Google Calendar e o do arquivo .ics, para o usuário adicionar ao calendário dele.',
    z.object({
      id: IdSchema,
      kind: JobApplicationEventKindSchema,
      title: z.string().min(1).max(120),
      startsLocal: LocalDateTimeSchema,
      durationMin: z.number().int().min(5).max(1440).optional(),
      stage: z.string().optional(),
      location: z.string().max(300).optional(),
      link: z.url().optional(),
      notes: z.string().max(4000).optional(),
    }),
    EventOut,
  ),
  "job_application.set_google_event": tool(
    "Guarda o id do evento criado no Google Calendar (tools do Google, quando conectado) no evento da candidatura, para editar o mesmo evento depois.",
    z.object({ eventId: IdSchema, googleEventId: z.string().min(1).max(1024) }),
    z.object({ id: IdSchema, url: z.string() }),
  ),
  "job_application.upcoming": tool(
    "Eventos das candidaturas nas próximas horas (padrão 48) e os atrasados (não concluídos), com o link de cada candidatura.",
    z.object({ hours: z.number().int().min(1).max(336).optional() }),
    z.object({
      timezone: z.string(),
      upcoming: z.array(Line),
      overdue: z.array(Line),
    }),
  ),
} as const;

export type JobApplicationToolName = keyof typeof JOB_APPLICATION_TOOLS;

export const JOB_APPLICATION_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(JOB_APPLICATION_TOOLS) as JobApplicationToolName[]).map((name) => [
    name,
    {
      description: JOB_APPLICATION_TOOLS[name].description,
      input: toJsonSchema(JOB_APPLICATION_TOOLS[name].input),
      output: toJsonSchema(JOB_APPLICATION_TOOLS[name].output),
    },
  ]),
) as Record<JobApplicationToolName, { description: string; input: unknown; output: unknown }>;
