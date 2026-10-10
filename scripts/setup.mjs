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
  cloudflareSecretsPath,
  cloudflareTemplatePath,
  createCloudflareConfig,
  getCloudflareWorkersSubdomain,
  readCloudflareConfig,
  readEnv,
  readJsonConfig,
  upsertEnv,
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
        { value: "cloudflare", label: "Cloudflare Workers" },
        { value: "docker", label: "Docker Compose (self-hosted)" },
        { value: "local", label: "Local development" },
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
  const authUrl = existing.BETTER_AUTH_URL || baseUrl;
  const adminEmail = await askAdminEmail(existing.DEVPUSH_ADMIN_EMAIL);
  const database = await askDatabase(existing);
  const values = {
    ...database,
    BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || secret(),
    DEVPUSH_DATABASE_PATH:
      existing.DEVPUSH_DATABASE_PATH || ".data/devpush.sqlite",
    DEVPUSH_LOG_DATABASE_PATH:
      existing.DEVPUSH_LOG_DATABASE_PATH || ".data/logs.sqlite",
    DEVPUSH_MONITORING_RETENTION_DAYS:
      existing.DEVPUSH_MONITORING_RETENTION_DAYS || "7",
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
      "",
      "1. Start devpush: pnpm dev:start",
      `3. Open ${baseUrl}`,
      "3. Create a project and install the GitHub App when prompted.",
    ]
      .filter(Boolean)
      .join("\n"),
    "Next steps",
  );
  outro("Local configuration is complete. Nothing was deployed.");
}

async function setupDocker() {
  const envPath = resolve(root, "deploy/.env.production");
  const existing = readEnv(envPath);
  const baseUrl = await askBaseUrl(
    existing.DEVPUSH_BASE_URL || "https://devpush.example.com",
  );
  const authUrl = existing.BETTER_AUTH_URL || baseUrl;
  const adminEmail = await askAdminEmail(existing.DEVPUSH_ADMIN_EMAIL);
  const database = await askDatabase(existing);
  const values = {
    ...database,
    BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || secret(),
    DEVPUSH_BASE_URL: baseUrl,
    DEVPUSH_ADMIN_EMAIL: adminEmail,
    DEVPUSH_CRON_SECRET: existing.DEVPUSH_CRON_SECRET || secret(),
    DEVPUSH_SECRET_ENCRYPTION_KEY:
      existing.DEVPUSH_SECRET_ENCRYPTION_KEY || secret(),
    DEVPUSH_DATABASE_PATH:
      existing.DEVPUSH_DATABASE_PATH || "/app/storage/devpush.sqlite",
    DEVPUSH_LOG_DATABASE_PATH:
      existing.DEVPUSH_LOG_DATABASE_PATH || "/app/storage/logs.sqlite",
    DEVPUSH_MONITORING_RETENTION_DAYS:
      existing.DEVPUSH_MONITORING_RETENTION_DAYS || "7",
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
      "",
      "1. Start devpush: docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build",
      `3. Open ${baseUrl}`,
      "3. Create a project and install the GitHub App when prompted.",
    ].join("\n"),
    "Next steps",
  );
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
  const database = await askDatabase(
    { ...existingConfig?.vars, ...existingSecrets },
    "Cloudflare D1",
  );
  const remoteDatabase = Boolean(database.DEVPUSH_DATABASE_URL);
  const configuredResources = Boolean(
    existingConfig?.bucketName &&
    (remoteDatabase ||
      (existingConfig?.databaseId && existingConfig?.logDatabaseId)),
  );
  const workerName = await ask(
    text({
      message: "Worker name",
      initialValue:
        pendingConfig?.workerName || existingConfig?.workerName || "devpush",
      validate: validateWorkerName,
    }),
  );
  const identity = await ensureCloudflareLogin();
  const account = await getCloudflareAccount(
    identity,
    pendingConfig?.accountId || existingConfig?.accountId,
  );
  const origin = await askCloudflareOrigin({
    accountId: account.id,
    existingConfig,
    existingUrl:
      existingConfig?.vars.DEVPUSH_BASE_URL || existingSecrets.DEVPUSH_BASE_URL,
    workerName,
  });
  const baseUrl = origin.baseUrl;
  const authUrl =
    existingConfig?.vars.BETTER_AUTH_URL || existingSecrets.BETTER_AUTH_URL;
  const adminEmail = await askAdminEmail(
    existingConfig?.vars.DEVPUSH_ADMIN_EMAIL ||
      existingSecrets.DEVPUSH_ADMIN_EMAIL,
  );
  const email = await setupResend(existingSecrets);
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
                label: remoteDatabase
                  ? "Create R2 bucket"
                  : "Create R2 and two D1 databases",
              },
            ]),
        { value: "existing", label: "Use existing resources" },
      ],
    }),
  );
  let bucketName;
  const databases = remoteDatabase
    ? []
    : [
        {
          binding: "DEVPUSH_DATABASE",
          idKey: "databaseId",
          nameKey: "databaseName",
          label: "Main database",
          defaultName: workerName,
        },
        {
          binding: "DEVPUSH_LOG_DATABASE",
          idKey: "logDatabaseId",
          nameKey: "logDatabaseName",
          label: "Log database",
          defaultName: `${workerName}-logs`,
        },
      ];
  if (resourceMode === "configured") bucketName = existingConfig.bucketName;
  else if (resourceMode === "existing")
    bucketName = await ask(
      text({ message: "R2 bucket name", validate: required }),
    );
  else
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
  for (const database of databases) {
    const current =
      resourceMode === "configured"
        ? existingConfig
        : resourceMode === "resume"
          ? pendingConfig
          : null;
    database.id = current?.[database.idKey] || "";
    database.name = current?.[database.nameKey] || database.defaultName;
    if (resourceMode === "existing") {
      database.id = await ask(
        text({ message: `${database.label} D1 ID`, validate: required }),
      );
      database.name = await ask(
        text({
          message: `${database.label} name`,
          initialValue: database.name,
          validate: required,
        }),
      );
    } else if (!database.id)
      database.name = await ask(
        text({
          message: `New ${database.label.toLowerCase()} name`,
          initialValue: database.name,
          validate: required,
        }),
      );
  }
  if (
    !remoteDatabase &&
    (databases[0].name === databases[1].name ||
      (databases[0].id && databases[0].id === databases[1].id))
  )
    throw new Error("Main data and logs must use different D1 databases.");

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
        createCloudflareConfig({
          accountId: account.id,
          databaseName: databases[0]?.name,
          remoteDatabase,
          logDatabaseName: databases[1]?.name,
          template,
          workerName,
        }),
        0o644,
      );
    }
    try {
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
      for (const database of databases) {
        if (!database.id)
          await runWrangler([
            "d1",
            "create",
            database.name,
            "--binding",
            database.binding,
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
    if (
      !created?.bucketName ||
      (!remoteDatabase && (!created.databaseId || !created.logDatabaseId))
    ) {
      throw new Error(
        "Wrangler created resources but did not write all required bindings to app/wrangler.pending.jsonc.",
      );
    }
    bucketName = created.bucketName;
    for (const database of databases) {
      database.id = created[database.idKey];
      database.name = created[database.nameKey];
    }
  } else {
    await runWrangler(["r2", "bucket", "info", bucketName]);
    for (const database of databases)
      await runWrangler(["d1", "info", database.id]);
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
    ...database,
    BETTER_AUTH_SECRET: existingSecrets.BETTER_AUTH_SECRET || secret(),
    DEVPUSH_SECRET_ENCRYPTION_KEY:
      existingSecrets.DEVPUSH_SECRET_ENCRYPTION_KEY || secret(),
    ...email.values,
    ...github?.values,
  };
  if (!email.enabled) {
    delete secrets.EMAIL_FROM;
    delete secrets.RESEND_API_KEY;
  }
  delete secrets.BETTER_AUTH_URL;
  delete secrets.DEVPUSH_ADMIN_EMAIL;
  delete secrets.DEVPUSH_BASE_URL;
  writePrivateJson(secretsPath, secrets);
  writeFileAtomic(
    generatedPath,
    createCloudflareConfig({
      accountId: account.id,
      bucketName,
      customDomain: origin.customDomain,
      databaseId: databases[0]?.id,
      databaseName: databases[0]?.name,
      remoteDatabase,
      logDatabaseId: databases[1]?.id,
      logDatabaseName: databases[1]?.name,
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

  note(
    [
      "1. Apply both database migrations: pnpm --dir app db:migrate:cloudflare",
      "2. Deploy devpush: pnpm deploy:cloudflare",
      `3. Open ${baseUrl}`,
      "4. Sign in and create a project.",
      "5. Install the GitHub App when prompted by devpush.",
      "",
      "Optional preflight: pnpm validate:cloudflare",
      "Future updates: pull the new code and rerun pnpm deploy:cloudflare.",
      "Continuous deployment is not configured by this wizard.",
    ].join("\n"),
    "Next steps",
  );
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

async function setupResend(existing) {
  const configured = Boolean(existing.EMAIL_FROM && existing.RESEND_API_KEY);
  const enabled = await ask(
    confirm({
      message: configured
        ? "Keep email sign-in with Resend enabled?"
        : "Configure email sign-in with Resend?",
      initialValue: configured,
    }),
  );

  if (!enabled) {
    return { enabled: false, values: {} };
  }

  note(
    [
      "Email sign-in and team invitations use Resend.",
      "For production, use a sender on a domain verified in Resend.",
      "onboarding@resend.dev can only send test email to your Resend account address.",
    ].join("\n"),
    "Email",
  );
  const apiKey = await ask(
    password({
      message: configured
        ? "Resend API key (leave blank to keep it)"
        : "Resend API key",
      mask: "•",
      validate: (value) =>
        value || existing.RESEND_API_KEY
          ? undefined
          : "A Resend API key is required.",
    }),
  );
  const from = await ask(
    text({
      message: "Email sender",
      initialValue: existing.EMAIL_FROM || "devpush <onboarding@resend.dev>",
      validate: required,
    }),
  );

  return {
    enabled: true,
    values: {
      EMAIL_FROM: from,
      RESEND_API_KEY: apiKey || existing.RESEND_API_KEY,
    },
  };
}

async function ensureCloudflareLogin() {
  const progress = spinner();
  progress.start("Checking Cloudflare authentication");
  try {
    const identity = await runWranglerJson(["whoami", "--json"]);
    progress.stop("Cloudflare authentication confirmed");
    return identity;
  } catch {
    progress.stop("Cloudflare authentication required");
  }
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
  return runWranglerJson(["whoami", "--json"]);
}

async function getCloudflareAccount(identity, preferredAccountId = "") {
  const accounts = Array.isArray(identity?.accounts)
    ? identity.accounts.filter(
        (account) =>
          typeof account?.id === "string" && typeof account?.name === "string",
      )
    : [];
  if (accounts.length === 0) {
    throw new Error(
      "Wrangler did not return an authenticated Cloudflare account.",
    );
  }

  const preferred = accounts.find(
    (account) => account.id === preferredAccountId,
  );
  if (preferred) return preferred;
  if (accounts.length === 1) return accounts[0];

  const accountId = await ask(
    select({
      message: "Cloudflare account",
      options: accounts.map((account) => ({
        value: account.id,
        label: account.name,
      })),
    }),
  );
  return accounts.find((account) => account.id === accountId);
}

async function getCloudflareApiToken() {
  const credentials = await runWranglerJson(["auth", "token", "--json"], {
    sensitive: true,
  });
  if (typeof credentials?.token !== "string" || !credentials.token) {
    throw new Error("Wrangler did not return an authentication token.");
  }
  return credentials.token;
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

async function runWranglerJson(args, { sensitive = false } = {}) {
  const output = await runCaptured(
    "pnpm",
    ["--dir", "app", "exec", "wrangler", ...args],
    { sensitive },
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      sensitive
        ? "Wrangler returned an invalid authentication response."
        : `Wrangler ${args.join(" ")} returned invalid JSON.`,
    );
  }
}

function run(command, args, options) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, { cwd: root, ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolveCode(code ?? 1));
  });
}

function runCaptured(command, args, { sensitive = false } = {}) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(stdout);
      else {
        reject(
          new Error(
            sensitive
              ? "Wrangler authentication token retrieval failed."
              : stderr.trim() || "Wrangler command failed.",
          ),
        );
      }
    });
  });
}

async function askDatabase(existing, localLabel = "Local SQLite files") {
  const mode = await ask(
    select({
      message: "Where should devpush store its databases?",
      initialValue: existing.DEVPUSH_DATABASE_URL ? "remote" : "local",
      options: [
        { value: "local", label: localLabel },
        { value: "remote", label: "Turso / remote libSQL" },
      ],
    }),
  );
  const values = {};
  for (const store of [
    {
      label: "Main",
      url: "DEVPUSH_DATABASE_URL",
      token: "DEVPUSH_DATABASE_AUTH_TOKEN",
    },
    {
      label: "Logs",
      url: "DEVPUSH_LOG_DATABASE_URL",
      token: "DEVPUSH_LOG_DATABASE_AUTH_TOKEN",
    },
  ]) {
    if (mode === "local") {
      values[store.url] = "";
      values[store.token] = "";
      continue;
    }
    values[store.url] = await ask(
      text({
        message: `${store.label} database URL`,
        initialValue: existing[store.url] || "",
        validate: (value) => {
          try {
            const url = new URL(value);
            if (
              ["libsql:", "https:", "http:"].includes(url.protocol) &&
              url.hostname &&
              !url.username &&
              !url.password &&
              !url.hash
            ) {
              const main =
                values.DEVPUSH_DATABASE_URL &&
                new URL(values.DEVPUSH_DATABASE_URL);
              const identity = (target) =>
                `${target.hostname}:${target.port || (target.protocol === "http:" ? "80" : "443")}${target.pathname.replace(/\/$/, "")}`;
              if (main && identity(url) === identity(main))
                return "Use a separate database for logs.";
              return;
            }
          } catch {}
          return "Use a libsql://, https:// or http:// URL without embedded credentials.";
        },
      }),
    );
    values[store.token] =
      (await ask(
        password({
          message: `${store.label} database token (blank keeps an existing token, otherwise optional)`,
          mask: "•",
        }),
      )) ||
      existing[store.token] ||
      "";
  }
  return values;
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
  accountId,
  existingConfig,
  existingUrl = "",
  workerName,
}) {
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
    const progress = spinner();
    progress.start("Reading the Cloudflare workers.dev subdomain");
    let accountSubdomain;
    try {
      accountSubdomain = await getCloudflareWorkersSubdomain({
        accountId,
        apiToken: await getCloudflareApiToken(),
      });
      progress.stop("Cloudflare workers.dev subdomain found");
    } catch (error) {
      progress.stop("Could not read the Cloudflare workers.dev subdomain");
      throw error;
    }
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
    cancel("Setup cancelled.");
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
