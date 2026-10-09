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
import type { EmphasisFactKind, EmphasisListResponse, EmphasisMode } from "@narnia-jobs/shared";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFormGuard } from "../../app/FormGuard";
import { describeError, ErrorState } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Select } from "../../components/ui/input";
import { TabPanel, Tabs } from "../../components/ui/tabs";
import { useEmphasis } from "../../hooks/useEmphasis";
import { useProfileCard } from "../../hooks/useProfileCard";
import { type TKey, t } from "../../i18n";
import { CardText } from "./CardText";

type Item = EmphasisListResponse["items"][number];
/** Tipos com aba no F02 (F02-3: conquistas só em F05; F02-9: projetos com aba vazia até F03). */
const KINDS = [
  "experience",
  "project",
  "skill",
  "education",
  "language",
] as const satisfies readonly EmphasisFactKind[];
type Kind = (typeof KINDS)[number];
const MODES: EmphasisMode[] = ["highlight", "normal", "hidden"];

function groupByKind(items: Item[]): Record<Kind, Item[]> {
  const out = Object.fromEntries(KINDS.map((k) => [k, [] as Item[]])) as Record<Kind, Item[]>;
  for (const it of items)
    if ((KINDS as readonly string[]).includes(it.kind)) out[it.kind as Kind].push(it);
  return out;
}

function SortableRow({
  item,
  index,
  total,
  onMode,
  onMove,
}: {
  item: Item;
  index: number;
  total: number;
  onMode: (mode: EmphasisMode) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const pct = item.relevance ? Math.round(item.relevance.score * 100) : null;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-border bg-card p-2 ${item.mode === "hidden" ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        aria-label={t("emphasis.dragHandle", { label: item.label })}
        className="cursor-grab text-muted-fg"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.label}</span>
        <span className="truncate text-xs text-muted-fg">
          {[item.sublabel, item.date].filter(Boolean).join(" · ")}
        </span>
      </div>
      {pct !== null ? (
        <Badge tone={pct >= 70 ? "ok" : "neutral"} title={item.relevance?.reasons.join(", ")}>
          {t("emphasis.relevance", { score: `${pct}%` })}
        </Badge>
      ) : null}
      <Select
        aria-label={t("emphasis.modeLabel", { label: item.label })}
        value={item.mode}
        onChange={(e) => onMode(e.target.value as EmphasisMode)}
        className="h-8 w-32"
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {t(`emphasis.modes.${m}`)}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("emphasis.moveUp")}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("emphasis.moveDown")}
        disabled={index === total - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={14} />
      </Button>
    </li>
  );
}

/** Quadro de ênfases (F02 §4, F02-4): abas por tipo, destacar/normal/ocultar, ordem por arraste ou botões, lote. */
export function EmphasisBoard({ profileId }: { profileId: string }) {
  const emphasis = useEmphasis(profileId);
  const card = useProfileCard(profileId);
  const guard = useFormGuard();
  const { setDirty: setGuardDirty } = guard;
  useEffect(() => () => setGuardDirty(false), [setGuardDirty]);
  const [tab, setTab] = useState<Kind>("experience");
  const [groups, setGroups] = useState<Record<Kind, Item[]> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (emphasis.data && !dirty) setGroups(groupByKind(emphasis.data.items));
  }, [emphasis.data, dirty]);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const tabs = useMemo(() => KINDS.map((k) => ({ value: k, label: t(`emphasis.tabs.${k}`) })), []);

  function touch(next: Record<Kind, Item[]>) {
    setGroups(next);
    setDirty(true);
    setSaved(false);
    guard.setDirty(true);
  }
  function update(kind: Kind, fn: (list: Item[]) => Item[]) {
    if (!groups) return;
    touch({ ...groups, [kind]: fn(groups[kind]) });
  }
  function onDragEnd(kind: Kind, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    update(kind, (list) => {
      const from = list.findIndex((i) => i.id === active.id);
      const to = list.findIndex((i) => i.id === over.id);
      return arrayMove(list, from, to);
    });
  }
  function save() {
    if (!groups) return;
    const items = KINDS.flatMap((k) =>
      groups[k].map((it, position) => ({ kind: it.kind, id: it.id, mode: it.mode, position })),
    );
    emphasis.save.mutate(
      // auditoria F02 (3): só os tipos com aba são substituídos; ênfases de outros tipos (conquistas) ficam
      { items, kinds: [...KINDS] },
      {
        onSuccess: () => {
          setDirty(false);
          setSaved(true);
          guard.setDirty(false);
        },
      },
    );
  }

  if (emphasis.isError)
    return <ErrorState error={emphasis.error} onRetry={() => void emphasis.refetch()} />;
  if (!groups) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t("emphasis.title")}</CardTitle>
          {dirty ? <Badge tone="warn">{t("emphasis.unsaved")}</Badge> : null}
        </div>
        <p className="text-sm text-muted-fg">{t("emphasis.hint")}</p>
        {emphasis.data && !emphasis.data.cardValid ? (
          <Alert tone="warn">{t("emphasis.staleRelevance")}</Alert>
        ) : null}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)} items={tabs}>
          {KINDS.map((kind) => (
            <TabPanel key={kind} value={kind}>
              {groups[kind].length === 0 ? (
                <p className="text-sm text-muted-fg">
                  {kind === "project" ? t("emphasis.projectsEmpty") : t("emphasis.empty")}
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => onDragEnd(kind, e)}
                >
                  <SortableContext
                    items={groups[kind].map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul
                      aria-label={t(`emphasis.tabs.${kind}` as TKey)}
                      className="flex flex-col gap-2"
                    >
                      {groups[kind].map((item, index) => (
                        <SortableRow
                          key={item.id}
                          item={item}
                          index={index}
                          total={groups[kind].length}
                          onMode={(mode) =>
                            update(kind, (list) =>
                              list.map((i) => (i.id === item.id ? { ...i, mode } : i)),
                            )
                          }
                          onMove={(delta) =>
                            update(kind, (list) => arrayMove(list, index, index + delta))
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </TabPanel>
          ))}
        </Tabs>
        {emphasis.save.isError ? (
          <Alert tone="danger">{describeError(emphasis.save.error).title}</Alert>
        ) : null}
        {saved ? <Alert tone="ok">{t("emphasis.saved")}</Alert> : null}
        <div>
          <Button onClick={save} disabled={!dirty || emphasis.save.isPending}>
            {t("emphasis.save")}
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-2">
        <CardTitle>{t("emphasis.preview")}</CardTitle>
        {card.data ? (
          <CardText text={card.data.text} />
        ) : (
          <p className="text-sm text-muted-fg">{t("app.loading")}</p>
        )}
      </Card>
    </div>
  );
}
