import { localD1Ids } from "./d1-config.mjs";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { parse, printParseErrorCode } from "jsonc-parser";
import { parseEnv } from "node:util";
import { updateEnvSource } from "./env-file.mjs";

export const cloudflareTemplatePath = "app/wrangler.template.jsonc";
export const cloudflareConfigPath = "app/wrangler.jsonc";
export const cloudflareSecretsPath = "app/.cloudflare-secrets.json";

export function createCloudflareConfig({
  accountId,
  bucketName,
  customDomain,
  databaseId,
  databaseName = "devpush",
  remoteDatabase = false,
  logDatabaseId,
  logDatabaseName = "devpush-logs",
  template = {},
  vars,
  workersDev,
  workerName = template.name || "devpush",
} = {}) {
  const config = {
    ...template,
    name: workerName,
    ...(accountId ? { account_id: accountId } : {}),
    ...(vars && Object.keys(vars).length > 0 ? { vars } : {}),
    ...(databaseId ||
    logDatabaseId ||
    databaseName !== "devpush" ||
    logDatabaseName !== "devpush-logs"
      ? {
          d1_databases: [
            {
              binding: "DEVPUSH_DATABASE",
              database_id: databaseId || "",
              database_name: databaseName,
              migrations_dir: "src/server/db/migrations-sqlite",
            },
            {
              binding: "DEVPUSH_LOG_DATABASE",
              database_id: logDatabaseId || "",
              database_name: logDatabaseName,
              migrations_dir: "src/server/db/migrations-logs",
            },
          ],
        }
      : {}),
    ...(bucketName
      ? {
          r2_buckets: [{ binding: "DEVPUSH_OBJECTS", bucket_name: bucketName }],
        }
      : {}),
  };

  delete config.hyperdrive;
  if (remoteDatabase) delete config.d1_databases;

  if (customDomain) {
    config.workers_dev = false;
    config.routes = [{ pattern: customDomain, custom_domain: true }];
  } else if (workersDev !== undefined) {
    config.workers_dev = workersDev;
    delete config.routes;
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

export function readCloudflareConfig(filePath) {
  const config = readJsonConfig(filePath);
  if (!config) return null;

  try {
    const database = config.d1_databases?.find(
      (item) => item.binding === "DEVPUSH_DATABASE",
    );
    const logDatabase = config.d1_databases?.find(
      (item) => item.binding === "DEVPUSH_LOG_DATABASE",
    );
    const bucket = config.r2_buckets?.find(
      (item) => item.binding === "DEVPUSH_OBJECTS",
    );

    return {
      accountId: config.account_id || "",
      bucketName: bucket?.bucket_name || "",
      customDomain:
        config.routes?.find((route) => route.custom_domain === true)?.pattern ||
        "",
      databaseId: localD1Ids.includes(database?.database_id)
        ? ""
        : database?.database_id || "",
      databaseName: database?.database_name || "",
      logDatabaseId: localD1Ids.includes(logDatabase?.database_id)
        ? ""
        : logDatabase?.database_id || "",
      logDatabaseName: logDatabase?.database_name || "",
      vars:
        config.vars &&
        typeof config.vars === "object" &&
        !Array.isArray(config.vars)
          ? Object.fromEntries(
              Object.entries(config.vars).filter(
                ([, value]) => typeof value === "string",
              ),
            )
          : {},
      workerName: config.name || "devpush",
      workersDev: config.workers_dev !== false,
    };
  } catch {
    throw new Error(`Could not parse ${filePath}.`);
  }
}

export async function getCloudflareWorkersSubdomain({
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  const body = await response.json();
  const subdomain = body?.result?.subdomain;

  if (response.ok && body?.success === true && typeof subdomain === "string") {
    return subdomain;
  }

  const missing = body?.errors?.some((error) => error?.code === 10007);
  if (missing) {
    throw new Error(
      `This Cloudflare account has no workers.dev subdomain. Create one at https://dash.cloudflare.com/${accountId}/workers/onboarding, then rerun \`pnpm configure\`.`,
    );
  }

  const message = body?.errors?.find(
    (error) => typeof error?.message === "string",
  )?.message;
  throw new Error(
    `Cloudflare could not return the account workers.dev subdomain${message ? `: ${message}` : "."}`,
  );
}

export function readJsonConfig(filePath) {
  if (!existsSync(filePath)) return null;

  try {
    const errors = [];
    const config = parse(readFileSync(filePath, "utf8"), errors, {
      allowTrailingComma: true,
    });
    if (errors.length > 0) {
      const first = errors[0];
      throw new Error(
        `${printParseErrorCode(first.error)} at offset ${first.offset}`,
      );
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("The root value must be an object.");
    }
    return config;
  } catch (error) {
    throw new Error(
      `Could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readEnv(filePath) {
  if (!existsSync(filePath)) return {};

  return parseEnv(readFileSync(filePath, "utf8"));
}

export function upsertEnv(filePath, values) {
  const source = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileAtomic(filePath, updateEnvSource(source, values), 0o600);
}

export function writeFileAtomic(filePath, content, mode = 0o600) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, mode);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function validateMcpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full MCP endpoint URL.";
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href.includes("?") ||
    url.href.includes("#")
  )
    return "Use the full HTTP(S) /mcp endpoint without credentials, query or fragment.";
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const local = isLocalDevelopmentHostname(host);
  if (url.protocol === "http:" && !local)
    return "Use HTTPS for a public MCP endpoint; HTTP is only allowed for local development hosts.";
}

function isLocalDevelopmentHostname(host) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "host.lima.internal" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// URL.";
    }
    if (
      url.pathname !== "/" ||
      url.href.includes("?") ||
      url.href.includes("#")
    ) {
      return "Use an origin without a path, query, or fragment.";
    }
    if (url.username || url.password)
      return "Use an origin without embedded credentials.";
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (url.protocol === "http:" && !isLocalDevelopmentHostname(host))
      return "Use HTTPS except for local development hosts.";
    return undefined;
  } catch {
    return "Enter a valid URL.";
  }
}
