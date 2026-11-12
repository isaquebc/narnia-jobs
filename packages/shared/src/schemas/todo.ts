import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/**
 * Tarefas da pessoa (F15, plans/plan-v0/tasks/F15-tarefas-e-avisos.md §2.1): um kanban com A fazer, Fazendo e Feito;
 * as do e-mail nascem da ação que um e-mail pede (F15-2), as manuais a pessoa escreve. Tags identificam e filtram.
 */
export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export const TodoStatusSchema = z.enum(TODO_STATUSES);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoSourceSchema = z.enum(["manual", "email"]);
export type TodoSource = z.infer<typeof TodoSourceSchema>;

/** O que o e-mail pede (F15-2): vira tag também. */
export const TODO_KINDS = [
  "screening",
  "test",
  "form",
  "documents",
  "interview",
  "schedule",
  "other",
] as const;
export const TodoKindSchema = z.enum(TODO_KINDS);
export type TodoKind = z.infer<typeof TodoKindSchema>;

const TagSchema = z.string().trim().min(1).max(40);
const ActionUrlSchema = z.url({ protocol: /^https?$/ }).max(2000);

export const TodoSchema = z.object({
  id: IdSchema,
  title: z.string(),
  note: z.string().nullable(),
  status: TodoStatusSchema,
  position: z.number(),
  dueAt: IsoDateTimeSchema.nullable(),
  actionUrl: z.string().nullable(),
  source: TodoSourceSchema,
  kind: TodoKindSchema.nullable(),
  tags: z.array(z.string()),
  applicationId: IdSchema.nullable(),
  postingId: IdSchema.nullable(),
  mailMessageId: IdSchema.nullable(),
  doneAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Todo = z.infer<typeof TodoSchema>;

/** Na lista: a candidatura (empresa e cargo) e o link do e-mail, para o cartão. */
export const TodoItemSchema = TodoSchema.extend({
  application: z
    .object({ id: IdSchema, company: z.string().nullable(), title: z.string().nullable() })
    .nullable(),
  mailUrl: z.string().nullable(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
  status: TodoStatusSchema.optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
  actionUrl: ActionUrlSchema.nullable().optional(),
  tags: z.array(TagSchema).max(20).optional(),
  applicationId: IdSchema.nullable().optional(),
});
export type TodoCreate = z.infer<typeof TodoCreateSchema>;

export const TodoPatchSchema = TodoCreateSchema.partial().omit({ status: true });
export type TodoPatch = z.infer<typeof TodoPatchSchema>;

/** Arrastar: a coluna e a posição (índice) nela. */
export const TodoMoveSchema = z.object({
  status: TodoStatusSchema,
  index: z.number().int().min(0).optional(),
});
export type TodoMove = z.infer<typeof TodoMoveSchema>;

export const TodoFilterSchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
  source: TodoSourceSchema.optional(),
  applicationId: IdSchema.optional(),
  /** Só as vencidas (prazo passado e não feitas). */
  overdue: z.boolean().optional(),
});
export type TodoFilter = z.infer<typeof TodoFilterSchema>;

export const TodoListResponseSchema = z.object({
  todos: z.array(TodoItemSchema),
  /** Todas as tags em uso, com quantas tarefas cada (para o filtro e a sugestão). */
  tags: z.array(z.object({ tag: z.string(), count: z.number().int() })),
});
export type TodoListResponse = z.infer<typeof TodoListResponseSchema>;

export const TodoUpdatedEventSchema = z.object({
  type: z.literal("todo.updated"),
  todoId: IdSchema.nullable(),
});
