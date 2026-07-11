const LEGACY_API_KEY_STORAGE_KEY = "vibe_trading_api_auth_key";
const AUTH_TOKEN_STORAGE_KEY = "vibe_trading_a_auth_token";
const AUTH_USER_STORAGE_KEY = "vibe_trading_a_auth_user";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin" | string;
  status: string;
}

export function getApiAuthKey(): string {
  return window.localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY) || "";
}

export function setApiAuthKey(value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    window.localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
}

export function getAuthToken(): string {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

export function getStoredAuthUser(): AuthUser | null {
  const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser): void {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getAuthToken());
}

export function isAdminUser(): boolean {
  return getStoredAuthUser()?.role === "admin";
}

export function authHeaders(): Record<string, string> {
  const key = getAuthToken() || getApiAuthKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function authQuerySuffix(): string {
  const key = getAuthToken() || getApiAuthKey();
  return key ? `api_key=${encodeURIComponent(key)}` : "";
}

export function withAuthQuery(url: string): string {
  const suffix = authQuerySuffix();
  if (!suffix) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${suffix}`;
}
