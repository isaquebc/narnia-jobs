import type {
  CoverLetterContent,
  CoverLetterDraft,
  CvContent,
  CvDraft,
  CvSection,
} from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Textarea } from "../../components/ui/input";
import { documentKeys } from "../../hooks/useDocuments";
import { type TKey, t } from "../../i18n";
import { ApiError, type DocumentView } from "../../lib/api";
import { sectionNames } from "./sections";

/**
 * Edição na tela (F05 §4, M6): cargo do cabeçalho, resumo, bullets (editar e tirar), ordem e inclusão das seções e
 * skills (tirar); na carta, saudação e parágrafos. Salvar cria a versão seguinte, montada e revisada de novo sem o
 * gerador; a origem de cada bullet fica (a revisão confere que o texto continua batendo com os dados).
 */
export function cvDraftOf(c: CvContent): CvDraft {
  return {
    headline: c.header.title,
    summary: c.summary,
    experiences: c.experiences.map((e) => ({
      factId: e.factId,
      title: e.title,
      location: e.location,
      bullets: e.bullets,
      tech: e.tech,
    })),
    education: c.education.map((e) => ({ factId: e.factId, course: e.course, degree: e.degree })),
    skills: c.skills.map((g) => ({
      label: g.label,
      items: g.items.map((i) => ({ name: i.name, factIds: i.factIds })),
    })),
    projects: c.projects.map((p) => ({ factId: p.factId, description: p.description ?? p.name })),
    adjacent: c.adjacent,
    sectionsOrder: c.sectionsOrder,
  };
}

const ALL_SECTIONS: CvSection[] = [
  "summary",
  "experience",
  "skills",
  "projects",
  "education",
  "languages",
];

export function ContentEditor({
  view,
  open,
  onOpenChange,
}: {
  view: DocumentView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const content = view.current?.content;
  if (!content || !view.current) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t("documents.editTitle", { kind: t(`documents.kinds.${view.document.kind}` as TKey) })}
    >
      {content.meta.kind === "cv" ? (
        <CvEditor view={view} content={content as CvContent} onDone={() => onOpenChange(false)} />
      ) : (
        <LetterEditor
          view={view}
          content={content as CoverLetterContent}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function useSave(view: DocumentView, onDone: () => void) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { cv?: CvDraft; letter?: CoverLetterDraft }) =>
      api.editDocument(view.document.id, { baseVersion: view.document.currentVersion, ...body }),
    onSuccess: async () => {
      onDone();
      await qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

function SaveBar({ save, onCancel }: { save: ReturnType<typeof useSave>; onCancel: () => void }) {
  return (
    <>
      {save.isError ? (
        <Alert tone="danger">
          {save.error instanceof ApiError && save.error.code === "conflict"
            ? t("documents.conflict")
            : (save.error as Error).message}
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("documents.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t("documents.save")}
        </Button>
      </div>
    </>
  );
}

function CvEditor({
  view,
  content,
  onDone,
}: {
  view: DocumentView;
  content: CvContent;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<CvDraft>(() => cvDraftOf(content));
  const save = useSave(view, onDone);
  const ids = useId();
  const companies = new Map(content.experiences.map((e) => [e.factId, e.company]));
  const names = sectionNames(content.meta.locale);
  const move = (i: number, d: -1 | 1) =>
    setDraft((x) => {
      const order = [...x.sectionsOrder];
      const [it] = order.splice(i, 1);
      order.splice(i + d, 0, it as CvSection);
      return { ...x, sectionsOrder: order };
    });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ cv: draft });
      }}
    >
      <p className="text-sm text-muted-fg">{t("documents.editHint")}</p>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-headline`}>
        {t("documents.headline")}
        <Input
          id={`${ids}-headline`}
          value={draft.headline}
          onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-summary`}>
        {t("documents.summary")}
        <Textarea
          id={`${ids}-summary`}
          className="min-h-20"
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </label>
      {draft.experiences.map((exp, ei) => (
        <fieldset
          key={exp.factId}
          className="flex flex-col gap-2 rounded-md border border-border p-2"
        >
          <legend className="px-1 text-sm font-medium">
            {exp.title} · {companies.get(exp.factId)}
          </legend>
          {exp.bullets.map((b, bi) => (
            <div
              key={`${exp.factId}-${b.factIds.map((f) => f.id).join("-")}-${b.text.slice(0, 12)}`}
              className="flex gap-2"
            >
              <Textarea
                aria-label={t("documents.bullet", {
                  n: bi + 1,
                  company: companies.get(exp.factId) ?? "",
                })}
                className="min-h-12 flex-1"
                value={b.text}
                onChange={(e) =>
                  setDraft((x) => ({
                    ...x,
                    experiences: x.experiences.map((xe, i) =>
                      i === ei
                        ? {
                            ...xe,
                            bullets: xe.bullets.map((xb, j) =>
                              j === bi ? { ...xb, text: e.target.value } : xb,
                            ),
                          }
                        : xe,
                    ),
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={exp.bullets.length <= 1}
                onClick={() =>
                  setDraft((x) => ({
                    ...x,
                    experiences: x.experiences.map((xe, i) =>
                      i === ei ? { ...xe, bullets: xe.bullets.filter((_, j) => j !== bi) } : xe,
                    ),
                  }))
                }
              >
                {t("documents.removeBullet")}
              </Button>
            </div>
          ))}
        </fieldset>
      ))}
      <fieldset className="flex flex-col gap-1 rounded-md border border-border p-2">
        <legend className="px-1 text-sm font-medium">{t("documents.sections")}</legend>
        {draft.sectionsOrder.map((s, i) => (
          <div key={s} className="flex items-center gap-2 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked
                aria-label={t("documents.include", { section: names[s] })}
                onChange={() =>
                  setDraft((x) => ({ ...x, sectionsOrder: x.sectionsOrder.filter((y) => y !== s) }))
                }
              />
              {names[s]}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("emphasis.moveUp")}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("emphasis.moveDown")}
              disabled={i === draft.sectionsOrder.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={14} />
            </Button>
          </div>
        ))}
        {ALL_SECTIONS.filter((s) => !draft.sectionsOrder.includes(s)).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm text-muted-fg">
            <input
              type="checkbox"
              checked={false}
              aria-label={t("documents.include", { section: names[s] })}
              onChange={() => setDraft((x) => ({ ...x, sectionsOrder: [...x.sectionsOrder, s] }))}
            />
            {names[s]}
          </label>
        ))}
      </fieldset>
      {draft.skills.length ? (
        <fieldset className="flex flex-wrap gap-2 rounded-md border border-border p-2">
          <legend className="px-1 text-sm font-medium">{names.skills}</legend>
          {draft.skills.flatMap((g, gi) =>
            g.items.map((it, ii) => (
              <Button
                key={`${g.label}-${it.name}`}
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("documents.removeSkill", { skill: it.name })}
                onClick={() =>
                  setDraft((x) => ({
                    ...x,
                    skills: x.skills
                      .map((xg, i) =>
                        i === gi ? { ...xg, items: xg.items.filter((_, j) => j !== ii) } : xg,
                      )
                      .filter((xg) => xg.items.length > 0),
                  }))
                }
              >
                {it.name} ×
              </Button>
            )),
          )}
        </fieldset>
      ) : null}
      <SaveBar save={save} onCancel={onDone} />
    </form>
  );
}

function LetterEditor({
  view,
  content,
  onDone,
}: {
  view: DocumentView;
  content: CoverLetterContent;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<CoverLetterDraft>({
    greeting: content.greeting,
    paragraphs: content.paragraphs,
  });
  const save = useSave(view, onDone);
  const ids = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ letter: draft });
      }}
    >
      <p className="text-sm text-muted-fg">{t("documents.editHint")}</p>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-greeting`}>
        {t("documents.greeting")}
        <Input
          id={`${ids}-greeting`}
          value={draft.greeting}
          onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
        />
      </label>
      {draft.paragraphs.map((p, i) => (
        <Textarea
          key={p.role}
          aria-label={t("documents.paragraph", { n: i + 1 })}
          className="min-h-24"
          value={p.text}
          onChange={(e) =>
            setDraft((x) => ({
              ...x,
              paragraphs: x.paragraphs.map((xp, j) =>
                j === i ? { ...xp, text: e.target.value } : xp,
              ),
            }))
          }
        />
      ))}
      <SaveBar save={save} onCancel={onDone} />
    </form>
  );
}
