export async function outreachApi(path, options = {}) {
  const response = await fetch(`/api/outreach/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const type = response.headers.get("content-type") || "";
  const result = type.includes("json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error.replace(/_/g, " ")
        : "The outreach service could not complete that request.",
    );
  }
  return result;
}

const lagosTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatLagos = (ms) => (ms ? lagosTime.format(new Date(ms)) : "—");

export function formatPhone(phone) {
  return phone
    ? `+${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`
    : "—";
}

export function formatUntil(ms, now = Date.now()) {
  const seconds = Math.round((ms - now) / 1000);
  if (seconds <= 0) return "now";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

export const stageLabels = {
  new: ["Ready", "purple"],
  contacting: ["Sending", "neutral"],
  contacted: ["Contacted", "green"],
  replied: ["Replied", "green"],
  opted_out: ["Opted out", "red"],
  no_mobile: ["Call only", "neutral"],
  banked: ["Banked", "neutral"],
  other_niche: ["Other niche", "neutral"],
  send_failed: ["Send failed", "red"],
  closed: ["Closed", "neutral"],
  archived: ["Archived", "neutral"],
};

export const messageLabels = {
  reserved: ["Sending", "neutral"],
  accepted: ["Sent", "purple"],
  sent: ["Sent", "purple"],
  delivered: ["Delivered", "green"],
  read: ["Read", "green"],
  failed: ["Failed", "red"],
  uncertain: ["Uncertain", "neutral"],
};

// Manual call pipeline (cold calls, meetings). `time: true` means a date and time must be set.
export const pipelineStatuses = [
  ["called", "Cold called", "neutral", false],
  ["no_answer", "No answer", "neutral", false],
  ["interested", "Interested", "green", false],
  ["callback", "Call back", "purple", true],
  ["meeting_booked", "Meeting booked", "green", true],
  ["proposal_sent", "Proposal sent", "purple", false],
  ["won", "Won", "green", false],
  ["not_interested", "Not interested", "red", false],
  ["lost", "Lost", "red", false],
  ["wrong_number", "Wrong number", "neutral", false],
  ["do_not_contact", "Do not contact", "red", false],
];
export const pipelineLabels = Object.fromEntries(
  pipelineStatuses.map(([key, text, tone, time]) => [key, [text, tone, time]]),
);

// Times are entered and shown in Lagos time (UTC+1, no daylight saving).
const LAGOS_OFFSET_MS = 3600000;
export function lagosInputToMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - LAGOS_OFFSET_MS;
}
export const msToLagosInput = (ms) =>
  ms ? new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 16) : "";
