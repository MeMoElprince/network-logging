import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
const PORT = Number(process.env.PORT ?? 9999);

const consumers = new Set<WebSocket>();
const producers = new Set<WebSocket>();

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, consumers: consumers.size, producers: producers.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  if (url !== '/producer' && url !== '/consumer') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url === '/producer') {
      producers.add(ws);
      console.log(`[relay] producer connected (total=${producers.size})`);
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const msg = data.toString();
        for (const c of consumers) {
          if (c.readyState === WebSocket.OPEN) c.send(msg);
        }
      });
      ws.on('close', () => {
        producers.delete(ws);
        console.log(`[relay] producer disconnected (total=${producers.size})`);
      });
    } else {
      consumers.add(ws);
      console.log(`[relay] consumer connected (total=${consumers.size})`);
      ws.on('close', () => {
        consumers.delete(ws);
        console.log(`[relay] consumer disconnected (total=${consumers.size})`);
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on ws://localhost:${PORT} (/producer, /consumer)`);
});
