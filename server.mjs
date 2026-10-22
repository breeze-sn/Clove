import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const model = process.env.OPENAI_MODEL || 'gpt-5.6';
const apiKey = process.env.OPENAI_API_KEY;
const baseAvailable = 18420;
const categories = {
  'Home & bills': { spent: 20500, budget: 24000 },
  Everyday: { spent: 13240, budget: 17000 },
  'Food & groceries': { spent: 6840, budget: 9000 },
  Savings: { spent: 8000, budget: 10000 },
  Investments: { spent: 5000, budget: 5000 },
  Personal: { spent: 2480, budget: 6000 },
};

const tools = [
  { type: 'function', name: 'get_financial_snapshot', description: 'Read the user’s current synthetic demo financial snapshot. Use this before giving personalized financial guidance.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
  { type: 'function', name: 'get_category_spending', description: 'Read current spending and the monthly budget for one category.', parameters: { type: 'object', properties: { category: { type: 'string', enum: Object.keys(categories) } }, required: ['category'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'check_purchase_affordability', description: 'Calculate whether a one-time purchase fits the current available-to-spend amount after known commitments. This is a scenario calculation only.', parameters: { type: 'object', properties: { amount: { type: 'integer', minimum: 1, maximum: 500000 } }, required: ['amount'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'draft_plan_adjustment', description: 'Draft (never apply) a proposal that reserves part of available spending for a planned purchase. The amount must fit within current available spending. The application will require explicit user approval before applying it.', parameters: { type: 'object', properties: { title: { type: 'string' }, amount: { type: 'integer', minimum: 1, maximum: 500000 }, direction: { type: 'string', enum: ['reduce_available_spend'] }, reason: { type: 'string' } }, required: ['title', 'amount', 'direction', 'reason'], additionalProperties: false }, strict: true },
];

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}
function availableFrom(body) {
  const approved = Math.max(0, Math.min(baseAvailable, safeInteger(body?.context?.approvedSpend)));
  return baseAvailable - approved;
}
function runTool(name, args, available) {
  if (name === 'get_financial_snapshot') return { currency: 'INR', monthlyIncome: 65000, spentSoFar: 38740 + (baseAvailable - available), availableToSpend: available, knownBillsCovered: true, nextPayday: '30 Oct 2026', daysUntilPayday: 8, dataStatus: 'synthetic demo data' };
  if (name === 'get_category_spending') {
    const entry = categories[args.category];
    if (!entry) throw new Error('Unknown category');
    return { category: args.category, ...entry, remaining: entry.budget - entry.spent };
  }
  if (name === 'check_purchase_affordability') {
    const amount = safeInteger(args.amount, -1);
    if (amount < 1 || amount > 500000) throw new Error('Purchase amount is outside the supported range');
    return { purchaseAmount: amount, availableBefore: available, availableAfter: available - amount, fitsAvailableSpending: amount <= available, knownCommitmentsRemainCovered: amount <= available, note: 'Scenario only; no financial data was changed.' };
  }
  if (name === 'draft_plan_adjustment') {
    const amount = safeInteger(args.amount, -1);
    if (amount < 1 || amount > available || args.direction !== 'reduce_available_spend') throw new Error('The proposed amount must fit within available spending');
    return { proposal: { id: crypto.randomUUID(), title: String(args.title).slice(0, 100), reason: String(args.reason).slice(0, 500), currentAvailable: available, proposedAvailable: available - amount, amount, direction: args.direction, status: 'pending' }, applied: false };
  }
  throw new Error('Tool is not available');
}

function localAgent(message, available) {
  const text = message.toLowerCase();
  const toolsUsed = [];
  let reply;
  let proposal = null;
  const amountMatch = message.replaceAll(',', '').match(/(?:₹\s*|rs\.?\s*|inr\s*)(\d+)|\b(\d{3,})\b/i);
  const amount = amountMatch ? Number(amountMatch[1] || amountMatch[2]) : null;
  if (text.includes('budget') || text.includes('over') || text.includes('category')) {
    const category = Object.keys(categories).find(item => text.includes(item.toLowerCase())) || 'Everyday';
    const data = runTool('get_category_spending', { category }, available);
    toolsUsed.push('get_category_spending');
    reply = `${category} is at ₹${data.spent.toLocaleString('en-IN')} of ₹${data.budget.toLocaleString('en-IN')}, with ₹${data.remaining.toLocaleString('en-IN')} left in that category. This is based on synthetic demo data.`;
  } else if (amount && (text.includes('buy') || text.includes('purchase') || text.includes('afford') || text.includes('spend'))) {
    const calculation = runTool('check_purchase_affordability', { amount }, available);
    toolsUsed.push('check_purchase_affordability');
    reply = calculation.fitsAvailableSpending
      ? `Based on the demo plan, ₹${amount.toLocaleString('en-IN')} fits within the ₹${available.toLocaleString('en-IN')} available after known commitments. That would leave ₹${calculation.availableAfter.toLocaleString('en-IN')}. This is a scenario, not a guarantee.`
      : `A ₹${amount.toLocaleString('en-IN')} purchase is larger than the ₹${available.toLocaleString('en-IN')} currently available after known commitments. I’d avoid treating it as affordable from this plan alone. We can explore a lower amount or a later date.`;
    if (calculation.fitsAvailableSpending && (text.includes('plan') || text.includes('adjust') || text.includes('proposal'))) {
      const drafted = runTool('draft_plan_adjustment', { title: `Account for ₹${amount.toLocaleString('en-IN')} purchase`, amount, direction: 'reduce_available_spend', reason: 'Reserve this amount from available spending while keeping known commitments unchanged.' }, available);
      proposal = drafted.proposal;
      toolsUsed.push('draft_plan_adjustment');
      reply += ' I’ve drafted an optional plan change for you to review.';
    }
  } else if (text.includes('week') || text.includes('available') || text.includes('snapshot') || text.includes('payday')) {
    const snapshot = runTool('get_financial_snapshot', {}, available);
    toolsUsed.push('get_financial_snapshot');
    reply = `You have ₹${snapshot.availableToSpend.toLocaleString('en-IN')} available through payday in 8 days, after the known commitments in this demo plan. That averages about ₹${Math.round(snapshot.availableToSpend / 8).toLocaleString('en-IN')} a day. Treat it as a guide, not a rule.`;
  } else {
    const snapshot = runTool('get_financial_snapshot', {}, available);
    toolsUsed.push('get_financial_snapshot');
    reply = `I checked your demo snapshot: ₹${snapshot.availableToSpend.toLocaleString('en-IN')} is available until payday, with known bills accounted for. You can ask me about a purchase, your weekly spending, or a category budget.`;
  }
  return { reply, proposal, toolsUsed, mode: 'local' };
}

function instructions(available) {
  return `You are Clove, a calm, friendly personal-finance companion for India. Use INR and only the supplied synthetic demo data. Explain calculations in plain language, avoid shame and certainty, and do not present investment/tax/legal advice. Use the finance tools to ground answers; do not guess values. You may only read data, calculate scenarios, or draft an optional proposal. Never claim that a draft was applied. A proposal must remain pending until the user presses Approve in the app. Never ask for passwords, OTPs, or bank credentials. Current available-to-spend amount is ₹${available}.`;
}

async function openAIReply(body, available) {
  const input = Array.isArray(body.history) ? body.history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.text || '').slice(0, 4000) })) : [];
  input.push({ role: 'user', content: String(body.message || '').slice(0, 4000) });
  let response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions: instructions(available), input, tools, parallel_tool_calls: false, store: false }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  let payload = await response.json();
  const toolsUsed = [];
  let proposal = null;
  for (let turn = 0; turn < 4; turn++) {
    const calls = (payload.output || []).filter(item => item.type === 'function_call');
    if (!calls.length) break;
    input.push(...payload.output);
    for (const call of calls) {
      const args = JSON.parse(call.arguments || '{}');
      let result;
      try {
        result = runTool(call.name, args, available);
        if (call.name === 'draft_plan_adjustment') proposal = result.proposal;
      } catch (error) {
        result = { error: error.message };
      }
      toolsUsed.push(call.name);
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions: instructions(available), input, tools, parallel_tool_calls: false, store: false }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
    payload = await response.json();
  }
  const reply = payload.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!reply) throw new Error('The agent did not return a text response');
  return { reply, proposal, toolsUsed, mode: 'openai' };
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 48_000) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  const requested = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!requested.startsWith(root + path.sep) && requested !== path.join(root, 'index.html')) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(requested, (statError, stat) => {
    const file = statError ? requested : stat.isDirectory() ? path.join(requested, 'index.html') : requested;
    fs.readFile(file, (error, content) => {
      if (error) { res.writeHead(404).end('Not found'); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(content);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { mode: apiKey ? 'openai' : 'local', model: apiKey ? model : null });
  if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
    try {
      const body = await readBody(req);
      if (!String(body.message || '').trim()) return json(res, 400, { error: 'Message is required' });
      const available = availableFrom(body);
      const result = apiKey ? await openAIReply(body, available) : localAgent(String(body.message), available);
      return json(res, 200, result);
    } catch (error) {
      console.error('Agent request failed:', error.message);
      return json(res, 502, { error: 'Clove could not complete that request. Please try again.' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/approve') {
    try {
      const body = await readBody(req);
      const proposal = body.proposal;
      const amount = safeInteger(proposal?.amount, -1);
      const available = availableFrom(body);
      if (!proposal || proposal.status !== 'pending' || amount < 1 || amount > available || proposal.direction !== 'reduce_available_spend') return json(res, 400, { error: 'This proposal cannot be approved against the current plan.' });
      return json(res, 200, { approved: true, approvedSpend: Math.min(baseAvailable, safeInteger(body.context?.approvedSpend) + amount), message: 'The plan proposal was applied to this browser demo.' });
    } catch {
      return json(res, 400, { error: 'The proposal could not be approved.' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res, url.pathname);
});

server.listen(port, '127.0.0.1', () => console.log(`Clove is running at http://localhost:${port} (${apiKey ? `OpenAI Responses · ${model}` : 'local demo agent'})`));
