import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { ErrorState } from "../components/ErrorState";
import { Shell } from "../components/shell/Shell";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "../features/dashboard/Dashboard";
import { Wizard } from "../features/onboarding/Wizard";
import { t } from "../i18n";
import type { AppServices } from "./context";

export interface RouterContext {
  services: AppServices;
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <TooltipProvider>
      <Shell>
        <Outlet />
      </Shell>
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

const routeTree = rootRoute.addChildren([indexRoute, onboardingRoute, dashboardRoute]);

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
