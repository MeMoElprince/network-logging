# CLAUDE.md

Quickstart for AI assistants and contributors. Project-specific instructions live here; deeper architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this is

Live multi-transport network viewer for debugging third-party web pages. A Chrome MV3 extension instruments the page, a Node WebSocket relay fans events out, and a React+Vite viewer renders them with filtering, grouping, and session detection.

Captured transports: WebSocket, fetch, XMLHttpRequest, EventSource (SSE), RTCDataChannel.

## Workspace layout

- `extension/` — Chrome MV3 extension. Page-script (`src/inject.ts`) monkey-patches transport globals; content-script (`src/content.ts`) bridges to the relay.
- `relay/` — Tiny Node `ws` server. Producers (extension) → `/producer`; consumers (viewer) → `/consumer`. Passthrough only.
- `shared/` — Cross-workspace TypeScript types. The protocol lives in `shared/protocol.ts`.
- `web/` — React+Vite viewer. In-memory subscriber store, filter chips, grouping, session detection, JSON export/import.

## Local dev

```bash
npm run install:all       # one-time: install all workspaces
npm run build:ext         # build extension into extension/dist/
npm run dev               # boots relay (ws://localhost:9999) + viewer (http://localhost:5173)
```

Load `extension/dist/` unpacked in `chrome://extensions` (Developer mode). After each `build:ext`, click the extension's reload button. Set the target URL pattern in the extension popup.

## Conventions

- **State is in-memory.** No IndexedDB. Entries hard-capped at 5000 (oldest dropped). Filters persist via `localStorage` key `nl.ui.v2`.
- **Payload cap.** Bodies >64 KB are truncated (`MAX_PAYLOAD_BYTES` in `shared/protocol.ts`); `truncated: true` is set on the event.
- **Self-traffic filter.** `inject.ts` skips any URL containing `localhost:9999` to avoid feedback loops when viewing the relay itself.
- **No new files unless needed.** Prefer editing existing files; UI follows the chip/pill component style already in `web/src/components/`.

## Adding a new transport (cheatsheet)

Full recipe in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#adding-a-transport).

1. Add to the `Transport` union in `shared/protocol.ts`.
2. Add an `installXxx()` function in `extension/src/inject.ts` that wraps the global API and emits via the shared `emitEvent` / `emitLifecycle` helpers (set `transport:` and any `meta:` fields).
3. Add a `{ id, label }` entry to `CATEGORIES` in `web/src/lib/category.ts` and a short label in `web/src/lib/transport.ts`.
4. If the transport has unusual direction semantics, tweak `web/src/components/Toolbar.tsx` `CategoryChips` to hide the inapplicable chip.

## Build / typecheck

```bash
cd web && npx tsc -b          # viewer typecheck
cd extension && npx tsc -b    # extension typecheck (also via npm run build:ext)
```
