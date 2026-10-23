import {
  type ConnectionResult,
  DEFAULT_INSTANCE,
  disconnect,
  normalizeInstanceUrl,
  pairWithCode,
  testConnection,
} from "./client";
import { optionsView } from "./options-view";
import { clearToken, loadPairing, savePairing } from "./storage";

/**
 * Página de opções (F12/M1): sem pareamento, o formulário (endereço, código, nome); pareada, o estado da conexão com
 * "Testar conexão" e "Desconectar" (que remove o dispositivo no narnia também).
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("pair-form");
const connected = $<HTMLElement>("connected");
const instanceInput = $<HTMLInputElement>("instance");
const codeInput = $<HTMLInputElement>("code");
const nameInput = $<HTMLInputElement>("device-name");
const testButton = $<HTMLButtonElement>("test");
const forgetButton = $<HTMLButtonElement>("forget");
const status = $<HTMLParagraphElement>("status");

function show(text: string, tone: "ok" | "error" | "" = "") {
  status.textContent = text;
  status.className = tone;
}

async function render(check: boolean) {
  const p = await loadPairing();
  instanceInput.value = p.instance ?? DEFAULT_INSTANCE;
  nameInput.value = p.deviceName ?? "Chrome";
  $("connected-instance").textContent = p.instance ?? DEFAULT_INSTANCE;
  $("connected-name").textContent = p.deviceName ?? "";
  let c: ConnectionResult | null = null;
  if (p.token && check) {
    show("Testando a conexão…");
    testButton.disabled = true;
    c = await testConnection(fetch, p.instance ?? DEFAULT_INSTANCE, p.token);
    testButton.disabled = false;
  }
  const v = optionsView(p, c, new Date());
  form.hidden = v.mode !== "pair";
  connected.hidden = v.mode !== "connected";
  show(v.text, v.tone);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const instance = normalizeInstanceUrl(instanceInput.value);
  if (!instance)
    return show("Endereço inválido: use o do narnia local, como http://127.0.0.1:5173.", "error");
  if (!codeInput.value.trim()) return show("Cole o código mostrado em Configurações.", "error");
  show("Pareando…");
  const r = await pairWithCode(fetch, instance, codeInput.value, nameInput.value || "Chrome");
  if (!r.ok) return show(r.message, "error");
  await savePairing({ instance, token: r.token, deviceName: r.deviceName });
  codeInput.value = "";
  await render(true);
});

testButton.addEventListener("click", () => void render(true));

forgetButton.addEventListener("click", async () => {
  const p = await loadPairing();
  forgetButton.disabled = true;
  const r = p.token
    ? await disconnect(fetch, p.instance ?? DEFAULT_INSTANCE, p.token)
    : { ok: true as const };
  forgetButton.disabled = false;
  await clearToken();
  await render(false);
  if (r.ok) show("Desconectado. Para usar de novo, gere um código em Configurações e pareie.");
  else show(r.message, "error");
});

void render(true);
