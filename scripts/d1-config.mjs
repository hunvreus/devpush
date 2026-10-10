import { resolve } from "node:path";

export const localD1Ids = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
];

export function getD1Bindings(config, { local = false } = {}) {
  const bindings = ["DEVPUSH_DATABASE", "DEVPUSH_LOG_DATABASE"].map(
    (binding) => {
      const matches =
        config.d1_databases?.filter((item) => item.binding === binding) ?? [];
      if (matches.length !== 1)
        throw new Error(`Configure exactly one ${binding} D1 binding.`);
      const item = matches[0];
      if (!item.database_name?.trim() || !item.migrations_dir?.trim())
        throw new Error(
          `${binding} needs a database name and migrations directory.`,
        );
      if (!item.database_id)
        throw new Error(
          `${binding} needs a database ID, including for local development.`,
        );
      if (
        !local &&
        (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          item.database_id ?? "",
        ) ||
          /^0+$/.test(item.database_id.replaceAll("-", "")) ||
          localD1Ids.includes(item.database_id))
      )
        throw new Error(
          `${binding} needs a configured D1 database ID. Run pnpm configure.`,
        );
      return item;
    },
  );
  const [main, logs] = bindings;
  if (
    main.database_name === logs.database_name ||
    (main.database_id &&
      main.database_id.toLowerCase() === logs.database_id?.toLowerCase()) ||
    resolve(main.migrations_dir) === resolve(logs.migrations_dir)
  )
    throw new Error(
      "Main data and logs must use different D1 databases and migration directories.",
    );
  return bindings;
}
