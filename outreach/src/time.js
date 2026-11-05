// Africa/Lagos is UTC+1 all year with no DST, so a fixed offset is exact.
const OFFSET = 3_600_000;
export const DAY = 86_400_000;

const shift = (ms) => new Date(ms + OFFSET);

export const lagosDay = (ms = Date.now()) => shift(ms).toISOString().slice(0, 10);
export const lagosDayStart = (day) => Date.parse(`${day}T00:00:00Z`) - OFFSET;
export const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);

export function lagosParts(ms = Date.now()) {
  const d = shift(ms);
  return {
    dow: d.getUTCDay(),
    hour: d.getUTCHours(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
  };
}

export function greetingPeriod(ms = Date.now()) {
  const h = lagosParts(ms).hour;
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function parseWindow(text) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) throw new Error('SEND_WINDOW must look like 09:00-17:30');
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  if (!(start < end && end <= 1440)) throw new Error('SEND_WINDOW start must be before its end');
  return { start, end };
}

export function parseDays(text) {
  const days = new Set();
  for (const token of String(text).split(',').map((t) => t.trim()).filter(Boolean)) {
    const range = /^([0-6])-([0-6])$/.exec(token);
    if (range) for (let d = +range[1]; d <= +range[2]; d++) days.add(d);
    else if (/^[0-6]$/.test(token)) days.add(+token);
    else throw new Error('SEND_DAYS must be like 1-6 or 1,2,3');
  }
  if (!days.size) throw new Error('SEND_DAYS cannot be empty');
  return days;
}

/** Whether `ms` is inside the sending window, and how many seconds of it remain. */
export function windowState(ms, cfg) {
  const p = lagosParts(ms);
  const open = cfg.sendDays.has(p.dow) && p.minutes >= cfg.sendWindow.start && p.minutes < cfg.sendWindow.end;
  const secondsLeft = open ? (cfg.sendWindow.end - p.minutes) * 60 - p.seconds : 0;
  return { open, secondsLeft };
}
