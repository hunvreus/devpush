#!/usr/bin/env node
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createPrivateKey } from "node:crypto";
import { isIP } from "node:net";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const smoke = args.includes("--smoke");
const envIndex = args.indexOf("--env");
if (
  envIndex >= 0 &&
  (!args[envIndex + 1] || args[envIndex + 1].startsWith("--"))
) {
  console.error("Error: --env requires a file path.");
  process.exit(2);
}
const envPath = resolve(envIndex >= 0 ? args[envIndex + 1] : "app/.env");
const productionComposeEnv =
  envPath.endsWith("/deploy/.env.production") ||
  envPath.endsWith("/deploy/.env.production.example");

if (args.includes("-h") || args.includes("--help")) {
  console.log(`Validate devpush MVP configuration.

Usage:
  pnpm validate:config
  pnpm validate:config -- --smoke
  pnpm validate:config -- --remote
  pnpm validate:config -- --env deploy/.env.production --remote

Options:
  --env <path>  Environment file to read. Defaults to app/.env.
  --smoke       Require only config needed by local smoke checks.
  --remote      Require internet-reachable settings for real server validation.`);
  process.exit(0);
}

if (smoke && remote) {
  console.error("Error: --smoke and --remote cannot be used together.");
  process.exit(1);
}

const fileEnv = existsSync(envPath)
  ? parseEnvFile(readFileSync(envPath, "utf8"))
  : {};
const env = { ...fileEnv, ...process.env };
const errors = [];
const warnings = [];
const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

if (productionComposeEnv) {
  checkRequired("POSTGRES_PASSWORD");
} else {
  checkRequired("DATABASE_URL");
}
checkRequired("BETTER_AUTH_SECRET");
checkRequired("BETTER_AUTH_URL");

const appUrl = readUrl("BETTER_AUTH_URL");
if (appUrl) {
  if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    errors.push(
      "BETTER_AUTH_URL must be an origin only, without path, query, or fragment.",
    );
  }
  if (remote && appUrl.protocol !== "https:") {
    errors.push("BETTER_AUTH_URL must use https:// for remote MVP validation.");
  }
  if (remote && isPrivateOrLocalHost(appUrl.hostname)) {
    errors.push(
      "BETTER_AUTH_URL must be public, not localhost, for remote MVP validation.",
    );
  }
}

const authSecret = env.BETTER_AUTH_SECRET?.trim();
if (authSecret) {
  const weakSecret =
    authSecret.length < 32 ||
    authSecret === "dev-secret-change-me" ||
    authSecret === "dev-secret";
  if (weakSecret) {
    issue(
      "BETTER_AUTH_SECRET should be a generated secret with at least 32 characters.",
    );
  }
}

if (smoke) {
  finish();
}

if (
  productionComposeEnv &&
  env.POSTGRES_PASSWORD?.startsWith("replace-with-")
) {
  issue("POSTGRES_PASSWORD must be changed before running production Compose.");
}

checkPair("Google OAuth", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
checkPair("GitHub OAuth", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET");

checkRequired("GITHUB_APP_ID");
checkRequired("GITHUB_APP_NAME");
checkRequired("GITHUB_APP_PRIVATE_KEY");

if (env.GITHUB_APP_ID?.trim() && !/^\d+$/.test(env.GITHUB_APP_ID.trim())) {
  errors.push("GITHUB_APP_ID must be numeric.");
}

const privateKey = env.GITHUB_APP_PRIVATE_KEY;
if (privateKey) {
  try {
    createPrivateKey(privateKey.replaceAll("\\n", "\n"));
  } catch (error) {
    errors.push(
      `GITHUB_APP_PRIVATE_KEY is not a valid private key: ${error.message}`,
    );
  }
}

if (!env.GITHUB_APP_WEBHOOK_SECRET) {
  issue("GITHUB_APP_WEBHOOK_SECRET is required for GitHub App push webhooks.");
}

if (!env.EMAIL_FROM || !env.RESEND_API_KEY) {
  issue(
    "Email OTP requires EMAIL_FROM and RESEND_API_KEY. GitHub/Google OAuth can still work without OTP email.",
  );
}

if (!env.DEVPUSH_AGENT_BINARY_DIR && productionComposeEnv) {
  warnings.push(
    "DEVPUSH_AGENT_BINARY_DIR is not set because production Compose embeds agent binaries in the app image.",
  );
} else if (!env.DEVPUSH_AGENT_BINARY_DIR) {
  issue("DEVPUSH_AGENT_BINARY_DIR is required before adding real servers.");
} else {
  const binaryDir = resolve(env.DEVPUSH_AGENT_BINARY_DIR);
  for (const filename of [
    "devpush-agent-linux-amd64",
    "devpush-agent-linux-arm64",
  ]) {
    const binaryPath = resolve(binaryDir, filename);
    try {
      const stat = statSync(binaryPath);
      if (!stat.isFile()) {
        errors.push(
          `DEVPUSH_AGENT_BINARY_DIR entry is not a file: ${binaryPath}`,
        );
      } else {
        accessSync(binaryPath, constants.R_OK | constants.X_OK);
      }
    } catch (error) {
      errors.push(
        `DEVPUSH_AGENT_BINARY_DIR entry is not readable/executable: ${binaryPath}`,
      );
    }
  }
}

if (
  env.DEVPUSH_TRAEFIK_EMAIL &&
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.DEVPUSH_TRAEFIK_EMAIL)
) {
  errors.push("DEVPUSH_TRAEFIK_EMAIL must be a valid email address when set.");
}

if (appUrl) {
  const base = appUrl.origin;
  console.log("Expected OAuth callbacks:");
  console.log(`  Google:     ${base}/api/auth/callback/google`);
  console.log(`  GitHub:     ${base}/api/auth/callback/github`);
  console.log(`  GitHub App: ${base}/api/github/install/callback`);
  console.log("");
}

finish();

function checkRequired(name) {
  if (!env[name]?.trim()) {
    errors.push(`${name} is required.`);
  }
}

function checkPair(label, idName, secretName) {
  const hasId = Boolean(env[idName]?.trim());
  const hasSecret = Boolean(env[secretName]?.trim());
  if (hasId !== hasSecret) {
    errors.push(`${label} requires both ${idName} and ${secretName}.`);
  }
}

function readUrl(name) {
  const value = env[name]?.trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return null;
  }
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    localHostnames.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map((part) => Number(part));
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (ipVersion === 6) {
    return (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }

  return false;
}

function issue(message) {
  if (remote) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

function finish() {
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  console.log(
    smoke
      ? "Local smoke config validation passed."
      : remote
        ? "Remote MVP config validation passed."
        : "Local MVP config validation passed.",
  );
  process.exit(0);
}

function parseEnvFile(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }

  return values;
}
