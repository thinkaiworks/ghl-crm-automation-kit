// Build the KPI dashboard.
//   node scripts/kpi-report.js                 -> uses live GHL data (needs .env)
//   node scripts/kpi-report.js --sample        -> uses sample/opportunities.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { GHLClient } from '../lib/ghl.js';
import { computeKpis, renderHtml } from '../lib/kpi.js';

const useSample = process.argv.includes('--sample');
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || 'reports/kpi-report.html';

let opps, stages = {};
if (useSample) {
  const sample = JSON.parse(readFileSync(new URL('../sample/opportunities.json', import.meta.url), 'utf8'));
  opps = sample.opportunities;
  stages = sample.stages;
} else {
  const ghl = new GHLClient({ token: process.env.GHL_TOKEN, locationId: process.env.GHL_LOCATION_ID });
  opps = await ghl.searchOpportunities({ pipelineId: process.env.GHL_PIPELINE_ID });
  stages = JSON.parse(process.env.GHL_STAGE_NAMES || '{}');
}

const kpis = computeKpis(opps, { stages, staleDays: Number(process.env.STALE_DAYS || 7), now: useSample ? new Date('2026-10-30T12:00:00Z') : new Date() });
mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
writeFileSync(out, renderHtml(kpis));
console.table(kpis.totals);
console.log(`Stale deals: ${kpis.stale.length}. Report written to ${out}`);
