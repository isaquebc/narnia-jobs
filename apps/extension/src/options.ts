import { DEFAULT_INSTANCE, normalizeInstanceUrl, pairWithCode, testConnection } from "./client";
import { clearToken, loadPairing, saveInstance, savePairing } from "./storage";

/** Página de opções (F12/M1): endereço da instância, pareamento por código e teste da conexão. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const instanceInput = $<HTMLInputElement>("instance");
const codeInput = $<HTMLInputElement>("code");
const nameInput = $<HTMLInputElement>("device-name");
const status = $<HTMLParagraphElement>("status");

function show(text: string, tone: "ok" | "error" | "" = "") {
  status.textContent = text;
  status.className = tone;
}

function instanceOrError(): string | null {
  const instance = normalizeInstanceUrl(instanceInput.value);
  if (!instance)
    show("Endereço inválido: use o do narnia local, como http://127.0.0.1:3100.", "error");
  return instance;
}

async function refresh() {
  const p = await loadPairing();
  instanceInput.value = p.instance ?? DEFAULT_INSTANCE;
  nameInput.value = p.deviceName ?? "Chrome";
  if (!p.token) return show("Ainda não pareado.");
  const r = await testConnection(fetch, p.instance ?? DEFAULT_INSTANCE, p.token);
  if (r.ok) show(`Conectado como "${r.deviceName ?? p.deviceName}" (narnia ${r.version}).`, "ok");
  else show(r.message, "error");
}

$<HTMLFormElement>("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const instance = instanceOrError();
  if (!instance) return;
  if (!codeInput.value.trim()) return show("Cole o código mostrado em Configurações.", "error");
  show("Pareando…");
  const r = await pairWithCode(fetch, instance, codeInput.value, nameInput.value || "Chrome");
  if (!r.ok) return show(r.message, "error");
  await savePairing({ instance, token: r.token, deviceName: r.deviceName });
  codeInput.value = "";
  show(`Pareado como "${r.deviceName}". Pronto para usar.`, "ok");
});

$<HTMLButtonElement>("test").addEventListener("click", async () => {
  const instance = instanceOrError();
  if (!instance) return;
  await saveInstance(instance);
  await refresh();
});

$<HTMLButtonElement>("forget").addEventListener("click", async () => {
  await clearToken();
  show(
    "Desconectado neste navegador. Para remover no narnia, use Configurações › Extensão do navegador.",
  );
});

void refresh();
