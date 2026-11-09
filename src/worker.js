import { validateLead } from './lead.js';
import { getSettings, respond, readBoundedJSON, verifyTurnstile,
  forwardLead, requestTooLarge, BODY_LIMIT } from './security.js';

export function handleConfig(request, env) {
  if (request.method !== 'GET') {
    return respond(405, { success: false, message: 'Method not allowed.' }, { Allow: 'GET' });
  }
  const settings = getSettings(env);
  
  // Log configuration status in worker console for quick troubleshooting
  if (!settings.enabled) {
    console.warn('Config Check Failed: One or more required secrets/vars are missing or invalid.');
  }

  // Public widget site key only. Secrets never leave the server.
  return respond(200, {
    formEnabled: settings.enabled,
    turnstileSiteKey: settings.enabled ? settings.siteKey : '',
    localTestMode: false
  });
}

export async function handleContact(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') {
    return respond(405, { success: false, message: 'Method not allowed.' }, { Allow: 'POST' });
  }

  const settings = getSettings(env);
  if (!settings.enabled) {
    return respond(503, { success: false, message: 'Contact form is temporarily unavailable.' });
  }

  // Browser same-origin POST protection
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || !settings.allowedOrigins.includes(origin)) {
    return respond(403, { success: false, message: 'Request origin is not allowed.' });
  }

  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type') || '')) {
    return respond(415, { success: false, message: 'Send JSON data.' });
  }

  if (requestTooLarge(request)) {
    return respond(413, { success: false, message: 'Request is too large.' });
  }

  // CF-Connecting-IP is supplied by Cloudflare.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return respond(503, { success: false, message: 'Request verification is unavailable.' });

  try {
    const { success } = await settings.rateLimiter.limit({ key: `kord-contact:${ip}` });
    if (!success) {
      return respond(429, { success: false, message: 'Too many requests. Please try later.' }, { 'Retry-After': '60' });
    }
  } catch (err) {
    console.error('Rate limiter error:', err);
    return respond(503, { success: false, message: 'Contact form is temporarily unavailable.' });
  }

  let body;
  try { 
    body = await readBoundedJSON(request.body, BODY_LIMIT); 
  } catch (error) { 
    return respond(error.status === 413 ? 413 : 400, { success: false, message: 'Invalid request data.' }); 
  }

  const validation = validateLead(body);
  if (!validation.ok) return respond(400, { success: false, message: validation.message });

  let challengeValid;
  try { 
    challengeValid = await verifyTurnstile(fetchImpl, settings, body.turnstileToken, ip); 
  } catch (err) { 
    console.error('Turnstile verification error:', err);
    return respond(503, { success: false, message: 'Security verification is unavailable. Please try again.' }); 
  }

  if (!challengeValid) return respond(400, { success: false, message: 'Security verification failed. Please retry.' });

  try {
    const accepted = await forwardLead(fetchImpl, settings, validation.lead);
    if (!accepted) {
      console.error('n8n did not acknowledge successful lead storage');
      return respond(502, { success: false, message: 'Unable to submit right now. Please try again later.' });
    }
    return respond(200, { success: true, message: 'Your request has been received successfully.' });
  } catch (err) {
    console.error('n8n request failed:', err);
    return respond(502, { success: false, message: 'Unable to submit right now. Please try again later.' });
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/config') return handleConfig(request, env);
    if (path === '/api/contact') return handleContact(request, env);
    if (path.startsWith('/api/')) return respond(404, { success: false, message: 'Not found.' });
    return env.ASSETS.fetch(request);
  }
};
