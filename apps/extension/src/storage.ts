/** Pareamento guardado no `chrome.storage.local` (F12/M1): endereço da instância, token e nome do dispositivo. */
export interface Pairing {
  instance: string;
  token: string;
  deviceName: string;
}

const KEYS = ["instance", "token", "deviceName"];

export async function loadPairing(): Promise<Partial<Pairing>> {
  return (await chrome.storage.local.get(KEYS)) as Partial<Pairing>;
}

export async function savePairing(p: Pairing): Promise<void> {
  await chrome.storage.local.set({ ...p });
}

export async function saveInstance(instance: string): Promise<void> {
  await chrome.storage.local.set({ instance });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(["token", "deviceName"]);
}
