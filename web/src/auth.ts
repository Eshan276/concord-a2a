// Two kinds of session: a company workspace token (tenant) and the network operator token (admin).
const KEY = { company: "concord.company-token", admin: "concord.admin-token" } as const;
export type Kind = keyof typeof KEY;

export const getToken = (k: Kind) => localStorage.getItem(KEY[k]) ?? "";
export const setToken = (k: Kind, t: string) => localStorage.setItem(KEY[k], t);
export const clearToken = (k: Kind) => localStorage.removeItem(KEY[k]);

export function api(path: string, kind: Kind, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${getToken(kind)}`, ...(init.headers ?? {}) },
  });
}

export function go(route: string) {
  location.hash = `#/${route}`;
}
