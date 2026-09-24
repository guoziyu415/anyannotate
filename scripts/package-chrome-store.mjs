import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { prepareStoreManifest } from "./lib/chrome-store-manifest.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "chrome-extension");
const developmentManifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "config/chrome-web-store.json"), "utf8"));
const manifest = prepareStoreManifest(developmentManifest, config);
if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error("Invalid extension version.");
const dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });
const archive = path.join(dist, `AnyAnnotate-Chrome-Web-Store-v${manifest.version}.zip`);
if (await fs.stat(archive).catch((error) => { if (error.code !== "ENOENT") throw error; })) {
  throw new Error("The store archive already exists. Preserve it and increment the extension version before creating another package.");
}

const files = [
  "background.js", "content.js", "options.html", "options.js", "settings.css",
  "popup.html", "popup.js", "popup.css", "google-setup.html",
  "lib/database.js", "lib/google-docs.js", "lib/markdown.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "anyannotate-store-"));
try {
  for (const file of files) {
    const destination = path.join(stage, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(source, file), destination);
  }
  await fs.writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  execFileSync("zip", ["-q", archive, "manifest.json", ...files], { cwd: stage });
  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const digest = createHash("sha256").update(await fs.readFile(archive)).digest("hex");
  await fs.writeFile(archive.replace(/\.zip$/, ".sha256"), `${digest}  ${path.basename(archive)}\n`);
  console.log(`Created ${archive}`);
  console.log(`Store extension ID: ${config.extensionId}`);
  console.log(`SHA-256: ${digest}`);
  console.log("The development manifest and its OAuth client were not changed.");
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
