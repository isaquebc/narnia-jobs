import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { ErrorState } from "../components/ErrorState";
import { Shell } from "../components/shell/Shell";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "../features/dashboard/Dashboard";
import { RepoDetailPage } from "../features/evidence/RepoDetailPage";
import { ReposPage } from "../features/evidence/ReposPage";
import { IngestionPage } from "../features/ingestion/IngestionPage";
import { RunPage } from "../features/ingestion/RunPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { Wizard } from "../features/onboarding/Wizard";
import { NewProfilePage, type NewProfileSearch } from "../features/profiles/NewProfilePage";
import { PersonaOverrides } from "../features/profiles/PersonaOverrides";
import { PitchEditor } from "../features/profiles/PitchEditor";
import { ProfileCardView } from "../features/profiles/ProfileCardView";
import { ProfilePage, useProfile } from "../features/profiles/ProfilePage";
import { ProfilesPage } from "../features/profiles/ProfilesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { t } from "../i18n";
import type { AppServices } from "./context";
import { FormGuardProvider } from "./FormGuard";

export interface RouterContext {
  services: AppServices;
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <TooltipProvider>
      <FormGuardProvider>
        <Shell>
          <Outlet />
        </Shell>
      </FormGuardProvider>
    </TooltipProvider>
  ),
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
const profileCardRoute = createRoute({
  getParentRoute: () => profileRoute,
  path: "/cartao",
  component: function CardTab() {
    const { id } = profileRoute.useParams();
    return <ProfileCardView profileId={id} />;
  },
});

// F03 §4 — ingestão, execução, evidências, pendências e configurações
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
  ]),
  ingestionRoute,
  runRoute,
  reposRoute,
  repoDetailRoute,
  notificationsRoute,
  settingsRoute,
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
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
