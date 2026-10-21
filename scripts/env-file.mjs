import { parseEnv } from "node:util";

// Accept only encodings that round-trip through the runtime's dotenv parser.
export function encodeEnvValue(value) {
  const candidates = [JSON.stringify(value)];
  for (const quote of ["'", '"', "`"]) {
    if (!value.includes(quote)) candidates.push(`${quote}${value}${quote}`);
  }
  candidates.push(value);
  const encoded = candidates.find(
    (candidate) => parseEnv(`VALUE=${candidate}\n`).VALUE === value,
  );
  if (encoded === undefined)
    throw new Error("An environment value cannot be represented safely.");
  return encoded;
}

export function updateEnvSource(source, updates) {
  const lines = source.split(/\r?\n/u);
  const seen = new Set();
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u,
    );
    if (!match) {
      output.push(line);
      continue;
    }
    const [, key, value] = match;
    const block = [line];
    const quote = value[0];
    if (["'", '"', "`"].includes(quote) && !value.slice(1).includes(quote)) {
      while (++index < lines.length) {
        block.push(lines[index]);
        if (lines[index].includes(quote)) break;
      }
      if (index === lines.length)
        throw new Error(
          "Cannot update an unterminated quoted environment value.",
        );
    }
    if (Object.hasOwn(updates, key) && updates[key] !== undefined) {
      output.push(`${key}=${encodeEnvValue(String(updates[key]))}`);
      seen.add(key);
    } else output.push(...block);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && !seen.has(key))
      output.push(`${key}=${encodeEnvValue(String(value))}`);
  }
  return `${output.join("\n").replace(/\n+$/gu, "")}\n`;
}
