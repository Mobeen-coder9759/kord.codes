// No user-submitted content is ever executed. All values are plain data.
export const ALLOWED_TOPICS = Object.freeze([
  'Lead follow-up', 'Scheduling', 'Customer support',
  'Data entry', 'Reporting', 'Custom'
]);
const TOPICS = new Set(ALLOWED_TOPICS);

export function safeForSpreadsheet(value) {
  const string = String(value ?? '');
  // Defense in depth for spreadsheet formulas; ALSO set the n8n Sheets node to RAW.
  return /^[\s\u200b-\u200f\ufeff]*[=+\-@]/u.test(string) ? `'${string}` : string;
}

export function validateLead(body, now = () => new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Invalid form data.' };
  }
  if (typeof body.name !== 'string' || typeof body.email !== 'string' ||
      typeof body.message !== 'string' || !Array.isArray(body.topics)) {
    return { ok: false, message: 'Please check your form details.' };
  }
  if (/[\p{Cc}\p{Cf}]/u.test(body.name)) {
    return { ok: false, message: 'Please enter a valid name (up to 100 characters).' };
  }
  const name = body.name.trim().replace(/\s+/gu, ' ');
  const email = body.email.trim();
  const message = body.message.trim();
  const topics = body.topics;

  if (!name || name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    return { ok: false, message: 'Please enter a valid name (up to 100 characters).' };
  }
  // A conservative format check, not a claim of mailbox verification.
  if (email.length > 254 || email.length < 3 ||
      !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(email)) {
    return { ok: false, message: 'Please enter a valid business email address.' };
  }
  if (message.length > 3000 || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) {
    return { ok: false, message: 'The message must contain no more than 3,000 characters.' };
  }
  if (topics.length > ALLOWED_TOPICS.length ||
      !topics.every(t => typeof t === 'string' && TOPICS.has(t))) {
    return { ok: false, message: 'Please choose valid services.' };
  }

  const cleanedTopics = [...new Set(topics)];
  const timestamp = now().toISOString();
  const lead = {
    leadId: crypto.randomUUID(),
    name, email, message, topics: cleanedTopics,
    source: 'logic-weave-website', // ignore untrusted client source
    submittedAt: timestamp, receivedAt: timestamp, // server-owned timestamps
    sheetsSafe: {
      name: safeForSpreadsheet(name),
      email: safeForSpreadsheet(email),
      message: safeForSpreadsheet(message),
      topics: safeForSpreadsheet(cleanedTopics.join(', '))
    }
  };
  return { ok: true, lead };
}
