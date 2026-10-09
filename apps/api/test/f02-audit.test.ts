import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, VALID_PROFILE } from "./helpers";

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const PM = {
  ...VALID_PROFILE,
  name: "PM",
  targetTitle: "Project Manager",
  altTitles: [],
  area: "management",
};
const invalidated = (t: TestApp) =>
  t.events.filter((e) => e.type === "profile.card_invalidated") as Array<{ profileIds: string[] }>;

describe("Auditoria F02 (2026-10-08) · api", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("8. archive, unarchive e clone emitem profile.card_invalidated com os ids certos", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    const pm = (await (await t.api("/api/profiles", json("POST", PM))).json()) as { id: string };
    // cartões válidos dos dois
    await t.api(`/api/profiles/${seeded.profileId}/card`);
    await t.api(`/api/profiles/${pm.id}/card`);
    t.events.length = 0;

    expect((await t.api(`/api/profiles/${pm.id}/archive`, json("POST"))).status).toBe(200);
    expect(invalidated(t)).toEqual([{ type: "profile.card_invalidated", profileIds: [pm.id] }]);

    t.events.length = 0;
    expect((await t.api(`/api/profiles/${pm.id}/unarchive`, json("POST"))).status).toBe(200);
    expect(invalidated(t).map((e) => e.profileIds)).toEqual([[pm.id]]);

    t.events.length = 0;
    const clone = (await (
      await t.api(`/api/profiles/${seeded.profileId}/clone`, json("POST", { ...PM, name: "Clone" }))
    ).json()) as { id: string };
    const ev = invalidated(t);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.profileIds).toContain(clone.id);
  });

  it("9. GET emphasis devolve cardValid refletindo a validade do cartão", async () => {
    t = makeTestApp();
    const seeded = seedFixture(t.repos, "engineer");
    const before = (await (await t.api(`/api/profiles/${seeded.profileId}/emphasis`)).json()) as {
      cardValid: boolean;
    };
    expect(before.cardValid).toBe(false);
    await t.api(`/api/profiles/${seeded.profileId}/card`);
    const after = (await (await t.api(`/api/profiles/${seeded.profileId}/emphasis`)).json()) as {
      cardValid: boolean;
    };
    expect(after.cardValid).toBe(true);
  });
});
