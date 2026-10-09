import { rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { type Repos, resolveIngestSettings } from "@narnia-jobs/core";
import { Hono } from "hono";
import { apiError } from "../errors";

/** Gestão de espaço dos snapshots (F03-9): uso total, teto configurável e remoção manual. */
export function snapshotsRoutes(deps: { repos: Repos; dataDir: string }) {
  const app = new Hono();

  app.get("/api/snapshots", (c) =>
    c.json({
      snapshots: deps.repos.snapshots.list().map(({ path: _p, sha256: _s, ...rest }) => rest),
      totalBytes: deps.repos.snapshots.totalBytes(),
      maxBytes: resolveIngestSettings(deps.repos.settings).snapshotsMaxBytes,
    }),
  );

  app.delete("/api/snapshots/:id", (c) => {
    const snap = deps.repos.snapshots.get(c.req.param("id"));
    if (!snap) return apiError(c, 404, "not_found", "Snapshot não encontrado");
    const abs = isAbsolute(snap.path) ? snap.path : join(deps.dataDir, snap.path);
    // nunca apaga fora da pasta de dados
    if (!relative(deps.dataDir, abs).startsWith(".."))
      rmSync(abs, { recursive: true, force: true });
    deps.repos.snapshots.remove(snap.id);
    return c.json({ ok: true });
  });

  return app;
}
