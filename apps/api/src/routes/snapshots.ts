import { existsSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
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
    if (!isInsideSnapshots(deps.dataDir, abs))
      return apiError(c, 400, "invalid_snapshot_path", "Caminho do snapshot fora de snapshots/");
    rmSync(abs, { recursive: true, force: true });
    deps.repos.snapshots.remove(snap.id);
    return c.json({ ok: true });
  });

  return app;
}

/**
 * F03-fix L1 item 3: só apaga dentro de `<dados>/snapshots/` (nunca a própria pasta, nunca a de dados, nunca fora
 * por `..` ou por link simbólico: o caminho real é resolvido antes da comparação).
 */
export function isInsideSnapshots(dataDir: string, abs: string): boolean {
  const root = join(dataDir, "snapshots");
  if (!existsSync(root)) return false;
  const realRoot = realpathSync(root);
  const real = existsSync(abs) ? realpathSync(abs) : join(realRoot, relative(root, abs));
  const rel = relative(realRoot, real);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
}
