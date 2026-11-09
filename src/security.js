const MAX_BODY_BYTES = 12 * 1024;
const MAX_REPLY_BYTES = 4 * 1024;

// Updated to match the Kord rebranding expected action
const EXPECTED_ACTION = 'kord_contact';

export function respond(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      ...extraHeaders
    }
  });
}

function hosts(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

function validHost(host) {
  return host.length <= 253 && /^[a-z0-9.-]+$/.test(host) && !host.includes('..') &&
    !host.startsWith('.') && !host.endsWith('.') && !host.startsWith('-');
}

export function getSettings(env = {}) {
  const siteKey = env.TURNSTILE_SITE_KEY;
  const secret = env.TURNSTILE_SECRET_KEY;
  const hostnames = hosts(env.TURNSTILE_EXPECTED_HOSTNAMES);
  const allowedOrigins = String(env.PUBLIC_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  const targetHost = String(env.N8N_ALLOWED_HOST || '').toLowerCase();
  
  let webhookURL;
  try { webhookURL = new URL(env.N8N_WEBHOOK_URL); } catch { /* not configured */ }
  
  const webhookAllowed = !!webhookURL && webhookURL.protocol === 'https:' &&
    webhookURL.hostname === targetHost && validHost(targetHost) &&
    !webhookURL.username && !webhookURL.password && !webhookURL.hash &&
    !webhookURL.search && !webhookURL.port &&
    webhookURL.pathname.startsWith('/webhook/') && webhookURL.pathname.length > '/webhook/'.length;
    
  const originValid = allowedOrigins.length > 0 && allowedOrigins.every(origin => {
    try {
      const u = new URL(origin);
      return (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')) &&
        u.origin === origin && !u.username && !u.password;
    } catch { return false; }
  });
  
  const testKey = s => typeof s === 'string' && /^[123]x0{5}/.test(s);
  const authName = env.N8N_AUTH_HEADER_NAME || '';
  const authValue = env.N8N_AUTH_HEADER_VALUE || '';
  const validAuthHeader = !authName && !authValue ||
    (/^[A-Za-z][A-Za-z0-9-]*$/.test(authName) && !!authValue &&
      !['host', 'authorization', 'content-type', 'content-length', 'cf-access-client-id', 'cf-access-client-secret'].includes(authName.toLowerCase()));
      
  // Fail closed without the platform-level rate limiting binding.
  const enabled = Boolean(siteKey && secret && !testKey(siteKey) && !testKey(secret) &&
    hostnames.length && hostnames.every(validHost) && originValid && webhookAllowed &&
    env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET && validAuthHeader &&
    env.CONTACT_RATE_LIMITER && typeof env.CONTACT_RATE_LIMITER.limit === 'function');
    
  return { 
    enabled, 
    siteKey: siteKey || '', 
    secret, 
    hostnames, 
    allowedOrigins,
    webhookURL: webhookAllowed ? webhookURL.toString() : null,
    accessId: env.CF_ACCESS_CLIENT_ID, 
    accessSecret: env.CF_ACCESS_CLIENT_SECRET,
    authName, 
    authValue, 
    rateLimiter: env.CONTACT_RATE_LIMITER 
  };
}

export async function readBoundedJSON(stream, maxBytes) {
  if (!stream) throw new Error('empty body');
  const reader = stream.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel('Too large').catch(() => {});
        const err = new Error('Too large'); err.status = 413; throw err;
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result));
}

export async function verifyTurnstile(fetchImpl, settings, token, ip) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return false;
  const payload = new URLSearchParams({ secret: settings.secret, response: token });
  if (ip) payload.set('remoteip', ip);
  
  const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', 
    body: payload, 
    // Cloudflare edge strictly requires 'manual' or 'follow' instead of 'error'
    redirect: 'manual', 
    signal: AbortSignal.timeout(8000)
  });
  
  if (!response.ok) return false;
  const data = await readBoundedJSON(response.body, MAX_REPLY_BYTES);
  return data?.success === true && settings.hostnames.includes(String(data.hostname || '').toLowerCase()) &&
    data.action === EXPECTED_ACTION;
}

export async function forwardLead(fetchImpl, settings, lead) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'CF-Access-Client-Id': settings.accessId,
    'CF-Access-Client-Secret': settings.accessSecret
  };
  
  if (settings.authName) headers[settings.authName] = settings.authValue;
  
  const response = await fetchImpl(settings.webhookURL, {
    method: 'POST', 
    headers, 
    body: JSON.stringify(lead),
    // Cloudflare edge strictly requires 'manual' or 'follow' instead of 'error'
    redirect: 'manual', 
    signal: AbortSignal.timeout(12000)
  });
  
  if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return false;
  }
  const result = await readBoundedJSON(response.body, MAX_REPLY_BYTES);
  return result?.success === true;
}

export function requestTooLarge(request) {
  const length = request.headers.get('content-length');
  return length !== null && (Number.isNaN(Number(length)) || Number(length) > MAX_BODY_BYTES);
}

export const BODY_LIMIT = MAX_BODY_BYTES;