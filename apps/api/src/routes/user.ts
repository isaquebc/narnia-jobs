import { PhoneError, parsePhone, type Repos, trackInvalidation } from "@narnia-jobs/core";
import { UserUpsertRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { emitInvalidated } from "./profiles";
import { validate } from "./validate";

/** Identidade e contato (F01 §3): telefone validado no servidor (país + DDD → E.164). */
export function userRoutes(deps: { repos: Repos; bus: EventBus }) {
  const app = new Hono();
  app.get("/api/user", (c) => c.json({ user: deps.repos.users.get() }));
  app.put("/api/user", validate("json", UserUpsertRequestSchema), (c) => {
    const body = c.req.valid("json");
    let phone: ReturnType<typeof parsePhone>;
    try {
      phone = parsePhone({ country: body.phone.country, national: body.phone.national });
    } catch (e) {
      if (e instanceof PhoneError) return apiError(c, 400, `phone_${e.code}`, e.message);
      throw e;
    }
    const { id: _id, pronouns, region, ...rest } = body;
    const { result: user, flipped } = trackInvalidation(deps.repos, () =>
      deps.repos.users.upsert({
        ...rest,
        phone,
        pronouns: pronouns ?? null,
        region: region ?? null,
      }),
    );
    emitInvalidated(deps.bus, flipped);
    return c.json({ user });
  });
  return app;
}
