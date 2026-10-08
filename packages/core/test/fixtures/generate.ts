/**
 * Gera as fixtures binárias fictícias do core (rodar em container: `pnpm --filter @narnia-jobs/core exec tsx test/fixtures/generate.ts`).
 * Nenhum dado pessoal real: nomes, e-mails e telefones são inventados.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const run = promisify(execFile);
const here = new URL(".", import.meta.url).pathname;

export const CV_LINES_PAGE1 = [
  "ANA MARIA EXEMPLO",
  "Engenheira de Software | Campinas, SP | ana.exemplo@example.com | +55 (11) 98765-4321",
  "github.com/exemplo | linkedin.com/in/exemplo",
  "",
  "RESUMO",
  "Engenheira de software com 7 anos de experiência em backend, Go e Kubernetes.",
  "Foco em sistemas distribuídos, observabilidade e liderança técnica de times pequenos.",
  "",
  "EXPERIÊNCIA",
  "Acme Ltda — Engenheira de Software Sênior (CLT) — mar/2021 a nov/2023 — Campinas, SP",
  "- Reduziu a latência p95 da API de pagamentos em 40% com cache distribuído.",
  "- Liderou a migração de 12 serviços para Kubernetes, sem downtime.",
  "Globex S.A. — Desenvolvedora Pleno — jan/2018 a fev/2021 — São Paulo, SP (híbrido)",
  "- Implementou pipeline de CI/CD que cortou o tempo de deploy de 2 h para 15 min.",
  "- Mentorou 3 estagiários em Python e testes automatizados.",
];
export const CV_LINES_PAGE2 = [
  "FORMAÇÃO",
  "Unicamp — Bacharelado em Ciência da Computação — 2014 a 2018",
  "",
  "SKILLS",
  "Go, Python, Kubernetes, Docker, PostgreSQL, Kafka, Terraform, AWS, Prometheus",
  "",
  "IDIOMAS",
  "Português (nativo), Inglês (C1), Espanhol (B1)",
  "",
  "CERTIFICAÇÕES",
  "CKA — Certified Kubernetes Administrator (2022)",
];

async function makeTextPdf(path: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of [CV_LINES_PAGE1, CV_LINES_PAGE2]) {
    const page = pdf.addPage([595.28, 841.89]); // A4
    let y = 790;
    for (const line of lines) {
      const size = line === line.toUpperCase() && line.length > 3 && line.length < 20 ? 14 : 11;
      page.drawText(line, { x: 50, y, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 10;
    }
  }
  writeFileSync(path, await pdf.save());
}

async function makeScanPdf(textPdf: string, path: string) {
  const dir = join(tmpdir(), `narnia-fixture-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  await run("pdftoppm", ["-r", "150", "-png", textPdf, join(dir, "page")]);
  const pngs = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  const pdf = await PDFDocument.create();
  for (const png of pngs) {
    const img = await pdf.embedPng(readFileSync(join(dir, png)));
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  // página 3 em branco (teste: página em branco não gera texto)
  pdf.addPage([595.28, 841.89]);
  writeFileSync(path, await pdf.save());
  rmSync(dir, { recursive: true, force: true });
}

async function makeDocx(path: string) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Ana Maria Exemplo", heading: HeadingLevel.TITLE }),
          new Paragraph(
            "Engenheira de Software | Campinas, SP | ana.exemplo@example.com | +55 (11) 98765-4321",
          ),
          new Paragraph({ text: "Experiência", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Acme Ltda — Engenheira de Software Sênior — 2021 a 2023",
                bold: true,
              }),
            ],
          }),
          new Paragraph(
            "Reduziu a latência p95 da API de pagamentos em 40% com cache distribuído.",
          ),
          new Paragraph({ text: "Formação", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("Unicamp — Bacharelado em Ciência da Computação — 2014 a 2018"),
        ],
      },
    ],
  });
  writeFileSync(path, await Packer.toBuffer(doc));
}

async function main() {
  await makeTextPdf(join(here, "cv_text.pdf"));
  await makeScanPdf(join(here, "cv_text.pdf"), join(here, "cv_scan.pdf"));
  await makeDocx(join(here, "cv.docx"));
  writeFileSync(
    join(here, "cv_text.lines.json"),
    JSON.stringify([...CV_LINES_PAGE1, ...CV_LINES_PAGE2], null, 2),
  );
  console.log("fixtures geradas em", here);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
