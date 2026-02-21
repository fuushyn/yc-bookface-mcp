import { execSync } from "child_process";

const KEYCHAIN_SERVICE = "yc-bookface-mcp";
const KEYCHAIN_ACCOUNT_SSO = "sso-key";
const KEYCHAIN_ACCOUNT_SESSION = "session-key";
const MESSAGES_BASE = "https://messages.ycombinator.com";

let ssoKey: string | null = null;
let sessionKey: string | null = null;
let xsrfToken: string | null = null;

/**
 * Get credentials. Both _sso.key and _bf_session_key are required.
 * _sso.key is the stable SSO token, _bf_session_key rotates per-response.
 */
function loadCredentials(): { sso: string; session: string } {
  if (ssoKey && sessionKey) return { sso: ssoKey, session: sessionKey };

  // From env: expects "cookie string" format or individual vars
  const envCookie = process.env.YC_SESSION_COOKIE;
  if (envCookie) {
    const parsed = parseCookieString(envCookie);
    if (parsed.sso) ssoKey = parsed.sso;
    if (parsed.session) sessionKey = parsed.session;
  }

  // Individual env vars
  if (!ssoKey) ssoKey = process.env.YC_SSO_KEY || null;
  if (!sessionKey) sessionKey = process.env.YC_BF_SESSION_KEY || null;

  // From Keychain
  if (!ssoKey) ssoKey = readFromKeychain(KEYCHAIN_ACCOUNT_SSO);
  if (!sessionKey) sessionKey = readFromKeychain(KEYCHAIN_ACCOUNT_SESSION);

  if (!ssoKey || !sessionKey) {
    throw new Error(
      "Missing Bookface credentials. Need both _sso.key and _bf_session_key.\n" +
        "Run: npm run setup"
    );
  }

  return { sso: ssoKey, session: sessionKey };
}

/**
 * Parse a full cookie string like the one from browser DevTools "Copy all cookies".
 */
function parseCookieString(raw: string): { sso?: string; session?: string } {
  const result: { sso?: string; session?: string } = {};
  const ssoMatch = raw.match(/_sso\.key=([^;]+)/);
  if (ssoMatch) result.sso = ssoMatch[1].trim();
  const sessionMatch = raw.match(/_bf_session_key=([^;]+)/);
  if (sessionMatch) result.session = sessionMatch[1].trim();
  return result;
}

/**
 * Bootstrap XSRF token via a lightweight GET if we don't have one yet.
 * Must NOT call authedFetch to avoid infinite recursion.
 */
async function ensureXsrfToken(): Promise<void> {
  if (xsrfToken) return;
  const creds = loadCredentials();
  const res = await fetch(
    `${MESSAGES_BASE}/messages/application_shell.json`,
    {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${MESSAGES_BASE}/messages`,
        Cookie: `_sso.key=${creds.sso}; _bf_session_key=${creds.session}`,
      },
      redirect: "manual",
    }
  );
  updateFromResponse(res);
}

/**
 * Fetch wrapper for authenticated Bookface Messages API requests.
 */
export async function authedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const creds = loadCredentials();
  const method = (init.method || "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    await ensureXsrfToken();
  }

  const cookieParts = [
    `_sso.key=${creds.sso}`,
    `_bf_session_key=${creds.session}`,
  ];
  if (xsrfToken) cookieParts.push(`XSRF-TOKEN=${xsrfToken}`);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Origin: MESSAGES_BASE,
    Referer: `${MESSAGES_BASE}/messages`,
    Cookie: cookieParts.join("; "),
    ...(init.headers as Record<string, string>),
  };

  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    if (xsrfToken) {
      headers["X-CSRF-Token"] = xsrfToken;
    }
  }

  const res = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
  });

  // Track cookie rotation
  updateFromResponse(res);

  // Detect session expiry
  if (res.status === 401) {
    clearAuth();
    throw new Error("Session expired (401). Re-run: npm run setup");
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (
      location.includes("authenticate") ||
      location.includes("account.ycombinator.com") ||
      location.includes("login")
    ) {
      clearAuth();
      throw new Error("Session expired (redirect). Re-run: npm run setup");
    }
  }

  return res;
}

function updateFromResponse(res: Response): void {
  const setCookies: string[] =
    (res.headers as any).getSetCookie?.() ??
    res.headers.get("set-cookie")?.split(/, (?=[^;]*=)/) ??
    [];

  for (const c of setCookies) {
    const xm = c.match(/XSRF-TOKEN=([^;]+)/);
    if (xm) xsrfToken = xm[1];

    const sm = c.match(/_bf_session_key=([^;]+)/);
    if (sm) sessionKey = sm[1];
  }
}

export function clearAuth(): void {
  ssoKey = null;
  sessionKey = null;
  xsrfToken = null;
}

// ── macOS Keychain ─────────────────────────────────────────────────────────

function readFromKeychain(account: string): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const result = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w 2>/dev/null`,
      { encoding: "utf-8" }
    ).trim();
    if (result) {
      console.error(`[auth] Loaded ${account} from macOS Keychain.`);
      return result;
    }
  } catch {
    // Not found
  }
  return null;
}

function writeToKeychainEntry(account: string, value: string): void {
  if (process.platform !== "darwin") {
    throw new Error("Keychain storage is only supported on macOS.");
  }
  execSync(
    `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${value.replace(/"/g, '\\"')}" -U`,
    { encoding: "utf-8" }
  );
}

export function saveCredentials(sso: string, session: string): void {
  writeToKeychainEntry(KEYCHAIN_ACCOUNT_SSO, sso);
  writeToKeychainEntry(KEYCHAIN_ACCOUNT_SESSION, session);
}

export function deleteCredentials(): void {
  if (process.platform !== "darwin") return;
  for (const account of [KEYCHAIN_ACCOUNT_SSO, KEYCHAIN_ACCOUNT_SESSION]) {
    try {
      execSync(
        `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" 2>/dev/null`,
        { encoding: "utf-8" }
      );
    } catch {
      // Not found
    }
  }
}
