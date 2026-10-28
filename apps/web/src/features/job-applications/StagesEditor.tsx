import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JobApplicationStage, JobApplicationSummary } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { t } from "../../i18n";

type Draft = { id?: string; name: string };
const toDraft = (s: JobApplicationStage): Draft => ({ id: s.id, name: s.name });

function StageRow({
  stage,
  index,
  total,
  current,
  onMove,
  onRemove,
  onCurrent,
}: {
  stage: JobApplicationStage;
  index: number;
  total: number;
  current: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onCurrent: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: stage.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-current={current ? "step" : undefined}
      className={`flex items-center gap-2 rounded-md border bg-card p-2 text-sm ${current ? "border-primary" : "border-border"}`}
    >
      <button
        type="button"
        aria-label={t("jobApplications.stages.drag", { name: stage.name })}
        className="cursor-grab text-muted-fg"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="min-w-0 flex-1">
        {index + 1}. {stage.name}
        {current ? (
          <span className="text-muted-fg"> · {t("jobApplications.detail.current")}</span>
        ) : null}
      </span>
      {current ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("jobApplications.stages.makeCurrent", { name: stage.name })}
          onClick={onCurrent}
        >
          {t("jobApplications.stages.makeCurrentShort")}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("jobApplications.stages.up", { name: stage.name })}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("jobApplications.stages.down", { name: stage.name })}
        disabled={index === total - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("jobApplications.stages.remove", { name: stage.name })}
        onClick={onRemove}
      >
        <X size={14} />
      </Button>
    </li>
  );
}

/**
 * Pipeline da candidatura (F07/M2, §0-3): adicionar, remover, reordenar (arrastar ou botões, também pelo teclado) e
 * escolher a etapa atual (o "x" do "x/N"). Cada mudança grava a lista inteira em ordem; enquanto grava, a ordem nova
 * já aparece.
 */
export function StagesEditor({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const qc = useQueryClient();
  const [order, setOrder] = useState<JobApplicationStage[]>(a.stages);
  const [name, setName] = useState("");
  useEffect(() => setOrder(a.stages), [a.stages]);
  const done = () => qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
  const save = useMutation({
    mutationFn: (next: Draft[]) => api.putJobApplicationStages(a.id, next),
    onSettled: done,
  });
  const current = useMutation({
    mutationFn: (stageId: string) => api.patchJobApplication(a.id, { currentStageId: stageId }),
    onSettled: done,
  });
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const commit = (next: JobApplicationStage[]) => {
    setOrder(next);
    save.mutate(next.map(toDraft));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((s) => s.id === e.active.id);
    const to = order.findIndex((s) => s.id === e.over?.id);
    if (from >= 0 && to >= 0) commit(arrayMove(order, from, to));
  };
  const error = save.error ?? current.error;
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{t("jobApplications.detail.stages")}</CardTitle>
      <p className="text-xs text-muted-fg">{t("jobApplications.stages.hint")}</p>
      {error ? <Alert tone="danger">{describeError(error).title}</Alert> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol aria-label={t("jobApplications.detail.stages")} className="flex flex-col gap-1">
            {order.map((s, i) => (
              <StageRow
                key={s.id}
                stage={s}
                index={i}
                total={order.length}
                current={s.id === a.currentStageId}
                onMove={(d) => commit(arrayMove(order, i, i + d))}
                onRemove={() => commit(order.filter((x) => x.id !== s.id))}
                onCurrent={() => current.mutate(s.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {order.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("jobApplications.stages.empty")}</p>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim();
          if (!clean) return;
          save.mutate([...order.map(toDraft), { name: clean }]);
          setName("");
        }}
      >
        <Input
          aria-label={t("jobApplications.stages.new")}
          placeholder={t("jobApplications.stages.newPlaceholder")}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim() || order.length >= 20}>
          {t("jobApplications.stages.add")}
        </Button>
      </form>
    </Card>
  );
}
