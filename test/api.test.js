import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleContact as workerContact, handleConfig } from '../src/worker.js';
const handleContact = (context, fetchImpl) => workerContact(context.request, context.env, fetchImpl);
import { validateLead, safeForSpreadsheet } from '../src/lead.js';
import { getSettings } from '../src/security.js';
import { readFileSync } from 'node:fs';

const baseEnv = () => ({
  TURNSTILE_SITE_KEY: 'real-site-key-not-demo',
  TURNSTILE_SECRET_KEY: 'real-secret-key-not-demo',
  TURNSTILE_EXPECTED_HOSTNAMES: 'logicweave.pages.dev',
  PUBLIC_ORIGINS: 'https://logicweave.pages.dev',
  N8N_WEBHOOK_URL: 'https://itsmsquare.me/webhook/logic-weave-contact',
  N8N_ALLOWED_HOST: 'itsmsquare.me',
  CF_ACCESS_CLIENT_ID: 'test-id',
  CF_ACCESS_CLIENT_SECRET: 'test-secret',
  CONTACT_RATE_LIMITER: { limit: async () => ({ success: true }) }
});
const lead = () => ({
  name: 'Alex Morgan', email: 'alex@example.com', message: 'I need CRM automation.',
  topics: ['Lead follow-up'], source: 'evil-source', submittedAt: '1970-01-01',
  turnstileToken: 'sample-valid-token'
});
function context({ data = lead(), env = baseEnv(), method = 'POST', origin = 'https://logicweave.pages.dev', ip = '203.0.113.9', contentType = 'application/json' } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': contentType };
  const request = new Request('https://logicweave.pages.dev/api/contact', {
    method, headers, body: method === 'POST' ? JSON.stringify(data) : undefined
  });
  return { request, env };
}
function fetchMock({ turnstileResult = { success: true, hostname: 'logicweave.pages.dev', action: 'logicweave_contact' },
  n8nResult = { success: true }, n8nStatus = 200, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('challenges.cloudflare.com')) return Response.json(turnstileResult);
    return Response.json(n8nResult, { status: n8nStatus });
  };
}

test('validation enforces topics, name and email and ignores user-owned source/time', () => {
  const result = validateLead(lead());
  assert.equal(result.ok, true);
  assert.equal(result.lead.source, 'logic-weave-website');
  assert.notEqual(result.lead.submittedAt, '1970-01-01');
  assert.match(result.lead.leadId, /^[0-9a-f-]{36}$/);
  for (const patch of [{ name: '' }, { email: 'not-an-email' }, { message: 'a'.repeat(3001) },
    { topics: ['SHELL'] }, { topics: 'Lead follow-up' }, { name: 'Bob\r\nBcc: foo' }]) {
    assert.equal(validateLead({ ...lead(), ...patch }).ok, false, JSON.stringify(patch).slice(0, 100));
  }
});

test('spreadsheet formula attempts are escaped in dedicated n8n fields', () => {
  for (const formula of ['=HYPERLINK("x")', '+1+2', '-2+2', '@SUM(A1)', '  =IMPORTXML()']) {
    assert.equal(safeForSpreadsheet(formula).startsWith("'"), true);
  }
  assert.equal(safeForSpreadsheet('normal text'), 'normal text');
  const r = validateLead({ ...lead(), message: '=1+1' });
  assert.equal(r.lead.sheetsSafe.message, "'=1+1");
});

test('config defaults to disabled and never sends credentials', async () => {
  const absent = handleConfig(new Request('https://example.com/api/config'), {});
  assert.equal((await absent.json()).formEnabled, false);
  const enabled = await handleConfig(new Request('https://example.com/api/config'), baseEnv()).json();
  assert.equal(enabled.formEnabled, true);
  assert.equal(enabled.localTestMode, false);
  assert.equal(JSON.stringify(enabled).includes('test-secret'), false);
});

test('fail closed on missing rate binding, wrong webhook host, and Turnstile test keys', () => {
  const missingLimiter = baseEnv(); delete missingLimiter.CONTACT_RATE_LIMITER;
  assert.equal(getSettings(missingLimiter).enabled, false);
  assert.equal(getSettings({ ...baseEnv(), N8N_WEBHOOK_URL: 'https://evil.example/webhook/contact' }).enabled, false);
  assert.equal(getSettings({ ...baseEnv(), N8N_WEBHOOK_URL: 'http://itsmsquare.me/webhook/contact' }).enabled, false);
  assert.equal(getSettings({ ...baseEnv(), N8N_WEBHOOK_URL: 'https://itsmsquare.me/webhook-test/contact' }).enabled, false);
  assert.equal(getSettings({ ...baseEnv(), TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }).enabled, false);
  assert.equal(getSettings({ ...baseEnv(), N8N_AUTH_HEADER_NAME: 'Host', N8N_AUTH_HEADER_VALUE: 'bad' }).enabled, false);
});

test('successful submission verifies Turnstile before forwarding, authenticates to n8n and acknowledges', async () => {
  const calls = [];
  const res = await handleContact(context(), fetchMock({ calls }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[1].url, 'https://itsmsquare.me/webhook/logic-weave-contact');
  assert.equal(calls[1].options.headers['CF-Access-Client-Id'], 'test-id');
  assert.equal(calls[1].options.headers['CF-Access-Client-Secret'], 'test-secret');
  assert.equal(calls[1].options.redirect, 'error');
  const forwarded = JSON.parse(calls[1].options.body);
  assert.equal(forwarded.source, 'logic-weave-website');
  assert.equal(forwarded.turnstileToken, undefined);
  assert.equal(forwarded.email, 'alex@example.com');
});

test('rejects wrong origin, content type, method, missing IP and excessive content', async () => {
  assert.equal((await handleContact(context({origin: 'https://evil.example'}))).status, 403);
  assert.equal((await handleContact(context({contentType: 'text/plain'}))).status, 415);
  assert.equal((await handleContact(context({method: 'GET'}))).status, 405);
  assert.equal((await handleContact(context({ip: ''}))).status, 503);
  assert.equal((await handleContact(context({data: { ...lead(), message: 'x'.repeat(13000) }}))).status, 413);
});

test('rate limiter blocks before Turnstile or n8n', async () => {
  const env = baseEnv(); env.CONTACT_RATE_LIMITER = { limit: async () => ({success:false}) };
  const calls = [];
  const res = await handleContact(context({env}), fetchMock({calls}));
  assert.equal(res.status, 429);
  assert.equal(calls.length, 0);
});

test('invalid data cannot reach Turnstile or n8n', async () => {
  const calls = [];
  const res = await handleContact(context({data: {...lead(), topics: ['unexpected']}}), fetchMock({calls}));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('rejects Turnstile failed, wrong action and wrong hostname before n8n', async () => {
  for (const turnstileResult of [
    {success:false}, {success:true, hostname:'evil.example', action:'logicweave_contact'},
    {success:true, hostname:'logicweave.pages.dev', action:'wrong_action'}]) {
    const calls = [];
    const res = await handleContact(context(), fetchMock({turnstileResult, calls}));
    assert.equal(res.status, 400);
    assert.equal(calls.length, 1);
  }
});

test('does not return false success on n8n failure, rejection, or nonconfirmation', async () => {
  for (const settings of [{n8nStatus:500}, {n8nResult:{success:false}}, {n8nResult:{ok:true}}]) {
    const res = await handleContact(context(), fetchMock(settings));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).success, false);
  }
});

test('static content has externalized JS/CSS, no inline event handlers, strong CSP', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
  assert.equal(/onclick=|<script>(.|\n)*?<\/script>/i.test(html), false);
  assert.equal(html.includes('<style>'), false);
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.ok(csp.includes('frame-ancestors'));
  assert.ok(js.includes("action: 'logicweave_contact'"));
  assert.ok(js.includes("fetch('/api/contact'"));
});
