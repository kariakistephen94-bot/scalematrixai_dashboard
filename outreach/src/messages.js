// Message copy for solar companies. Rules-based, no model calls. Wording follows ../solar_outreach_scripts.md
// (AI assistants that answer solar leads fast and book site surveys); no invented facts about the recipient.
import { greetingPeriod } from './time.js';

const MAX_BRAND = 40;
const LEGAL_SUFFIX = /(?:,?\s+)(?:limited|ltd\.?|plc\.?|llc\.?|inc\.?|incorporated|corporation|corp\.?)\s*$/i;
const BRANCH = /\s+(?:\||[–—]|-)\s+[^\n]*(?:branch|outlet|location)\s*$/i;

function clean(value) {
  return String(value ?? '').normalize('NFKC').replace(/\p{C}/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
}

/** "Sunrise Hotels Ltd - Wuse Branch" -> "Sunrise Hotels". name is null when it cannot be shortened safely. */
export function shortenBusinessName(value) {
  let candidate = clean(value).replace(BRANCH, '').trim();
  for (;;) {
    const next = candidate.replace(LEGAL_SUFFIX, '').trim().replace(/^,+|,+$/g, '');
    if (next === candidate) break;
    candidate = next;
  }
  candidate = candidate.replace(/\s*\([^()]*\b(?:branch|outlet|location)\)\s*$/i, '').trim();
  if (!candidate || candidate.length > MAX_BRAND) return { name: null };
  return { name: candidate };
}

const OPT_OUT = "\n\n(Reply STOP and I won't message again.)";

const FIRST = [
  (c) => `${c.greeting}\n\n${c.intro}I help solar companies in ${c.city} reply to new enquiries faster: an AI assistant answers leads within a minute, asks the right qualifying questions and books the site survey.\n\nWould it be useful if I showed how it could work for ${c.biz}?`,
  (c) => `${c.greeting}\n\n${c.intro}Quick question for ${c.biz}: when a new solar enquiry comes in after hours, who replies, and how quickly? I build AI assistants that respond to every lead instantly and book the site survey.\n\nOpen to a short demo this week?`,
  (c) => `${c.greeting}\n\n${c.intro}Speed of reply often decides who wins a solar enquiry. I set up AI assistants for solar companies that answer every lead within a minute and keep customers updated on their installation.\n\nCan I show you a quick demo for ${c.biz}?`,
];

const FOLLOW_UP_1 = [
  (c) => `${c.greeting}\n\nJust following up on my message about AI lead replies for ${c.biz}. If useful, I can send a 2-minute demo video. No pressure at all.`,
  (c) => `${c.greeting}\n\nChecking in on my earlier note. Happy to show how an AI assistant could handle new enquiries and survey bookings for ${c.biz}, whenever suits you.`,
];

const FOLLOW_UP_2 = [
  (c) => `${c.greeting}\n\nLast note from me: if replying to enquiries or customer updates ever eats into your week at ${c.biz}, message me here and I'll send the demo. Thank you!`,
];

const TEMPLATES = [FIRST, FOLLOW_UP_1, FOLLOW_UP_2];

/**
 * Build the text for a step: 0 = first message, 1.. = follow-ups.
 * The variant is picked from the lead id, so a lead always gets the same wording for the same step.
 */
export function buildMessage(lead, step, cfg, now = Date.now()) {
  const family = TEMPLATES[Math.min(step, TEMPLATES.length - 1)];
  const variant = lead.id % family.length;
  const who = cfg.senderName && cfg.companyName ? `${cfg.senderName} from ${cfg.companyName}` : cfg.senderName || cfg.companyName;
  const ctx = {
    greeting: `Hello, good ${greetingPeriod(now)}.`,
    biz: lead.short_name || shortenBusinessName(lead.name).name || 'your business',
    city: lead.city,
    intro: step === 0 && who ? `This is ${who}. ` : '',
  };
  return { text: family[variant](ctx) + OPT_OUT, template: `solar-s${step}-v${variant + 1}` };
}

// An opt-out phrase at the start of a short message ("Stop", "please stop messaging me", "don't contact me").
// Phrases in the middle of a sentence ("bus stop", "do not stop the offer") are not opt-outs.
const STOP_PATTERN = /^(?:(?:please|pls|kindly)\s+)?(?:stop|unsubscribe|opt[\s-]?out|remove me|no more|(?:do not|don'?t|dont)\s+(?:contact|message|text|disturb|send|call))\b/i;

/** True when a reply is an opt-out request. */
export function isStopMessage(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return t.split(/\s+/).length <= 8 && STOP_PATTERN.test(t);
}
