/** Token de boot (F01-7): chega em `?token=` na URL impressa pelo lançador, vira cookie via `/api/auth/enter`. */
const STORAGE_KEY = "narnia.token";

export function readTokenFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const token = params.get("token");
  return token && token.length > 0 ? token : null;
}

export function enterUrl(token: string): string {
  return `/api/auth/enter?token=${encodeURIComponent(token)}`;
}

export function stripTokenFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("token");
  const search = url.searchParams.toString();
  return `${url.origin}${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

export function saveToken(token: string, storage: Pick<Storage, "setItem"> = sessionStorage) {
  storage.setItem(STORAGE_KEY, token);
}

export function loadToken(storage: Pick<Storage, "getItem"> = sessionStorage): string | null {
  return storage.getItem(STORAGE_KEY);
}
