import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, "../..");
const extensionDir = process.env.ANYANNOTATE_EXTENSION_PATH ? path.resolve(process.env.ANYANNOTATE_EXTENSION_PATH) : sourceDir;
const repositoryDir = path.resolve(sourceDir, "..");
const storeScreenshots = process.argv.includes("--store-screenshots");
const recordLive = process.argv.includes("--record-live");
const outputDir = path.join(repositoryDir, "build", recordLive ? "chrome-live-qa" : storeScreenshots ? "chrome-store-screenshots" : "chrome-e2e");
const bundledBrowsers = path.join(repositoryDir, ".tools", "playwright");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && await fs.stat(bundledBrowsers).catch(() => null)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers;
}
const { chromium } = await import("playwright");
const fixture = await fs.readFile(path.join(testDir, "reading-fixture.html"), "utf8");
const readingURLs = [
  "https://reading.example.test/notes",
  "http://docs.example.test/guide",
  "https://chatgpt.com/anyannotate-demo",
];
const profiles = [];
async function createProfile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "anyannotate-e2e-"));
  profiles.push(directory);
  return directory;
}
let profile = await createProfile();
await fs.mkdir(outputDir, { recursive: true });
const captureScreenshots = recordLive || storeScreenshots || process.argv.includes("--screenshots");
const checks = [];
const screenshots = [];
let context;
let activePage;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: !process.argv.includes("--headed"),
    viewport: storeScreenshots || recordLive ? { width: 1280, height: 800 } : { width: 1120, height: 840 },
    deviceScaleFactor: storeScreenshots || recordLive ? 1 : 2,
    ...(recordLive ? { recordVideo: { dir: path.join(profile, "recordings"), size: { width: 1280, height: 800 } } } : {}),
    colorScheme: "light",
    locale: "en-US",
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  context.setDefaultTimeout(10_000);
  for (const url of readingURLs) {
    await context.route(url, (route) => route.fulfill({
      status: 200, contentType: "text/html", body: fixture,
    }));
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = worker.url().split("/")[2];
  if (process.env.ANYANNOTATE_EXPECTED_ID) assert.equal(id, process.env.ANYANNOTATE_EXPECTED_ID, "The tested extension must have the expected store identity");
  return id;
}

function passed(description) {
  checks.push(description);
  console.log(`PASS ${description}`);
}

async function eventually(read, expected, description) {
  const deadline = Date.now() + 8_000;
  let actual;
  while (Date.now() < deadline) {
    actual = await read();
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(actual, expected, description);
}

// CDP can inspect a closed shadow root without changing the shipped content script.
// Input still goes through real mouse and keyboard events.
async function extensionUI(page) {
  await page.locator("#anyannotate-root").waitFor({ state: "attached" });
  const client = await context.newCDPSession(page);
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  function findHost(node) {
    if (node.attributes?.includes("anyannotate-root")) return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const found = findHost(child);
      if (found) return found;
    }
  }
  const host = findHost(root);
  assert.ok(host?.shadowRoots?.[0], "The real extension must create its shadow UI");
  const { object } = await client.send("DOM.resolveNode", { backendNodeId: host.shadowRoots[0].backendNodeId });
  async function read(selector, property) {
    const response = await client.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(selector, property) {
        if (property === "count") return this.querySelectorAll(selector).length;
        const element = this.querySelector(selector);
        if (!element) throw new Error("Element not found: " + selector);
        if (property === "visible") return !!element.getClientRects().length &&
          !(element.closest("details:not([open])") && !element.closest("summary"));
        if (property === "disabled") return element.disabled;
        if (property === "options") return Array.from(element.options, option => option.value);
        if (property === "rect") {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return property === "value" ? element.value : element.textContent;
      }`,
      arguments: [{ value: selector }, { value: property }],
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  return {
    read,
    async click(selector) {
      const rect = await read(selector, "rect");
      assert.ok(rect.width && rect.height, `${selector} must be visible before clicking`);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    },
    async fill(selector, text) {
      await this.click(selector);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(text);
    },
    async select(selector, value) {
      // The dialog disables this control while destination settings load.
      // Unlike Playwright locators, raw CDP focus does not wait for readiness.
      await eventually(() => read(selector, "disabled"), false, "The destination selector must be ready");
      const choices = await read(selector, "options");
      const index = choices.indexOf(value);
      assert.ok(index >= 0, `Missing destination: ${value}`);
      // Native macOS popup menus do not receive headless CDP key events.
      // Focus the select without opening the OS menu, then use native type-ahead.
      await client.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: "function(selector) { this.querySelector(selector).focus(); }",
        arguments: [{ value: selector }],
      });
      await page.keyboard.press({ markdown: "m", txt: "p", google: "g", inbox: "l" }[value]);
      await page.keyboard.press("Tab");
      await eventually(() => read(selector, "value"), value, "The selected destination must update");
    },
  };
}

async function openReadingPage(url = readingURLs[0]) {
  const page = await context.newPage();
  activePage = page;
  await page.goto(url);
  return { page, ui: await extensionUI(page) };
}

async function selectQuote(page, ui, selector, expectBubble = true) {
  const selection = await page.locator(selector).evaluate((element) => {
    const text = element.firstChild;
    const first = new Range();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    const last = new Range();
    last.setStart(text, text.length - 1);
    last.setEnd(text, text.length);
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return { text: text.textContent, from: { x: a.left, y: a.top + a.height / 2 }, to: { x: b.right, y: b.top + b.height / 2 } };
  });
  await page.mouse.move(selection.from.x, selection.from.y);
  await page.mouse.down();
  await page.mouse.move(selection.to.x, selection.to.y, { steps: 20 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), selection.text);
  if (expectBubble) {
    await eventually(() => ui.read("#bubble", "visible"), true, "Selection must show Annotate");
  } else {
    await page.waitForTimeout(50);
    assert.equal(await ui.read("#bubble", "visible"), false, "Editing text must not show Annotate");
  }
  return selection.text;
}

async function snapshot(page, name) {
  if (!captureScreenshots) return;
  await page.screenshot({ path: path.join(outputDir, name), animations: "disabled", fullPage: !storeScreenshots && name === "chrome-inbox.png" });
  screenshots.push(name);
}

async function send(page, message) {
  const result = await page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  assert.equal(result.ok, true, result.error);
  return result;
}

try {
  let extensionId = await launch();
  let options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 0);

  const { page, ui } = await openReadingPage();
  await page.mouse.move(36, 810);
  await page.mouse.down();
  await page.mouse.move(95, 810, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(50); // Allow the content script's deferred selection check to run.
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "");
  assert.equal(await ui.read("#bubble", "visible"), false);
  passed("Dragging empty space does not show Annotate");

  const quote = await selectQuote(page, ui, "#first-quote");
  await snapshot(page, "chrome-selection.png");
  await ui.click("#bubble");
  assert.equal(await ui.read("#quote", "text"), quote);
  const annotation = "Use this rule for my next reading session: one useful sentence, one personal takeaway.";
  await ui.fill("#annotation", annotation);
  assert.equal(await ui.read("#tags", "visible"), false, "Metadata should not clutter the default dialog");
  await ui.click("#more-options summary");
  await ui.fill("#tags", "reading, ideas");
  await ui.click("#more-options summary");
  assert.equal(await ui.read(".actions button", "count"), 2, "Only Cancel and one Save button are allowed");
  assert.equal(await ui.read("#download", "count"), 0, "There must not be a second save button");
  assert.deepEqual(await ui.read("#save-destination", "options"), ["markdown", "txt", "google", "inbox"]);
  await ui.select("#save-destination", "markdown");
  await ui.click("#annotation");
  await snapshot(page, "chrome-annotation.png");
  await ui.select("#save-destination", "inbox");
  await ui.click("#save");
  await eventually(() => ui.read("#overlay", "visible"), false, "Saving must close the dialog");
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 1);
  let clips = await options.evaluate(() => AnyAnnotateDatabase.getClips());
  assert.equal(clips[0].quote, quote);
  assert.equal(clips[0].annotation, annotation);
  assert.deepEqual(clips[0].tags, ["#reading", "#ideas"]);
  assert.equal(clips[0].pageTitle, await page.title());
  assert.equal(clips[0].pageUrl, readingURLs[0]);
  passed("Mouse selection, annotation entry, and real IndexedDB saving");

  await page.reload();
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 1);
  passed("Saved annotation survives a page reload");

  const parallelPages = await Promise.all(readingURLs.slice(1).map((url) => openReadingPage(url)));
  await Promise.all(parallelPages.map(async ({ page: tab, ui: tabUI }, index) => {
    await selectQuote(tab, tabUI, index ? "#third-quote" : "#second-quote");
    await tabUI.click("#bubble");
    await tabUI.fill("#annotation", index ? "Review these notes on Friday." : "Turn this idea into a small experiment.");
  }));
  await Promise.all(parallelPages.map(({ ui: tabUI }) => tabUI.click("#save")));
  await eventually(async () => (await send(options, { type: "GET_STATUS" })).count, 3, "Both tabs must save");
  clips = await options.evaluate(() => AnyAnnotateDatabase.getClips());
  assert.deepEqual(clips.map((clip) => clip.pageUrl).sort(), [...readingURLs].sort());
  passed("HTTP and HTTPS sites plus ChatGPT save concurrently with their own source links");

  await options.reload();
  await eventually(() => options.locator("#count").innerText(), "3", "Settings must show saved clips");
  await snapshot(options, "chrome-inbox.png");
  const downloadClient = await context.newCDPSession(options);
  await downloadClient.send("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: outputDir, eventsEnabled: true,
  });
  await options.locator("#export").click();
  await eventually(async () => options.evaluate(async () => {
    const [download] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    return download?.state;
  }), "complete", "The extension download must finish");
  const exportPath = await options.evaluate(async () => {
    const [download] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    return download.filename;
  });
  const markdown = await fs.readFile(exportPath, "utf8");
  assert.ok(markdown.startsWith("# AnyAnnotate\n\n"));
  assert.ok(markdown.includes(quote) && markdown.includes(annotation));
  assert.doesNotMatch(markdown, /\*\*Tags:|\*\*Category:|\*\*Time:|\*\*Link:|\*\*Annotation:/);
  for (const url of readingURLs) assert.ok(markdown.includes(`](<${url}>)`));
  assert.equal((markdown.match(/^---$/gm) || []).length, 3);
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 3);
  passed("Export All downloads a real Markdown file containing all three clips");

  // A real sandbox file exercises FileSystemFileHandle persistence and writes.
  // Native OS file-picker interaction is outside this headless test.
  await options.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle("AnyAnnotate-Test.md", { create: true });
    await AnyAnnotateDatabase.putFileHandle(handle);
  });
  const fileResults = await Promise.all(["First file entry", "Second file entry"].map((text, index) => send(options, {
    type: "SAVE_CLIP", destination: "markdown", clip: { id: `file-${index}`, quote: text, annotation: "File append test" },
  })));
  assert.ok(fileResults.every((result) => result.savedTo === "default"));
  const fileContents = await options.evaluate(async () => {
    const handle = await AnyAnnotateDatabase.getFileHandle();
    return (await handle.getFile()).text();
  });
  assert.ok(fileContents.includes("First file entry") && fileContents.includes("Second file entry"));
  assert.equal((fileContents.match(/^# AnyAnnotate$/gm) || []).length, 1);
  passed("Default-file writes append both entries using a real browser file handle");

  await context.close();
  extensionId = await launch();
  options = await context.newPage();
  activePage = options;
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 5);
  assert.equal(await options.evaluate(async () => (await AnyAnnotateDatabase.getFileHandle()).name), "AnyAnnotate-Test.md");
  passed("Inbox and connected file handle survive a complete browser restart");

  await options.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    await directory.removeEntry("AnyAnnotate-Test.md");
  });
  const fallback = await send(options, { type: "SAVE_CLIP", clip: { quote: "Keep this even if the file is missing." } });
  assert.equal(fallback.savedTo, "inbox");
  assert.equal(fallback.fileWriteFailed, true);
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 6);
  passed("A deleted default file produces a warning and keeps the local annotation");

  await options.reload();
  options.once("dialog", (dialog) => dialog.dismiss());
  await options.locator("#clear").click();
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 6);
  options.once("dialog", (dialog) => dialog.accept());
  await options.locator("#clear").click();
  await eventually(async () => (await send(options, { type: "GET_STATUS" })).count, 0, "Confirmed clear must empty the inbox");
  passed("Clear Inbox preserves data on Cancel and clears it on confirmation");

  const editor = await openReadingPage();
  await editor.page.evaluate(() => {
    const form = document.createElement("section");
    form.style.cssText = "padding: 20px; background: white;";
    form.innerHTML = '<input id="test-input" value="Example typed text"><textarea id="test-textarea">Example draft text</textarea><input id="test-password" type="password" value="fictional-password"><div id="test-editable" contenteditable="true"><span id="editable-quote">An unfinished draft should stay in the editor.</span></div><div id="test-shadow-editor"></div>';
    document.querySelector("main").prepend(form);
    const shadow = document.querySelector("#test-shadow-editor").attachShadow({ mode: "open" });
    shadow.innerHTML = '<input id="test-shadow-input" value="Example shadow editor text">';
  });
  for (const selector of ["#test-input", "#test-textarea", "#test-password", "#test-shadow-input"]) {
    await editor.page.locator(selector).focus();
    await editor.page.keyboard.press("ControlOrMeta+A");
    await editor.page.keyboard.press("Shift");
    await editor.page.waitForTimeout(50);
    assert.equal(await editor.ui.read("#bubble", "visible"), false);
  }
  await selectQuote(editor.page, editor.ui, "#editable-quote", false);
  await selectQuote(editor.page, editor.ui, "#first-quote");
  await editor.ui.click("#bubble");
  assert.equal(await editor.ui.read("#quote", "text"), await editor.page.locator("#first-quote").textContent());
  await editor.ui.click("#cancel");
  assert.equal((await send(options, { type: "GET_STATUS" })).count, 0);
  passed("Inputs, passwords, rich-text editors, and shadow editors are excluded; article text still works");
  await send(options, { type: "SET_SAVE_DESTINATION", destination: "inbox" });

  const localURL = pathToFileURL(path.join(testDir, "reading-fixture.html")).href;
  const fileAccessAllowed = await options.evaluate(() => chrome.extension.isAllowedFileSchemeAccess());
  if (fileAccessAllowed) {
    await options.evaluate(() => AnyAnnotateDatabase.deleteFileHandle());
    const local = await openReadingPage(localURL);
    await selectQuote(local.page, local.ui, "#first-quote");
    await local.ui.click("#bubble");
    await local.ui.fill("#annotation", "A note from a local HTML document.");
    await local.ui.click("#save");
    await eventually(async () => (await send(options, { type: "GET_STATUS" })).count, 1, "Local document clip must save");
    const [localClip] = await options.evaluate(() => AnyAnnotateDatabase.getClips());
    assert.equal(localClip.pageUrl, localURL);
    passed("Local HTML selections save with a file source when file access is enabled");
  } else {
    const local = await context.newPage();
    await local.goto(localURL);
    assert.equal(await local.locator("#anyannotate-root").count(), 0);
    passed("Chrome blocks local HTML injection until file access is enabled");
  }

  if (process.argv.includes("--live") || recordLive) {
    await options.evaluate(() => AnyAnnotateDatabase.deleteFileHandle());
    const before = (await send(options, { type: "GET_STATUS" })).count;
    const live = await openReadingPage("https://example.com/");
    const liveQuote = await selectQuote(live.page, live.ui, "h1");
    if (recordLive) await live.page.waitForTimeout(1200);
    await live.ui.click("#bubble");
    await live.ui.fill("#annotation", "A clip from a live public website.");
    if (recordLive) await live.page.waitForTimeout(1800);
    await live.ui.click("#save");
    await eventually(async () => (await send(options, { type: "GET_STATUS" })).count, before + 1, "Live website clip must save");
    const liveClips = await options.evaluate(() => AnyAnnotateDatabase.getClips());
    const saved = liveClips.find((clip) => clip.pageUrl === "https://example.com/");
    assert.ok(saved);
    assert.equal(saved.quote, liveQuote);
    assert.equal(saved.pageTitle, await live.page.title());
    passed("The real public example.com page can be selected, annotated, and saved");
    if (recordLive) {
      const video = live.page.video();
      await live.page.waitForTimeout(1200);
      const client = await context.newCDPSession(options);
      await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outputDir, eventsEnabled: true });
      for (const format of ["markdown", "txt"]) {
        const previous = await options.evaluate(async () => (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }))[0]?.id ?? -1);
        await selectQuote(live.page, live.ui, "h1");
        await live.ui.click("#bubble");
        await live.ui.select("#save-destination", format);
        await live.ui.fill("#annotation", `Real website test: save as ${format}.`);
        await live.page.waitForTimeout(1800);
        await live.ui.click("#save");
        await eventually(() => live.ui.read("#overlay", "visible"), false, "Recorded save must close the dialog");
        await eventually(async () => options.evaluate(async (previous) => {
          const item = (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }))[0];
          return Boolean(item && item.id > previous && item.state === "complete");
        }, previous), true, "Recorded download must complete");
        const filename = await options.evaluate(async () => (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }))[0].filename);
        assert.equal(path.extname(filename), format === "txt" ? ".txt" : ".md");
        assert.ok((await fs.readFile(filename, "utf8")).includes(`Real website test: save as ${format}.`));
        await live.page.waitForTimeout(1200);
      }
      assert.equal((await send(options, { type: "GET_STATUS" })).count, before + 3);
      await live.page.goto(`chrome-extension://${extensionId}/options.html`);
      await live.page.locator("#count").scrollIntoViewIfNeeded();
      await eventually(() => live.page.locator("#count").innerText(), String(before + 3), "All recorded saves must have inbox backups");
      await live.page.screenshot({ path: path.join(outputDir, "live-inbox.png") });
      await live.page.waitForTimeout(1800);
      await live.page.close();
      await video.saveAs(path.join(outputDir, "chrome-live-local-saving.webm"));
      passed("Recorded real-site inbox, Markdown and TXT saves with actual downloaded-file verification");
      await send(options, { type: "SET_SAVE_DESTINATION", destination: "inbox" });
    }
  }

  // Exercise all local choices through the one-button annotation UI.
  await options.evaluate(async () => {
    await AnyAnnotateDatabase.deleteFileHandle();
    await AnyAnnotateDatabase.deleteFileHandle("txt");
  });
  const localDownloadClient = await context.newCDPSession(options);
  await localDownloadClient.send("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: outputDir, eventsEnabled: true,
  });
  const latestDownload = () => options.evaluate(async () => {
    const [download] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    return download || null;
  });
  async function downloadedSince(id) {
    await eventually(async () => {
      const item = await latestDownload();
      return Boolean(item && item.id > id && item.state === "complete");
    }, true, "A new file must finish downloading");
    return latestDownload();
  }
  const choice = await openReadingPage();
  const beforeChoices = (await send(options, { type: "GET_STATUS" })).count;
  for (const format of ["txt", "markdown"]) {
    const previous = (await latestDownload())?.id ?? -1;
    await selectQuote(choice.page, choice.ui, "#first-quote");
    await choice.ui.click("#bubble");
    if (format === "markdown") {
      await eventually(() => choice.ui.read("#save-destination", "value"), "txt", "The last saved choice must be remembered");
    }
    await choice.ui.select("#save-destination", format);
    assert.equal(await choice.ui.read("#save", "text"), "Save");
    await choice.ui.fill("#annotation", `Save this as ${format}.`);
    await choice.ui.click("#save");
    await eventually(() => choice.ui.read("#overlay", "visible"), false, "A local-format save must finish");
    const download = await downloadedSince(previous);
    assert.equal(path.extname(download.filename), format === "txt" ? ".txt" : ".md");
    const content = await fs.readFile(download.filename, "utf8");
    assert.ok(content.includes(quote));
    if (format === "txt") {
      assert.match(content, /^“Keep the sentence/);
      assert.doesNotMatch(content, /\*\*Annotation|^> /m);
      assert.doesNotMatch(content, /Quote:|Annotation:|Category:|Tags:|Time:|https:\/\//);
    } else assert.match(content, /^> /);
  }
  assert.equal((await send(options, { type: "GET_STATUS" })).count, beforeChoices + 2);
  passed("One Save button downloads real TXT or Markdown files and remembers the dialog's selection");

  const previousExport = (await latestDownload())?.id ?? -1;
  await options.reload();
  await options.locator("#export-format").selectOption("txt");
  await options.locator("#export").click();
  const textExport = await downloadedSince(previousExport);
  const textExportBody = await fs.readFile(textExport.filename, "utf8");
  assert.equal(path.extname(textExport.filename), ".txt");
  assert.ok(textExportBody.startsWith("AnyAnnotate\n\n"));
  assert.equal((textExportBody.match(/^--------------------$/gm) || []).length, beforeChoices + 2);
  passed("The settings export selector downloads the entire inbox as plain text");

  await options.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const txt = await directory.getFileHandle("AnyAnnotate-Test.txt", { create: true });
    const md = await directory.getFileHandle("AnyAnnotate-Other.md", { create: true });
    await AnyAnnotateDatabase.putFileHandle(txt, "txt");
    await AnyAnnotateDatabase.putFileHandle(md, "markdown");
  });
  for (const selector of ["#second-quote", "#third-quote"]) {
    await selectQuote(choice.page, choice.ui, selector);
    await choice.ui.click("#bubble");
    await choice.ui.select("#save-destination", "txt");
    await choice.ui.click("#save");
    await eventually(() => choice.ui.read("#overlay", "visible"), false, "TXT append must finish");
  }
  const appendText = await options.evaluate(async () => {
    const txt = await AnyAnnotateDatabase.getFileHandle("txt");
    const md = await AnyAnnotateDatabase.getFileHandle("markdown");
    return { txt: await (await txt.getFile()).text(), md: await (await md.getFile()).text() };
  });
  assert.equal((appendText.txt.match(/^AnyAnnotate$/gm) || []).length, 1);
  assert.equal((appendText.txt.match(/^--------------------$/gm) || []).length, 2);
  assert.equal(appendText.md, "", "TXT saves must not touch the Markdown file");
  passed("Selecting TXT appends to its own real file handle without changing the Markdown file");

  await selectQuote(choice.page, choice.ui, "#first-quote");
  await choice.ui.click("#bubble");
  await choice.ui.fill("#annotation", "Keep this draft while setting up Google.");
  await choice.ui.select("#save-destination", "google");
  assert.equal(await choice.ui.read("#save", "disabled"), true);
  assert.match(await choice.ui.read("#destination-text", "text"), /Connect Google/);
  await choice.ui.select("#save-destination", "inbox");
  assert.equal(await choice.ui.read("#annotation", "value"), "Keep this draft while setting up Google.");
  assert.equal(await choice.ui.read("#save", "disabled"), false);
  await choice.ui.select("#save-destination", "google");
  passed("An unconfigured Google destination explains setup and switching preserves the draft");

  // Google identity and HTTP are test doubles: no credentials or real account
  // are used. The actual UI, message routing, client, and database still run.
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(() => {
    const manifest = chrome.runtime.getManifest();
    chrome.runtime.getManifest = () => ({ ...manifest, oauth2: { client_id: "test-client.apps.googleusercontent.com" } });
    chrome.identity.getAuthToken = async () => ({ token: "test-only-token", grantedScopes: [AnyAnnotateGoogleDocs.SCOPE] });
    chrome.identity.removeCachedAuthToken = async () => {};
    chrome.identity.clearAllCachedAuthTokens = async () => {};
    globalThis.googleTestState = {
      offline: false, writes: 0, insertedText: "", textStyles: [],
      document: {
        documentId: "browser-test-doc", title: "Browser test notes", revisionId: "revision-1",
        tabs: [{ tabProperties: { tabId: "t.notes", title: "Notes" }, documentTab: {
          body: { content: [{ endIndex: 2 }] }, namedRanges: {},
        } }],
      },
    };
    globalThis.fetch = async (url, options) => {
      const state = globalThis.googleTestState;
      if (state.offline) throw new Error("Test network outage");
      if (!url.startsWith("https://docs.googleapis.com/v1/documents")) throw new Error("Unexpected test request");
      if (options.method === "GET") return Response.json(state.document);
      const body = JSON.parse(options.body);
      if (!url.endsWith(":batchUpdate")) {
        state.document.title = body.title;
        return Response.json({ documentId: state.document.documentId });
      }
      if (body.writeControl.requiredRevisionId !== state.document.revisionId) return Response.json({ error: { message: "Revision changed" } }, { status: 400 });
      for (const request of body.requests) {
        if (request.insertText) {
          state.document.tabs[0].documentTab.body.content[0].endIndex += request.insertText.text.length;
          state.insertedText += request.insertText.text;
        }
        if (request.updateTextStyle) state.textStyles.push(request.updateTextStyle);
        if (request.createNamedRange) state.document.tabs[0].documentTab.namedRanges[request.createNamedRange.name] = { name: request.createNamedRange.name };
      }
      state.writes++;
      state.document.revisionId = `revision-${state.writes + 1}`;
      return Response.json({ documentId: state.document.documentId });
    };
  });
  assert.equal(await worker.evaluate(async () => {
    try {
      await handleMessage({ type: "GOOGLE_CONNECT" }, { id: chrome.runtime.id, url: "https://reading.example.test/notes" });
      return false;
    } catch { return true; }
  }), true);
  passed("Web page senders cannot manage Google connections");

  await options.reload();
  await options.locator("#google-connect").click();
  await eventually(() => options.locator("#google-controls").isVisible(), true, "Connected controls must appear");
  await options.locator("#google-title").fill("Browser test notes");
  await options.locator("#google-create").click();
  await eventually(() => options.locator("#google-document").innerText(), "Browser test notes", "Create must select the returned document");
  await options.locator("#google-link").fill("https://docs.google.com/document/d/browser-test-doc/edit?tab=t.notes");
  await options.locator("#google-select").click();
  await eventually(() => options.locator("#save-destination").isEnabled(), true, "Destination selection must be ready");
  assert.notEqual((await send(options, { type: "GET_STATUS" })).saveDestination, "google", "Choosing a document must not silently enable cloud saving");
  await choice.page.bringToFront();
  await eventually(() => choice.ui.read("#save", "disabled"), false, "Returning from Google setup must refresh the open draft");
  assert.equal(await choice.ui.read("#annotation", "value"), "Keep this draft while setting up Google.");
  assert.equal(await choice.ui.read("#save-destination", "value"), "google");
  assert.match(await choice.ui.read("#destination-text", "text"), /Browser test notes/);
  await choice.ui.click("#cancel");
  const beforeGoogle = (await send(options, { type: "GET_STATUS" })).count;
  const cloud = await openReadingPage();
  await selectQuote(cloud.page, cloud.ui, "#first-quote");
  await cloud.ui.click("#bubble");
  await cloud.ui.select("#save-destination", "google");
  assert.equal(await cloud.ui.read("#save", "text"), "Save", "The dialog has one consistent Save button");
  assert.match(await cloud.ui.read("#destination-text", "text"), /Browser test notes/);
  await cloud.ui.fill("#annotation", "An annotation for the selected Google document.");
  await cloud.ui.click("#save");
  await eventually(() => cloud.ui.read("#overlay", "visible"), false, "Cloud save must finish");
  assert.equal((await send(options, { type: "GET_STATUS" })).count, beforeGoogle + 1);
  assert.equal(await worker.evaluate(() => googleTestState.writes), 1);
  const cloudFormat = await worker.evaluate(() => ({ text: googleTestState.insertedText, styles: googleTestState.textStyles }));
  assert.doesNotMatch(cloudFormat.text, /Quote:|Annotation:|Category:|Tags:|Source:|Link:|Time:|https:\/\//);
  assert.equal(cloudFormat.text.split("An annotation for the selected Google document.").length - 1, 1);
  assert.equal(cloudFormat.styles.find((style) => style.textStyle.link)?.textStyle.link.url, readingURLs[0]);
  assert.equal((await send(options, { type: "GET_STATUS" })).saveDestination, "google");
  passed("Google connect, create/select, and individual save UI work with mocked Google services");

  await options.reload();
  await options.locator("#google-export").click();
  await eventually(() => options.locator("#google-export").isEnabled(), true, "Bulk export must finish");
  const writesAfterExport = await worker.evaluate(() => googleTestState.writes);
  await options.locator("#google-export").click();
  await eventually(() => options.locator("#google-export").isEnabled(), true, "Repeated export must finish");
  assert.equal(await worker.evaluate(() => googleTestState.writes), writesAfterExport);
  passed("Google Inbox export skips clips already present in the chosen tab (mocked Google services)");

  await worker.evaluate(() => { googleTestState.offline = true; });
  await selectQuote(cloud.page, cloud.ui, "#second-quote");
  await cloud.ui.click("#bubble");
  await cloud.ui.fill("#annotation", "Keep this offline note locally.");
  await cloud.ui.click("#save");
  await eventually(() => cloud.ui.read("#error", "visible"), true, "Offline cloud save must keep the draft with a visible error");
  assert.equal(await cloud.ui.read("#overlay", "visible"), true);
  assert.equal((await send(options, { type: "GET_STATUS" })).count, beforeGoogle + 2);
  assert.match(await cloud.ui.read("#error", "text"), /local inbox/);
  assert.equal(await cloud.ui.read("#annotation", "value"), "Keep this offline note locally.");
  await worker.evaluate(() => { googleTestState.offline = false; });
  await options.locator("#google-export").click();
  await eventually(() => options.locator("#google-export").isEnabled(), true, "Recovery export must finish");
  assert.equal(await worker.evaluate(() => googleTestState.writes), writesAfterExport + 1);
  options.once("dialog", (dialog) => dialog.accept());
  await options.locator("#google-disconnect").click();
  await eventually(async () => (await send(options, { type: "GET_STATUS" })).saveDestination, "inbox", "Disconnect must restore local saving");
  assert.equal((await send(options, { type: "GET_STATUS" })).count, beforeGoogle + 2);
  passed("Offline Google saves remain local, retry recovers them, and disconnect preserves notes (mocked Google services)");

  for (const format of ["markdown", "txt"]) {
    for (const ending of ["", "\n", "\n\n", "\r\n", "\r\n\r\n"]) {
      const original = `Existing paragraph 🙂${ending}`;
      await options.evaluate(async ({ format, original }) => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(`Boundary.${format === "txt" ? "txt" : "md"}`, { create: true });
        const writer = await handle.createWritable();
        await writer.write(original);
        await writer.close();
        await AnyAnnotateDatabase.putFileHandle(handle, format);
      }, { format, original });
      const result = await send(options, {
        type: "SAVE_CLIP", destination: format,
        clip: { id: `boundary-${format}-${JSON.stringify(ending)}`, quote: "Fresh excerpt", annotation: "Separate this note" },
      });
      assert.equal(result.savedTo, "default");
      const text = await options.evaluate(async (format) => {
        const handle = await AnyAnnotateDatabase.getFileHandle(format);
        return (await handle.getFile()).text();
      }, format);
      assert.ok(text.startsWith(original), "Existing bytes must not change");
      const quote = format === "txt" ? "“Fresh excerpt”" : "> Fresh excerpt";
      assert.ok(text.replace(/\r\n/g, "\n").startsWith(`Existing paragraph 🙂\n\n${quote}`));
    }
  }
  passed("Existing Markdown and TXT files receive a blank-line separator through real browser file handles");

  // Versions before 0.6.4 kept the inbox and file handles in an IndexedDB
  // database with the previous internal name. Seed one in a fresh profile before
  // the extension first opens IndexedDB, then confirm that real data moves over.
  await context.close();
  profile = await createProfile();
  extensionId = await launch();
  const upgradeWorker = context.serviceWorkers()[0];
  await upgradeWorker.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle("Legacy-Notes.txt", { create: true });
    const writer = await handle.createWritable();
    await writer.write("Earlier notes\n");
    await writer.close();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("answer-clipper-files", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("handles");
        request.result.createObjectStore("clips", { keyPath: "id" }).createIndex("createdAt", "createdAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(["handles", "clips"], "readwrite");
      transaction.objectStore("handles").put(handle, "default-txt");
      transaction.objectStore("clips").put({ id: "saved-before-rename", quote: "An older note", annotation: "", createdAt: "2026-08-14T00:00:00Z" });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  options = await context.newPage();
  activePage = options;
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const upgraded = await send(options, { type: "GET_STATUS" });
  assert.equal(upgraded.count, 1);
  assert.equal(upgraded.files.txt.name, "Legacy-Notes.txt");
  const migratedText = await options.evaluate(async () => {
    const [clip] = await AnyAnnotateDatabase.getClips();
    const handle = await AnyAnnotateDatabase.getFileHandle("txt");
    return { id: clip.id, text: await (await handle.getFile()).text() };
  });
  assert.deepEqual(migratedText, { id: "saved-before-rename", text: "Earlier notes\n" });
  await eventually(async () => options.evaluate(async () => (await indexedDB.databases()).map((item) => item.name).sort().join(",")),
    "anyannotate-files", "The old database must be removed after migration");
  const afterUpgrade = await send(options, {
    type: "SAVE_CLIP", destination: "txt", clip: { id: "after-upgrade", quote: "New excerpt", annotation: "Saved after upgrading" },
  });
  assert.equal(afterUpgrade.savedTo, "default");
  assert.ok((await options.evaluate(async () => (await (await AnyAnnotateDatabase.getFileHandle("txt")).getFile()).text())).includes("New excerpt"));
  passed("Upgrading from an older build keeps the local inbox and a connected file");

  if (captureScreenshots && !storeScreenshots && !recordLive) {
    const destination = path.join(repositoryDir, "docs", "screenshots");
    await fs.mkdir(destination, { recursive: true });
    for (const name of screenshots) await fs.copyFile(path.join(outputDir, name), path.join(destination, name));
  }
  if (recordLive) await fs.writeFile(path.join(outputDir, "verification.json"), JSON.stringify({
    extensionId, version: JSON.parse(await fs.readFile(path.join(extensionDir, "manifest.json"), "utf8")).version,
    checks, recording: "chrome-live-local-saving.webm", recordedSite: "https://example.com/",
    recordingScope: "Real Chromium UI, live public page, real IndexedDB and downloaded Markdown/TXT files. No Google mocks run in the recorded flow.",
    limitations: ["Google OAuth/API checks elsewhere in this suite are mocked, not a live account test.", "Headless download approval is automatic; native OS save-location dialogs are not tested.", "This recording is not a Google OAuth verification video."],
  }, null, 2) + "\n");
  console.log(`\n${checks.length} end-to-end checks passed. Artifacts: ${outputDir}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(outputDir, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  for (const directory of profiles) await fs.rm(directory, { recursive: true, force: true });
}
