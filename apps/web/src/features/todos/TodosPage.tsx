import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  localInputFromUtc,
  localToUtc,
  TODO_STATUSES,
  type TodoItem,
  type TodoStatus,
} from "@narnia-jobs/shared";
import { GripVertical } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTimezone } from "../../app/context";
import { describeError, ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Menu } from "../../components/ui/menu";
import { useJobApplications } from "../../hooks/useJobApplications";
import { type TodoFilterState, useTodos } from "../../hooks/useTodos";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { applicationWho } from "../job-applications/JobApplicationsPage";

/**
 * Tarefas (F15/M1, plans/plan-v0/tasks/F15-tarefas-e-avisos.md §4): kanban A fazer, Fazendo e Feito; filtros por texto,
 * tag, origem e só as vencidas; nova tarefa e edição num diálogo. Arrastar (mouse ou teclado) ou "Mover".
 */
export const statusLabel = (s: TodoStatus) => t(`todos.status.${s}` as TKey);

const isOverdue = (x: TodoItem, now = Date.now()) =>
  x.status !== "done" && !!x.dueAt && Date.parse(x.dueAt) < now;

const splitTags = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Criar ou editar: título, nota, prazo (no fuso da pessoa), link, tags e candidatura. */
export function TodoDialog({
  todo,
  applicationId,
  onClose,
}: {
  todo?: TodoItem;
  /** Nova tarefa já ligada a esta candidatura (cartão da candidatura). */
  applicationId?: string;
  onClose: () => void;
}) {
  const tz = useTimezone();
  const { create, patch } = useTodos();
  const apps = useJobApplications("", false);
  const [title, setTitle] = useState(todo?.title ?? "");
  const [note, setNote] = useState(todo?.note ?? "");
  const [due, setDue] = useState(todo?.dueAt ? localInputFromUtc(todo.dueAt, tz) : "");
  const [url, setUrl] = useState(todo?.actionUrl ?? "");
  const [tags, setTags] = useState((todo?.tags ?? []).join(", "));
  const [app, setApp] = useState(todo?.applicationId ?? applicationId ?? "");
  const m = todo ? patch : create;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title: title.trim(),
      note: note.trim() || null,
      dueAt: due ? localToUtc(due, tz) : null,
      actionUrl: url.trim() || null,
      tags: splitTags(tags),
      applicationId: app || null,
    };
    const done = { onSuccess: onClose };
    if (todo) patch.mutate({ id: todo.id, body }, done);
    else create.mutate(body, done);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={todo ? t("todos.editTitle") : t("todos.new")}
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label={t("todos.fields.title")} htmlFor="todo-title" required>
          <Input
            id="todo-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("todos.fields.note")} htmlFor="todo-note">
          <Textarea id="todo-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t("todos.fields.dueAt")} htmlFor="todo-due">
          <Input
            id="todo-due"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <Field label={t("todos.fields.actionUrl")} htmlFor="todo-url">
          <Input
            id="todo-url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label={t("todos.fields.tags")} htmlFor="todo-tags" hint={t("todos.fields.tagsHint")}>
          <Input id="todo-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label={t("todos.fields.application")} htmlFor="todo-app">
          <Select id="todo-app" value={app} onChange={(e) => setApp(e.target.value)}>
            <option value="">{t("todos.fields.noApplication")}</option>
            {apps.applications.map((a) => (
              <option key={a.id} value={a.id}>
                {[applicationWho(a), a.posting.title].filter(Boolean).join(" · ")}
              </option>
            ))}
          </Select>
        </Field>
        {m.error ? <Alert tone="danger">{describeError(m.error).title}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!title.trim() || m.isPending}>
            {todo ? t("todos.save") : t("todos.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Cartão da tarefa: prazo (vencida em destaque), tags, origem, links e ações. */
export function TodoCard({
  x,
  onEdit,
  draggable = true,
  highlight = false,
}: {
  x: TodoItem;
  onEdit: (x: TodoItem) => void;
  draggable?: boolean;
  /** Aberta pelo aviso (`/tarefas?id=…`): em destaque e rolada até a vista. */
  highlight?: boolean;
}) {
  const tz = useTimezone();
  const { move, remove } = useTodos();
  const drag = useDraggable({ id: x.id, disabled: !draggable });
  const overdue = isOverdue(x);
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView?.({ block: "center" });
  }, [highlight]);
  return (
    <li
      ref={(el) => {
        ref.current = el;
        drag.setNodeRef(el);
      }}
      data-highlight={highlight || undefined}
      style={{ transform: CSS.Translate.toString(drag.transform) }}
      className={drag.isDragging ? "relative z-10 opacity-80" : undefined}
      aria-label={x.title}
    >
      <Card
        className={`flex flex-col gap-1 p-3 ${overdue ? "border-danger" : ""} ${highlight ? "ring-2 ring-primary" : ""}`}
      >
        <div className="flex items-start gap-1">
          {draggable ? (
            <button
              type="button"
              aria-label={t("todos.drag", { name: x.title })}
              className="mt-0.5 cursor-grab text-muted-fg"
              {...drag.attributes}
              {...drag.listeners}
            >
              <GripVertical size={14} />
            </button>
          ) : null}
          <span className={`font-medium ${x.status === "done" ? "line-through opacity-70" : ""}`}>
            {x.title}
          </span>
        </div>
        {x.note ? <p className="line-clamp-3 text-sm text-muted-fg">{x.note}</p> : null}
        <div className="flex flex-wrap items-center gap-1">
          {x.source === "email" ? <Badge tone="info">{t("todos.source.email")}</Badge> : null}
          {x.kind ? <Badge>{t(`todos.kind.${x.kind}` as TKey)}</Badge> : null}
          {x.tags.map((tag) => (
            <Badge key={tag} tone="neutral">
              #{tag}
            </Badge>
          ))}
        </div>
        {x.dueAt && x.status !== "done" ? (
          <p className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted-fg"}`}>
            {t(overdue ? "todos.overdue" : "todos.due", {
              date: formatDate(x.dueAt, tz, "DD/MM/YYYY HH:mm"),
            })}
          </p>
        ) : null}
        {x.status === "done" && x.doneAt ? (
          <p className="text-xs text-muted-fg">
            {t("todos.doneOn", { date: formatDate(x.doneAt, tz, "DD/MM/YYYY") })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {x.application ? (
            <NavLink to={`/candidaturas/${x.application.id}`} className="underline">
              {[x.application.company, x.application.title].filter(Boolean).join(" · ") ||
                t("todos.openApplication")}
            </NavLink>
          ) : null}
          {x.actionUrl ? (
            <a href={x.actionUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {t("todos.openAction")}
            </a>
          ) : null}
          {x.mailUrl ? (
            <a href={x.mailUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {t("todos.openMail")}
            </a>
          ) : null}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => onEdit(x)}>
            {t("todos.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => window.confirm(t("todos.removeConfirm")) && remove.mutate(x.id)}
          >
            {t("todos.remove")}
          </Button>
          <Menu
            label={t("todos.move")}
            variant="ghost"
            items={TODO_STATUSES.filter((s) => s !== x.status).map((s) => ({
              id: s,
              label: statusLabel(s),
              onSelect: () => move.mutate({ id: x.id, body: { status: s } }),
            }))}
          />
        </div>
      </Card>
    </li>
  );
}

function Column({ status, children }: { status: TodoStatus; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      data-column={status}
      className={`flex min-w-0 flex-col gap-2 rounded-lg p-2 ${isOver ? "bg-primary/10 ring-2 ring-primary" : "bg-muted/40"}`}
    >
      {children}
    </div>
  );
}

export function TodosPage() {
  const [text, setText] = useState("");
  const [f, setF] = useState<TodoFilterState>({});
  useEffect(() => {
    const id = setTimeout(() => setF((x) => ({ ...x, q: text.trim() || undefined })), 250);
    return () => clearTimeout(id);
  }, [text]);
  const list = useTodos(f);
  // as tags do filtro vêm da lista sem filtro (o filtro não some quando escolhido)
  const all = useTodos({});
  const [editing, setEditing] = useState<TodoItem | "new" | null>(null);
  // aberta por um aviso: /tarefas?id=…
  const [focusId] = useState(() => new URLSearchParams(window.location.search).get("id"));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const todos = list.data?.todos ?? [];
  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as TodoStatus | undefined;
    const from = todos.find((x) => x.id === e.active.id)?.status;
    if (to && from && to !== from)
      list.move.mutate({ id: String(e.active.id), body: { status: to } });
  };
  if (list.isError) return <ErrorState error={list.error} />;
  const filtered = !!(f.q || f.tag || f.source || f.overdue);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t("todos.title")}</h1>
          <p className="text-sm text-muted-fg">{t("todos.hint")}</p>
        </div>
        <Button onClick={() => setEditing("new")}>{t("todos.new")}</Button>
      </div>
      <section aria-label={t("todos.filters")} className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label={t("todos.search")}
          placeholder={t("todos.searchPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="max-w-xs"
        />
        <Select
          aria-label={t("todos.tag")}
          value={f.tag ?? ""}
          onChange={(e) => setF((x) => ({ ...x, tag: e.target.value || undefined }))}
          className="w-auto"
        >
          <option value="">{t("todos.allTags")}</option>
          {(all.data?.tags ?? []).map((g) => (
            <option key={g.tag} value={g.tag}>
              #{g.tag} ({g.count})
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("todos.origin")}
          value={f.source ?? ""}
          onChange={(e) =>
            setF((x) => ({
              ...x,
              source: (e.target.value || undefined) as TodoFilterState["source"],
            }))
          }
          className="w-auto"
        >
          <option value="">{t("todos.allOrigins")}</option>
          <option value="email">{t("todos.source.email")}</option>
          <option value="manual">{t("todos.source.manual")}</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!f.overdue}
            onChange={(e) => setF((x) => ({ ...x, overdue: e.target.checked || undefined }))}
          />
          {t("todos.overdueOnly")}
        </label>
      </section>
      {list.data && todos.length === 0 ? (
        <p className="text-sm text-muted-fg">
          {filtered ? t("todos.emptyFiltered") : t("todos.empty")}
        </p>
      ) : null}
      <section aria-label={t("todos.board")} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {TODO_STATUSES.map((s) => {
            const items = todos.filter((x) => x.status === s);
            return (
              <Column key={s} status={s}>
                <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                  {statusLabel(s)}
                  <span aria-hidden className="text-xs font-normal text-muted-fg">
                    {items.length}
                  </span>
                </h2>
                <ul aria-label={statusLabel(s)} className="flex flex-col gap-2">
                  {items.map((x) => (
                    <TodoCard key={x.id} x={x} onEdit={setEditing} highlight={x.id === focusId} />
                  ))}
                </ul>
              </Column>
            );
          })}
        </DndContext>
      </section>
      {editing ? (
        <TodoDialog
          {...(editing === "new" ? {} : { todo: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
