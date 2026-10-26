import { PhoneError, parsePhone, type Repos, trackInvalidation } from "@narnia-jobs/core";
import { AddressFormSchema, UserUpsertRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { emitInvalidated } from "./profiles";
import { validate } from "./validate";

const UserLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.url().refine((u) => /^https?:\/\//i.test(u), "Só links http(s)."),
});

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
  // F12-23: como o narnia se refere à pessoa (roleplay e motivações); nunca deduzido do nome
  app.put("/api/user/address", validate("json", z.object({ address: AddressFormSchema })), (c) => {
    if (!deps.repos.users.get())
      return apiError(c, 404, "user_not_found", "Cadastro não encontrado");
    const user = deps.repos.users.upsert({ pronouns: c.req.valid("json").address });
    return c.json({ user });
  });
  // F05-19: atalho do CV para cadastrar o link que falta (LinkedIn, GitHub, portfólio) sem refazer o cadastro inteiro
  app.post("/api/user/links", validate("json", UserLinkSchema), (c) => {
    const link = c.req.valid("json");
    const current = deps.repos.users.get();
    if (!current) return apiError(c, 404, "user_not_found", "Cadastro não encontrado");
    const links = current.links.some((l) => l.url === link.url)
      ? current.links
      : [...current.links, link];
    const { result: user, flipped } = trackInvalidation(deps.repos, () =>
      deps.repos.users.upsert({ links }),
    );
    emitInvalidated(deps.bus, flipped);
    return c.json({ user });
  });
  return app;
}
