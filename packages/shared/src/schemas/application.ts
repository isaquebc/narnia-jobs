import { z } from "zod";

/**
 * Formulário de candidatura (F12/M3, §4.6): os campos que a extensão leu da página (`FormSnapshot`, espelho de
 * `apps/extension/src/capture/form.ts`) e as perguntas organizadas a partir deles. Nada é preenchido na página: a
 * referência (`ref`) só liga a pergunta ao campo.
 */
export const FIELD_CONTROLS = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
  "multiselect",
  "radio",
  "checkbox",
  "checkboxes",
  "file",
  "richtext",
  "combobox",
] as const;
export const FieldControlSchema = z.enum(FIELD_CONTROLS);

const text = (max: number) => z.string().max(max).nullable();

export const FormFieldSchema = z.object({
  ref: z.string().regex(/^f\d{1,3}$/),
  control: FieldControlSchema,
  label: text(300),
  name: text(300),
  placeholder: text(300),
  help: text(600),
  section: text(300),
  required: z.boolean(),
  maxLength: z.number().int().positive().nullable(),
  options: z.array(z.object({ value: z.string().max(300), label: z.string().max(300) })).max(200),
  autocomplete: text(100),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSnapshotSchema = z.object({
  fields: z.array(FormFieldSchema).max(300),
  frames: z.array(z.string().max(300)).max(50),
});
export type FormSnapshot = z.infer<typeof FormSnapshotSchema>;

/** Tipos de pergunta (§4.6): consentimento e autodeclaração nunca têm resposta sugerida pelo modelo (F12-12). */
export const APPLICATION_QUESTION_KINDS = [
  "short_text",
  "long_text",
  "choice",
  "multi_choice",
  "yes_no",
  "number",
  "date",
  "file",
  "consent",
  "self_declaration",
] as const;
export const ApplicationQuestionKindSchema = z.enum(APPLICATION_QUESTION_KINDS);
export type ApplicationQuestionKind = z.infer<typeof ApplicationQuestionKindSchema>;

/** Assuntos de autodeclaração (F12-12): perguntados à pessoa no chat, nunca adivinhados. */
export const SELF_DECLARATION_TOPICS = [
  "race",
  "gender",
  "sexual_orientation",
  "disability",
  "religion",
  "age",
  "veteran",
  "other",
] as const;
export const SelfDeclarationTopicSchema = z.enum(SELF_DECLARATION_TOPICS);
export type SelfDeclarationTopic = z.infer<typeof SelfDeclarationTopicSchema>;

/** Campos óbvios respondidos direto dos dados da pessoa, sem modelo (§4.6-1). */
export const PROFILE_FIELDS = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "linkedin",
  "github",
  "portfolio",
  "city",
] as const;
export const ProfileFieldSchema = z.enum(PROFILE_FIELDS);
export type ProfileField = z.infer<typeof ProfileFieldSchema>;

export const ApplicationQuestionSchema = z.object({
  id: z.string(),
  question: z.string().min(1),
  kind: ApplicationQuestionKindSchema,
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  required: z.boolean(),
  maxChars: z.number().int().positive().nullable(),
  fieldRefs: z.array(z.string()).min(1),
  section: z.string().nullable(),
  profileField: ProfileFieldSchema.nullable(),
  topic: SelfDeclarationTopicSchema.nullable(),
  /** Quem organizou: a heurística (campos óbvios, consentimento, autodeclaração) ou o modelo. */
  source: z.enum(["heuristic", "model"]),
});
export type ApplicationQuestion = z.infer<typeof ApplicationQuestionSchema>;

/**
 * Saída do localizador (`narnia-application-locate`, Haiku): plana, para gerar JSON Schema simples. O modelo não
 * copia opções (o código tira dos campos referidos) nem inventa campos (referência desconhecida é descartada).
 */
export const ApplicationLocateOutputSchema = z.object({
  questions: z.array(
    z.object({
      fieldRefs: z.array(z.string().min(1)).min(1),
      question: z.string().min(1),
      kind: ApplicationQuestionKindSchema,
      required: z.boolean(),
      section: z.string().nullable(),
      topic: SelfDeclarationTopicSchema.nullable(),
    }),
  ),
  /** Campos que não são perguntas (navegação, busca, "buscar CEP"). */
  ignored: z.array(z.string()),
});
export type ApplicationLocateOutput = z.infer<typeof ApplicationLocateOutputSchema>;

export const APPLICATION_STATUSES = ["locating", "ready", "error"] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
