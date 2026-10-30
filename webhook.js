// Webhook receiver: point a GoHighLevel workflow "Webhook" action, a website form,
// or Facebook Lead Ads (via n8n/Make) at POST /webhook/lead.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GHLClient } from './lib/ghl.js';
import { routeLead } from './lib/leadRouter.js';

function safeEqual(a = '', b = '') {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function createServerApp({ env = process.env, ghl } = {}) {
  ghl ??= new GHLClient({ token: env.GHL_TOKEN, locationId: env.GHL_LOCATION_ID, dryRun: env.DRY_RUN === '1' });
  const config = { pipelineId: env.GHL_PIPELINE_ID, newLeadStageId: env.GHL_NEW_LEAD_STAGE_ID, followUpMinutes: Number(env.FOLLOW_UP_MINUTES || 5) };

  return createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { status: 'ok', dryRun: ghl.dryRun });
    if (req.method !== 'POST' || !req.url.startsWith('/webhook/lead')) return reply(404, { error: 'not found' });
    if (env.WEBHOOK_SECRET && !safeEqual(req.headers['x-webhook-secret'], env.WEBHOOK_SECRET)) return reply(401, { error: 'bad secret' });

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(raw || '{}');
        const result = await routeLead(ghl, payload, config);
        reply(200, { ok: true, ...result });
      } catch (err) {
        reply(err.message.includes('needs an email') ? 422 : 500, { ok: false, error: err.message });
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  createServerApp().listen(port, () => console.log(`GHL lead router listening on http://localhost:${port}/webhook/lead`));
}
