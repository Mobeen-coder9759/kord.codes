# Logic Weave: Cloudflare Worker + Static Assets (no Heroku required)

This is the **recommended Cloudflare-only replacement** for the earlier Heroku ZIP. It hosts your existing horizontal website **and** `/api/contact` on one Cloudflare Worker. The site retains horizontal desktop navigation, horizontal mobile pages, and the mobile vertical-swipe-to-navigate behavior.

The frontend's original CSS and JavaScript were moved into external files for a restrictive Content Security Policy. No intended desktop colors, layout measurements, or scrolling controls were redesigned.

## What's in the ZIP

- `public/index.html`: your website, connected to the same-origin `/api/contact` endpoint.
- `public/assets/style.css` and `public/assets/app.js`: original site styles and interactions, externalized to avoid inline JS/CSS. Service-card click handlers now attach from JavaScript; the testimonial star fills use equivalent CSS classes.
- `public/_headers`: static security headers including CSP, HSTS, and clickjacking protection.
- `src/worker.js`: Cloudflare Worker, site configuration endpoint, and secure contact handler.
- `src/lead.js`: data validation, server-owned timestamps, spreadsheet-formula-safe versions of fields.
- `src/security.js`: configuration validation, bounded JSON parsing, Turnstile verification, and authenticated n8n forwarding.
- `wrangler.jsonc`: Worker + Static Assets with native rate limiting binding.
- `.dev.vars.example`: variable names only, **not real secrets**.
- `test/api.test.js`: automated tests with mocked external calls.

## 1. Before obtaining a domain

You can run tests and deploy to a `*.workers.dev` address before buying a domain. A custom domain isn't required to create or test the Worker. You do need real Turnstile configuration and your Access-protected n8n webhook before the contact form will accept live submissions.

Requirements: Node.js 22 or later and npm. From the unzipped project directory:

```bash
npm install
npm test
cp .dev.vars.example .dev.vars
npm run dev
```

The app appears at the local URL Wrangler prints, usually `http://localhost:8787`. **Without real secrets the contact form stays disabled.** This is deliberate. The automated tests use *mock* Turnstile and *mock* n8n, never real credentials.

To deploy:

```bash
npx wrangler login
npm run deploy
```

You can instead use Cloudflare Workers Git integration if you prefer a GitHub repository. Keep `.dev.vars` and credentials out of GitHub. Existing `wrangler.jsonc` is your deployment configuration and defines the static assets and the rate limiting binding.

**The package has passed local Node.js tests, but live Wrangler deployment and end-to-end integrations have not yet been verified.** Run those before accepting real leads.

## 2. Required configuration on Cloudflare Workers

In Cloudflare Workers & Pages → Your Worker → Settings → Variables and Secrets, add:

| Name | Type | Example / meaning |
|---|---|---|
| `TURNSTILE_SITE_KEY` | Variable | Real Turnstile *site key* (public) |
| `TURNSTILE_SECRET_KEY` | Secret | Real Turnstile *secret key* |
| `TURNSTILE_EXPECTED_HOSTNAMES` | Variable | Exact hostname(s) separated by commas, e.g. `logic-weave-site.ACCOUNT.workers.dev,logicweave.com` |
| `PUBLIC_ORIGINS` | Variable | Exact origins, e.g. `https://logic-weave-site.ACCOUNT.workers.dev,https://logicweave.com` |
| `N8N_WEBHOOK_URL` | Secret | Exact n8n production URL, e.g. `https://itsmsquare.me/webhook/logic-weave-contact` |
| `N8N_ALLOWED_HOST` | Variable | Exact host of that URL, e.g. `itsmsquare.me` |
| `CF_ACCESS_CLIENT_ID` | Secret | Cloudflare Access service-token Client ID |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Cloudflare Access service-token Client Secret |
| `N8N_AUTH_HEADER_NAME` | Optional variable | Additional n8n webhook Header Auth header name |
| `N8N_AUTH_HEADER_VALUE` | Optional secret | Additional n8n Header Auth header value |
| `CONTACT_RATE_LIMITER` | Native binding | Defined under `ratelimits` in `wrangler.jsonc`; do NOT create a plain-text variable with this name |

IMPORTANT: The real site key's Turnstile widget must be configured for every allowed hostname. `TURNSTILE_EXPECTED_HOSTNAMES` lists names **without scheme**. `PUBLIC_ORIGINS` lists full origins **with** HTTPS and **without trailing slash**. When adding or moving the site domain, update both settings and the Turnstile widget's allowed hostnames.

The form is fail-closed: it won't enable until all mandatory real credentials and the limiter binding are present. Known Turnstile test keys, redirecting/non-HTTPS n8n URLs, and mismatched n8n hosts are rejected. `GET /api/config` returns only whether the form is ready and its public site key. Secrets never appear there.

The frontend sets Turnstile action `logicweave_contact`. Siteverify checks **success + expected hostname + action**. Tokens are short-lived and single-use.

## 3. Your existing n8n at itsmsquare.me

Use the URL that n8n calls the **production webhook** (`/webhook/...`), not the test webhook (`/webhook-test/...`). Your n8n instance may be at the apex `itsmsquare.me` or at a chosen subdomain. Set `N8N_ALLOWED_HOST` to match.

Cloudflare Tunnel does not automatically provide access control. Create a Cloudflare Access **self-hosted application** for the webhook route, with a **Service Auth** policy allowing only your Worker service token. Use separate user authentication for the n8n dashboard/editor and make sure the service token cannot access administration routes. Lock down any direct bypass to your n8n server.

The Worker sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers only to the fixed allowed n8n URL. If you also enable n8n webhook Header Auth, fill in the two optional auth vars.

## 4. n8n workflow expectations

After the Google Sheets append succeeds, respond to the webhook with HTTP 200 and the JSON body:

```json
{"success":true,"message":"Lead stored"}
```

On invalid input, storage failure or other failure, **do not return `success:true`**. The Worker only tells the browser “Request received” after it sees this explicit confirmation. Otherwise it returns a generic error without exposing secrets or PII.

**Important Google Sheets formula-injection protection:** The n8n workflow must map fields from `sheetsSafe`, not directly from raw text:

- Name → `{{$json.sheetsSafe.name}}`
- Email → `{{$json.sheetsSafe.email}}`
- Interested Services → `{{$json.sheetsSafe.topics}}`
- Message → `{{$json.sheetsSafe.message}}`

Also use a **RAW** cell input mode where supported, so values are never interpreted as spreadsheet formulas. This is extra important because a customer can paste anything into the message box.

For notification emails, use a fixed From and To address, not customer-supplied values. Plain text is simplest. If you use HTML, escape the fields. Customer email can be Reply-To *only if the email node sets it as a properly validated structured address.*

There is a random `leadId` for traceability; the project does **not** implement durable deduplication. If the webhook times out after n8n has saved a lead, a retry could result in a duplicate. Implement idempotency/deduplication in n8n if required.

## 5. Protections and honest limitations

- **Spam/bots:** Turnstile server verification and Cloudflare rate limiting binding, currently 5 attempts per IP per 60 seconds. Native limits are approximate, per data center, and IP sharing can affect mobile users. Add a Cloudflare WAF rule for `/api/contact` as a secondary layer and watch for false positives.
- **Bad requests:** same-origin POST, Origin check, strict JSON type, streaming body limit (12 KB), field-length and service-category allowlists.
- **CORS/CSRF:** no permissive CORS response; Origin check and Turnstile. CORS by itself is never authentication.
- **XSS:** external JS/CSS, safe text rendering, restrictive CSP; avoid later reintroducing inline event handlers or user-controlled `innerHTML`.
- **n8n abuse/SSRF:** server-side HTTPS target on a fixed, explicitly allowlisted hostname; no redirects; Cloudflare Access service authentication; optional n8n header-auth.
- **PII:** no database or log storage in this Worker. PII protection at n8n/Sheets/email remains your responsibility: restrict access, encrypt and back up n8n, set short execution-data retention, use a privacy notice and appropriate deletion policies.
- **SQL injection:** no SQL database or SQL queries exist in this version. If you add SQL later, use parameterized queries and least-privilege credentials.
- **Prompt injection/jailbreak:** no LLM/AI agents are involved in this lead-capture pipeline, so there is no AI to jailbreak here. If you later add AI to n8n, treat messages as untrusted data and enforce tool permissions and human approval for risky actions.
- **Reliability:** No claim of 100% security or absence of bugs. Cloudflare production configuration, real Turnstile, Access, and n8n integrations all need live checks.

## 6. Troubleshooting

- `GET /api/config` says form disabled: check all environment variables and `CONTACT_RATE_LIMITER` binding. Do not bypass security checks to enable the form.
- `403`: browser Origin isn't exactly one of the configured `PUBLIC_ORIGINS`.
- `400` after Turnstile: action or hostname doesn't match, token expired, or token already used. Widget reset is included in the frontend.
- `429`: rate limit hit. Wait and retry.
- `502`: n8n webhook inaccessible, Access service auth incorrect, workflow returned non-JSON, or Sheets failed. Check n8n/Access error logs without logging personal data.
- `503`: configuration or required verification service missing/unavailable.

## Documentation

- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers rate limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Cloudflare Turnstile Siteverify: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Cloudflare Access service tokens: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- Cloudflare Workers `_headers`: https://developers.cloudflare.com/workers/static-assets/headers/
