"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const google = require("../lib/google-docs.js");
const { normalizeClip } = require("../lib/markdown.js");

function harness() {
  const document = {
    documentId: "document-123", title: "Research notes", revisionId: "revision-1",
    tabs: [{ tabProperties: { tabId: "t.first", title: "Notes" }, documentTab: {
      body: { content: [{ endIndex: 14 }] }, namedRanges: {},
    } }],
  };
  const target = google.resolveTarget(document);
  const state = { document, calls: [], writes: [], attempts: [], rejections: [], interactive: [], invalidated: 0, lostReply: false, conflict: false, unauthorized: false };
  const client = google.createClient({
    identity: {
      async getAuthToken({ interactive }) { state.interactive.push(interactive); return { token: "test-only-token", grantedScopes: [google.SCOPE] }; },
      async removeCachedAuthToken() { state.invalidated++; },
      async clearAllCachedAuthTokens() { state.cleared = true; },
    },
    getManifest: () => ({ oauth2: { client_id: "test-client.apps.googleusercontent.com" } }),
    fetch: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-only-token");
      assert.ok(url.startsWith("https://docs.googleapis.com/v1/documents"));
      state.calls.push({ url, method: options.method });
      if (state.unauthorized) {
        state.unauthorized = false;
        return Response.json({ error: {} }, { status: 401 });
      }
      if (state.denied) return Response.json({ error: {} }, { status: 403 });
      if (options.method === "GET") return Response.json(document);
      const body = JSON.parse(options.body);
      if (!url.endsWith(":batchUpdate")) return Response.json({ documentId: document.documentId });
      state.attempts.push(body);
      if (state.rejections.length) return Response.json(state.rejections.shift(), { status: 400 });
      if (state.conflict) {
        state.conflict = false;
        document.revisionId = "revision-concurrent";
        document.tabs[0].documentTab.body.content[0].endIndex += 5;
        return Response.json({ error: { message: "Revision does not match" } }, { status: 400 });
      }
      assert.equal(body.writeControl.requiredRevisionId, document.revisionId);
      state.writes.push(body);
      for (const request of body.requests) {
        if (request.insertText) document.tabs[0].documentTab.body.content[0].endIndex += request.insertText.text.length;
        if (request.createNamedRange) document.tabs[0].documentTab.namedRanges[request.createNamedRange.name] = { name: request.createNamedRange.name };
      }
      document.revisionId = `revision-${state.writes.length + 1}`;
      if (state.lostReply) { state.lostReply = false; throw new Error("Connection lost after commit"); }
      return Response.json({ documentId: document.documentId });
    },
  });
  return { state, client, target };
}

const clip = (id, quote = "A useful idea") => normalizeClip({ id, quote, annotation: "My note", tags: "reading", createdAt: "2026-09-07T00:00:00Z" });

test("only accepts genuine Google Docs URLs and preserves tab selection", () => {
  assert.deepEqual(google.parseDocumentLink("https://docs.google.com/document/d/doc-123/edit?tab=t.notes"), { documentId: "doc-123", tabId: "t.notes" });
  for (const url of ["https://docs.google.com.evil.test/document/d/123", "https://docs.google.com/spreadsheets/d/123", "javascript:alert(1)", "https://user:secret@docs.google.com/document/d/123/edit"]) {
    assert.throws(() => google.parseDocumentLink(url));
  }
});

test("resolves nested document tabs and rejects removed tabs", () => {
  const { state } = harness();
  state.document.tabs[0].childTabs = [{ tabProperties: { tabId: "t.child", title: "Child" }, documentTab: {} }];
  const target = google.resolveTarget(state.document, "t.child");
  assert.equal(target.tabTitle, "Child");
  assert.match(target.url, /tab=t.child/);
  assert.throws(() => google.resolveTarget(state.document, "t.missing"), /unavailable/);
});

test("unconfigured builds never request an OAuth token", async () => {
  const client = google.createClient({ identity: { getAuthToken() { assert.fail("No login should be launched"); } }, getManifest: () => ({}) });
  assert.equal(client.configured(), false);
  await assert.rejects(client.connect(), /not configured/);
});

test("interactive login is explicit; token refresh and document operations are silent", async () => {
  const { client, state } = harness();
  await client.connect();
  state.unauthorized = true;
  await client.select("https://docs.google.com/document/d/document-123/edit");
  assert.deepEqual(state.interactive, [true, false, false]);
  assert.equal(state.invalidated, 1);
  await client.disconnect();
  assert.equal(state.cleared, true);
});

test("appends to existing content with UTF-16 ranges and an atomic revision guard", async () => {
  const { client, state, target } = harness();
  const result = await client.append(target, [clip("one", "An idea with an emoji 📝"), clip("two")]);
  assert.deepEqual(result, { exported: 2, skipped: 0 });
  const requests = state.writes[0].requests;
  const inserts = requests.filter((request) => request.insertText).map((request) => request.insertText);
  const markers = requests.filter((request) => request.createNamedRange).map((request) => request.createNamedRange);
  const styles = requests.filter((request) => request.updateParagraphStyle).map((request) => request.updateParagraphStyle);
  assert.equal(inserts[0].location.index, 13);
  assert.equal(inserts[0].text, "\nAn idea with an emoji 📝\nMy note\n\n");
  assert.equal(markers[0].range.endIndex, 13 + inserts[0].text.length);
  assert.equal(inserts[1].location.index, markers[0].range.endIndex);
  assert.equal(styles[0].range.startIndex, 14);
  assert.equal(styles[0].paragraphStyle.namedStyleType, "NORMAL_TEXT");
  assert.equal(styles[1].paragraphStyle.borderLeft.width.magnitude, 1.5);
  assert.equal(styles[1].range.endIndex, 14 + "An idea with an emoji 📝".length);
  assert.equal(inserts[0].location.tabId, "t.first");
  for (const request of requests) {
    const update = request.updateTextStyle || request.updateParagraphStyle || request.deleteParagraphBullets;
    if (update) assert.ok(update.range.startIndex >= 14, "Existing paragraphs must never be restyled");
  }
  assert.equal(state.writes[0].writeControl.requiredRevisionId, "revision-1");
});

test("Docs source is a small native hyperlink, not a long URL or repeated field list", async () => {
  const { client, state, target } = harness();
  const pageUrl = "https://www.google.com/search?q=test&tracking=still-exact";
  const note = normalizeClip({ id: "source-test", quote: "Example 📝\nSecond line", annotation: "test",
    pageTitle: "Search 🙂 results", pageUrl, kind: "Thought", tags: "test" });
  await client.append(target, [note]);
  const requests = state.writes[0].requests;
  const inserted = requests[0].insertText;
  assert.equal(inserted.text, "\nExample 📝\nSecond line\ntest\nSearch 🙂 results\n\n");
  assert.doesNotMatch(inserted.text, /https:|Quote:|Annotation:|Source:|Category:|Tags:|Time:/);
  const link = requests.find((request) => request.updateTextStyle?.textStyle.link)?.updateTextStyle;
  assert.equal(link.textStyle.link.url, pageUrl);
  assert.equal(link.textStyle.fontSize.magnitude, 9);
  assert.equal(inserted.text.slice(link.range.startIndex - inserted.location.index, link.range.endIndex - inserted.location.index), "Search 🙂 results");
  assert.equal(link.range.tabId, target.tabId);
  assert.equal(note.pageUrl, pageUrl);
});

test("paragraph border updates always supply complete non-transparent border objects", async () => {
  const { client, state, target } = harness();
  await client.append(target, [clip("borders")]);
  let hidden = 0;
  for (const request of state.writes[0].requests) {
    const update = request.updateParagraphStyle;
    if (!update) continue;
    for (const field of update.fields.split(",").filter((name) => name.startsWith("border"))) {
      const border = update.paragraphStyle[field];
      assert.ok(border, `${field} must not be omitted while included in the field mask`);
      assert.deepEqual(Object.keys(border).sort(), ["color", "dashStyle", "padding", "width"]);
      assert.ok(border.color.color.rgbColor);
      assert.equal(border.width.unit, "PT");
      assert.equal(border.padding.unit, "PT");
      assert.equal(border.dashStyle, "SOLID");
      if (border.width.magnitude === 0) hidden++;
    }
  }
  assert.equal(hidden, 5);
});

test("an explicit rejected formatting operation retries once with text and deduplication markers", async () => {
  const { client, state, target } = harness();
  state.rejections.push({ error: { status: "INVALID_ARGUMENT", message: "Invalid requests[3].updateParagraphStyle: invalid border" } });
  assert.deepEqual(await client.append(target, [clip("fallback")]), { exported: 1, skipped: 0, basicFormattingCount: 1 });
  assert.equal(state.attempts.length, 2);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.writes[0].requests.map((request) => Object.keys(request)[0]), ["insertText", "createNamedRange"]);
  assert.equal(state.calls.filter((call) => call.method === "GET").length, 2, "The document must be reread before retrying");
  assert.equal(state.writes[0].requests[0].insertText.text, state.attempts[0].requests[0].insertText.text);
  assert.deepEqual(await client.append(target, [clip("fallback")]), { exported: 0, skipped: 1 });
});

test("a formatting fallback with an uncertain response is not automatically sent again", async () => {
  const { client, state, target } = harness();
  state.rejections.push({ error: { status: "INVALID_ARGUMENT", message: "Invalid requests[4].updateTextStyle: invalid style" } });
  state.lostReply = true;
  await assert.rejects(client.append(target, [clip("uncertain-fallback")]), /local notes are safe/);
  assert.equal(state.attempts.length, 2);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(await client.append(target, [clip("uncertain-fallback")]), { exported: 0, skipped: 1 });
});

test("generic and non-formatting 400 errors are not retried or exposed as raw private data", async () => {
  for (const message of ["Private document https://docs.google.com/document/d/private-id with secret note", "Invalid requests[0].insertText: secret note", "Invalid requests[999].updateParagraphStyle: secret note"]) {
    const { client, state, target } = harness();
    state.rejections.push({ error: { status: "INVALID_ARGUMENT", message } });
    await assert.rejects(client.append(target, [clip("bad-request")]), (error) => {
      assert.match(error.message, /HTTP 400; INVALID_ARGUMENT/);
      assert.doesNotMatch(error.message, /secret note|private-id|https:/);
      return true;
    });
    assert.equal(state.attempts.length, 1);
    assert.equal(state.writes.length, 0);
  }
});

test("a rejected basic retry stops without creating markers or reporting success", async () => {
  const { client, state, target } = harness();
  state.rejections.push(
    { error: { status: "INVALID_ARGUMENT", message: "Invalid requests[3].updateParagraphStyle: invalid style" } },
    { error: { status: "INVALID_ARGUMENT", message: "Invalid requests[0].insertText: invalid range" } },
  );
  await assert.rejects(client.append(target, [clip("rejected-fallback")]), /request 0: insertText/);
  assert.equal(state.attempts.length, 2);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.document.tabs[0].documentTab.namedRanges, {});
});

test("Docs removes unsupported controls before computing ranges and handles missing notes or sources", () => {
  const result = google.formatClip(normalizeClip({ quote: "A\u0001🙂\r\nB\uE000", annotation: "", pageTitle: "" }));
  assert.equal(result.text, "A🙂\nB\n\n");
  assert.deepEqual(result.quote, { start: 0, end: "A🙂\nB".length });
  assert.equal(result.annotation, null);
  assert.equal(result.source, null);
  assert.throws(() => google.formatClip(normalizeClip({ quote: "\uE000" })), /no readable selected text/);
  const local = google.formatClip(normalizeClip({ quote: "Local", pageUrl: "file:///tmp/local.html" }));
  assert.equal(local.source.url, "");
  assert.ok(local.text.includes("Local document"));
});

test("re-export skips remote markers, including duplicate input IDs", async () => {
  const { client, state, target } = harness();
  await client.append(target, [clip("one"), clip("one")]);
  assert.deepEqual(await client.append(target, [clip("one"), clip("two")]), { exported: 1, skipped: 1 });
  assert.equal(state.writes.length, 2);
});

test("notes exported before the rename are recognized and not appended again", async () => {
  const { client, state, target } = harness();
  const [current, legacy] = await google.knownMarkersFor("older-note");
  assert.equal(current, await google.markerFor("older-note"));
  assert.match(current, /^anyannotate_[0-9a-f]{64}$/);
  assert.equal(legacy.slice(legacy.lastIndexOf("_") + 1), current.slice(current.lastIndexOf("_") + 1));
  state.document.tabs[0].documentTab.namedRanges[legacy] = { name: legacy };
  assert.deepEqual(await client.append(target, [clip("older-note"), clip("new-note")]), { exported: 1, skipped: 1 });
  const created = state.writes[0].requests.filter((request) => request.createNamedRange).map((request) => request.createNamedRange.name);
  assert.deepEqual(created, [await google.markerFor("new-note")]);
});

test("a lost write response is not blindly retried and the next export deduplicates it", async () => {
  const { client, state, target } = harness();
  state.lostReply = true;
  await assert.rejects(client.append(target, [clip("one")]), /local notes are safe/);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(await client.append(target, [clip("one")]), { exported: 0, skipped: 1 });
  assert.equal(state.writes.length, 1);
});

test("rejected revisions are reread before retrying at the new end of the document", async () => {
  const { client, state, target } = harness();
  state.conflict = true;
  await client.append(target, [clip("one")]);
  assert.equal(state.writes[0].requests[0].insertText.location.index, 18);
  assert.equal(state.writes[0].writeControl.requiredRevisionId, "revision-concurrent");
});

test("permission failure makes no remote write and exports are bounded into batches", async () => {
  const { client, state, target } = harness();
  state.denied = true;
  await assert.rejects(client.append(target, [clip("one")]), /denied access/);
  assert.equal(state.writes.length, 0);
  state.denied = false;
  await client.append(target, Array.from({ length: 30 }, (_, index) => clip(`clip-${index}`)));
  assert.equal(state.writes.length, 2);
});
