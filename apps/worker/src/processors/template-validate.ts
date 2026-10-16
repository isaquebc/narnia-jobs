import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTemplateZip,
  renderUserTemplate,
  SAMPLE_CV,
  type UserTemplate,
  userTemplatePreview,
  userTemplateZip,
} from "@narnia-jobs/core";
import type { WorkerDeps } from "../pipeline";
import type { TaskHandler } from "../tasks";
import { documentDeps } from "./cv-generate";

/**
 * Validação do template enviado (F05 §2.7, `template.validate`): lê o .zip, confere as regras (sandbox, F05-4), monta o
 * CV de exemplo com JavaScript desligado e a rede bloqueada e guarda a prévia (página 1). Inválido fica com a lista
 * dos motivos para a tela de Configurações; uma falha inesperada também vira inválido (não fica preso em "validando").
 */
export const templateValidate: TaskHandler = async (data, _ctx, deps) => {
  const { repos } = deps;
  const tpl = repos.cvTemplates.get(String(data.payload.templateId ?? ""));
  if (!tpl) return { skipped: "template_not_found" };
  const invalid = (errors: string[]) => {
    repos.cvTemplates.update(tpl.id, { status: "invalid", validationErrors: errors });
    return { templateId: tpl.id, status: "invalid", errors };
  };
  let zip: Buffer;
  try {
    zip = readFileSync(join(deps.dataDir, userTemplateZip(tpl.id)));
  } catch {
    return invalid(["O arquivo enviado não foi encontrado."]);
  }
  const read = readTemplateZip(zip);
  if (!read.ok) return invalid(read.errors);
  try {
    const rendered = await renderSample(deps, tpl.id, read.template);
    if (!rendered.ok) return invalid([rendered.message]);
  } catch (e) {
    return invalid([`Não consegui validar o modelo: ${(e as Error).message}`]);
  }
  return { templateId: tpl.id, status: "valid" };
};

async function renderSample(
  deps: WorkerDeps,
  id: string,
  template: UserTemplate,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const docs = documentDeps(deps);
  const paper = template.manifest.paper?.[0] ?? "A4";
  const html = renderUserTemplate(
    template,
    { ...SAMPLE_CV, meta: { ...SAMPLE_CV.meta, paper } },
    paper,
  );
  const pdf = await docs.render(html, paper, false);
  if (!pdf.ok) return { ok: false, message: `Não consegui montar o CV de exemplo: ${pdf.message}` };
  const tmp = mkdtempSync(join(tmpdir(), "narnia-template-"));
  try {
    writeFileSync(join(tmp, "exemplo.pdf"), pdf.pdf);
    const pages = await docs.pages(join(tmp, "exemplo.pdf"), tmp).catch(() => [] as string[]);
    // cópia, não rename: o /tmp do container e a pasta de dados ficam em dispositivos diferentes (EXDEV)
    if (pages[0]) {
      mkdirSync(join(deps.dataDir, "templates"), { recursive: true });
      copyFileSync(pages[0], join(deps.dataDir, userTemplatePreview(id)));
    }
    deps.repos.cvTemplates.update(id, {
      status: "valid",
      validationErrors: [],
      name: template.manifest.name,
      manifest: template.manifest,
      previewPath: pages[0] ? userTemplatePreview(id) : null,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: true };
}
