# Network Logging

Live WebSocket frame viewer for debugging third-party chatbot pages. React+Vite+TS viewer, Chrome MV3 extension for auto-injection, Node `ws` relay.

## Setup

```bash
npm run install:all
npm run build:ext
```

Load `extension/dist/` as unpacked in `chrome://extensions` (Developer Mode).
Open the extension popup, set the target URL pattern (e.g. `https://chat.example.com/*`), save.

## Run

```bash
npm run dev
```

Starts relay on `ws://localhost:9999` and viewer on `http://localhost:5173`.

Open the target page — frames stream into the viewer.
