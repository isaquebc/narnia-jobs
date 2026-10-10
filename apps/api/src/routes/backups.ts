import { BACKUPS_MAX_KEY, listBackups, type Repos, readBackupsMax } from "@narnia-jobs/core";
import { BackupSettingsPutRequestSchema, type BackupSettingsResponse } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { validate } from "./validate";

/** Configuração dos backups (F03-fix L1, FX-2): teto total e o mais recente. Os arquivos não saem pela API. */
export function backupsRoutes(deps: { repos: Repos; backupDir: string | null }) {
  const app = new Hono();
  const view = (): BackupSettingsResponse => {
    const files = listBackups(deps.backupDir).filter((b) => /^narnia-(boot|pre-)/.test(b.file));
    const latest = files[0];
    return {
      max: readBackupsMax(deps.repos.db),
      enabled: deps.backupDir !== null,
      latest: latest ? { file: latest.file, at: latest.at } : null,
      count: files.length,
    };
  };
  app.get("/api/settings/backups", (c) => c.json(view()));
  app.put("/api/settings/backups", validate("json", BackupSettingsPutRequestSchema), (c) => {
    deps.repos.settings.set(BACKUPS_MAX_KEY, c.req.valid("json").max);
    return c.json(view());
  });
  return app;
}
