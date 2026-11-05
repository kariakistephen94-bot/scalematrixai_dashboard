export function contactLabel(contact, business) {
  if (business?.name) return business.name;
  if (contact.source_type === "google_maps")
    return business?.error
      ? "Business details unavailable"
      : "Loading business…";
  return contact.company;
}

export function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function contactPayload(form) {
  // Only user-owned fields are saved. Live Google details stay display-only.
  const fields = [
    "company",
    "contact_name",
    "email",
    "phone",
    "stage",
    "value",
    "currency",
    "follow_up",
    "notes",
    "source_type",
    "source_id",
  ];
  const body = Object.fromEntries(fields.map((key) => [key, form[key]]));
  body.company = body.company.trim();
  body.follow_up = body.follow_up || null;
  body.value = Number(body.value);
  return body;
}
