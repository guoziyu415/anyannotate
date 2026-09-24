import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "website");
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
// The policy uses only paragraphs, headings, simple lists, emphasis and HTTPS links.
function renderPolicy(markdown) {
  return markdown.trim().split(/\n\s*\n/).map((block) => {
    const heading = /^(#{1,3}) (.+)$/.exec(block);
    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (block.startsWith("- ")) return `<ul>${block.split("\n").map((line) => `<li>${inline(line.replace(/^- /, ""))}</li>`).join("")}</ul>`;
    return `<p>${inline(block.replace(/\n/g, " "))}</p>`;
  }).join("\n");
}

await fs.mkdir(path.join(out, "assets"), { recursive: true });
for (const name of ["index.html", "styles.css"]) await fs.copyFile(path.join(root, "website", name), path.join(out, name));
for (const name of ["icon-32.png", "icon-128.png"]) await fs.copyFile(path.join(root, "chrome-extension", "icons", name), path.join(out, "assets", name));
await fs.copyFile(path.join(root, "docs", "screenshots", "chrome-annotation.png"), path.join(out, "assets", "chrome-annotation.png"));
const policy = await fs.readFile(path.join(root, "chrome-extension", "PRIVACY.md"), "utf8");
await fs.writeFile(path.join(out, "privacy.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Privacy Policy — AnyAnnotate</title><meta name="description" content="How AnyAnnotate handles selected text, annotations, local notes, and optional Google Docs saving."><link rel="canonical" href="https://guoziyu415.github.io/anyannotate/privacy.html"><link rel="icon" href="assets/icon-32.png"><link rel="stylesheet" href="styles.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header class="site-header wrap"><a class="brand" href="./"><img src="assets/icon-128.png" width="40" height="40" alt="">AnyAnnotate</a><nav aria-label="Main navigation"><a href="./">Home</a><a href="https://github.com/guoziyu415/anyannotate">GitHub ↗</a></nav></header><main id="main" class="wrap policy">${renderPolicy(policy)}</main><footer class="wrap site-footer"><span>AnyAnnotate</span><a href="./">Back to home</a></footer></body></html>\n`);
await fs.writeFile(path.join(out, ".nojekyll"), "");
for (const page of ["index.html", "privacy.html"]) {
  const html = await fs.readFile(path.join(out, page), "utf8");
  if (/<script\b/i.test(html) || !html.includes('lang="en"') || !html.includes("<h1>")) throw new Error(`Invalid static page: ${page}`);
  for (const [, target] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^https:\/\//.test(target)) continue;
    const localPath = target === "./" ? "index.html" : target;
    if (localPath.includes("..") || path.isAbsolute(localPath)) throw new Error(`Unsafe asset path: ${target}`);
    await fs.access(path.join(out, localPath));
  }
}
console.log(`Built and checked two English pages with local assets: ${out}`);
