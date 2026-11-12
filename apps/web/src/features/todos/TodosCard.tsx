import type { TodoItem } from "@narnia-jobs/shared";
import { useState } from "react";
import { NavLink } from "../../components/shell/NavLink";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { useTodos } from "../../hooks/useTodos";
import { t } from "../../i18n";
import { TodoCard, TodoDialog } from "./TodosPage";

/** Cartão "Tarefas" na página da candidatura (F15 §4): as abertas dela e Nova tarefa já ligada. */
export function TodosCard({ applicationId }: { applicationId: string }) {
  const list = useTodos({ applicationId });
  const [editing, setEditing] = useState<TodoItem | "new" | null>(null);
  const open = (list.data?.todos ?? []).filter((x) => x.status !== "done");
  return (
    <Card role="region" aria-label={t("todos.card")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{t("todos.card")}</CardTitle>
        <div className="flex items-center gap-2">
          <NavLink to="/tarefas" className="text-xs underline">
            {t("todos.seeAll")}
          </NavLink>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            {t("todos.new")}
          </Button>
        </div>
      </div>
      {open.length ? (
        <ul aria-label={t("todos.card")} className="flex flex-col gap-2">
          {open.map((x) => (
            <TodoCard key={x.id} x={x} onEdit={setEditing} draggable={false} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-fg">{t("todos.cardEmpty")}</p>
      )}
      {editing ? (
        <TodoDialog
          {...(editing === "new" ? { applicationId } : { todo: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}
