import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = resolve(root, "docs");
const errors = [];
function findPages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? findPages(path) : entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}
const pages = findPages(docs);
const pageBySlug = new Map();
for (const page of pages) {
  const slug = basename(page, ".md");
  if (pageBySlug.has(slug)) errors.push(`Duplicate documentation filename: ${slug}.md`);
  pageBySlug.set(slug, page);
}
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
  }
}
visit(menu);
for (const name of entries) {
  if (name.includes("/") || !pageBySlug.has(name))
    errors.push(`Invalid navigation page: ${name}`);
}
for (const name of pages) {
  if (
    !/^---\n[\s\S]*?^description: .+$/m.test(
      readFileSync(name, "utf8"),
    )
  )
    errors.push(`Missing page description: ${name}`);
  if (!entries.includes(basename(name, ".md")))
    errors.push(`Page missing from navigation: ${name}`);
}
if (new Set(entries).size !== entries.length)
  errors.push("Duplicate navigation pages");
const sources = [
  ...pages,
  ...["README.md", "AGENTS.md", "app/README.md", "agent/README.md"].map(
    (name) => resolve(root, name),
  ),
];
for (const source of sources) {
  const isDoc = pages.includes(source);
  for (const [, raw] of text(source).matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = raw.replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (/^(https?:|mailto:|data:)/.test(target)) continue;
    if (isDoc && /^(?:\.\/)?[\w-]+\.md(?:#|$)/.test(target)) errors.push(`${relative(root, source)}: use a rendered /docs/page/ URL instead of a Markdown export: ${target}`);
    let [path, anchor] = target.split("#");
    if (path.startsWith("/docs/"))
      path = pageBySlug.get(path.slice(6).replace(/\/$/, "") || "index") ?? resolve(docs, "__missing__.md");
    else if (path.startsWith("/")) continue;
    else
      path = path ? resolve(dirname(source), decodeURIComponent(path)) : source;
    if (isDoc && relative(docs, path).startsWith(".."))
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
    `Documentation checked: ${pages.length} pages in grouped folders, navigation and local links.`,
  );
