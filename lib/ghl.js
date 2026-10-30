// Minimal GoHighLevel (LeadConnector) API v2 client.
// Docs: https://highlevel.stoplight.io/docs/integrations
// DRY_RUN=1 records every request instead of sending it, so you can test against a client
// account safely before going live.

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export class GHLClient {
  constructor({ token, locationId, dryRun = false, fetchImpl = fetch } = {}) {
    if (!dryRun && !token) throw new Error('GHL_TOKEN (Private Integration token) is required unless DRY_RUN=1');
    this.token = token;
    this.locationId = locationId;
    this.dryRun = dryRun;
    this.fetch = fetchImpl;
    this.log = [];
  }

  async request(method, path, body) {
    const entry = { method, path, body };
    if (this.dryRun) {
      this.log.push(entry);
      return { dryRun: true, ...fakeResponse(method, path, body) };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetch(BASE + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, version: VERSION, accept: 'application/json', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`GHL ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
      return data;
    }
  }

  upsertContact(contact) {
    return this.request('POST', '/contacts/upsert', { locationId: this.locationId, ...contact });
  }

  addTags(contactId, tags) {
    return this.request('POST', `/contacts/${contactId}/tags`, { tags });
  }

  addNote(contactId, body) {
    return this.request('POST', `/contacts/${contactId}/notes`, { body });
  }

  createTask(contactId, { title, body = '', dueDate }) {
    return this.request('POST', `/contacts/${contactId}/tasks`, { title, body, dueDate, completed: false });
  }

  createOpportunity({ pipelineId, pipelineStageId, contactId, name, monetaryValue = 0, source }) {
    return this.request('POST', '/opportunities/', {
      locationId: this.locationId, pipelineId, pipelineStageId, contactId, name, status: 'open', monetaryValue, source,
    });
  }

  updateOpportunity(id, fields) {
    return this.request('PUT', `/opportunities/${id}`, fields);
  }

  async searchOpportunities({ pipelineId, limit = 100, maxPages = 20 } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const q = new URLSearchParams({ location_id: this.locationId, limit: String(limit), page: String(page) });
      if (pipelineId) q.set('pipeline_id', pipelineId);
      const data = await this.request('GET', `/opportunities/search?${q}`);
      const rows = data.opportunities || [];
      all.push(...rows);
      if (rows.length < limit) break;
    }
    return all;
  }
}

function fakeResponse(method, path) {
  if (path === '/contacts/upsert') return { contact: { id: 'dry_contact_1' }, new: true };
  if (path === '/opportunities/') return { opportunity: { id: 'dry_opp_1' } };
  if (path.startsWith('/opportunities/search')) return { opportunities: [] };
  return { ok: true };
}
