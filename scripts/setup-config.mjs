import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export const cloudflareTemplatePath = "app/wrangler.template.jsonc";
export const cloudflareConfigPath = "app/wrangler.jsonc";
export const cloudflareSecretsPath = "app/.cloudflare-secrets.json";
export const cloudflareDatabasePath = "app/.cloudflare-database.env";

export function createCloudflareConfig({
  bucketName,
  customDomain,
  hyperdriveId,
  template = {},
  vars,
  workersDev,
  workerName = template.name || "devpush",
} = {}) {
  const config = {
    ...template,
    name: workerName,
    ...(vars && Object.keys(vars).length > 0 ? { vars } : {}),
    ...(hyperdriveId
      ? {
          hyperdrive: [{ binding: "DEVPUSH_DATABASE", id: hyperdriveId }],
        }
      : {}),
    ...(bucketName
      ? {
          r2_buckets: [{ binding: "DEVPUSH_OBJECTS", bucket_name: bucketName }],
        }
      : {}),
  };

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
    const hyperdrive = config.hyperdrive?.find(
      (item) => item.binding === "DEVPUSH_DATABASE",
    );
    const bucket = config.r2_buckets?.find(
      (item) => item.binding === "DEVPUSH_OBJECTS",
    );

    return {
      bucketName: bucket?.bucket_name || "",
      customDomain:
        config.routes?.find((route) => route.custom_domain === true)?.pattern ||
        "",
      hyperdriveId: hyperdrive?.id || "",
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

export function readJsonConfig(filePath) {
  if (!existsSync(filePath)) return null;

  try {
    const config = JSON.parse(readFileSync(filePath, "utf8"));
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

  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    if (!match) continue;
    values[match[1]] = decodeEnvValue(match[2]);
  }
  return values;
}

export function upsertEnv(filePath, values) {
  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split(/\r?\n/u)
    : [];

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const line = `${key}=${encodeEnvValue(String(value))}`;
    const index = lines.findIndex((current) => current.startsWith(`${key}=`));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }

  writeFileAtomic(
    filePath,
    `${lines.join("\n").replace(/\n+$/gu, "")}\n`,
    0o600,
  );
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

export function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// URL.";
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return "Use an origin without a path, query, or fragment.";
    }
    return undefined;
  } catch {
    return "Enter a valid URL.";
  }
}

export function validatePostgresUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? undefined
      : "Use a postgres:// or postgresql:// URL.";
  } catch {
    return "Enter a valid PostgreSQL URL.";
  }
}

function encodeEnvValue(value) {
  if (!/[\s#"']/u.test(value)) return value;
  return `"${value.replace(/\r\n/gu, "\n").replace(/\n/gu, "\\n").replace(/"/gu, '\\"')}"`;
}

function decodeEnvValue(value) {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\n/gu, "\n").replace(/\\"/gu, '"');
}
