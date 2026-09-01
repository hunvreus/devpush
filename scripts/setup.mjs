#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { createGitHubApp } from "../app/scripts/github-app.mjs";
import {
  cloudflareConfigPath,
  cloudflareDatabasePath,
  cloudflareSecretsPath,
  cloudflareTemplatePath,
  createCloudflareConfig,
  readCloudflareConfig,
  readEnv,
  readJsonConfig,
  upsertEnv,
  validatePostgresUrl,
  validateUrl,
  writeFileAtomic,
} from "./setup-config.mjs";

const root = resolve(import.meta.dirname, "..");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    `Configure devpush\n\nUsage: pnpm configure\n\nThe interactive wizard configures local development, Cloudflare, or Docker Compose.`,
  );
  process.exit(0);
}

main().catch((error) => {
  cancel(toMessage(error));
  process.exitCode = 1;
});

async function main() {
  intro("devpush setup");
  const target = await ask(
    select({
      message: "Where will this devpush control plane run?",
      options: [
        { value: "local", label: "Local development" },
        { value: "cloudflare", label: "Cloudflare Workers" },
        { value: "docker", label: "Docker Compose (self-hosted)" },
      ],
    }),
  );

  if (target === "local") await setupLocal();
  else if (target === "cloudflare") await setupCloudflare();
  else await setupDocker();
}

async function setupLocal() {
  const envPath = resolve(root, "app/.env");
  const existing = readEnv(envPath);
  const baseUrl = await askBaseUrl(
    existing.DEVPUSH_BASE_URL || "http://localhost:7429",
  );
  const authUrl = await askAuthUrl(existing.BETTER_AUTH_URL);
  const adminEmail = await askAdminEmail(existing.DEVPUSH_ADMIN_EMAIL);
  const values = {
    BETTER_AUTH_URL: authUrl,
    BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || secret(),
    DATABASE_URL:
      existing.DATABASE_URL ||
      "postgres://devpush:devpush@localhost:7543/devpush",
    DEVPUSH_BASE_URL: baseUrl,
    DEVPUSH_ADMIN_EMAIL: adminEmail,
    DEVPUSH_SECRET_ENCRYPTION_KEY:
      existing.DEVPUSH_SECRET_ENCRYPTION_KEY || secret(),
  };
  const github = await setupGitHub(
    baseUrl,
    authUrl || baseUrl,
    Boolean(existing.GITHUB_APP_ID),
    (githubValues) => upsertEnv(envPath, githubValues),
  );
  Object.assign(values, github?.values);
  upsertEnv(envPath, values);

  note(
    [
      `Configuration: ${relative(envPath)}`,
      "Start: pnpm dev:start",
      "App: " + baseUrl,
    ]
      .filter(Boolean)
      .join("\n"),
    "Ready",
  );
  if (github)
    note(`Install the GitHub App:\n${github.installUrl}`, "Next step");
  outro("Local configuration is complete. Nothing was deployed.");
}

async function setupDocker() {
  const envPath = resolve(root, "deploy/.env.production");
  const existing = readEnv(envPath);
  const baseUrl = await askBaseUrl(
    existing.DEVPUSH_BASE_URL || "https://devpush.example.com",
  );
  const authUrl = await askAuthUrl(existing.BETTER_AUTH_URL);
  const adminEmail = await askAdminEmail(existing.DEVPUSH_ADMIN_EMAIL);
  const postgresPassword = await ask(
    password({
      message: "PostgreSQL password",
      mask: "•",
      validate: (value) =>
        value || existing.POSTGRES_PASSWORD
          ? undefined
          : "A password is required.",
    }),
  );
  const values = {
    BETTER_AUTH_URL: authUrl,
    BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || secret(),
    DEVPUSH_BASE_URL: baseUrl,
    DEVPUSH_ADMIN_EMAIL: adminEmail,
    DEVPUSH_CRON_SECRET: existing.DEVPUSH_CRON_SECRET || secret(),
    DEVPUSH_SECRET_ENCRYPTION_KEY:
      existing.DEVPUSH_SECRET_ENCRYPTION_KEY || secret(),
    POSTGRES_PASSWORD: postgresPassword || existing.POSTGRES_PASSWORD,
  };
  const github = await setupGitHub(
    baseUrl,
    authUrl || baseUrl,
    Boolean(existing.GITHUB_APP_ID),
    (githubValues) => upsertEnv(envPath, githubValues),
  );
  Object.assign(values, github?.values);
  upsertEnv(envPath, values);

  note(
    `Configuration: ${relative(envPath)}\nStart: docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build`,
    "Ready",
  );
  if (github)
    note(`Install the GitHub App:\n${github.installUrl}`, "Next step");
  outro("Docker configuration is complete. Nothing was started or deployed.");
}

async function setupCloudflare() {
  const secretsPath = resolve(root, cloudflareSecretsPath);
  const template = readJsonConfig(resolve(root, cloudflareTemplatePath));
  if (!template) {
    throw new Error(
      `Missing tracked Cloudflare template: ${cloudflareTemplatePath}.`,
    );
  }
  const generatedPath = resolve(root, cloudflareConfigPath);
  const pendingPath = resolve(root, "app/wrangler.pending.jsonc");
  const existingSecrets = readJson(secretsPath);
  const existingConfig = readCloudflareConfig(generatedPath);
  const pendingConfig = readCloudflareConfig(pendingPath);
  const existingDatabase = readEnv(resolve(root, cloudflareDatabasePath));
  const configuredResources = Boolean(
    existingConfig?.bucketName && existingConfig?.hyperdriveId,
  );
  const workerName = await ask(
    text({
      message: "Worker name",
      initialValue:
        pendingConfig?.workerName || existingConfig?.workerName || "devpush",
      validate: validateWorkerName,
    }),
  );
  const origin = await askCloudflareOrigin({
    existingConfig,
    existingUrl:
      existingConfig?.vars.DEVPUSH_BASE_URL || existingSecrets.DEVPUSH_BASE_URL,
    workerName,
  });
  const baseUrl = origin.baseUrl;
  const authUrl = await askAuthUrl(
    existingConfig?.vars.BETTER_AUTH_URL || existingSecrets.BETTER_AUTH_URL,
  );
  const adminEmail = await askAdminEmail(
    existingConfig?.vars.DEVPUSH_ADMIN_EMAIL ||
      existingSecrets.DEVPUSH_ADMIN_EMAIL,
  );
  note(
    [
      "Cloudflare does not create the application database.",
      "Provide an existing TLS PostgreSQL database from any reachable provider (for example Neon, Supabase, RDS, or a self-managed server).",
      "Setup creates Hyperdrive in front of that database; Supabase is not required.",
    ].join("\n"),
    "PostgreSQL",
  );
  const databaseInput = await ask(
    password({
      message: existingDatabase.DATABASE_URL
        ? "Production PostgreSQL connection URL (leave blank to keep it)"
        : "Production PostgreSQL connection URL",
      mask: "•",
      validate: (value) =>
        value
          ? validatePostgresUrl(value)
          : existingDatabase.DATABASE_URL
            ? undefined
            : "A PostgreSQL URL is required.",
    }),
  );
  const databaseUrl = databaseInput || existingDatabase.DATABASE_URL;
  const resourceMode = await ask(
    select({
      message: "Use existing Cloudflare storage resources or create them?",
      options: [
        ...(configuredResources
          ? [
              {
                value: "configured",
                label: "Keep the currently configured resources",
              },
            ]
          : []),
        ...(pendingConfig
          ? [
              {
                value: "resume",
                label: "Resume the interrupted resource setup",
              },
            ]
          : [
              {
                value: "create",
                label: "Create R2 and Hyperdrive resources",
              },
            ]),
        { value: "existing", label: "Use existing resources" },
      ],
    }),
  );
  let bucketName;
  let hyperdriveId;
  let hyperdriveName;

  if (resourceMode === "configured") {
    bucketName = existingConfig.bucketName;
    hyperdriveId = existingConfig.hyperdriveId;
  } else if (resourceMode === "existing") {
    bucketName = await ask(
      text({ message: "R2 bucket name", validate: required }),
    );
    hyperdriveId = await ask(
      text({ message: "Hyperdrive configuration ID", validate: required }),
    );
  } else {
    bucketName =
      resourceMode === "resume" && pendingConfig.bucketName
        ? pendingConfig.bucketName
        : await ask(
            text({
              message: "New R2 bucket name",
              initialValue: workerName,
              validate: required,
            }),
          );
    hyperdriveId = resourceMode === "resume" ? pendingConfig.hyperdriveId : "";
    if (!hyperdriveId) {
      hyperdriveName = await ask(
        text({
          message: "New Hyperdrive configuration name",
          initialValue: workerName,
          validate: required,
        }),
      );
    }
  }

  if (
    (resourceMode === "configured" ||
      (resourceMode === "resume" && pendingConfig.hyperdriveId)) &&
    existingDatabase.DATABASE_URL &&
    databaseUrl !== existingDatabase.DATABASE_URL
  ) {
    throw new Error(
      "The database URL changed, but the configured Hyperdrive still points to the previous database. Re-run `pnpm configure` and create or select the matching Hyperdrive configuration.",
    );
  }

  const proceed = await ask(
    confirm({
      message:
        resourceMode === "create"
          ? "Create these Cloudflare resources and write local deployment configuration?"
          : resourceMode === "resume"
            ? "Resume resource creation from the pending configuration?"
            : "Write local deployment configuration for these existing resources?",
      initialValue: true,
    }),
  );
  if (!proceed) {
    cancel("No files or Cloudflare resources were changed.");
    return;
  }

  if (resourceMode === "create" || resourceMode === "resume") {
    if (resourceMode === "create") {
      writeFileAtomic(
        pendingPath,
        createCloudflareConfig({ template, workerName }),
        0o644,
      );
    }
    try {
      await ensureCloudflareLogin();
      if (resourceMode === "create" || !pendingConfig.bucketName) {
        await runWrangler([
          "r2",
          "bucket",
          "create",
          bucketName,
          "--binding",
          "DEVPUSH_OBJECTS",
          "--update-config",
          "--config",
          "wrangler.pending.jsonc",
        ]);
      }
      if (resourceMode === "create" || !pendingConfig.hyperdriveId) {
        await runWrangler([
          "hyperdrive",
          "create",
          hyperdriveName,
          "--connection-string",
          databaseUrl,
          "--caching-disabled",
          "--binding",
          "DEVPUSH_DATABASE",
          "--update-config",
          "--config",
          "wrangler.pending.jsonc",
        ]);
      }
    } catch (error) {
      throw new Error(
        `${toMessage(error)} The previous generated config is unchanged. Check Cloudflare for partially created resources and app/wrangler.pending.jsonc before rerunning setup.`,
      );
    }
    const created = readCloudflareConfig(pendingPath);
    if (!created?.bucketName || !created.hyperdriveId) {
      throw new Error(
        "Wrangler created resources but did not write both bindings to app/wrangler.pending.jsonc.",
      );
    }
    bucketName = created.bucketName;
    hyperdriveId = created.hyperdriveId;
  } else {
    await ensureCloudflareLogin();
    await runWrangler(["r2", "bucket", "info", bucketName]);
    await runWrangler(["hyperdrive", "get", hyperdriveId]);
  }

  const github = await setupGitHub(
    baseUrl,
    authUrl || baseUrl,
    Boolean(existingSecrets.GITHUB_APP_ID),
    (githubValues) =>
      writePrivateJson(secretsPath, {
        ...existingSecrets,
        ...githubValues,
      }),
  );
  const secrets = {
    ...existingSecrets,
    BETTER_AUTH_SECRET: existingSecrets.BETTER_AUTH_SECRET || secret(),
    DEVPUSH_SECRET_ENCRYPTION_KEY:
      existingSecrets.DEVPUSH_SECRET_ENCRYPTION_KEY || secret(),
    ...github?.values,
  };
  delete secrets.BETTER_AUTH_URL;
  delete secrets.DEVPUSH_ADMIN_EMAIL;
  delete secrets.DEVPUSH_BASE_URL;
  writePrivateJson(secretsPath, secrets);
  writeFileAtomic(
    generatedPath,
    createCloudflareConfig({
      bucketName,
      customDomain: origin.customDomain,
      hyperdriveId,
      template,
      vars: {
        DEVPUSH_BASE_URL: baseUrl,
        ...(authUrl ? { BETTER_AUTH_URL: authUrl } : {}),
        ...(adminEmail ? { DEVPUSH_ADMIN_EMAIL: adminEmail } : {}),
      },
      workersDev: origin.workersDev,
      workerName,
    }),
    0o644,
  );
  rmSync(pendingPath, { force: true });
  upsertEnv(resolve(root, cloudflareDatabasePath), {
    DATABASE_URL: databaseUrl,
  });

  note(
    [
      `Wrangler: ${cloudflareConfigPath}`,
      `Secrets: ${cloudflareSecretsPath}`,
      `Database: ${cloudflareDatabasePath}`,
      "",
      "Validate without changing production: pnpm validate:cloudflare",
      "Migrate, publish agents, and deploy: pnpm deploy:cloudflare",
    ].join("\n"),
    "Next steps",
  );
  if (github) note(`Install the GitHub App:\n${github.installUrl}`, "GitHub");
  outro(
    "Cloudflare resources are configured. The application was not deployed.",
  );
}

async function setupGitHub(
  baseUrl,
  authUrl,
  configured = false,
  persist = async () => {},
) {
  const create = await ask(
    confirm({
      message: configured
        ? "Replace the currently configured GitHub App?"
        : "Create and configure a GitHub App now?",
      initialValue: !configured,
    }),
  );
  if (!create) return null;
  const ownerType = await ask(
    select({
      message: "Who should own the GitHub App?",
      options: [
        { value: "personal", label: "My personal account" },
        { value: "org", label: "A GitHub organization" },
      ],
    }),
  );
  const org =
    ownerType === "org"
      ? await ask(text({ message: "Organization slug", validate: required }))
      : "";

  return createGitHubApp({
    authUrl,
    baseUrl,
    onAuthorize: (url) =>
      note(`Approve the manifest in your browser:\n${url}`, "GitHub App"),
    org,
    ownerType,
    persist,
  });
}

async function ensureCloudflareLogin() {
  const status = await runWrangler(["whoami", "--json"], {
    allowFailure: true,
    quiet: true,
  });
  if (status === 0) return;
  const login = await ask(
    confirm({
      message: "Wrangler is not authenticated. Log in now?",
      initialValue: true,
    }),
  );
  if (!login)
    throw new Error(
      "Cloudflare authentication is required to create resources.",
    );
  await runWrangler(["login"]);
}

async function runWrangler(args, { allowFailure = false, quiet = false } = {}) {
  const progress = quiet ? null : spinner();
  progress?.start(`Running wrangler ${args.slice(0, 3).join(" ")}`);
  let code = 1;
  try {
    code = await run("pnpm", ["--dir", "app", "exec", "wrangler", ...args], {
      stdio: quiet ? "ignore" : "inherit",
    });
    if (code !== 0 && !allowFailure)
      throw new Error("Wrangler command failed.");
    return code;
  } finally {
    progress?.stop(code === 0 ? "Wrangler finished" : "Wrangler failed");
  }
}

function run(command, args, options) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, { cwd: root, ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolveCode(code ?? 1));
  });
}

async function askBaseUrl(initialValue) {
  const value = await ask(
    text({
      message: "Public control-plane URL",
      initialValue,
      validate: validateUrl,
    }),
  );
  return value.trim().replace(/\/+$/gu, "");
}

async function askAuthUrl(initialValue = "") {
  const value = await ask(
    text({
      message: "Authentication URL (blank uses the control-plane URL)",
      initialValue,
      validate: (input) => (input.trim() ? validateUrl(input) : undefined),
    }),
  );
  return value.trim().replace(/\/+$/gu, "");
}

async function askAdminEmail(initialValue = "") {
  const value = await ask(
    text({
      message:
        "Installation administrator email for admin access (blank uses the first user)",
      initialValue,
      validate: (value) =>
        !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
          ? undefined
          : "Enter a valid email address or leave it blank.",
    }),
  );
  return value.trim();
}

async function askCloudflareOrigin({
  existingConfig,
  existingUrl = "",
  workerName,
}) {
  const existingWorkersDevSubdomain = workersDevSubdomain(
    existingUrl,
    workerName,
  );
  const mode = await ask(
    select({
      message: "Which public origin should this deployment use?",
      initialValue: existingConfig?.customDomain ? "custom" : "workers-dev",
      options: [
        {
          value: "workers-dev",
          label: "workers.dev URL",
          hint: "recommended for the first deployment",
        },
        {
          value: "custom",
          label: "Custom domain",
          hint: "the domain must already be on this Cloudflare account",
        },
      ],
    }),
  );

  if (mode === "workers-dev") {
    const accountSubdomain = await ask(
      text({
        message: "Cloudflare workers.dev account subdomain",
        initialValue: existingWorkersDevSubdomain,
        placeholder: "your-account-subdomain",
        validate: validateDnsLabel,
      }),
    );
    const baseUrl = `https://${workerName}.${accountSubdomain}.workers.dev`;
    note(
      `${baseUrl}\nCloudflare returns this URL after deployment; setup records it now because authentication, GitHub callbacks, and generated agent installers need the final origin.`,
      "Public origin",
    );
    return { baseUrl, customDomain: "", workersDev: true };
  }

  const baseUrl = await ask(
    text({
      message: "Custom HTTPS control-plane URL",
      initialValue:
        existingConfig?.customDomain && existingUrl
          ? existingUrl
          : "https://devpush.example.com",
      validate: validateHttpsUrl,
    }),
  );
  const normalized = baseUrl.trim().replace(/\/+$/gu, "");
  return {
    baseUrl: normalized,
    customDomain: new URL(normalized).hostname,
    workersDev: false,
  };
}

async function ask(prompt) {
  const value = await prompt;
  if (isCancel(value)) {
    cancel("Setup cancelled. No remaining steps were run.");
    process.exit(0);
  }
  return value;
}

function secret() {
  return randomBytes(32).toString("base64url");
}

function required(value) {
  return value.trim() ? undefined : "This value is required.";
}

function validateDnsLabel(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value.trim())
    ? undefined
    : "Enter the account label before .workers.dev.";
}

function validateHttpsUrl(value) {
  const error = validateUrl(value);
  if (error) return error;
  return new URL(value).protocol === "https:"
    ? undefined
    : "Cloudflare custom domains must use https://.";
}

function validateWorkerName(value) {
  return validateDnsLabel(value) === undefined
    ? undefined
    : "Use a lowercase DNS-safe Worker name.";
}

function workersDevSubdomain(value, workerName) {
  try {
    const hostname = new URL(value).hostname;
    const suffix = ".workers.dev";
    if (!hostname.endsWith(suffix)) return "";
    const labels = hostname.slice(0, -suffix.length).split(".");
    return labels.length === 2 && labels[0] === workerName ? labels[1] : "";
  } catch {
    return "";
  }
}

function relative(path) {
  return path.replace(`${root}/`, "");
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    throw new Error(`Could not parse ${relative(path)}.`);
  }
}

function writePrivateJson(path, value) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}
