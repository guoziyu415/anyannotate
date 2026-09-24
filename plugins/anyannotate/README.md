# AnyAnnotate Plugin

AnyAnnotate is a local-only MCP app with an in-chat interface. It can also be used as a Codex plugin from this repository. The workspace collects multiple excerpts, adds annotations, changes their order, and exports files. Buttons and inputs call server tools directly, so each edit does not create another chat turn.

## Implemented features

- Opens an interactive clipping workspace below a ChatGPT response
- Collects any number of excerpts and annotations
- Saves automatically to the server-local `data/draft.json`
- Edits quotes, annotations, tags, and sources
- Moves, deletes, and clears entries
- Downloads Markdown or plain text
- Includes a normal browser preview for debugging without ChatGPT

## Run locally

Node.js 20 or later is required.

```bash
cd plugins/anyannotate
npm install
npm start
```

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- Local widget preview: `http://127.0.0.1:8787/preview`
- Health check: `http://127.0.0.1:8787/health`

Run tests:

```bash
npm test
```

## Connect to ChatGPT

ChatGPT must be able to reach the MCP endpoint over HTTPS. For local development, use Secure MCP Tunnel or another HTTPS tunnel to connect `http://127.0.0.1:8787`, then create a developer-mode app in ChatGPT with the MCP URL:

```text
https://your-domain.example/mcp
```

After connecting, ask ChatGPT to `Open AnyAnnotate` to mount the workspace. Once it is open, adding, annotating, reordering, deleting, and exporting can be completed inside the interface.

Secure MCP Tunnel is for private developer-mode testing. Do not publish or share the tunnel URL.

## Important limitation

ChatGPT widgets run inside an isolated iframe and cannot monitor or read the surrounding conversation DOM. The plugin therefore cannot capture text selected with the mouse in an existing answer as directly as the macOS app or Chrome extension.

The current input methods are:

1. Paste or type an excerpt at the top of the workspace.
2. Clearly identify the text to save in ChatGPT so `add_excerpt` can add it and open the workspace.

The local preview uses same-origin `/api` routes. Cross-origin browser access is rejected to prevent unrelated websites from reading or changing the local draft.

## Data and deployment

The default data file is `data/draft.json`. Set `ANYANNOTATE_DATA_FILE` to use another path. `PORT` controls the listening port. `HOST` may be `127.0.0.1`, `localhost`, or `::1`; non-loopback binding is rejected.

This version is a single-user, local-first prototype. The REST preview is same-origin only, but the MCP endpoint does not implement user authentication. Before any public deployment, add OAuth, per-user isolation, a persistent database, rate limiting, logging, and abuse controls. Never expose one default draft to multiple users.

The widget resource URI is versioned. Set `ANYANNOTATE_WIDGET_DOMAIN` to the verified HTTPS origin when preparing a future submission; it is intentionally omitted for local development.
