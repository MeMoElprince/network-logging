# Architecture

End-to-end picture of how a network event flows from a target page to the viewer, and how to extend the system with new transports.

## Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│  Target page (any third-party site matching the configured pattern)    │
│                                                                        │
│   page JS  ─── calls window.fetch / new WebSocket / etc.               │
│       │                                                                │
│       ▼                                                                │
│  inject.ts (MAIN world, document_start)  ── monkey-patches transports  │
│       │                                                                │
│       │  window.postMessage({ __nl: true, kind, data })                │
│       ▼                                                                │
│  content.ts (ISOLATED world)  ── listens, queues, forwards             │
└────────────────────────────────────────────────────────────────────────┘
        │
        │  ws://localhost:9999/producer  (JSON-stringified RelayMsg)
        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  relay (Node ws server)                                                │
│   producers → broadcasts each message to all consumers                 │
└────────────────────────────────────────────────────────────────────────┘
        │
        │  ws://localhost:9999/consumer
        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  web viewer (React + Vite)                                             │
│   subscriber store → derived filter/group → EventList / DetailPane     │
└────────────────────────────────────────────────────────────────────────┘
```

Background service worker (`extension/src/background.ts`) registers both content scripts (`inject.js` in MAIN world, `content.js` in ISOLATED world) at `document_start` for the URL patterns configured in the extension popup.

## Capture layer (`extension/src/inject.ts`)

The page script runs in the MAIN world so it can replace `window.WebSocket`, `window.fetch`, etc. — globals the page actually uses. Each transport has its own `installXxx()` function. All emits funnel through two helpers:

- `emitEvent({ socketId, url, direction, transport, data, meta })` — serializes the body (string / ArrayBuffer / Blob / FormData / JSON) and posts a `CapturedEvent`.
- `emitLifecycle(lc)` — posts a `SocketLifecycle`.

Both `postMessage` to the same window with a `__nl: true` tag. The ISOLATED-world content script picks them up and forwards to the relay.

### Per-transport details

| Transport | Global wrapped | `send` event | `recv` event | Lifecycle |
|-----------|----------------|--------------|--------------|-----------|
| `websocket` | `window.WebSocket` | `ws.send(data)` | `message` listener | `open` on construct, `close`, `error` |
| `fetch` | `window.fetch` | request URL + body + headers + method | response body + headers + status | `error` on rejection only (no open/close — each fetch is self-contained) |
| `xhr` | `XMLHttpRequest.prototype.{open,send,setRequestHeader}` | request body + headers + method | `loadend` → response body + headers + status | `error` only |
| `sse` | `window.EventSource` | (none — SSE is recv-only) | every message, with `meta.eventName` (default `'message'`) and `meta.lastEventId` | `open` on construct, `close` on `.close()`, `error` |
| `webrtc` | `RTCPeerConnection.prototype.createDataChannel` + `datachannel` event | `channel.send(data)` | `message` listener | `open` / `close` / `error`; `meta.label = channel.label` |

### `socketId` (a.k.a. "connection id")

Despite the legacy name, `socketId` is the **connection / correlation id**. It groups related entries:

- WebSocket: every frame on the same socket.
- fetch / xhr: the request and its response share one id.
- SSE: open + every message + close + error all share one id.
- WebRTC: the channel's open + each send/recv + close share one id.

The field name is kept for back-compat with v1 JSON exports.

### Self-traffic filter

`isSelfTraffic(url)` rejects URLs containing `localhost:9999` (the relay host). Without this, opening the viewer in the same browser as a target page would cause the extension to instrument the viewer's own WebSocket to the relay → infinite loop.

### Payload truncation

Anything over `MAX_PAYLOAD_BYTES` (64 KB, `shared/protocol.ts`) is clipped and `truncated: true` is set on the event. Binary payloads go through `bufToBase64()`; strings are sliced.

### Why fetch needs `clone()`

A `Response` body is a single-consumption stream. The wrapper calls `res.clone()` and reads the clone, so the page's own `await res.json()` still works. Same idea for `Request` objects passed as `input`.

## Relay (`relay/src/index.ts`)

Dumb broadcaster, no buffering, no persistence:

- `/producer` connections — content scripts. Each message is JSON-parsed and forwarded.
- `/consumer` connections — viewer instances. Receive every producer message.
- The relay itself holds no state beyond connection lists. Producers queue locally (1000-msg cap) when the relay is down; the content script reconnects with exponential backoff.

## Shared protocol (`shared/protocol.ts`)

```ts
type Transport = 'websocket' | 'fetch' | 'xhr' | 'sse' | 'webrtc';

type EventMeta = {
  method?: string;            // fetch/xhr
  status?: number;            // fetch/xhr response
  statusText?: string;
  headers?: Record<string, string>;
  eventName?: string;         // SSE
  lastEventId?: string;       // SSE
  label?: string;             // WebRTC channel label
  error?: string;             // any
};

type CapturedEvent = {
  id: string;
  socketId: string;           // connection id (see above)
  url: string;
  direction: 'send' | 'recv';
  timestamp: number;
  payloadType: 'string' | 'binary';
  payload: string;            // base64 if binary
  size: number;
  truncated?: boolean;
  transport: Transport;
  meta?: EventMeta;
};

type SocketLifecycle = {
  socketId: string;
  url: string;
  kind: 'open' | 'close' | 'error';
  timestamp: number;
  code?: number;              // WS close code
  reason?: string;
  transport: Transport;
  meta?: EventMeta;
};

type RelayMsg =
  | { type: 'event'; data: CapturedEvent }
  | { type: 'lifecycle'; data: SocketLifecycle };
```

The protocol is forward-extensible: new transports are added to the `Transport` union, transport-specific extras go in `meta`. The shape itself doesn't change.

## Viewer state (`web/src/store.ts`)

Custom subscriber store (no Zustand / Redux dependency). State:

- `entries: LogEntry[]` — max 5000, oldest evicted.
- `connection: 'connecting' | 'open' | 'closed'` — relay status.
- `filters: Filters` — search, category, send/recv/lifecycle toggles, noise patterns, group-by, session config, row layout, collapsed groups. Persisted to `localStorage` (`nl.ui.v2`).
- `selectedId: string | null` — for DetailPane.

Derived data (filtering, grouping, session detection, path/event observation) lives in `web/src/lib/select.ts` and runs inside `useMemo` keyed on `[entries, filters]`.

### Categories

`web/src/lib/category.ts` maps `entry.data.transport` directly to a category. The Category Tabs in `Toolbar.tsx` filter by this. `CategoryChips` hides the `send` chip for SSE (recv-only) and hides the `lifecycle` chip for fetch/xhr (no lifecycle events emitted).

### Export / Import

`web/src/lib/exportImport.ts` serializes `{ version, exportedAt, entries, filters }` to JSON. Current version is `2`; v1 files (pre-multi-transport) are accepted via `normalizeEntry()` which fills `transport: 'websocket'`.

## Adding a transport

Recipe:

1. **Extend the protocol** (`shared/protocol.ts`):
   - Add the literal to the `Transport` union.
   - Add any new `meta` fields if needed.

2. **Write the wrapper** (`extension/src/inject.ts`):
   - Add an `installXxx()` function.
   - Identify the global to monkey-patch. Wrap it so the page's calls still work normally.
   - For each captured operation, call `emitEvent` (with `transport`, `direction`, `data`, optional `meta`) or `emitLifecycle`.
   - Generate one `socketId` per logical connection / correlation; reuse it across related events.
   - Call `installXxx()` from the IIFE at the bottom of the file.
   - Run all URLs through `isSelfTraffic()` first.

3. **Surface in the viewer**:
   - `web/src/lib/category.ts` — add `{ id: 'xxx', label: 'Xxx' }` to `CATEGORIES`.
   - `web/src/lib/transport.ts` — add a short label to `transportLabel()`.
   - `web/src/components/EventRow.tsx` — if the transport has a per-event badge (HTTP method, SSE event name, etc.), add a branch in `transportBadge()`.
   - `web/src/components/DetailPane.tsx` — most new `meta` fields render automatically via the existing rows; add a row only if it's a new field.
   - `web/src/components/Toolbar.tsx` — `CategoryChips`: hide `send` / `recv` / `life` chips that don't apply to your transport.

4. **Typecheck and rebuild**:
   ```bash
   cd extension && npx tsc -b && npm run build
   cd web && npx tsc -b
   ```
   Then reload the extension in `chrome://extensions`.

## Caveats

- **MV3 timing.** Page scripts inject at `document_start`. Anything the page does before that escapes capture. The MV3 dynamic-registration model is the standard workaround.
- **Streaming responses (fetch).** The wrapper awaits the full response before emitting the `recv` event. Truly long-lived streams (e.g. unbounded `fetch` with chunked responses) only surface when they end.
- **gzip / br response bodies.** Captured as-is — the browser decompresses transparently for the page; the wrapper reads the decoded text via `res.clone().text()`.
- **Service worker fetches** intercepted inside a registered SW are out of scope — the wrapper only sees the page context.
- **Cross-realm WebSocket / fetch.** If the page creates objects in a worker or iframe with a different realm, those globals are separate and unwrapped. The current extension injects into the top-level page only.
- **No backpressure.** The relay drops nothing but the viewer caps entries at 5000. If a page emits faster than 5000 events between viewer refreshes, the tail wins.
