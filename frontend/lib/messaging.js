export function liveMessage(result, now = new Date()) {
  if (!result.message_body) return result.outreach_draft || "";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: result.recipient_timezone || "Africa/Lagos",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Hello sir, good ${period}.\n\n${result.message_body}`;
}
