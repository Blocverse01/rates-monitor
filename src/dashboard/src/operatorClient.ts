import type { ManagerOptions, SocketOptions } from "socket.io-client";

const USER_KEY = "rates_operator_user";
const PASS_KEY = "rates_operator_pass";

export function getStoredOperatorAuth(): {
  username: string;
  password: string;
} | null {
  const username = sessionStorage.getItem(USER_KEY);
  const password = sessionStorage.getItem(PASS_KEY);
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

export function storeOperatorAuth(username: string, password: string): void {
  sessionStorage.setItem(USER_KEY, username);
  sessionStorage.setItem(PASS_KEY, password);
}

export function operatorAuthHeader(): Record<string, string> {
  const auth = getStoredOperatorAuth();
  if (!auth) {
    return {};
  }
  return {
    Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}`,
  };
}

export function operatorFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...operatorAuthHeader(),
      ...(init.headers ?? {}),
    },
  });
}

export function operatorSocketOptions(): Partial<
  ManagerOptions & SocketOptions
> {
  const auth = getStoredOperatorAuth();
  return {
    transports: ["websocket"],
    withCredentials: true,
    auth: auth ? { username: auth.username, password: auth.password } : {},
  };
}
