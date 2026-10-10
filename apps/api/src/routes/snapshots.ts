import { existsSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  planSnapshotPrune,
  type Repos,
  resolveIngestSettings,
  syncSnapshotCapNotification,
} from "@narnia-jobs/core";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";

/** Gestão de espaço dos snapshots (F03-9): uso total, teto configurável e remoção manual. */
export function snapshotsRoutes(deps: { repos: Repos; dataDir: string; bus?: EventBus }) {
  const app = new Hono();
  const maxBytes = () => resolveIngestSettings(deps.repos.settings).snapshotsMaxBytes;
  /** Aviso de teto (correções F03, item 15): criado acima do teto, resolvido abaixo; retransmitido por WS. */
  const syncCap = () => {
    for (const ev of syncSnapshotCapNotification(deps.repos, maxBytes()))
      deps.bus?.emit({
        type: ev.created ? "notification.created" : "notification.updated",
        notification: ev.notification,
      });
  };
  const removeSnapshot = (snap: { id: string; path: string }): boolean => {
    const abs = isAbsolute(snap.path) ? snap.path : join(deps.dataDir, snap.path);
    if (!isInsideSnapshots(deps.dataDir, abs)) return false;
    rmSync(abs, { recursive: true, force: true });
    deps.repos.snapshots.remove(snap.id);
    return true;
  };

  // ordem de último uso, do menos usado para o mais usado (candidatos à limpeza primeiro)
  app.get("/api/snapshots", (c) => {
    syncCap();
    return c.json({
      snapshots: deps.repos.snapshots.lru().map(({ path: _p, sha256: _s, ...rest }) => rest),
      totalBytes: deps.repos.snapshots.totalBytes(),
      maxBytes: maxBytes(),
    });
  });

  app.post("/api/snapshots/prune", (c) => {
    let removed = 0;
    for (const snap of planSnapshotPrune(deps.repos, maxBytes()))
      if (removeSnapshot(snap)) removed++;
    syncCap();
    return c.json({ removed, totalBytes: deps.repos.snapshots.totalBytes(), maxBytes: maxBytes() });
  });

  app.delete("/api/snapshots/:id", (c) => {
    const snap = deps.repos.snapshots.get(c.req.param("id"));
    if (!snap) return apiError(c, 404, "not_found", "Snapshot não encontrado");
    if (!removeSnapshot(snap))
      return apiError(c, 400, "invalid_snapshot_path", "Caminho do snapshot fora de snapshots/");
    syncCap();
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
