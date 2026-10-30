import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GHLClient } from '../lib/ghl.js';
import { normaliseLead, tagsFor, routeLead } from '../lib/leadRouter.js';
import { computeKpis, renderHtml } from '../lib/kpi.js';
import { createServerApp } from '../webhook.js';
import sample from '../sample/opportunities.json' with { type: 'json' };

test('normalises different lead payload shapes', () => {
  const a = normaliseLead({ contact: { first_name: 'Ana', last_name: 'Ruiz', email: ' ANA@X.COM ', phone: '(555) 010-2000' }, source: 'Facebook Lead Ad' });
  assert.deepEqual([a.firstName, a.lastName, a.email, a.phone], ['Ana', 'Ruiz', 'ana@x.com', '5550102000']);
  const b = normaliseLead({ name: 'Sam Lee Jr', email: 'sam@x.com', utm_source: 'google' });
  assert.equal(b.lastName, 'Lee Jr');
});

test('tags by source, service and value', () => {
  const tags = tagsFor({ source: 'fb lead form', service: 'Hair Restoration', value: 6500 });
  assert.deepEqual(tags, ['new-lead', 'source:facebook', 'service:hair-restoration', 'high-value']);
});

test('routes a lead: contact, opportunity, fast follow-up task (dry run)', async () => {
  const ghl = new GHLClient({ locationId: 'loc1', dryRun: true });
  const now = new Date('2026-10-30T10:00:00Z');
  const r = await routeLead(ghl, { name: 'Ana Ruiz', email: 'ana@x.com', source: 'facebook', estimated_value: 6000 }, { pipelineId: 'p1', newLeadStageId: 's1' }, now);
  assert.equal(ghl.log.length, 3);
  assert.equal(ghl.log[0].path, '/contacts/upsert');
  assert.equal(ghl.log[1].body.pipelineStageId, 's1');
  assert.equal(r.task.dryRun, true);
  assert.equal(ghl.log[2].body.dueDate, '2026-10-30T10:02:00.000Z'); // high-value => 2 minutes
});

test('client retries on 429 and sends the right headers', async () => {
  let calls = 0;
  const fake = async (url, opts) => {
    calls++;
    assert.equal(opts.headers.version, '2021-07-28');
    return calls === 1 ? { status: 429, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => ({ contact: { id: 'c1' } }) };
  };
  const ghl = new GHLClient({ token: 't', locationId: 'l', fetchImpl: fake });
  const res = await ghl.upsertContact({ email: 'a@b.co' });
  assert.equal(res.contact.id, 'c1');
  assert.equal(calls, 2);
});

test('KPIs: win rate, stale deals, sources', () => {
  const k = computeKpis(sample.opportunities, { stages: sample.stages, staleDays: 7, now: new Date('2026-10-30T12:00:00Z') });
  assert.equal(k.totals.won, 2);
  assert.equal(k.totals.lost, 1);
  assert.equal(k.totals.winRate, 66.7);
  assert.deepEqual(k.stale.map((s) => s.id), ['o2', 'o4']);
  assert.equal(k.bySource.facebook.leads, 4);
  assert.match(renderHtml(k), /Stale deals/);
});

test('webhook rejects bad secret and accepts a valid lead', async () => {
  const ghl = new GHLClient({ locationId: 'loc', dryRun: true });
  const server = createServerApp({ env: { WEBHOOK_SECRET: 's3cret', GHL_PIPELINE_ID: 'p', GHL_NEW_LEAD_STAGE_ID: 's' }, ghl }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/webhook/lead`;
  try {
    const bad = await fetch(url, { method: 'POST', headers: { 'x-webhook-secret': 'nope' }, body: '{}' });
    assert.equal(bad.status, 401);
    const ok = await fetch(url, { method: 'POST', headers: { 'x-webhook-secret': 's3cret' }, body: JSON.stringify({ email: 'z@x.com', source: 'website' }) });
    assert.equal(ok.status, 200);
    const noContact = await fetch(url, { method: 'POST', headers: { 'x-webhook-secret': 's3cret' }, body: JSON.stringify({ name: 'X' }) });
    assert.equal(noContact.status, 422);
  } finally {
    server.close();
  }
});
