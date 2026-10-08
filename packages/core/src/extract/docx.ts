import mammoth from "mammoth";
import { ExtractError } from "./errors";
import { normalizeFreeText } from "./free-text";

export async function extractDocxText(buffer: Uint8Array): Promise<{ text: string }> {
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return { text: normalizeFreeText(result.value) };
  } catch (e) {
    throw new ExtractError("corrupt", `DOCX ilegível: ${(e as Error).message}`);
  }
}
