import type {
  RecordingAnalysis,
  RecordingPerson,
  RecordingReportContent,
  RecordingStep,
} from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useApi, useTimezone, useWs } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/input";
import { Progress } from "../../components/ui/progress";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { errorText } from "./errors";

/**
 * Página da entrevista gravada (F13/M6; plans/plan-v0/tasks/F13 §1 e §2.5, no padrão das telas atuais): vídeo, quem é
 * quem, relatório do recrutador na ordem aprovada pelo dono (F13-14), quadros, transcrição clicável com correção de
 * quem falou, refazer o relatório e conversar sobre a entrevista. Todo `[mm:ss]` vira botão que leva o vídeo ao trecho.
 */
export const recordingPageKey = (id: string) => ["recordings", "analysis", id] as const;

const mmss = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = String(Math.floor((v % 3600) / 60)).padStart(2, "0");
  const sec = String(v % 60).padStart(2, "0");
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};
const TIME_RE = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[–-]\d{1,2}:\d{2}(?::\d{2})?)?\]/g;
const toSec = (a: string, b: string, c?: string) =>
  c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);

type Seek = (s: number) => void;

function SeekButton({ at, onSeek }: { at: number; onSeek: Seek }) {
  return (
    <button
      type="button"
      className="font-mono text-xs text-primary underline"
      aria-label={t("recordingPage.seek", { at: mmss(at) })}
      onClick={() => onSeek(at)}
    >
      [{mmss(at)}]
    </button>
  );
}

/** Texto com os `[mm:ss]` como botões. */
function Timed({ text, onSeek }: { text: string; onSeek: Seek }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TIME_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(<SeekButton key={i} at={toSec(m[1] ?? "0", m[2] ?? "0", m[3])} onSeek={onSeek} />);
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-sm font-semibold">{title}</h3>
    {children}
  </section>
);

function useRecordingEvents(id: string) {
  const ws = useWs();
  const qc = useQueryClient();
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "recording.updated" && e.recordingId === id)
        void qc.invalidateQueries({ queryKey: ["recordings"] });
    });
  }, [ws, qc, id]);
}

function personLabel(p: RecordingPerson | undefined) {
  return p ? (p.name ?? `${p.key} · ${t("recordingPage.noName")}`) : "?";
}

function PersonCard({ recId, p }: { recId: string; p: RecordingPerson }) {
  const api = useApi();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name ?? "");
  const id = useId();
  const patch = useMutation({
    mutationFn: (body: { name?: string; isCandidate?: boolean }) =>
      api.patchRecordingPerson(recId, p.id, body),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: recordingPageKey(recId) });
    },
  });
  const m = p.measurements as {
    talkShare?: number;
    voice?: { wpm?: number; fillers_per_min?: number } | null;
    face?: { reliability?: { detected_pct: number; face_px: number; level: string } } | null;
  };
  const r = m.face?.reliability;
  const facts = [
    m.talkShare !== undefined
      ? t("recordingPage.talk", { pct: Math.round(100 * m.talkShare) })
      : null,
    m.voice?.wpm ? t("recordingPage.wpm", { n: Math.round(m.voice.wpm) }) : null,
    m.voice?.fillers_per_min !== undefined
      ? t("recordingPage.fillers", { n: String(m.voice.fillers_per_min).replace(".", ",") })
      : null,
    r
      ? t("recordingPage.face", { pct: String(r.detected_pct).replace(".", ","), px: r.face_px })
      : t("recordingPage.noFace"),
  ].filter(Boolean);
  const card = p.card as { role?: string; summary?: string } | null;
  const label = personLabel(p);
  return (
    <li className="flex flex-col gap-1 border-b border-border pb-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {p.key} · {label}
        </span>
        <Badge tone={p.isCandidate ? "ok" : "neutral"}>
          {p.isCandidate ? t("recordingPage.candidate") : t("recordingPage.other")}
        </Badge>
        {r ? (
          <Badge tone={r.level === "good" ? "ok" : r.level === "weak" ? "warn" : "danger"}>
            {r.level}
          </Badge>
        ) : null}
      </div>
      <span className="text-xs text-muted-fg">{facts.join(" · ")}</span>
      {card?.summary ? (
        <span className="text-xs">
          {card.role ? `${card.role}: ` : ""}
          {card.summary}
        </span>
      ) : null}
      {p.ambiguous ? <Alert tone="warn">{t("recordingPage.ambiguous")}</Alert> : null}
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) patch.mutate({ name: name.trim() });
          }}
        >
          <label htmlFor={id} className="sr-only">
            {t("recordingPage.rename", { name: label })}
          </label>
          <Input
            id={id}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
          />
          <Button type="submit" size="sm" disabled={!name.trim() || patch.isPending}>
            {t("recordingPage.renameSave")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          {!p.isCandidate ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ isCandidate: true })}
            >
              {t("recordingPage.markCandidate", { name: label })}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("recordingPage.rename", { name: label })}
          </Button>
        </div>
      )}
      {patch.isError ? <Alert tone="danger">{errorText(patch.error)}</Alert> : null}
    </li>
  );
}

function Report({ a, onSeek }: { a: RecordingAnalysis; onSeek: Seek }) {
  const r = a.report?.content as RecordingReportContent | undefined;
  const titleId = useId();
  const byKey = new Map(a.persons.map((p) => [p.key, p]));
  const turn = new Map(a.turns.map((x) => [x.idx, x]));
  const who = (key: string) => `${key} · ${personLabel(byKey.get(key))}`;
  if (!r || !a.report)
    return (
      <Card className="flex flex-col gap-2">
        <CardTitle>{t("recordingPage.report")}</CardTitle>
        <p className="text-sm text-muted-fg">{t("recordingPage.noReport")}</p>
      </Card>
    );
  const T = ({ text }: { text: string }) => <Timed text={text} onSeek={onSeek} />;
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      <CardTitle id={titleId}>{t("recordingPage.report")}</CardTitle>
      {r.score ? (
        <Section title={t("recordingPage.sections.score")}>
          <p className="text-sm">
            {r.score.overall === null ? (
              t("recordingPage.score.none")
            ) : (
              <>
                <span className="text-2xl font-semibold">{r.score.overall}</span>
                <span className="text-muted-fg"> / 100</span>
              </>
            )}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {r.score.criteria.map((c) => {
              const label = t(`recordingPage.score.${c.key}` as TKey);
              return (
                <li key={c.key} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>
                      {label} <span className="font-normal text-muted-fg">({c.weight}%)</span>
                    </strong>
                    <span>
                      {c.points === null
                        ? t("recordingPage.score.notMeasured")
                        : t("recordingPage.score.points", {
                            n: String(c.points).replace(".", ","),
                          })}
                    </span>
                  </span>
                  {c.points !== null ? (
                    <Progress value={c.points * 10} label={`${label}: ${c.points}/10`} />
                  ) : null}
                  <span className="text-muted-fg">
                    <T text={c.reason} />
                    {c.turns.map((idx) => {
                      const at = turn.get(idx)?.start;
                      return at === undefined ? null : (
                        <span key={idx}>
                          {" "}
                          <SeekButton at={at} onSeek={onSeek} />
                        </span>
                      );
                    })}
                  </span>
                  {c.key === "setup" ? (
                    <ul className="list-disc pl-5 text-muted-fg">
                      {r.score?.setup.map((s) => (
                        <li key={s.key}>
                          {t(`recordingPage.score.${s.key}` as TKey)}:{" "}
                          {s.points === null
                            ? t("recordingPage.score.notMeasured")
                            : t("recordingPage.score.points", {
                                n: String(s.points).replace(".", ","),
                              })}{" "}
                          · {s.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      <Section title={t("recordingPage.sections.verdict")}>
        <div className="flex items-center gap-2">
          <Badge
            tone={
              r.verdict.level === "strong" ? "ok" : r.verdict.level === "weak" ? "danger" : "warn"
            }
          >
            {t(`recordingPage.level.${r.verdict.level}` as TKey)}
          </Badge>
        </div>
        <p className="text-sm">
          <T text={r.verdict.summary} />
        </p>
        <ul className="list-disc pl-5 text-sm">
          {r.verdict.points.map((x) => (
            <li key={x}>
              <T text={x} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.shouldNot")}>
        <ul className="flex flex-col gap-2 text-sm">
          {r.shouldNotHaveSaid.map((x) => (
            <li key={`${x.turn}-${x.quote}`} className="flex flex-col gap-1">
              <span>
                <SeekButton at={x.t} onSeek={onSeek} /> “{x.quote}”
              </span>
              <span>
                <strong>{t("recordingPage.observed")}:</strong> <T text={x.observed} />
              </span>
              <span>
                <strong>{t("recordingPage.interpretation")}:</strong> <T text={x.interpretation} />
              </span>
              <span>
                <strong>{t("recordingPage.better")}:</strong> <T text={x.better} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.answers")}>
        <ul className="flex flex-col gap-3 text-sm">
          {r.answers.map((x) => (
            <li key={`${x.questionTurn}-${x.question}`} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <SeekButton at={x.t} onSeek={onSeek} />
                <strong>
                  {t("recordingPage.question")}: {x.question}
                </strong>
                <Badge tone="warn">{t(`recordingPage.problem.${x.problem}` as TKey)}</Badge>
                <span className="text-xs text-muted-fg">
                  {t(`recordingPage.certainty.${x.certainty}` as TKey)}
                </span>
              </span>
              <span className="text-xs text-muted-fg">
                {x.answerTurns.map((n) => {
                  const tt = turn.get(n);
                  return tt ? <SeekButton key={n} at={tt.start} onSeek={onSeek} /> : null;
                })}
              </span>
              <span>
                <strong>{t("recordingPage.missing")}:</strong> <T text={x.missing} />
              </span>
              <span>
                <strong>{t("recordingPage.suggestion")}:</strong> <T text={x.suggestion} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.worked")}>
        <ul className="flex flex-col gap-1 text-sm">
          {r.worked.map((x) => (
            <li key={`${x.turn}-${x.quote}`}>
              <SeekButton at={x.t} onSeek={onSeek} /> “{x.quote}” — <T text={x.why} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.discourse")}>
        <p className="text-sm">
          <T text={r.discourse.summary} />
        </p>
        <ul className="list-disc pl-5 text-sm">
          {r.discourse.points.map((x) => (
            <li key={x}>
              <T text={x} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.smile")}>
        {r.smile.alert ? <Alert tone="warn">{r.smile.alert}</Alert> : null}
        <ul className="list-disc pl-5 text-sm">
          {r.smile.observations.map((x) => (
            <li key={x}>
              <T text={x} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.reactions")}>
        <ul className="flex flex-col gap-1 text-sm">
          {r.notes.map((n) => {
            const ev = a.events.find((e) => e.key === n.event);
            return (
              <li key={n.event} className="flex flex-wrap items-center gap-2">
                <SeekButton at={n.t} onSeek={onSeek} />
                <span>{ev?.level ? t(`recordingPage.note.${ev.level}` as TKey) : n.event}</span>
                <Badge tone={n.reading === "indeterminate" ? "neutral" : "warn"}>
                  {t(`recordingPage.reading.${n.reading}` as TKey)}
                </Badge>
                <span className="text-xs">
                  <T text={n.reason} />
                </span>
              </li>
            );
          })}
          {r.reactions.map((x) => (
            <li key={`${x.person}-${x.observed}`}>
              {x.t !== null ? <SeekButton at={x.t} onSeek={onSeek} /> : null} {who(x.person)}:{" "}
              <T text={x.observed} />{" "}
              <em>
                (<T text={x.hypothesis} />)
              </em>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.setup")}>
        <ul className="flex flex-col gap-1 text-sm">
          {r.setup.people.map((x) => (
            <li key={x.person}>
              <strong>{who(x.person)}:</strong> {x.camera} {x.lighting} {x.audio}
            </li>
          ))}
        </ul>
        <ul className="list-disc pl-5 text-sm">
          {r.setup.tips.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.people")}>
        <ul className="flex flex-col gap-2 text-sm">
          {r.people.map((x) => (
            <li key={x.person} className="flex flex-col">
              <strong>
                {who(x.person)} · {x.role}
              </strong>
              <span>
                <T text={x.summary} />
              </span>
              {x.signals.length ? (
                <span className="text-xs text-muted-fg">{x.signals.join(" · ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("recordingPage.sections.drills")}>
        <ol className="list-decimal pl-5 text-sm">
          {r.drills.map((x) => (
            <li key={x.title}>
              <strong>{x.title}:</strong> <T text={x.how} />
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t("recordingPage.sections.limitations")}>
        <ul className="list-disc pl-5 text-sm">
          {r.limitations.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>
      {a.report.warnings.length ? (
        <details className="text-xs text-muted-fg">
          <summary>{t("recordingPage.warnings", { n: a.report.warnings.length })}</summary>
          <ul className="list-disc pl-5">
            {a.report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function Transcript({ a, onSeek }: { a: RecordingAnalysis; onSeek: Seek }) {
  const api = useApi();
  const qc = useQueryClient();
  const titleId = useId();
  const fix = useMutation({
    mutationFn: ({ turnId, personId }: { turnId: string; personId: string }) =>
      api.patchRecordingTurn(a.recording.id, turnId, personId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: recordingPageKey(a.recording.id) }),
  });
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-2">
      <CardTitle id={titleId}>{t("recordingPage.transcript")}</CardTitle>
      <ol className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto text-sm">
        {a.turns.map((x) => (
          <li key={x.id} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
            <span className="flex shrink-0 items-center gap-2">
              <SeekButton at={x.start} onSeek={onSeek} />
              <select
                aria-label={t("recordingPage.turnPerson", { n: x.idx })}
                value={x.personId ?? ""}
                onChange={(e) =>
                  e.target.value && fix.mutate({ turnId: x.id, personId: e.target.value })
                }
                className="h-8 rounded-md border border-border bg-card px-1 text-xs"
              >
                {x.personId ? null : <option value="">?</option>}
                {a.persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {personLabel(p)}
                  </option>
                ))}
              </select>
              {x.corrected ? (
                <span className="text-xs text-muted-fg">{t("recordingPage.corrected")}</span>
              ) : null}
            </span>
            <span>{x.text}</span>
          </li>
        ))}
      </ol>
      {fix.isError ? <Alert tone="danger">{errorText(fix.error)}</Alert> : null}
    </Card>
  );
}

function ChatBox({ id }: { id: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const open = useMutation({
    mutationFn: () => api.openRecordingChat(id, message.trim()),
    onSuccess: ({ session }) => void navigate({ to: `/chat/${session.id}` as string }),
  });
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{t("recordingPage.chat")}</CardTitle>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) open.mutate();
        }}
      >
        <Textarea
          aria-label={t("recordingPage.chat")}
          placeholder={t("recordingPage.chatPlaceholder")}
          rows={2}
          maxLength={4000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!message.trim() || open.isPending}>
            {t("recordingPage.chatSend")}
          </Button>
        </div>
        {open.isError ? <Alert tone="danger">{errorText(open.error)}</Alert> : null}
      </form>
    </Card>
  );
}

export function RecordingPage({ id, startAt }: { id: string; startAt?: number | undefined }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const video = useRef<HTMLVideoElement>(null);
  const peopleId = useId();
  useRecordingEvents(id);
  const q = useQuery({
    queryKey: recordingPageKey(id),
    queryFn: () => api.getRecordingAnalysis(id),
    refetchInterval: (query) => (query.state.data?.recording.state === "analyzing" ? 5000 : false),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["recordings"] });
  const analyze = useMutation({ mutationFn: () => api.analyzeRecording(id), onSuccess: refresh });
  const regenerate = useMutation({
    mutationFn: () => api.regenerateRecordingReport(id),
    onSuccess: refresh,
  });
  const seek: Seek = (s) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    v.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };
  if (q.isError) return <ErrorState error={q.error} />;
  const a = q.data;
  if (!a) return <p className="text-sm text-muted-fg">…</p>;
  const rec = a.recording;
  const stepLabel = rec.step ? t(`recordingPage.steps.${rec.step as RecordingStep}` as TKey) : "";
  const error = analyze.error ?? regenerate.error;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <NavLink
            to={
              rec.jobApplicationId
                ? `/candidaturas/${rec.jobApplicationId}`
                : `/perfis/${rec.profileId}/entrevistas`
            }
            className="text-xs text-muted-fg underline"
          >
            {rec.jobApplicationId ? t("recordingPage.backApplication") : t("recordingPage.back")}
          </NavLink>
          <h1 className="text-xl font-semibold">{rec.title ?? rec.fileName}</h1>
          <p className="text-sm text-muted-fg">
            {[formatDate(rec.createdAt, tz), rec.durationS ? mmss(rec.durationS) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rec.state === "ready" ? "ok" : rec.state === "failed" ? "danger" : "warn"}>
            {t(`recordings.state.${rec.state}` as TKey)}
          </Badge>
          {rec.analyzedAt && rec.state !== "analyzing" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              title={t("recordingPage.regenerateHint")}
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {t("recordingPage.regenerate")}
            </Button>
          ) : null}
          {rec.analyzedAt && rec.state !== "analyzing" && rec.hasVideo ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              title={t("recordingPage.reanalyzeHint")}
              disabled={analyze.isPending}
              onClick={() =>
                window.confirm(t("recordingPage.reanalyzeConfirm")) && analyze.mutate()
              }
            >
              {t("recordingPage.reanalyze")}
            </Button>
          ) : null}
          {!rec.analyzedAt &&
          (rec.state === "uploaded" || rec.state === "failed") &&
          rec.hasVideo ? (
            <Button
              type="button"
              size="sm"
              disabled={analyze.isPending}
              onClick={() => analyze.mutate()}
            >
              {rec.state === "failed" ? t("recordingPage.retry") : t("recordingPage.analyze")}
            </Button>
          ) : null}
        </div>
      </div>
      <Alert tone="warn">{t("videoAnalysis.rule")}</Alert>
      {rec.state === "analyzing" ? (
        <div className="flex flex-col gap-1">
          <Progress
            value={rec.progress}
            label={t("recordingPage.analyzing", { step: stepLabel, pct: rec.progress })}
          />
          <span className="text-xs text-muted-fg">
            {t("recordingPage.analyzing", { step: stepLabel, pct: rec.progress })}
          </span>
        </div>
      ) : null}
      {rec.state === "uploaded" && !rec.analyzedAt ? (
        <Alert tone="info">{t("recordingPage.waiting")}</Alert>
      ) : null}
      {rec.state === "failed" && rec.error ? <Alert tone="danger">{rec.error}</Alert> : null}
      {error ? <Alert tone="danger">{errorText(error)}</Alert> : null}
      {rec.approximate ? (
        <Alert tone="warn">
          {t("recordingPage.approximate")}{" "}
          <NavLink to="/configuracoes" className="underline">
            {t("recordingPage.approximateLink")}
          </NavLink>
        </Alert>
      ) : null}
      {rec.hasVideo ? (
        // biome-ignore lint/a11y/useMediaCaption: gravação da pessoa; a transcrição clicável está abaixo
        <video
          ref={video}
          src={api.recordingVideoUrl(id)}
          controls
          preload="metadata"
          className="max-h-[28rem] w-full rounded bg-black"
          onLoadedMetadata={(e) => {
            if (startAt !== undefined) e.currentTarget.currentTime = startAt;
          }}
        />
      ) : null}
      {a.persons.length ? (
        <Card role="region" aria-labelledby={peopleId} className="flex flex-col gap-2">
          <CardTitle id={peopleId}>{t("recordingPage.people")}</CardTitle>
          <p className="text-xs text-muted-fg">{t("recordingPage.peopleHint")}</p>
          <ul className="flex flex-col gap-2">
            {a.persons.map((p) => (
              <PersonCard key={`${p.id}:${p.name}:${p.isCandidate}`} recId={id} p={p} />
            ))}
          </ul>
        </Card>
      ) : null}
      {rec.analyzedAt ? <Report a={a} onSeek={seek} /> : null}
      {a.frames.length ? (
        <Card className="flex flex-col gap-2">
          <CardTitle>{t("recordingPage.frames")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {a.frames.map((f) => {
              const p = a.persons.find((x) => x.id === f.personId);
              const alt = t("recordingPage.frameAlt", { at: mmss(f.t), who: p ? p.key : "?" });
              return (
                <button
                  key={f.file}
                  type="button"
                  onClick={() => seek(f.t)}
                  className="flex flex-col text-xs"
                >
                  <img
                    src={api.recordingFrameUrl(id, f.file)}
                    alt={alt}
                    className="h-28 rounded border border-border"
                  />
                  <span>{alt}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}
      {a.turns.length ? <Transcript a={a} onSeek={seek} /> : null}
      {rec.analyzedAt ? <ChatBox id={id} /> : null}
    </div>
  );
}
