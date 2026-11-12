import type { TodoCreate, TodoMove, TodoPatch } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export const todoKeys = { all: ["todos"] as const };

export interface TodoFilterState {
  q?: string | undefined;
  tag?: string | undefined;
  source?: "manual" | "email" | undefined;
  applicationId?: string | undefined;
  overdue?: boolean | undefined;
}

/** Tarefas (F15/M1): lista com filtros; o WS `todo.updated` recarrega (outra aba, e-mail, lembrete). */
export function useTodos(f: TodoFilterState = {}) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...todoKeys.all, f],
    queryFn: () => api.listTodos(f),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "todo.updated") void qc.invalidateQueries({ queryKey: todoKeys.all });
    });
  }, [ws, qc]);
  const settle = () => qc.invalidateQueries({ queryKey: todoKeys.all });
  const create = useMutation({
    mutationFn: (body: TodoCreate) => api.createTodo(body),
    onSettled: settle,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: TodoPatch }) => api.patchTodo(v.id, v.body),
    onSettled: settle,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; body: TodoMove }) => api.moveTodo(v.id, v.body),
    onSettled: settle,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteTodo(id), onSettled: settle });
  return { ...query, create, patch, move, remove };
}
