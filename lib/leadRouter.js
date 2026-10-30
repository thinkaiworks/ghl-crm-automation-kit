// Speed-to-lead automation: every new lead is tagged, put in the pipeline, and gets a
// follow-up task assigned within minutes, so nothing falls through the cracks.

const SOURCE_TAGS = [
  [/facebook|fb|meta|instagram/i, 'source:facebook'],
  [/google|adwords|gclid|ppc/i, 'source:google-ads'],
  [/website|form|landing/i, 'source:website'],
  [/referral|refer/i, 'source:referral'],
  [/call|phone/i, 'source:phone'],
];

export function normaliseLead(payload) {
  // Accepts GHL workflow webhooks, form submissions, or any flat JSON.
  const c = payload.contact || payload;
  const first = c.first_name || c.firstName || (c.name || c.full_name || '').split(' ')[0] || '';
  const last = c.last_name || c.lastName || (c.name || c.full_name || '').split(' ').slice(1).join(' ') || '';
  const email = (c.email || '').trim().toLowerCase();
  const phone = (c.phone || '').replace(/[^\d+]/g, '');
  const source = c.source || payload.source || payload.utm_source || 'website';
  const service = c.service || payload.service || payload.customData?.service || '';
  const value = Number(c.value || payload.estimated_value || 0) || 0;
  return { firstName: first, lastName: last, email, phone, source, service, value };
}

export function tagsFor(lead) {
  const tags = ['new-lead'];
  const match = SOURCE_TAGS.find(([re]) => re.test(lead.source));
  tags.push(match ? match[1] : `source:${lead.source.toLowerCase().replace(/\s+/g, '-')}`);
  if (lead.service) tags.push(`service:${lead.service.toLowerCase().replace(/\s+/g, '-')}`);
  if (lead.value >= 5000) tags.push('high-value');
  return tags;
}

export function followUpDue(now = new Date(), minutes = 5) {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Push one lead through GoHighLevel. Returns everything it created. */
export async function routeLead(ghl, payload, config, now = new Date()) {
  const lead = normaliseLead(payload);
  if (!lead.email && !lead.phone) throw new Error('Lead needs an email or phone');
  const tags = tagsFor(lead);
  const { contact } = await ghl.upsertContact({
    firstName: lead.firstName, lastName: lead.lastName, email: lead.email || undefined, phone: lead.phone || undefined, source: lead.source, tags,
  });
  const name = `${lead.firstName} ${lead.lastName}`.trim() || lead.email || lead.phone;
  const { opportunity } = await ghl.createOpportunity({
    pipelineId: config.pipelineId,
    pipelineStageId: config.newLeadStageId,
    contactId: contact.id,
    name: lead.service ? `${name} – ${lead.service}` : name,
    monetaryValue: lead.value,
    source: lead.source,
  });
  const minutes = tags.includes('high-value') ? 2 : config.followUpMinutes ?? 5;
  const task = await ghl.createTask(contact.id, {
    title: `Call new lead: ${name}`,
    body: `Source: ${lead.source}${lead.service ? `\nService: ${lead.service}` : ''}\nPhone: ${lead.phone || '-'}\nEmail: ${lead.email || '-'}`,
    dueDate: followUpDue(now, minutes),
  });
  return { contactId: contact.id, opportunityId: opportunity.id, tags, task };
}
