---
name: open-cowart-canvas
description: Open the Cowart local web service, a tldraw-powered infinite canvas, in a Codex widget. Use when the user asks to open, launch, view, or work in the Cowart canvas or wants an infinite canvas inside Codex.
---

# Open Cowart Canvas

## Workflow

Start the local Cowart web service with the user's current Codex project directory:

```bash
/Users/bytedance/plugins/cowart/scripts/start-canvas.sh /path/to/user/codex-project
```

Use the active workspace or project directory from the current Codex session for `/path/to/user/codex-project`. Do not pass the Cowart plugin directory. If the script is run without an argument, it falls back to the caller's current working directory.

Keep that process running. It serves the tldraw infinite canvas at:

```text
http://127.0.0.1:43217
```

If Vite reports that the port is already in use and prints another `Local:` URL, open that actual URL instead. For example, if the output says `Local: http://127.0.0.1:43218/`, open port `43218`.

If `COWART_PORT` is set before starting the script, open that port instead:

```bash
COWART_PORT=43218 /Users/bytedance/plugins/cowart/scripts/start-canvas.sh /path/to/user/codex-project
```

Then render the Codex widget by calling the Cowart MCP `render_cowart_canvas_widget` tool with the actual local URL and the active project directory:

```json
{
  "canvasUrl": "http://127.0.0.1:43217/",
  "projectDir": "/path/to/user/codex-project"
}
```

The widget embeds the running local Cowart service. If the widget tool is unavailable, give the user the local URL as the fallback.

## Notes

The canvas data is stored on disk in the user's Codex project canvas folder, split by tldraw page:

```text
canvas/pages/<page-id>/cowart-canvas.json
canvas/pages/<page-id>/assets/
canvas/pages/manifest.json
```

Each page's `cowart-canvas.json` contains that page's tldraw records and only the assets used by shapes on that page. Page-local image files live beside the page snapshot under `assets/`. The page directory name is the page id without the `page:` prefix, URL-encoded if needed.

The React app loads all page snapshots through the local Vite API before mounting `tldraw`, merges them into one store snapshot for the editor, and saves changes back out as one `cowart-canvas.json` per page. This means canvas data lives in the project folder rather than in browser local storage.

When inserting or updating image assets programmatically, prefer a page-local file reference:

```text
canvas/pages/<page-id>/assets/example.png
```

with the asset `props.src` set to:

```text
/page-assets/<page-id>/example.png
```

The Vite service maps `/page-assets/<page-id>/...` to the matching page's `assets/` folder. It also supports the older shared route `/assets/...` for files under `canvas/assets/`; on save, local `/assets/...` references and data URLs are copied into the appropriate page's `assets/` folder and rewritten to `/page-assets/<page-id>/...`.

For backward compatibility, if `canvas/pages/` does not contain page snapshots yet, the service will read the legacy single-file snapshot:

```text
canvas/cowart-canvas.json
```

The next save writes the current document into the per-page layout.

The project folder can be supplied either as the first script argument or with `COWART_PROJECT_DIR`:

```bash
COWART_PROJECT_DIR=/path/to/project /Users/bytedance/plugins/cowart/scripts/start-canvas.sh
```

Both forms use `/path/to/project/canvas/` as the canvas root and write page snapshots plus page-local assets under `/path/to/project/canvas/pages/`. If a caller needs an exact canvas root, set `COWART_CANVAS_DIR`; it takes precedence over both the first argument and `COWART_PROJECT_DIR`, and page snapshots plus page assets are written under `$COWART_CANVAS_DIR/pages/`.
