/**
 * Minimal Fatture in Cloud webhook endpoint (node:http). Put it behind HTTPS: the sink must be an https URL
 * and `FIC_WEBHOOK_SINK` must be exactly the URL registered in the subscription (it is the JWT audience).
 *
 *   FIC_WEBHOOK_SINK=https://hooks.example.com/fic node examples/fic-webhook-server.ts
 */
import { createServer } from 'node:http';
import {
  handleFicVerification,
  verifyFicWebhook,
  WebhookVerificationError,
} from '@massimiliano-dev/fatturapa-fattureincloud';

const audience = process.env.FIC_WEBHOOK_SINK;
if (!audience) throw new Error('Set FIC_WEBHOOK_SINK');
const seen = new Set<string>(); // use a persistent store in production

createServer((req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 1024 * 1024) req.destroy();
    else chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const url = new URL(req.url ?? '/', 'https://placeholder');
      const request = {
        headers: req.headers,
        body: Buffer.concat(chunks),
        query: Object.fromEntries(url.searchParams),
      };
      if (req.method === 'GET') {
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(handleFicVerification(request, { audience })));
        return;
      }
      const event = verifyFicWebhook(request, { audience });
      if (!seen.has(event.id)) {
        seen.add(event.id);
        // Enqueue the work: read the documents `event.ids` of company `event.companyId` through the API.
      }
      res.writeHead(202).end();
    } catch (error) {
      res.writeHead(error instanceof WebhookVerificationError ? 401 : 400).end();
    }
  });
}).listen(8080);
