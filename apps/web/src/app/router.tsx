import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { ErrorState } from "../components/ErrorState";
import { Shell } from "../components/shell/Shell";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "../features/dashboard/Dashboard";
import { CaptureWindow } from "../features/extension/CaptureWindow";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { Wizard } from "../features/onboarding/Wizard";
import { NewProfilePage, type NewProfileSearch } from "../features/profiles/NewProfilePage";
import { PersonaOverrides } from "../features/profiles/PersonaOverrides";
import { PitchEditor } from "../features/profiles/PitchEditor";
import { ProfileCardView } from "../features/profiles/ProfileCardView";
import { ProfilePage, useProfile } from "../features/profiles/ProfilePage";
import { ProfilesPage } from "../features/profiles/ProfilesPage";
import { t } from "../i18n";
import type { AppServices } from "./context";
import { FormGuardProvider } from "./FormGuard";

export interface RouterContext {
  services: AppServices;
  queryClient: QueryClient;
}

/** Páginas sem o layout do narnia: a janela popup da extensão (F12-2, F12/M2). */
const BARE = ["/candidatura"];

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (BARE.includes(pathname))
    return (
      <TooltipProvider>
        <div data-layout="bare" className="min-h-screen bg-bg">
          <Outlet />
        </div>
      </TooltipProvider>
    );
  return (
    <TooltipProvider>
      <FormGuardProvider>
        <Shell>
          <Outlet />
        </Shell>
      </FormGuardProvider>
    </TooltipProvider>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <TooltipProvider>
      <Shell>
        <ErrorState error={error} onRetry={reset} />
      </Shell>
    </TooltipProvider>
  ),
  notFoundComponent: () => <ErrorState error={new Error(t("errors.notFound"))} />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const state = await context.queryClient.fetchQuery({
      queryKey: ["onboarding", "state"],
      queryFn: () => context.services.api.getOnboardingState(),
      staleTime: 0,
    });
    if (state.completed) throw redirect({ to: "/dashboard" });
    throw redirect({ to: "/onboarding/$step", params: { step: String(state.step) } });
  },
  component: () => null,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/$step",
  component: function OnboardingPage() {
    const { step } = onboardingRoute.useParams();
    return <Wizard step={Number(step) || 1} />;
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: Dashboard,
});

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/perfis",
  component: ProfilesPage,
});

const newProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/perfis/novo",
  validateSearch: (search: Record<string, unknown>): NewProfileSearch => {
    const out: NewProfileSearch = {};
    for (const k of [
      "cloneFrom",
      "suggestionId",
      "title",
      "seniority",
      "area",
      "market",
    ] as const) {
      const v = str(search[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  },
  component: function NewProfileRoute() {
    const search = newProfileRoute.useSearch();
    return <NewProfilePage search={search} />;
  },
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/perfis/$id",
  component: function ProfileLayout() {
    const { id } = profileRoute.useParams();
    return <ProfilePage id={id}>{(profile) => <Outlet key={profile.id} />}</ProfilePage>;
  },
});
// O quadro de ênfases carrega sob demanda: o `@dnd-kit` fica fora do bundle inicial (F02-4, F01-56).
const LazyEmphasisBoard = lazyRouteComponent(
  () => import("../features/profiles/EmphasisBoard"),
  "EmphasisBoard",
);
const profileEmphasisRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/enfases",
  component: function EmphasisTab() {
    const { id } = profileRoute.useParams();
    return <LazyEmphasisBoard profileId={id} />;
  },
});
const profilePitchRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/narrativa",
  component: function PitchTab() {
    const { id } = profileRoute.useParams();
    const profile = useProfile(id);
    return profile.data ? <PitchEditor key={profile.data.id} profile={profile.data} /> : null;
  },
});
const profilePersonaRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/recrutador",
  component: function PersonaTab() {
    const { id } = profileRoute.useParams();
    return <PersonaOverrides profileId={id} />;
  },
});
// F05 · Perfil › Currículo (sob demanda); `?gerar=1` vem do botão sugerido pelo recrutador
const LazyProfileCvTab = lazyRouteComponent(
  () => import("../features/documents/ProfileCvTab"),
  "ProfileCvTab",
);
const profileCvRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/curriculo",
  validateSearch: (s: Record<string, unknown>) => ({
    gerar: s.gerar === "1" || s.gerar === 1 ? "1" : undefined,
  }),
  component: function CvTab() {
    const { id } = profileRoute.useParams();
    const { gerar } = profileCvRoute.useSearch();
    const profile = useProfile(id);
    return profile.data ? (
      <LazyProfileCvTab profile={profile.data} openGenerate={gerar === "1"} />
    ) : null;
  },
});
const profileCardRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/cartao",
  component: function CardTab() {
    const { id } = profileRoute.useParams();
    return <ProfileCardView profileId={id} />;
  },
});

// F03 §4 — ingestão, execução, evidências, pendências e configurações. As páginas carregam sob demanda para não
// pesar o bundle inicial (F01-56); o sino e a página de pendências ficam no bundle principal (cabeçalho).
const IngestionPage = lazyRouteComponent(
  () => import("../features/ingestion/IngestionPage"),
  "IngestionPage",
);
const RunPage = lazyRouteComponent(() => import("../features/ingestion/RunPage"), "RunPage");
const ReposPage = lazyRouteComponent(() => import("../features/evidence/ReposPage"), "ReposPage");
const FilesPage = lazyRouteComponent(() => import("../features/evidence/FilesPage"), "FilesPage");
const RepoDetailPage = lazyRouteComponent(
  () => import("../features/evidence/RepoDetailPage"),
  "RepoDetailPage",
);
const SettingsPage = lazyRouteComponent(
  () => import("../features/settings/SettingsPage"),
  "SettingsPage",
);
const ingestionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ingestao",
  component: IngestionPage,
});
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ingestao/$runId",
  component: function RunRoute() {
    const { runId } = runRoute.useParams();
    return <RunPage key={runId} runId={runId} />;
  },
});
const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/evidencias/arquivos",
  component: FilesPage,
});
const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/evidencias/repositorios",
  component: ReposPage,
});
const repoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/evidencias/repositorios/$repoId",
  component: function RepoDetailRoute() {
    const { repoId } = repoDetailRoute.useParams();
    return <RepoDetailPage key={repoId} repoId={repoId} />;
  },
});
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pendencias",
  component: NotificationsPage,
});
// F04 · chat com o recrutador (sob demanda, fora do bundle inicial)
const ChatPage = lazyRouteComponent(() => import("../features/chat/ChatPage"), "ChatPage");
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: function ChatIndexRoute() {
    return <ChatPage />;
  },
});
const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  component: function ChatSessionRoute() {
    const { sessionId } = chatSessionRoute.useParams();
    return <ChatPage sessionId={sessionId} />;
  },
});
// F06 · vagas (sob demanda)
const PostingsPage = lazyRouteComponent(
  () => import("../features/postings/PostingsPage"),
  "PostingsPage",
);
const PostingPage = lazyRouteComponent(
  () => import("../features/postings/PostingPage"),
  "PostingPage",
);
const postingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vagas",
  component: PostingsPage,
});
const postingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vagas/$id",
  // `?nota=` abre a página com a nota pendente em destaque (link da pendência, F06-17)
  // F05: `?gerar=cv|cover_letter&perfil=` abre o "Gerar" (botão do recrutador); `?doc=` destaca um documento
  validateSearch: (s: Record<string, unknown>) => ({
    nota: typeof s.nota === "string" ? s.nota : undefined,
    gerar:
      s.gerar === "cv" || s.gerar === "cover_letter"
        ? (s.gerar as "cv" | "cover_letter")
        : undefined,
    perfil: typeof s.perfil === "string" ? s.perfil : undefined,
    doc: typeof s.doc === "string" ? s.doc : undefined,
  }),
  component: function PostingRoute() {
    const { id } = postingRoute.useParams();
    const { nota, gerar, perfil, doc } = postingRoute.useSearch();
    return (
      <PostingPage
        key={id}
        postingId={id}
        noteId={nota}
        generate={gerar}
        generateProfileId={perfil}
        documentId={doc}
      />
    );
  },
});
// F05 · processos em segundo plano (sob demanda)
const ProcessesPage = lazyRouteComponent(
  () => import("../features/processes/ProcessesPage"),
  "ProcessesPage",
);
const processesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/processos",
  component: ProcessesPage,
});
const ExtensionInstallPage = lazyRouteComponent(
  () => import("../features/extension/ExtensionInstallPage"),
  "ExtensionInstallPage",
);
const extensionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/extensao",
  component: ExtensionInstallPage,
});
// janela popup da extensão (F12-2, F12/M2): sem o menu do narnia (BARE no layout raiz)
const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/candidatura",
  validateSearch: (s: Record<string, unknown>) => ({
    captura: typeof s.captura === "string" ? s.captura : undefined,
    erro: typeof s.erro === "string" ? s.erro : undefined,
  }),
  component: function CaptureRoute() {
    const { captura, erro } = captureRoute.useSearch();
    return <CaptureWindow captureId={captura} error={erro} />;
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/configuracoes",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  dashboardRoute,
  profilesRoute,
  newProfileRoute,
  profileRoute.addChildren([
    profileEmphasisRoute,
    profilePitchRoute,
    profilePersonaRoute,
    profileCardRoute,
    profileCvRoute,
  ]),
  ingestionRoute,
  runRoute,
  filesRoute,
  reposRoute,
  repoDetailRoute,
  notificationsRoute,
  settingsRoute,
  extensionRoute,
  captureRoute,
  processesRoute,
  postingsRoute,
  postingRoute,
  chatRoute,
  chatSessionRoute,
]);

export function createAppRouter(opts: {
  services: AppServices;
  queryClient: QueryClient;
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    context: { services: opts.services, queryClient: opts.queryClient },
    ...(opts.history ? { history: opts.history } : {}),
    defaultPreload: false,
    // a janela não rola (Shell h-screen): quem rola é o <main>, então trocar de página volta ele ao topo (auditoria D)
    scrollToTopSelectors: ["window", "main"],
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
