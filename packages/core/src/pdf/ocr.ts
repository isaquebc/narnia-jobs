import { createWorker } from "tesseract.js";
import { type DetectedLanguage, detectLanguage } from "../extract/language";

export interface Recognizer {
  recognize(imagePath: string): Promise<{ text: string; confidence: number }>;
  terminate(): Promise<void>;
}

export interface OcrPage {
  page: number;
  text: string;
  /** 0–1 */
  confidence: number;
}

export interface OcrResult {
  pages: OcrPage[];
  text: string;
  /** Média da confiança das páginas com texto (0 se nenhuma). */
  quality: number;
  language: DetectedLanguage;
}

export interface TesseractOptions {
  langs?: string[];
  /** Pasta com `<lang>.traineddata.gz` (padrão: TESSDATA_PATH ou /usr/share/tessdata). */
  langPath?: string;
}

/** Subconjunto do worker do tesseract.js usado aqui (injetável em teste). */
export interface TesseractWorkerLike {
  recognize(image: string): Promise<{ data: { text?: string; confidence?: number } }>;
  terminate(): Promise<unknown>;
}
export type WorkerFactory = (langs: string[], langPath: string) => Promise<TesseractWorkerLike>;

const defaultFactory: WorkerFactory = (langs, langPath) =>
  createWorker(langs, 1, { langPath, gzip: true, cacheMethod: "none", logger: () => {} });

/** Leitura 2 (F01-3/F01-21): Tesseract em WASM, idiomas por+eng, dados locais (sem rede). */
export async function createTesseractRecognizer(
  opts: TesseractOptions = {},
  factory: WorkerFactory = defaultFactory,
): Promise<Recognizer> {
  const langs = opts.langs ?? ["por", "eng"];
  const langPath = opts.langPath ?? process.env.TESSDATA_PATH ?? "/usr/share/tessdata";
  const worker = await factory(langs, langPath);
  return {
    async recognize(imagePath) {
      const { data } = await worker.recognize(imagePath);
      return {
        text: data.text ?? "",
        confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
      };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

export async function ocrPages(imagePaths: string[], recognizer: Recognizer): Promise<OcrResult> {
  const pages: OcrPage[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const r = await recognizer.recognize(imagePaths[i] as string);
    const text = r.text.replace(/\r\n?/g, "\n").trim();
    pages.push({ page: i + 1, text, confidence: text ? r.confidence : 0 });
  }
  const withText = pages.filter((p) => p.text);
  const quality = withText.length
    ? withText.reduce((s, p) => s + p.confidence, 0) / withText.length
    : 0;
  const text = withText.map((p) => p.text).join("\n\n");
  return {
    pages,
    text,
    quality: Math.round(quality * 1000) / 1000,
    language: detectLanguage(text),
  };
}
