export async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "Please check the fields and try again.",
    );
  }
  return result;
}

export const niches = [
  "Commercial cleaning",
  "Solar businesses",
  "Facility management",
];
export const markets = ["United States", "United Kingdom", "Nigeria", "China"];
export const defaults = {
  prospect_source: "google_maps",
  target_industry: niches.join("; "),
  target_location: markets.join("; "),
  content_focus:
    "AI engineering, agents, automation architecture, RAG, evaluations, tools, and practical building lessons",
  timezone: "America/Los_Angeles",
  generation_time: "08:00",
  daily_prospect_count: 5,
  schedule_enabled: true,
  target_tiers: ["higher", "middle", "lower"],
  target_areas: [],
};

export function dateLabel(value, options = {}) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...options,
  });
}

export function downloadCSV(rows) {
  const fields = [
    "name",
    "website",
    "industry",
    "location",
    "stage",
    "opportunity",
    "source_url",
    "outreach_draft",
    "notes",
  ];
  const cell = (value) => {
    const text = String(value || "");
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => cell(row[field])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "scalematrix-prospects.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
