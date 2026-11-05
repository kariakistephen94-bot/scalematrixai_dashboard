import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactLabel,
  contactPayload,
  safeWebUrl,
} from "../lib/crm-display.js";

test("real names replace generated labels without disguising failed lookups", () => {
  const contact = {
    company: "Facility management · Birmingham · abc123",
    source_type: "google_maps",
  };
  assert.equal(
    contactLabel(contact, { name: "Actual business" }),
    "Actual business",
  );
  assert.equal(
    contactLabel(contact, { error: "Quota exhausted" }),
    "Business details unavailable",
  );
  assert.equal(contactLabel(contact, undefined), "Loading business…");
});

test("saving a follow-up preserves original CRM fields and excludes live Google details", () => {
  const payload = contactPayload({
    company: "Original user label",
    contact_name: "Alex",
    email: "",
    phone: "",
    stage: "contacted",
    value: "1250",
    currency: "GBP",
    follow_up: "",
    notes: "Follow up tomorrow",
    source_type: "google_maps",
    source_id: "abc",
    id: "crm-id",
    business: {
      name: "Real Google name",
      phone: "123",
      website: "https://example.com",
    },
    updated_at: "today",
  });
  assert.equal(payload.company, "Original user label");
  assert.equal(payload.notes, "Follow up tomorrow");
  assert.equal(payload.stage, "contacted");
  assert.equal(payload.value, 1250);
  assert.equal(payload.follow_up, null);
  assert.equal(payload.phone, "");
  assert.equal(payload.business, undefined);
  assert.equal(payload.id, undefined);
});

test("business website links only allow HTTP and HTTPS", () => {
  assert.equal(safeWebUrl("javascript:alert(1)"), null);
  assert.equal(safeWebUrl(undefined), null);
  assert.equal(safeWebUrl("https://example.com"), "https://example.com/");
});
