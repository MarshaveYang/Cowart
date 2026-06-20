import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const SERVER_NAME = "Cowart MCP";
const SERVER_VERSION = "0.1.1";
const TOOL_GET_SELECTION = "get_cowart_selection";
const TOOL_RENDER_WIDGET = "render_cowart_canvas_widget";
const WIDGET_URI = "ui://widget/cowart/canvas.html";
const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";
const DEFAULT_CANVAS_URL = "http://127.0.0.1:43217/";
const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
};

const widgetMeta = {
  ui: {
    resourceUri: WIDGET_URI,
    prefersBorder: false,
    csp: {
      connectDomains: [
        "http://127.0.0.1:*",
        "http://localhost:*",
      ],
      resourceDomains: [
        "http://127.0.0.1:*",
        "http://localhost:*",
      ],
    },
  },
  "openai/widgetDescription": "Cowart tldraw canvas widget.",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": {
    connect_domains: [
      "http://127.0.0.1:*",
      "http://localhost:*",
    ],
    resource_domains: [
      "http://127.0.0.1:*",
      "http://localhost:*",
    ],
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCanvasUrl(value) {
  const rawUrl = nonEmptyString(value) ?? DEFAULT_CANVAS_URL;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Cowart canvas URL must use http or https.");
    }
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch (error) {
    throw new Error(`Invalid Cowart canvas URL: ${error.message}`);
  }
}

function resolveSelectionFile(args = {}) {
  const explicitCanvasDir = nonEmptyString(args.canvasDir);
  if (explicitCanvasDir) {
    return path.join(path.resolve(explicitCanvasDir), "cowart-selection.json");
  }

  const explicitProjectDir = nonEmptyString(args.projectDir);
  if (explicitProjectDir) {
    return path.join(path.resolve(explicitProjectDir), "canvas", "cowart-selection.json");
  }

  const envCanvasDir = nonEmptyString(process.env.COWART_CANVAS_DIR);
  if (envCanvasDir) {
    return path.join(path.resolve(envCanvasDir), "cowart-selection.json");
  }

  const envProjectDir = nonEmptyString(process.env.COWART_PROJECT_DIR);
  if (envProjectDir) {
    return path.join(path.resolve(envProjectDir), "canvas", "cowart-selection.json");
  }

  return path.join(process.cwd(), "canvas", "cowart-selection.json");
}

function cowartWidgetHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cowart Canvas</title>
    <style>
      * {
        box-sizing: border-box;
      }
      html,
      body,
      #root {
        width: 100%;
        height: 100%;
        min-height: 640px;
        margin: 0;
      }
      body {
        background: #f7f5ef;
        color: #1f2430;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      #cowartWidgetStatus {
        display: grid;
        height: 100%;
        min-height: 640px;
        place-items: center;
        padding: 24px;
        text-align: center;
      }
      .cowart-widget-status__inner {
        display: grid;
        gap: 10px;
        max-width: 520px;
        color: #4a5568;
        font-size: 13px;
        line-height: 1.45;
      }
      .cowart-widget-status__title {
        color: #1f2430;
        font-size: 15px;
        font-weight: 650;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <main id="cowartWidgetStatus" aria-live="polite">
        <div class="cowart-widget-status__inner">
          <div class="cowart-widget-status__title" id="cowartStatusTitle">Opening Cowart Canvas...</div>
          <div id="cowartStatusText">Waiting for the canvas URL from Codex.</div>
        </div>
      </main>
    </div>
    <script>
      (() => {
        const fallbackUrl = ${JSON.stringify(DEFAULT_CANVAS_URL)};
        const statusTitle = document.getElementById("cowartStatusTitle");
        const statusText = document.getElementById("cowartStatusText");
        let latestPayload = {};
        let loaded = false;

        function isNonEmptyPayload(payload) {
          return Boolean(payload && typeof payload === "object" && Object.keys(payload).length > 0);
        }

        function payloadFromToolResult(result) {
          if (!result || typeof result !== "object") return null;
          if (result._meta?.widgetData && typeof result._meta.widgetData === "object") {
            return result._meta.widgetData;
          }
          if (result.structuredContent && typeof result.structuredContent === "object") {
            return result.structuredContent;
          }
          return result;
        }

        function toolPayload() {
          const openai = window.openai || {};
          const candidates = [
            payloadFromToolResult(openai.toolOutput),
            payloadFromToolResult(openai.rawToolResult),
            openai.widgetData,
          ];
          return candidates.find(isNonEmptyPayload) || {};
        }

        function canvasUrl() {
          const payload = latestPayload.canvasUrl ? latestPayload : toolPayload();
          return payload.canvasUrl || fallbackUrl;
        }

        function setStatus(title, text) {
          statusTitle.textContent = title;
          statusText.textContent = text;
        }

        function rememberPayload(payload) {
          if (!isNonEmptyPayload(payload)) return;
          latestPayload = { ...latestPayload, ...payload };
        }

        function assetUrl(baseUrl, path) {
          return new URL(path, baseUrl).toString();
        }

        function appendModule(src, { inline = false } = {}) {
          const script = document.createElement("script");
          script.type = "module";
          script.async = false;
          if (inline) {
            script.textContent = src;
          } else {
            script.src = src;
          }
          return new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => {
              reject(new Error("The Cowart widget could not load " + (inline ? "an inline module." : src)));
            };
            document.head.appendChild(script);
          });
        }

        function reactRefreshPreamble(baseUrl) {
          const refreshUrl = JSON.stringify(assetUrl(baseUrl, "/@react-refresh"));
          return [
            "import RefreshRuntime from " + refreshUrl + ";",
            "RefreshRuntime.injectIntoGlobalHook(window);",
            "window.$RefreshReg$ = () => {};",
            "window.$RefreshSig$ = () => (type) => type;",
            "window.__vite_plugin_react_preamble_installed__ = true;"
          ].join("\\n");
        }

        async function load() {
          if (loaded) return;
          const url = canvasUrl();
          setStatus("Opening Cowart Canvas...", url);
          loaded = true;
          window.__COWART_CANVAS_BASE_URL__ = url;
          try {
            await appendModule(reactRefreshPreamble(url), { inline: true });
            await appendModule(assetUrl(url, "/@vite/client"));
            await appendModule(assetUrl(url, "/src/main.jsx"));
          } catch (error) {
            loaded = false;
            setStatus(
              "Cowart Canvas could not load",
              error instanceof Error ? error.message : "The Cowart widget could not load the local Vite modules."
            );
          }
        }

        window.addEventListener("openai:set_globals", (event) => {
          rememberPayload(payloadFromToolResult(event.detail?.globals?.toolOutput));
          rememberPayload(event.detail?.globals?.widgetData);
          load();
        });
        window.addEventListener("message", (event) => {
          const result = event.data?.params?.result;
          if (event.data?.method !== "ui/notifications/tool-result" || !result) return;
          rememberPayload(payloadFromToolResult(result));
          load();
        });

        rememberPayload(toolPayload());
        if (latestPayload.canvasUrl) {
          load();
        } else {
          setTimeout(() => {
            if (latestPayload.canvasUrl || loaded) return;
            load();
          }, 1200);
        }
      })();
    </script>
  </body>
</html>`;
}

async function readSelectionState(args) {
  const selectionFile = resolveSelectionFile(args);
  try {
    const selection = JSON.parse(await readFile(selectionFile, "utf8"));
    if (!selection || typeof selection !== "object" || !Array.isArray(selection.selectedShapes)) {
      throw new Error(`Invalid selection state in ${selectionFile}`);
    }
    return { selection, selectionFile };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        selection: { selectedShapes: [], updatedAt: null },
        selectionFile,
      };
    }
    throw error;
  }
}

function renderCowartWidget(args = {}) {
  const canvasUrl = normalizeCanvasUrl(args.canvasUrl ?? args.url);
  const projectDir = nonEmptyString(args.projectDir);

  return {
    content: [
      {
        type: "text",
        text: `Rendered Cowart canvas widget for ${canvasUrl}`,
      },
    ],
    structuredContent: {
      widget: "cowart-canvas",
      canvasUrl,
      projectDir,
    },
    _meta: {
      "openai/outputTemplate": WIDGET_URI,
      widgetData: {
        canvasUrl,
        projectDir,
      },
    },
  };
}

async function handleToolCall(id, params) {
  if (params?.name === TOOL_RENDER_WIDGET) {
    sendResult(id, renderCowartWidget(params.arguments ?? {}));
    return;
  }

  if (params?.name !== TOOL_GET_SELECTION) {
    sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
    return;
  }

  const { selection, selectionFile } = await readSelectionState(params.arguments ?? {});
  const selectedShapes = selection.selectedShapes ?? [];
  const summary =
    selectedShapes.length === 0
      ? "No Cowart shapes are currently selected."
      : selectedShapes
          .map((shape) => {
            const assetName = shape.asset?.name ? ` (${shape.asset.name})` : "";
            return `${shape.id} [${shape.type ?? "unknown"}]${assetName}`;
          })
          .join("\n");

  sendResult(id, {
    content: [
      {
        type: "text",
        text: summary,
      },
    ],
    structuredContent: {
      selection,
      selectionFile,
    },
  });
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {}, resources: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions:
        "Render and read Cowart canvas state. Use render_cowart_canvas_widget to show the running Cowart web app as a Codex widget, and get_cowart_selection with the current Codex project directory to inspect the canvas selection.",
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, {
      tools: [
        {
          name: TOOL_GET_SELECTION,
          title: "Get Cowart Selection",
          description:
            "Return the currently selected Cowart/tldraw shapes and image asset metadata from a project's canvas/cowart-selection.json state file.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: {
                type: "string",
                description:
                  "Absolute Cowart project directory. The tool reads <projectDir>/canvas/cowart-selection.json.",
              },
              canvasDir: {
                type: "string",
                description:
                  "Absolute canvas directory. If provided, this takes precedence over projectDir.",
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: TOOL_RENDER_WIDGET,
          title: "Render Cowart Canvas Widget",
          description:
            "Render the running Cowart/tldraw local web app inside a Codex widget. Start the Cowart Vite service before calling this tool.",
          inputSchema: {
            type: "object",
            properties: {
              canvasUrl: {
                type: "string",
                description:
                  "Local Cowart canvas URL to embed. Defaults to http://127.0.0.1:43217/.",
              },
              projectDir: {
                type: "string",
                description:
                  "Absolute user project directory whose canvas data is being edited.",
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          _meta: {
            ui: {
              resourceUri: WIDGET_URI,
              visibility: ["model", "app"],
            },
            "openai/outputTemplate": WIDGET_URI,
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening Cowart canvas...",
            "openai/toolInvocation/invoked": "Cowart canvas ready",
          },
        },
      ],
    });
    return;
  }

  if (method === "resources/list") {
    sendResult(id, {
      resources: [
        {
          uri: WIDGET_URI,
          name: "cowart-canvas-widget",
          title: "Cowart Canvas Widget",
          description: "Widget shell for the running Cowart tldraw canvas.",
          mimeType: WIDGET_MIME_TYPE,
          _meta: widgetMeta,
        },
      ],
    });
    return;
  }

  if (method === "resources/read") {
    if (params?.uri !== WIDGET_URI) {
      sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown resource: ${params?.uri ?? ""}`);
      return;
    }

    sendResult(id, {
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: WIDGET_MIME_TYPE,
          text: cowartWidgetHtml(),
          _meta: widgetMeta,
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    try {
      await handleToolCall(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

lines.on("line", (line) => {
  if (line.trim().length === 0) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  handleRequest(message).catch((error) => {
    if (message.id !== undefined) {
      sendError(message.id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
  });
});
