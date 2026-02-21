/**
 * Setup script to store Bookface credentials in macOS Keychain.
 *
 * Usage:
 *   npx tsx src/setup.ts                  # interactive
 *   npx tsx src/setup.ts --delete         # remove stored credentials
 *
 * You need TWO cookies from messages.ycombinator.com:
 *   _sso.key       — stable SSO token (doesn't rotate)
 *   _bf_session_key — session key (rotates per-request, but that's fine)
 */

import { saveCredentials, deleteCredentials } from "./auth.js";
import { createInterface } from "readline";

const args = process.argv.slice(2);

if (args.includes("--delete")) {
  deleteCredentials();
  console.log("Deleted stored credentials from Keychain.");
  process.exit(0);
}

console.log(`YC Bookface MCP — Session Setup
================================

Steps:
  1. Open https://messages.ycombinator.com in your browser (log in if needed)
  2. Open DevTools (Cmd+Option+I) → Application → Cookies → messages.ycombinator.com
  3. You need TWO cookie values:

     _sso.key          (short, stable SSO token)
     _bf_session_key   (long, rotates but that's OK)
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const ssoKey = (await ask("Paste _sso.key value: ")).trim();
  if (!ssoKey) {
    console.error("No _sso.key provided.");
    process.exit(1);
  }

  const sessionKey = (await ask("Paste _bf_session_key value: ")).trim();
  if (!sessionKey) {
    console.error("No _bf_session_key provided.");
    process.exit(1);
  }

  // Strip cookie name prefix if user pasted "name=value"
  const sso = ssoKey.replace(/^_sso\.key=/, "");
  let session = sessionKey.replace(/^_bf_session_key=/, "");

  saveCredentials(sso, session);

  // Verify
  console.log("\nVerifying...");
  try {
    const res = await fetch(
      "https://messages.ycombinator.com/messages/application_shell.json",
      {
        headers: {
          Accept: "application/json",
          Cookie: `_sso.key=${sso}; _bf_session_key=${session}`,
        },
      }
    );
    if (res.ok) {
      console.log("Credentials valid. Stored in macOS Keychain.");
    } else if (res.status === 401) {
      console.error("WARNING: Got 401. Double-check both cookie values.");
      console.error("Credentials saved anyway — re-run setup to replace.");
    } else {
      console.error(`WARNING: Got ${res.status}. Credentials saved anyway.`);
    }
  } catch (e: any) {
    console.error(`Could not verify: ${e.message}. Credentials saved anyway.`);
  }

  rl.close();
}

main();
