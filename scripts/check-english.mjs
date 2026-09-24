import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  ".build",
  ".tools",
  "build",
  "dist",
  "node_modules",
  "icons",
]);
const ignoredFiles = new Set(["package-lock.json"]);
const ignoredRelativeDirectories = new Set(["plugins/anyannotate/data"]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".plist",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
]);
const cjkCharacters = /[\u3400-\u4DBF\u4E00-\u9FFF]/u;
const nonEnglishLocale = /\bzh(?:-|_)CN\b/u;
const failures = [];

function scan(directory) {
  if (ignoredRelativeDirectories.has(path.relative(root, directory))) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(absolutePath);
      continue;
    }
    if (ignoredFiles.has(entry.name) || !textExtensions.has(path.extname(entry.name))) continue;
    const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (cjkCharacters.test(line) || nonEnglishLocale.test(line)) {
        failures.push(`${path.relative(root, absolutePath)}:${index + 1}`);
      }
    });
  }
}

scan(root);
if (failures.length > 0) {
  console.error("Non-English CJK text found in repository files:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("English-only repository check passed.");
