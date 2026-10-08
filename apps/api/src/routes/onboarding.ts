import type { Repos } from "@narnia-jobs/core";
import { type OnboardingState, OnboardingStateSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { validate } from "./validate";

export const ONBOARDING_KEY = "onboarding";
const DEFAULT_STATE: OnboardingState = { step: 1, completed: false };

export function readOnboarding(repos: Repos): OnboardingState {
  return repos.settings.get<OnboardingState>(ONBOARDING_KEY) ?? DEFAULT_STATE;
}

export function patchOnboarding(repos: Repos, patch: Partial<OnboardingState>): OnboardingState {
  const next = OnboardingStateSchema.parse({ ...readOnboarding(repos), ...patch });
  repos.settings.set(ONBOARDING_KEY, next);
  return next;
}

/** Wizard retomável (F01 §4): o passo atual e os ids do run/arquivo em andamento. */
export function onboardingRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/onboarding/state", (c) => c.json(readOnboarding(deps.repos)));
  app.put("/api/onboarding/state", validate("json", OnboardingStateSchema), (c) => {
    const body = c.req.valid("json");
    deps.repos.settings.set(ONBOARDING_KEY, body);
    return c.json(body);
  });
  return app;
}
