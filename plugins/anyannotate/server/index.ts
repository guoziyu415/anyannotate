import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { exportDraft } from "./formats.js";
import { DraftStore } from "./store.js";
import type { ClipChanges, DraftState, ExportFormat } from "./types.js";

const VERSION = "0.2.0";
const WIDGET_URI = "ui://anyannotate/workspace-v0.2.0.html";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = process.env.ANYANNOTATE_DATA_FILE
  ? path.resolve(process.env.ANYANNOTATE_DATA_FILE)
  : path.join(rootDir, "data", "draft.json");
const widgetFile = path.join(rootDir, "dist", "index.html");
const store = new DraftStore(dataFile);

const identifier = z.string().min(1).max(100);
const clipFields = {
  quote: z.string().trim().min(1).max(50_000).describe("The exact answer excerpt to collect."),
  annotation: z.string().max(20_000).optional().describe("The user's private note about the excerpt."),
  tags: z.array(z.string().max(100)).max(30).optional().describe("Optional tags without requiring # prefixes."),
  source: z.string().max(1_000).optional().describe("Optional source label or URL."),
};
const clipInputSchema = z.object({ id: identifier.optional(), ...clipFields }).strict();
const clipUpdateSchema = z.object({
  quote: z.string().trim().min(1).max(50_000).optional(),
  annotation: z.string().max(20_000).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
  source: z.string().max(1_000).optional(),
}).strict();

function draftResult(draft: DraftState, message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { draft },
  };
}

function readWidgetHtml(): string {
  if (!fs.existsSync(widgetFile)) {
    throw new Error(`Widget build not found at ${widgetFile}. Run npm run build first.`);
  }
  return fs.readFileSync(widgetFile, "utf8");
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "anyannotate", version: VERSION });

  registerAppTool(
    server,
    "open_anyannotate",
    {
      title: "Open AnyAnnotate",
      description:
        "Open the interactive AnyAnnotate workspace. Use it when the user wants to collect, review, annotate, reorder, delete, or export answer excerpts without adding more chat messages for every edit.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async () => draftResult(store.read(), "Opened the AnyAnnotate workspace.")
  );

  registerAppTool(
    server,
    "add_excerpt",
    {
      title: "Add Excerpt",
      description:
        "Add one exact excerpt to AnyAnnotate and open the workspace. Use only when the user clearly identifies text they want to keep.",
      inputSchema: {
        id: identifier.describe("A stable request ID used to prevent duplicate inserts on retries."),
        ...clipFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async (input) =>
      draftResult(store.append(input), "Added one excerpt and opened the AnyAnnotate workspace.")
  );

  const appOnlyMeta = { ui: { visibility: ["app" as const] } };

  registerAppTool(
    server,
    "draft_get",
    {
      title: "Read Draft",
      description: "Read the current AnyAnnotate draft for the mounted app.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: appOnlyMeta,
    },
    async () => draftResult(store.read(), "Draft loaded.")
  );

  registerAppTool(
    server,
    "draft_set_title",
    {
      title: "Set Draft Title",
      description: "Set the export title for the mounted AnyAnnotate app.",
      inputSchema: { title: z.string().max(200) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: appOnlyMeta,
    },
    async ({ title }) => draftResult(store.setTitle(title), "Draft title updated.")
  );

  registerAppTool(
    server,
    "draft_append",
    {
      title: "Append Clip",
      description: "Append an excerpt from the mounted AnyAnnotate app.",
      inputSchema: { id: identifier, ...clipFields },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: appOnlyMeta,
    },
    async (input) => draftResult(store.append(input), "Excerpt added.")
  );

  registerAppTool(
    server,
    "draft_update",
    {
      title: "Update Clip",
      description: "Update one excerpt from the mounted AnyAnnotate app.",
      inputSchema: {
        id: identifier,
        quote: z.string().trim().min(1).max(50_000).optional(),
        annotation: z.string().max(20_000).optional(),
        tags: z.array(z.string().max(100)).max(30).optional(),
        source: z.string().max(1_000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: appOnlyMeta,
    },
    async ({ id, ...changes }) =>
      draftResult(store.update(id, changes as ClipChanges), "Excerpt updated.")
  );

  registerAppTool(
    server,
    "draft_delete",
    {
      title: "Delete Clip",
      description: "Delete one excerpt from the mounted AnyAnnotate app.",
      inputSchema: { id: identifier },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: appOnlyMeta,
    },
    async ({ id }) => draftResult(store.remove(id), "Excerpt deleted.")
  );

  registerAppTool(
    server,
    "draft_move",
    {
      title: "Move Clip",
      description: "Move one excerpt to an exact position in the mounted AnyAnnotate app.",
      inputSchema: { id: identifier, toIndex: z.number().int().min(0).max(100_000) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: appOnlyMeta,
    },
    async ({ id, toIndex }) => draftResult(store.move(id, toIndex), "Excerpt moved.")
  );

  registerAppTool(
    server,
    "draft_clear",
    {
      title: "Clear Draft",
      description: "Delete all excerpts from the mounted AnyAnnotate app.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: appOnlyMeta,
    },
    async () => draftResult(store.clear(), "Draft cleared.")
  );

  registerAppTool(
    server,
    "draft_export",
    {
      title: "Export Draft",
      description: "Render the mounted AnyAnnotate draft as Markdown or plain text.",
      inputSchema: { format: z.enum(["md", "txt"]) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: appOnlyMeta,
    },
    async ({ format }) => ({
      content: [{ type: "text" as const, text: "Draft export is ready." }],
      structuredContent: { export: exportDraft(store.read(), format as ExportFormat) },
    })
  );

  registerAppResource(
    server,
    "AnyAnnotate workspace",
    WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive workspace for collecting and annotating answer excerpts.",
      _meta: {
        ui: {
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: [] },
          ...(process.env.ANYANNOTATE_WIDGET_DOMAIN
            ? { domain: process.env.ANYANNOTATE_WIDGET_DOMAIN }
            : {}),
        },
      },
    },
    async () => ({
      contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: readWidgetHtml() }],
    })
  );

  return server;
}

export function createHttpApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'"
    );
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== expectedOrigin) {
      res.status(403).json({ error: "Cross-origin API access is not allowed." });
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true, name: "anyannotate", version: VERSION }));
  app.get("/preview", (_req, res) => res.type("html").send(readWidgetHtml()));
  app.get("/api/draft", (_req, res) => res.json({ draft: store.read() }));
  app.patch("/api/draft", (req, res) => {
    const { title } = z.object({ title: z.string().max(200) }).strict().parse(req.body);
    res.json({ draft: store.setTitle(title) });
  });
  app.post("/api/clips", (req, res) => res.json({ draft: store.append(clipInputSchema.parse(req.body)) }));
  app.patch("/api/clips/:id", (req, res) =>
    res.json({ draft: store.update(identifier.parse(req.params.id), clipUpdateSchema.parse(req.body)) })
  );
  app.delete("/api/clips/:id", (req, res) =>
    res.json({ draft: store.remove(identifier.parse(req.params.id)) })
  );
  app.post("/api/clips/:id/move", (req, res) =>
    res.json({
      draft: store.move(
        identifier.parse(req.params.id),
        z.number().int().min(0).max(100_000).parse(req.body.toIndex)
      ),
    })
  );
  app.delete("/api/draft", (_req, res) => res.json({ draft: store.clear() }));
  app.get("/api/export/:format", (req, res) => {
    const format = z.enum(["md", "txt"]).parse(req.params.format);
    const exported = exportDraft(store.read(), format);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
    res.type(exported.mimeType).send(exported.content);
  });

  app.all("/mcp", async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  });

  return app;
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

export function validateHost(value: string): string {
  if (!["127.0.0.1", "localhost", "::1"].includes(value)) {
    throw new Error("AnyAnnotate is local-only. HOST must be a loopback address.");
  }
  return value;
}

export function startHttpServer() {
  const safeHost = validateHost(host);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return createHttpApp().listen(port, safeHost, () => {
    console.log(`AnyAnnotate MCP App listening at http://${safeHost}:${port}/mcp`);
    console.log(`Local preview: http://${safeHost}:${port}/preview`);
  });
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMainModule) startHttpServer();
