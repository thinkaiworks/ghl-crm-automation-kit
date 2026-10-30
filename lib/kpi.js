// Pipeline KPIs from GoHighLevel opportunities: what's in each stage, win rate,
// speed to close, revenue by source, and which deals have gone stale.

const DAY = 86_400_000;

export function computeKpis(opps, { stages = {}, staleDays = 7, now = new Date() } = {}) {
  const byStage = {};
  const bySource = {};
  let won = 0, lost = 0, wonValue = 0, openValue = 0;
  const closeDays = [];
  const stale = [];

  for (const o of opps) {
    const stageName = stages[o.pipelineStageId] || o.pipelineStageId || 'Unknown';
    const value = Number(o.monetaryValue || 0);
    const src = o.source || 'unknown';
    bySource[src] ??= { leads: 0, won: 0, revenue: 0 };
    bySource[src].leads++;

    if (o.status === 'won') {
      won++; wonValue += value;
      bySource[src].won++; bySource[src].revenue += value;
      if (o.createdAt && o.lastStatusChangeAt) closeDays.push((new Date(o.lastStatusChangeAt) - new Date(o.createdAt)) / DAY);
    } else if (o.status === 'lost' || o.status === 'abandoned') {
      lost++;
    } else {
      openValue += value;
      byStage[stageName] ??= { count: 0, value: 0 };
      byStage[stageName].count++;
      byStage[stageName].value += value;
      const lastTouch = new Date(o.lastStageChangeAt || o.updatedAt || o.createdAt);
      const idle = Math.floor((now - lastTouch) / DAY);
      if (idle >= staleDays) stale.push({ id: o.id, name: o.name, stage: stageName, daysIdle: idle, value });
    }
  }

  const decided = won + lost;
  return {
    totals: {
      opportunities: opps.length,
      open: opps.length - decided,
      won, lost,
      winRate: decided ? +(won / decided * 100).toFixed(1) : 0,
      wonValue, openValue,
      avgDaysToClose: closeDays.length ? +(closeDays.reduce((a, b) => a + b, 0) / closeDays.length).toFixed(1) : null,
    },
    byStage,
    bySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { ...v, conversion: v.leads ? +(v.won / v.leads * 100).toFixed(1) : 0 }])),
    stale: stale.sort((a, b) => b.daysIdle - a.daysIdle),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export function renderHtml(k, title = 'Pipeline KPI Report') {
  const max = Math.max(1, ...Object.values(k.byStage).map((s) => s.count));
  const stageRows = Object.entries(k.byStage).map(([name, s]) => `
    <tr><td>${esc(name)}</td><td><div class="bar"><span style="width:${(s.count / max) * 100}%"></span></div></td><td>${s.count}</td><td>${money(s.value)}</td></tr>`).join('');
  const srcRows = Object.entries(k.bySource).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, s]) => `
    <tr><td>${esc(name)}</td><td>${s.leads}</td><td>${s.won}</td><td>${s.conversion}%</td><td>${money(s.revenue)}</td></tr>`).join('');
  const staleRows = k.stale.slice(0, 20).map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.stage)}</td><td>${s.daysIdle}</td><td>${money(s.value)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing stale 🎉</td></tr>';
  const t = k.totals;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--text:#141a2e;--muted:#66708a;--accent:#2f7bff;--warn:#d9480f}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#141b30;--text:#e8ecf6;--muted:#93a0bd}}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}main{max-width:960px;margin:0 auto;padding:24px 16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.tile{background:var(--card);border-radius:10px;padding:14px}.tile b{display:block;font-size:24px}.tile span{color:var(--muted);font-size:13px}
section{background:var(--card);border-radius:10px;padding:16px;margin-top:16px;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
td,th{padding:8px;text-align:left;border-bottom:1px solid rgba(128,128,128,.15)}th{color:var(--muted);font-weight:500}
.bar{background:rgba(128,128,128,.15);border-radius:4px;height:10px;min-width:80px}.bar span{display:block;height:100%;background:var(--accent);border-radius:4px}
.warn{color:var(--warn)}
</style></head><body><main>
<h1>${esc(title)}</h1>
<div class="tiles">
<div class="tile"><b>${t.open}</b><span>Open deals</span></div>
<div class="tile"><b>${money(t.openValue)}</b><span>Open pipeline value</span></div>
<div class="tile"><b>${t.winRate}%</b><span>Win rate</span></div>
<div class="tile"><b>${money(t.wonValue)}</b><span>Won revenue</span></div>
<div class="tile"><b>${t.avgDaysToClose ?? '–'}</b><span>Avg days to close</span></div>
<div class="tile"><b class="${k.stale.length ? 'warn' : ''}">${k.stale.length}</b><span>Stale deals</span></div>
</div>
<section><h2>Open deals by stage</h2><table><tr><th>Stage</th><th></th><th>Deals</th><th>Value</th></tr>${stageRows}</table></section>
<section><h2>Lead sources</h2><table><tr><th>Source</th><th>Leads</th><th>Won</th><th>Conversion</th><th>Revenue</th></tr>${srcRows}</table></section>
<section><h2>Stale deals: follow up today</h2><table><tr><th>Deal</th><th>Stage</th><th>Days idle</th><th>Value</th></tr>${staleRows}</table></section>
</main></body></html>`;
}
