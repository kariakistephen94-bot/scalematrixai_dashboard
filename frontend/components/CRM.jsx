"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Users,
  CalendarDays,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import { contactLabel, contactPayload, safeWebUrl } from "../lib/crm-display";
import { api } from "../lib/api";
import LeadMessage from "./LeadMessage";
import { Modal, Badge, EmptyState } from "./ui";

const stages = ["new", "contacted", "meeting", "proposal", "won", "lost"];
const blank = {
  company: "",
  contact_name: "",
  email: "",
  phone: "",
  stage: "new",
  value: 0,
  currency: "USD",
  follow_up: "",
  notes: "",
  source_type: "manual",
  source_id: null,
};
const money = (value, currency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const today = () => new Date().toLocaleDateString("en-CA");

export default function CRM({
  data,
  notify,
  onSearch,
  searching,
  seed,
  onSeedUsed,
}) {
  const [contacts, setContacts] = useState([]);
  const [businesses, setBusinesses] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [stageFilter, setStageFilter] = useState("all");
  const [active, setActive] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api("crm");
      setContacts(result.contacts);
      setError("");
      const linked = result.contacts.filter(
        (contact) => contact.source_type !== "manual",
      );
      const resolved = {};
      for (let index = 0; index < linked.length; index += 20) {
        const batch = linked.slice(index, index + 20);
        try {
          const response = await api("crm/businesses", {
            method: "POST",
            body: JSON.stringify({
              contact_ids: batch.map((contact) => contact.id),
            }),
          });
          Object.assign(resolved, response.businesses);
        } catch (error) {
          for (const contact of batch)
            resolved[contact.id] = { error: error.message };
        }
      }
      setBusinesses(resolved);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (seed && !loading) {
      const existing = contacts.find(
        (c) =>
          c.source_type === seed.source_type && c.source_id === seed.source_id,
      );
      setActive(existing || { ...blank, ...seed });
      onSeedUsed();
    }
  }, [seed, onSeedUsed, loading, contacts]);
  const open = contacts.filter((c) => !["won", "lost"].includes(c.stage));
  const due = (c) =>
    c.follow_up && c.follow_up <= today() && !["won", "lost"].includes(c.stage);
  const visible = contacts.filter(
    (c) =>
      `${contactLabel(c, businesses[c.id])} ${c.company} ${c.contact_name} ${c.email} ${c.phone} ${businesses[c.id]?.phone || ""} ${c.notes}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!dueOnly || due(c)) &&
      (stageFilter === "all" || c.stage === stageFilter),
  );
  return (
    <section>
      <div className="page-title-row">
        <div>
          <span className="overline">RELATIONSHIPS, WITH A NEXT STEP</span>
          <h2>Your client pipeline.</h2>
          <p>Track every conversation, deal, and follow-up in one place.</p>
        </div>
        <button
          className="button"
          disabled={!data.storage_connected}
          onClick={() => setActive({ ...blank })}
        >
          <Plus size={16} />
          Add contact
        </button>
      </div>
      <div className="crm-metrics">
        <div className="panel">
          <span>Active opportunities</span>
          <strong>{open.length}</strong>
          <small>From first hello to proposal</small>
        </div>
        <button
          className={`panel ${dueOnly ? "selected" : ""}`}
          onClick={() => setDueOnly(!dueOnly)}
          aria-pressed={dueOnly}
        >
          <span>Follow-ups due</span>
          <strong>{contacts.filter(due).length}</strong>
          <small>Today and overdue · click to filter</small>
        </button>
        <div className="panel">
          <span>Pipeline value</span>
          <strong className="crm-values">
            {["USD", "GBP", "NGN"]
              .filter((currency) =>
                open.some((c) => c.currency === currency && c.value),
              )
              .map((currency) => (
                <span key={currency}>
                  {money(
                    open
                      .filter((c) => c.currency === currency)
                      .reduce((sum, c) => sum + c.value, 0),
                    currency,
                  )}
                </span>
              ))}
            {!open.some((c) => c.value) && "$0"}
          </strong>
          <small>Open deals, grouped by currency</small>
        </div>
      </div>
      <div className="prospect-toolbar">
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Search CRM"
            placeholder="Search companies, people, or notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter CRM stage"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="all">All stages</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage.charAt(0).toUpperCase() + stage.slice(1)}
            </option>
          ))}
        </select>
        <button
          className="button secondary"
          onClick={() => setDueOnly(!dueOnly)}
          aria-pressed={dueOnly}
        >
          <CalendarDays size={15} />
          {dueOnly ? "Show all contacts" : "Follow-ups due"}
        </button>
        <button className="button secondary" onClick={load} disabled={loading}>
          <RefreshCw size={15} />
          Refresh
        </button>
        <button
          className="button secondary"
          onClick={onSearch}
          disabled={searching || !data.storage_connected}
        >
          <Search size={15} />
          Find new leads
        </button>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading your CRM…</p>
      ) : !contacts.length && !error ? (
        <div className="panel">
          <EmptyState
            icon={Users}
            title="Your next client starts with a conversation."
            description="Add a contact, or find businesses in Prospects and use Add to CRM. Set a follow-up so every opportunity has a next step."
          >
            <button className="button" onClick={() => setActive({ ...blank })}>
              <Plus size={15} />
              Add your first contact
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="panel crm-table-panel">
          <div className="crm-table-summary">
            <strong>All relationships</strong>
            <span>
              {visible.length} {visible.length === 1 ? "contact" : "contacts"}
            </span>
          </div>
          <div className="table-scroll">
            <table className="crm-table" aria-label="CRM contacts">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Website</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Notes</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <button
                        className="crm-company-link"
                        onClick={() => setActive(contact)}
                      >
                        {contactLabel(contact, businesses[contact.id])}
                      </button>
                      <small className="crm-source-label">
                        {contact.source_type === "google_maps" ? (
                          <span className="maps-attribution" translate="no">
                            Google Maps
                          </span>
                        ) : contact.source_type === "web_research" ? (
                          "Web research"
                        ) : (
                          "Manual contact"
                        )}
                      </small>
                    </td>
                    <td>
                      <div className="crm-contact-cell">
                        {contact.contact_name && (
                          <strong>{contact.contact_name}</strong>
                        )}
                        {contact.email && (
                          <a href={`mailto:${contact.email}`}>
                            {contact.email}
                          </a>
                        )}
                        {(contact.phone || businesses[contact.id]?.phone) && (
                          <a
                            href={`tel:${(contact.phone || businesses[contact.id].phone).replace(/[^+\d]/g, "")}`}
                          >
                            {contact.phone || businesses[contact.id].phone}
                          </a>
                        )}
                        {!contact.email &&
                          !contact.phone &&
                          !businesses[contact.id]?.phone && (
                            <small>
                              {businesses[contact.id]?.error
                                ? "Details temporarily unavailable"
                                : "No phone or email listed"}
                            </small>
                          )}
                      </div>
                    </td>
                    <td>
                      {safeWebUrl(businesses[contact.id]?.website) ? (
                        <a
                          className="crm-website-link"
                          href={safeWebUrl(businesses[contact.id].website)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Website ↗
                        </a>
                      ) : businesses[contact.id]?.status === "phone_only" ? (
                        <Badge tone="purple">No website</Badge>
                      ) : (
                        <span className="crm-muted">
                          {businesses[contact.id]?.error
                            ? "Unavailable"
                            : "Not listed"}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={
                          contact.stage === "won"
                            ? "green"
                            : contact.stage === "lost"
                              ? "neutral"
                              : "purple"
                        }
                      >
                        {contact.stage}
                      </Badge>
                    </td>
                    <td>
                      {contact.follow_up ? (
                        <span
                          className={`crm-follow-up ${due(contact) ? "overdue" : ""}`}
                        >
                          <CalendarDays size={13} />
                          {due(contact) ? "Due · " : ""}
                          {contact.follow_up}
                        </span>
                      ) : (
                        <span className="crm-muted">Not set</span>
                      )}
                    </td>
                    <td>
                      <p
                        className="crm-table-notes"
                        title={contact.notes || ""}
                      >
                        {contact.notes || "No notes"}
                      </p>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${contactLabel(contact, businesses[contact.id])}`}
                        onClick={() => setActive(contact)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="crm-no-matches">
                        <Search size={22} />
                        <strong>No contacts match these filters.</strong>
                        <span>
                          Try another search or show all stages and follow-ups.
                        </span>
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuery("");
                            setDueOnly(false);
                            setStageFilter("all");
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="page-footnote">
        Contact details and follow-up notes stay private in your Supabase
        workspace. Follow-ups are tracked here; outreach is sent by you.
      </p>
      {active && (
        <ContactEditor
          contact={{
            ...active,
            business: businesses[active.id] || active.business,
          }}
          onClose={() => setActive(null)}
          onSaved={async () => {
            setActive(null);
            await load();
          }}
          notify={notify}
        />
      )}
    </section>
  );
}

function BusinessDetails({ contact }) {
  const business = contact.business;
  const website = safeWebUrl(business?.website);
  const mapsLink =
    safeWebUrl(business?.maps_url) ||
    (business?.place_id
      ? `https://www.google.com/maps/search/?api=1&query=Business&query_place_id=${encodeURIComponent(business.place_id)}`
      : null);
  return (
    <section className="crm-business-details" aria-label="Business details">
      <div className="crm-business-heading">
        <span>
          {contact.source_type === "google_maps" ? (
            <span className="maps-attribution" translate="no">
              Google Maps
            </span>
          ) : (
            "Discovered business"
          )}
        </span>
        {mapsLink && (
          <a href={mapsLink} target="_blank" rel="noreferrer">
            View listing ↗
          </a>
        )}
      </div>
      <h3>{contactLabel(contact, business)}</h3>
      {business?.address && <p>{business.address}</p>}
      {business?.error ? (
        <p className="error-text" role="status">
          {business.error}
        </p>
      ) : business ? (
        <div className="crm-business-links">
          {business.phone && (
            <a href={`tel:${business.phone.replace(/[^+\d]/g, "")}`}>
              {business.phone}
            </a>
          )}
          {website ? (
            <a href={website} target="_blank" rel="noreferrer">
              {new URL(website).hostname} ↗
            </a>
          ) : business.status === "phone_only" ? (
            <Badge tone="purple">No website</Badge>
          ) : (
            <span className="crm-muted">Website not listed</span>
          )}
        </div>
      ) : (
        <p role="status">Loading the original business details…</p>
      )}
      {business?.attributions?.map((attribution, index) => (
        <p key={index} className="crm-provider-attribution">
          {safeWebUrl(attribution.providerUri) ? (
            <a
              href={safeWebUrl(attribution.providerUri)}
              target="_blank"
              rel="noreferrer"
            >
              {attribution.provider || "Data provider"}
            </a>
          ) : (
            attribution.provider
          )}
        </p>
      ))}
    </section>
  );
}

function ContactEditor({ contact, onClose, onSaved, notify }) {
  const [form, setForm] = useState(contact);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const imported = form.source_type !== "manual";
  const field = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = contactPayload(form);
      await api(form.id ? `crm/${form.id}` : "crm", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      notify("Lead saved to your CRM.");
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={contact.id ? "Lead details" : "Add to CRM"} onClose={onClose}>
      <form className="crm-lead-form" onSubmit={save}>
        <p className="modal-intro">
          {imported
            ? "Business information is loaded for you. Track your conversation and choose the next follow-up."
            : "Add a business, then set your next step."}
        </p>
        {imported ? (
          <BusinessDetails contact={contact} />
        ) : (
          <div className="crm-form-grid">
            <label className="field">
              Company
              <input
                required
                minLength={2}
                maxLength={180}
                value={form.company}
                onChange={(e) => field("company", e.target.value)}
              />
            </label>
            <label className="field">
              Phone
              <input
                type="tel"
                maxLength={80}
                value={form.phone}
                onChange={(e) => field("phone", e.target.value)}
              />
            </label>
          </div>
        )}
        {contact.id && <LeadMessage contactId={contact.id} notify={notify} />}
        <div className="crm-form-grid">
          <label className="field">
            Sales stage
            <select
              value={form.stage}
              onChange={(e) => field("stage", e.target.value)}
            >
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage.charAt(0).toUpperCase() + stage.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Next follow-up
            <input
              type="date"
              value={form.follow_up || ""}
              onChange={(e) => field("follow_up", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          Notes &amp; next action
          <textarea
            rows={3}
            maxLength={8000}
            value={form.notes}
            onChange={(e) => field("notes", e.target.value)}
            placeholder="What did you discuss? What happens next?"
          />
        </label>
        <details
          className="crm-optional-details"
          open={Boolean(contact.contact_name || contact.email)}
        >
          <summary>Contact person and email (optional)</summary>
          <p>Email is left empty until you have a verified address.</p>
          <div className="crm-form-grid">
            <label className="field">
              Contact person
              <input
                maxLength={180}
                value={form.contact_name}
                onChange={(e) => field("contact_name", e.target.value)}
              />
            </label>
            <label className="field">
              Email
              <input
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => field("email", e.target.value)}
              />
            </label>
          </div>
        </details>
        <details
          className="crm-optional-details"
          open={Number(contact.value) > 0}
        >
          <summary>Deal value (optional)</summary>
          <div className="crm-form-grid">
            <label className="field">
              Deal value
              <input
                type="number"
                min="0"
                max="1000000000"
                step="0.01"
                value={form.value}
                onChange={(e) => field("value", e.target.value)}
              />
            </label>
            <label className="field">
              Currency
              <select
                value={form.currency}
                onChange={(e) => field("currency", e.target.value)}
              >
                {["USD", "GBP", "NGN"].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? "Saving…" : "Save lead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
