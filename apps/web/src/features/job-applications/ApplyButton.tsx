import type { ApplyOption } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Button, buttonClass } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input, Select } from "../../components/ui/input";
import { jobApplicationKeys, useApplyOptions } from "../../hooks/useJobApplications";
import { postingKeys } from "../../hooks/usePostings";
import { t } from "../../i18n";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";

/** Hoje no fuso da pessoa, como YYYY-MM-DD. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

const cvLabel = (o: ApplyOption) =>
  t(o.scope === "posting" ? "jobApplications.apply.cvPosting" : "jobApplications.apply.cvProfile", {
    version: o.version,
  });

/**
 * "Aplicar" na vaga (F07 §0-1): a candidatura só nasce aqui (e na extensão). Trava a versão do CV (obrigatória, F07-10)
 * e a da carta; a data é hoje e só muda pelo botão "Mudar a data", antes de confirmar. Com uma candidatura ativa na
 * vaga (F07-9), o botão vira o link para ela.
 */
export function ApplyButton({
  postingId,
  onGenerateCv,
}: {
  postingId: string;
  onGenerateCv: () => void;
}) {
  const options = useApplyOptions(postingId);
  const [open, setOpen] = useState(false);
  if (!options.data) return null;
  if (options.data.activeApplicationId)
    return (
      <NavLink
        to={`/candidaturas/${options.data.activeApplicationId}`}
        className={buttonClass({ variant: "outline", size: "sm" })}
      >
        {t("jobApplications.apply.view")}
      </NavLink>
    );
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {t("jobApplications.apply.button")}
      </Button>
      {open ? (
        <ApplyDialog
          postingId={postingId}
          cvs={options.data.cvs}
          coverLetters={options.data.coverLetters}
          onClose={() => setOpen(false)}
          onGenerateCv={() => {
            setOpen(false);
            onGenerateCv();
          }}
        />
      ) : null}
    </>
  );
}

function ApplyDialog({
  postingId,
  cvs,
  coverLetters,
  onClose,
  onGenerateCv,
}: {
  postingId: string;
  cvs: ApplyOption[];
  coverLetters: ApplyOption[];
  onClose: () => void;
  onGenerateCv: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const today = todayIn(tz);
  const [cv, setCv] = useState(cvs[0]?.versionId ?? "");
  const [letter, setLetter] = useState(coverLetters[0]?.versionId ?? "");
  const [editDate, setEditDate] = useState(false);
  const [appliedOn, setAppliedOn] = useState(today);
  const create = useMutation({
    mutationFn: () =>
      api.createJobApplication({
        postingId,
        cvVersionId: cv,
        coverLetterVersionId: letter || null,
        appliedOn,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
      await qc.invalidateQueries({ queryKey: postingKeys.all });
      onClose();
    },
  });
  const error =
    create.error instanceof ApiError && create.error.code === "duplicate_pending"
      ? t("jobApplications.apply.duplicatePending")
      : create.error?.message;
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={t("jobApplications.apply.title")}
    >
      {cvs.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("jobApplications.apply.needCv")}</p>
          <div>
            <Button type="button" size="sm" onClick={onGenerateCv}>
              {t("jobApplications.apply.generateCv")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t("jobApplications.apply.cv")}</legend>
            <div
              role="radiogroup"
              aria-label={t("jobApplications.apply.cv")}
              className="flex flex-col gap-1"
            >
              {cvs.map((o) => (
                <label key={o.versionId} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="cv"
                    value={o.versionId}
                    checked={cv === o.versionId}
                    onChange={() => setCv(o.versionId)}
                  />
                  {cvLabel(o)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("jobApplications.apply.letter")} htmlFor="apply-letter">
            <Select id="apply-letter" value={letter} onChange={(e) => setLetter(e.target.value)}>
              <option value="">{t("jobApplications.apply.noLetter")}</option>
              {coverLetters.map((o) => (
                <option key={o.versionId} value={o.versionId}>
                  {t("jobApplications.apply.letterOption", { version: o.version })}
                </option>
              ))}
            </Select>
          </Field>
          {editDate ? (
            <Field label={t("jobApplications.apply.date")} htmlFor="apply-date">
              <Input
                id="apply-date"
                type="date"
                max={today}
                value={appliedOn}
                onChange={(e) => setAppliedOn(e.target.value)}
              />
            </Field>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {t("jobApplications.apply.dateToday", {
                  date: formatDate(appliedOn, tz),
                })}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditDate(true)}>
                {t("jobApplications.apply.changeDate")}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-fg">{t("jobApplications.apply.locked")}</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!cv || !appliedOn || create.isPending}>
              {t("jobApplications.apply.confirm")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
