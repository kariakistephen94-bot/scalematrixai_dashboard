// Nigerian mobile prefixes after the leading 0: 070x 080x 081x 090x 091x.
const MOBILE = /^(70|80|81|90|91)\d{8}$/;

/**
 * Normalise a phone string from Google Places.
 * Returns the number as digits with country code (2348031234567) plus a type:
 * mobile (can be messaged on WhatsApp), landline (call only), foreign, or none.
 */
export function normalizeNgPhone(raw) {
  const text = String(raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return { phone: null, type: 'none' };

  let national;
  if (digits.startsWith('234')) national = digits.slice(3);
  else if (text.startsWith('+') || text.startsWith('00')) return { phone: null, type: 'foreign' };
  else if (digits.startsWith('0') && digits.length >= 9) national = digits.slice(1);
  else national = digits;

  if (MOBILE.test(national)) return { phone: `234${national}`, type: 'mobile' };
  if (/^[1-9]\d{6,9}$/.test(national)) return { phone: `234${national}`, type: 'landline' };
  return { phone: null, type: 'none' };
}

/** "2348031234567@s.whatsapp.net" -> "2348031234567"; null for groups, LIDs and anything unresolved. */
export function jidToPhone(jid) {
  const m = /^([1-9]\d{6,14})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid ?? ''));
  return m ? m[1] : null;
}
