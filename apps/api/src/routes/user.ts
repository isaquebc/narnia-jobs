import { PhoneError, parsePhone, type Repos } from "@narnia-jobs/core";
import { UserUpsertRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { validate } from "./validate";

/** Identidade e contato (F01 §3): telefone validado no servidor (país + DDD → E.164). */
export function userRoutes(deps: { repos: Repos }) {
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
    const user = deps.repos.users.upsert({
      ...rest,
      phone,
      pronouns: pronouns ?? null,
      region: region ?? null,
    });
    return c.json({ user });
  });
  return app;
}
