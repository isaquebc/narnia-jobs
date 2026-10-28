import {
  formatDateOnly,
  formatInUserTz,
  googleCalendarUrl,
  JOB_APPLICATION_TOOLS,
  type JobApplication,
  type JobApplicationColumn,
  type JobApplicationEvent,
  type JobApplicationToolName,
  type PostingContact,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { addJobApplicationEvent, upcomingJobApplicationEvents } from "./agenda";
import { addJobApplicationEntry } from "./entries";
import { JobApplicationError, listJobApplications, setCurrentStage, summarize } from "./index";

/**
 * Handlers das tools das candidaturas (F07/M6). Texto curto, uma linha por item, com o link da candidatura na
 * interface; datas e horas no fuso do usuário. A cadeia de contatos são os contatos da vaga em ordem de data.
 */
type In<N extends JobApplicationToolName> = z.infer<(typeof JOB_APPLICATION_TOOLS)[N]["input"]>;
type Out<N extends JobApplicationToolName> = z.infer<(typeof JOB_APPLICATION_TOOLS)[N]["output"]>;
export type JobApplicationToolHandlers = {
  [N in JobApplicationToolName]: (input: unknown) => Promise<Out<N>>;
};

const COLUMN: Record<JobApplicationColumn, string> = {
  applied: "Aplicado",
  first_interview: "1ª Entrevista",
  in_process: "Em processo",
  offer: "Oferta",
  closed: "Encerrado",
};
const ROLE: Record<NonNullable<PostingContact["role"]>, string> = {
  recruiter: "recrutador(a)",
  hiring_manager: "gestor(a)",
  referral: "indicação",
  interviewer: "entrevistador(a)",
  other: "outro papel",
};
const ORIGIN: Record<PostingContact["origin"], string> = {
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "e-mail",
  other: "outro canal",
};

export const jobApplicationUrl = (id: string) => `/candidaturas/${id}`;

/** Contatos da vaga em ordem (data da conversa, depois a criação), numerados, com quem indicou quem. */
export function contactChain(contacts: PostingContact[]): Array<{ id: string; line: string }> {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const sorted = [...contacts].sort(
    (a, b) =>
      (a.contactedOn ?? "9999").localeCompare(b.contactedOn ?? "9999") ||
      a.createdAt.localeCompare(b.createdAt),
  );
  return sorted.map((c, i) => {
    const ref = c.referredById ? byId.get(c.referredById)?.name : null;
    const parts = [
      c.name,
      c.role ? ROLE[c.role] : null,
      ORIGIN[c.origin],
      c.contactedOn ? formatDateOnly(c.contactedOn) : null,
      ref ? `indicado(a) por ${ref}` : null,
      c.summary,
    ].filter(Boolean);
    return { id: c.id, line: `${i + 1}. ${parts.join(" · ")}` };
  });
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export function createJobApplicationTools(
  repos: Repos,
  ctx: {
    /** Endereço da api/interface para o link do `.ics` (`NARNIA_PUBLIC_URL`). */
    publicUrl: string;
    changed?: (applicationId: string) => void;
    now?: () => Date;
  },
): JobApplicationToolHandlers {
  const wrap = <N extends JobApplicationToolName>(
    name: N,
    impl: (input: In<N>) => Out<N> | Promise<Out<N>>,
  ) => {
    const def = JOB_APPLICATION_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(await impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };
  const now = () => ctx.now?.() ?? new Date();
  const tz = () => repos.users.get()?.timezone || "America/Sao_Paulo";
  const must = (id: string) => {
    const a = repos.jobApplications.get(id);
    if (!a) throw new JobApplicationError("not_found", `Candidatura não encontrada: ${id}`);
    return a;
  };
  const line = (a: JobApplication) => {
    const s = summarize(repos, a);
    const who = [s.posting.company, s.posting.client].filter(Boolean).join("/") || "(sem empresa)";
    const col =
      a.column === "in_process" && s.progress.total > 0
        ? `${COLUMN[a.column]} ${s.progress.current}/${s.progress.total}`
        : a.column === "closed" && a.closedReason
          ? `${COLUMN[a.column]} (${a.closedReason})`
          : COLUMN[a.column];
    return [
      who,
      s.posting.title,
      col,
      `aplicou em ${formatDateOnly(a.appliedOn)}`,
      a.archivedAt ? "arquivada" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const eventLine = (e: JobApplicationEvent) =>
    [
      `${e.title} (${e.kind})`,
      `${formatInUserTz(e.startsAt, tz())} (${tz()})`,
      `${e.durationMin} min`,
      e.doneAt ? "concluído" : Date.parse(e.startsAt) < now().getTime() ? "atrasado" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const icsUrl = (e: JobApplicationEvent) =>
    `${ctx.publicUrl.replace(/\/$/, "")}/api/job-applications/${e.applicationId}/events/${e.id}/calendar.ics`;
  const stageOf = (a: JobApplication, stage: string) => {
    const s = a.stages.find((x) => x.id === stage || norm(x.name) === norm(stage));
    if (!s)
      throw new JobApplicationError(
        "stage_not_found",
        `Etapa "${stage}" não está no processo; as etapas são: ${a.stages.map((x) => x.name).join(", ")}`,
      );
    return s;
  };
  const done = (a: JobApplication) => {
    ctx.changed?.(a.id);
    return { id: a.id, line: line(a), url: jobApplicationUrl(a.id) };
  };

  return {
    "job_application.list": wrap("job_application.list", (i) => ({
      items: listJobApplications(repos, { q: i.query, archived: i.archived ?? false })
        .filter((a) => !i.column || a.column === i.column)
        .map((a) => ({ id: a.id, column: a.column, line: line(a), url: jobApplicationUrl(a.id) })),
    })),
    "job_application.get": wrap("job_application.get", (i) => {
      const a = must(i.id);
      const doc = (d: JobApplication["cv"], label: string) =>
        `${label} ${d.scope === "posting" ? "desta vaga" : "geral do perfil"} · versão ${d.version}`;
      return {
        id: a.id,
        postingId: a.postingId,
        line: line(a),
        column: a.column,
        closedReason: a.closedReason,
        appliedOn: a.appliedOn,
        archived: a.archivedAt !== null,
        stages: a.stages.map((s) => ({
          id: s.id,
          name: s.name,
          current: s.id === a.currentStageId,
        })),
        documents: [doc(a.cv, "CV"), ...(a.coverLetter ? [doc(a.coverLetter, "Carta")] : [])],
        contacts: contactChain(repos.postingContacts.list(a.postingId)),
        entries: repos.jobApplicationEntries
          .list(a.id)
          .slice(0, 10)
          .map((e) => ({
            id: e.id,
            line: [
              formatDateOnly(e.occurredOn),
              e.body ? e.body.slice(0, 300) : null,
              e.attachments.length
                ? `anexos: ${e.attachments.map((x) => x.fileName).join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          })),
        events: repos.jobApplicationEvents
          .list(a.id)
          .map((e) => ({ id: e.id, line: eventLine(e) })),
        url: jobApplicationUrl(a.id),
      };
    }),
    "job_application.move": wrap("job_application.move", (i) => {
      must(i.id);
      if (i.column === "closed" && !i.closedReason)
        throw new JobApplicationError(
          "stage_not_found",
          "Encerrar pede o motivo: hired, declined, rejected, withdrew ou no_response",
        );
      return done(
        repos.jobApplications.update(
          i.id,
          { column: i.column, ...(i.closedReason ? { closedReason: i.closedReason } : {}) },
          now(),
        ),
      );
    }),
    "job_application.set_stage": wrap("job_application.set_stage", (i) => {
      const a = must(i.id);
      return done(setCurrentStage(repos, a.id, stageOf(a, i.stage).id, now()));
    }),
    "job_application.add_note": wrap("job_application.add_note", (i) => {
      const a = must(i.id);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(now());
      // nota pela conversa: sem arquivos (o anexo entra pela página da candidatura)
      addJobApplicationEntry(
        repos,
        "",
        a.id,
        { occurredOn: i.occurredOn ?? today, body: i.body, files: [] },
        now(),
      );
      ctx.changed?.(a.id);
      return { id: a.id, url: jobApplicationUrl(a.id) };
    }),
    "job_application.schedule": wrap("job_application.schedule", (i) => {
      const a = must(i.id);
      const e = addJobApplicationEvent(
        repos,
        a.id,
        {
          kind: i.kind,
          title: i.title,
          startsLocal: i.startsLocal,
          timezone: tz(),
          durationMin: i.durationMin ?? 60,
          stageId: i.stage ? stageOf(a, i.stage).id : null,
          location: i.location ?? null,
          link: i.link ?? null,
          notes: i.notes ?? null,
        },
        now(),
      );
      ctx.changed?.(a.id);
      return {
        id: e.id,
        line: eventLine(e),
        googleCalendarUrl: googleCalendarUrl({
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          durationMin: e.durationMin,
          location: e.location,
          link: e.link,
          notes: e.notes,
          sequence: e.icsSequence,
          appUrl: `${ctx.publicUrl.replace(/\/$/, "")}${jobApplicationUrl(a.id)}`,
        }),
        icsUrl: icsUrl(e),
      };
    }),
    "job_application.set_google_event": wrap("job_application.set_google_event", (i) => {
      const e = repos.jobApplicationEvents.get(i.eventId);
      if (!e) throw new JobApplicationError("not_found", `Evento não encontrado: ${i.eventId}`);
      repos.jobApplicationEvents.setGoogleEventId(e.id, i.googleEventId);
      ctx.changed?.(e.applicationId);
      return { id: e.id, url: jobApplicationUrl(e.applicationId) };
    }),
    "job_application.upcoming": wrap("job_application.upcoming", (i) => {
      const u = upcomingJobApplicationEvents(repos, { hours: i.hours ?? 48 }, now());
      const item = (x: (typeof u.upcoming)[number]) => ({
        id: x.application.id,
        line: `${eventLine(x.event)} · ${x.application.company ?? "(sem empresa)"}`,
        url: jobApplicationUrl(x.application.id),
      });
      return { timezone: tz(), upcoming: u.upcoming.map(item), overdue: u.overdue.map(item) };
    }),
  };
}
