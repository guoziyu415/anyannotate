# Testing and screenshots

The Chrome browser test loads the extension directly from `chrome-extension` into a temporary Chromium profile. It uses the shipped manifest, content script, service worker, settings page, IndexedDB database, and download implementation.

## Run the browser test

Requires Node.js 20 or later.

```bash
cd chrome-extension
npm ci
npx playwright install chromium
npm run test:e2e
```

On Linux CI, install browser system dependencies with `npx playwright install --with-deps chromium`.

The test follows Playwright's [Chrome extension testing guidance](https://playwright.dev/docs/chrome-extensions): use bundled Chromium and a persistent profile, since standard Chrome no longer supports the command-line extension loading flags used by the test.

## What is checked

1. Dragging empty space produces no annotation button.
2. Real mouse selection and keyboard input save the exact quote, annotation, and tags to IndexedDB. The dialog has one Save button, a Cancel button, and explicit destination choices. Category and tags start collapsed under More options.
3. The saved annotation remains after reloading the page.
4. An HTTPS article, an HTTP documentation page, and ChatGPT retain all annotations and their own source URLs during simultaneous saves.
5. **Export Inbox** downloads a real Markdown file containing all three collected clips; its content is verified from disk, including compact titled source links and the absence of metadata field lists.
6. Concurrent default-file saves append both entries without replacing previous content or duplicating the document header.
7. The inbox and stored file handle remain after closing and restarting Chromium.
8. Deleting the connected file causes a save warning while preserving the new annotation in the inbox.
9. **Clear Local Inbox** keeps notes when canceled and removes them after confirmation.
10. Text inputs, password inputs, textareas, rich-text editors, and shadow-root editors do not trigger annotation; ordinary article selection still works afterward.
11. Local HTML saves with its file source when Chrome grants file access. If access is disabled, the test verifies that Chrome does not inject the extension.
12. Web-page senders cannot call Google connection or document-selection operations.
13. Google connect, create/select, and individual-save controls work through the actual UI and service worker with Google identity and HTTP test doubles. Inserted text contains the annotation once without field labels or raw source URLs; source links are native text-style requests.
14. Repeated Google inbox export skips clips already present in the selected tab, using mocked Google services.
15. A simulated Google outage keeps notes locally; retry recovers them and disconnect restores local saving without deleting the inbox.
16. Switching between TXT and Markdown in the annotation dialog creates actual downloaded files with the correct extension and content, and remembers the last saved choice.
17. The settings export-format selector exports the entire inbox as plain text with quotation marks and short source titles instead of metadata labels and long URLs.
18. Choosing TXT appends two annotations to its own real file handle, with one header, without touching the connected Markdown file.
19. A Google destination that still needs setup explains the next action. Switching destinations keeps the draft; a failed Google save keeps the dialog and local backup instead of silently closing.
20. Existing Markdown and TXT files with no trailing newline, a single newline, or a blank line receive separated entries without rewriting earlier text. Real browser file handles cover both LF and CRLF endings and non-ASCII text.
21. In a fresh browser profile, an inbox note and a real file handle stored by a build older than 0.6.4 move to the renamed database; the old database is removed and the file keeps receiving saves.

Google browser tests use synthetic responses and a test-only token injected into the temporary service worker. They never contact a real Google account and do not represent live OAuth validation. See [Google Docs setup and validation](GOOGLE_DOCS.md).

To additionally test selecting and saving on the real public `https://example.com` website, run `npm run test:e2e -- --live`. This optional check requires internet access and is not part of CI.

The file append test uses a real `FileSystemFileHandle` from Chromium's origin-private file system. It does not automate the operating system's file picker or permission dialogs. The test does not validate the macOS app's Accessibility integration.

## Screenshot provenance

```bash
cd chrome-extension
npm run screenshots
```

The screenshots are browser captures of the actual extension UI with fictional, English example content. The test serves `tests/e2e/reading-fixture.html` at intercepted URLs on `https://reading.example.test`, `http://docs.example.test`, and `https://chatgpt.com`, using the shipped content-script match rules. The main screenshots come from the general article site. It does not log in to ChatGPT or use personal conversations. Live ChatGPT layout and account behavior are outside this fixture test.

Mouse and keyboard actions interact with the extension's UI. The test inspects its closed shadow root through the browser debugging protocol without changing the shipped content script or mocking extension storage and messaging. For the native destination select, the test focuses the control through CDP and uses keyboard type-ahead; headless macOS does not forward keyboard events to a native popup menu.

Images are first captured in the ignored `build/chrome-e2e` directory. Only after all assertions pass are they copied to:

- `docs/screenshots/chrome-selection.png`: a selected sentence and the floating **Annotate** button.
- `docs/screenshots/chrome-annotation.png`: the populated annotation dialog before saving, with optional metadata collapsed.
- `docs/screenshots/chrome-inbox.png`: settings after three clips have been saved.

Downloaded Markdown, TXT, and a failure screenshot, if any, stay in `build/chrome-e2e`. The temporary browser profile is removed after each run. README screenshots and this fixture are not included in the extension's distribution ZIP.

## Manual integration checks

For a release, also load the unpacked extension in Chrome and try an actual article, documentation page, and ChatGPT conversation. Select a default Markdown file and a separate TXT file through the system picker, append two notes to each, restart Chrome, and check whether permission renewal is requested. Switch destinations directly in the annotation dialog. Confirm that canceling a separate-file download does not lose the local copy. Try local HTML both with and without **Allow access to file URLs** enabled.

For the macOS app, verify Accessibility permission and selection behavior in the supported applications, including an empty drag and a double-click selection.
