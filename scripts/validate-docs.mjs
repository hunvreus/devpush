import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = resolve(root, "docs");
const errors = [];
const pages = readdirSync(docs).filter((name) => name.endsWith(".md"));
const text = (file) =>
  readFileSync(file, "utf8").replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
const headings = (file) => {
  const seen = new Map();
  return new Set(
    [...text(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, title]) => {
      const slug = title
        .trim()
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
        .replace(/\s/g, "-");
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      return count ? `${slug}-${count}` : slug;
    }),
  );
};
const menu = JSON.parse(readFileSync(resolve(docs, "docs.json"), "utf8")).menu;
const entries = [];
function visit(items) {
  for (const item of items) {
    if (typeof item === "string") entries.push(item);
    else if (item.items) visit(item.items);
    else if (item.slug) entries.push(item.slug);
  }
}
visit(menu);
for (const name of entries) {
  if (name.includes("/") || !pages.includes(`${name}.md`))
    errors.push(`Invalid navigation page: ${name}`);
}
for (const name of pages) {
  if (
    !/^---\n[\s\S]*?^description: .+$/m.test(
      readFileSync(resolve(docs, name), "utf8"),
    )
  )
    errors.push(`Missing page description: ${name}`);
  if (!entries.includes(name.slice(0, -3)))
    errors.push(`Page missing from navigation: ${name}`);
}
if (new Set(entries).size !== entries.length)
  errors.push("Duplicate navigation pages");
for (const name of readdirSync(docs)) {
  if (statSync(resolve(docs, name)).isDirectory())
    errors.push(`Documentation must be flat: ${name}/`);
}
const sources = [
  ...pages.map((name) => resolve(docs, name)),
  ...["README.md", "AGENTS.md", "app/README.md", "agent/README.md"].map(
    (name) => resolve(root, name),
  ),
];
for (const source of sources) {
  for (const [, raw] of text(source).matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = raw.replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (/^(https?:|mailto:|data:)/.test(target)) continue;
    if (dirname(source) === docs && /^(?:\.\/)?[\w-]+\.md(?:#|$)/.test(target)) errors.push(`${relative(root, source)}: use a rendered /docs/page/ URL instead of a Markdown export: ${target}`);
    let [path, anchor] = target.split("#");
    if (path.startsWith("/docs/"))
      path = resolve(docs, path.slice(6).replace(/\/$/, "") || "index") + ".md";
    else if (path.startsWith("/")) continue;
    else
      path = path ? resolve(dirname(source), decodeURIComponent(path)) : source;
    if (dirname(source) === docs && relative(docs, path).startsWith(".."))
      errors.push(
        `${relative(root, source)}: use a published repository URL for ${target}`,
      );
    if (!existsSync(path))
      errors.push(`${relative(root, source)}: missing ${target}`);
    else if (
      anchor &&
      extname(path) === ".md" &&
      !headings(path).has(decodeURIComponent(anchor))
    )
      errors.push(`${relative(root, source)}: missing heading ${target}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Documentation checked: ${pages.length} flat pages, navigation and local links.`,
  );
