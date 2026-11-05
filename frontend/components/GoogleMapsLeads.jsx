"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { api, markets, niches } from "../lib/api";
import { Badge, EmptyState, Modal } from "./ui";

function publicLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function mapsUrl(lead) {
  return (
    publicLink(lead.details?.googleMapsUri) ||
    `https://www.google.com/maps/search/?api=1&query=Business&query_place_id=${encodeURIComponent(lead.place_id)}`
  );
}

export default function GoogleMapsLeads({
  data,
  onDiscover,
  busy,
  canDiscover,
  onAddCRM,
}) {
  const [result, setResult] = useState({ leads: [], has_more: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState([]);
  const [websiteFilter, setWebsiteFilter] = useState("all");
  const [niche, setNiche] = useState("all");
  const [country, setCountry] = useState("all");
  const [stage, setStage] = useState("all");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(null);
  const pageSize = 5;
  const requestNumber = useRef(0);
  const recentRun = data.runs.find(
    (run) => run.status !== "running",
  )?.finished_at;
  const load = useCallback(async () => {
    if (!data.storage_connected || data.maps_storage_error) return;
    const requestId = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(pageSize),
      });
      if (niche !== "all") params.set("niche", niche);
      if (country !== "all") params.set("country", country);
      if (stage !== "all") params.set("stage", stage);
      params.set("website", websiteFilter);
      const next = await api(`maps/leads?${params}`);
      if (requestId === requestNumber.current) setResult(next);
    } catch (e) {
      if (requestId === requestNumber.current) {
        setError(e.message);
        setResult({ leads: [], has_more: false });
      }
    } finally {
      if (requestId === requestNumber.current) setLoading(false);
    }
  }, [
    offset,
    niche,
    country,
    stage,
    websiteFilter,
    data.storage_connected,
    data.maps_storage_error,
  ]);
  useEffect(() => {
    load();
  }, [load, recentRun]);
  const visible = result.leads.filter((lead) =>
    `${lead.details?.displayName?.text || ""} ${lead.details?.formattedAddress || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function filter(setter, value) {
    setter(value);
    setOffset(0);
    setHistory([]);
  }
  return (
    <div className="maps-workspace">
      <div className="maps-source-banner">
        <MapPin size={21} />
        <div>
          <strong>Discover locally. Build your pipeline.</strong>
          <p>
            Every new lead must have a phone number. View businesses with a
            website, or find phone-only leads that could use one.
          </p>
        </div>
        <Badge tone={data.maps_configured ? "green" : "neutral"}>
          {data.maps_configured
            ? "API key configured"
            : "Google API key needed"}
        </Badge>
      </div>
      <div className="prospect-toolbar">
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Search loaded Maps businesses"
            placeholder="Search businesses on this page"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Google Maps niche"
          value={niche}
          onChange={(e) => filter(setNiche, e.target.value)}
        >
          <option value="all">All niches</option>
          {niches.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <select
          aria-label="Google Maps market"
          value={country}
          onChange={(e) => filter(setCountry, e.target.value)}
        >
          <option value="all">All markets</option>
          {markets.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Google Maps pipeline stage"
          value={stage}
          onChange={(e) => filter(setStage, e.target.value)}
        >
          <option value="all">All active stages</option>
          {["new", "shortlisted", "contacted", "qualified", "archived"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <select
          aria-label="Google Maps website availability"
          value={websiteFilter}
          onChange={(e) => filter(setWebsiteFilter, e.target.value)}
        >
          <option value="all">All phone leads</option>
          <option value="with_website">Phone + website</option>
          <option value="no_website">No website</option>
        </select>
        <button
          className="button secondary"
          onClick={load}
          disabled={
            loading || !data.storage_connected || !!data.maps_storage_error
          }
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>
      {(error || data.maps_storage_error) && (
        <p className="error-box" role="alert">
          {error || data.maps_storage_error}
        </p>
      )}
      {result.details_errors > 0 && (
        <p className="error-box" role="status">
          {result.lookup_warning ||
            "Some business details could not be loaded. Refresh to retry."}{" "}
          These listings have not been classified as “No website.”
        </p>
      )}
      <div className="panel maps-results">
        <div className="maps-attribution-row">
          <span translate="no" className="maps-attribution">
            Google Maps
          </span>
          <span>
            Live business listings · your pipeline is saved in Supabase
          </span>
        </div>
        {loading ? (
          <div className="maps-loading" role="status">
            <Loader2 size={22} className="spin" />
            Loading live business details…
          </div>
        ) : visible.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Contact</th>
                  <th>Target niche</th>
                  <th>Pipeline</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lead) => {
                  const details = lead.details;
                  const phone =
                    details?.internationalPhoneNumber ||
                    details?.nationalPhoneNumber;
                  const website = publicLink(details?.websiteUri);
                  return (
                    <tr key={lead.id}>
                      <td>
                        <button
                          className="company-cell"
                          onClick={() => setActive(lead)}
                        >
                          <span className="company-avatar">
                            <MapPin size={17} />
                          </span>
                          <span>
                            <strong>
                              {details?.displayName?.text ||
                                "Saved Maps listing"}
                            </strong>
                            <small>
                              {details?.formattedAddress ||
                                `${lead.search_city}, ${lead.country}`}
                            </small>
                            {lead.details_error && (
                              <small className="error-text">
                                {lead.details_error}
                              </small>
                            )}
                          </span>
                        </button>
                        {details?.businessStatus &&
                          details.businessStatus !== "OPERATIONAL" && (
                            <small className="error-text">
                              {details.businessStatus.replaceAll("_", " ")}
                            </small>
                          )}
                        {details?.attributions?.map((a, i) => (
                          <div key={i} className="maps-third-party">
                            {publicLink(a.providerUri) ? (
                              <a
                                href={a.providerUri}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {a.provider || "Data provider"}
                              </a>
                            ) : (
                              a.provider
                            )}
                          </div>
                        ))}
                      </td>
                      <td>
                        <div className="maps-contact-links">
                          {phone && (
                            <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
                              <Phone size={12} />
                              {phone}
                            </a>
                          )}
                          {website && (
                            <a href={website} target="_blank" rel="noreferrer">
                              Website
                              <ArrowUpRight size={12} />
                            </a>
                          )}
                          {phone && !website && (
                            <Badge tone="purple">No website</Badge>
                          )}
                          {!phone && !website && (
                            <span>Contact details unavailable</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {lead.niche}
                        <small className="maps-country">{lead.country}</small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            lead.stage === "qualified" ? "green" : "neutral"
                          }
                        >
                          {lead.stage}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => onAddCRM(lead, "google_maps")}
                        >
                          Add to CRM
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Review ${details?.displayName?.text || lead.place_id}`}
                          onClick={() => setActive(lead)}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={MapPin}
            title={
              result.lookup_warning
                ? "Business details are temporarily unavailable."
                : query
                  ? "No matching businesses on this page."
                  : websiteFilter !== "all" || result.scanned
                    ? "No matching phone leads in this batch."
                    : "Your next local prospects start here."
            }
            description={
              result.lookup_warning
                ? "Restore Google Maps access or quota, then retry loading business details. Your saved leads are preserved."
                : data.maps_configured
                  ? result.has_more
                    ? "Use Next to check more saved businesses, or change the website filter."
                    : "Try another filter or run Quick Search to find businesses with a listed phone number."
                  : "Add GOOGLE_MAPS_API_KEY to backend/.env, enable Places API (New), and run the Google Maps database migration."
            }
          >
            <button
              className="button"
              disabled={busy || !canDiscover}
              onClick={result.lookup_warning ? load : onDiscover}
            >
              <Search size={15} />
              {result.lookup_warning
                ? "Retry business details"
                : "Discover businesses"}
            </button>
          </EmptyState>
        )}
        {(offset > 0 || result.has_more) && (
          <div className="maps-pagination">
            <button
              className="button secondary"
              disabled={loading || offset === 0}
              onClick={() => {
                setOffset(history[history.length - 1] ?? 0);
                setHistory((previous) => previous.slice(0, -1));
              }}
            >
              <ArrowLeft size={14} />
              Previous
            </button>
            <span>Page {history.length + 1}</span>
            <button
              className="button secondary"
              disabled={loading || !result.has_more}
              onClick={() => {
                setHistory((previous) => [...previous, offset]);
                setOffset(result.next_offset);
              }}
            >
              Next
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
      <p className="page-footnote">
        Names, addresses, phone numbers, and websites come directly from Google
        Maps. Saved listing IDs, your targeting, notes, and pipeline stages
        remain in Supabase. No messages are sent automatically.
      </p>
      {active && (
        <MapsLeadEditor
          lead={active}
          onClose={() => setActive(null)}
          onSaved={(updated) =>
            setResult((previous) => ({
              ...previous,
              leads: previous.leads.map((lead) =>
                lead.id === updated.id ? { ...lead, ...updated } : lead,
              ),
            }))
          }
        />
      )}
    </div>
  );
}

function MapsLeadEditor({ lead, onClose, onSaved }) {
  const [stage, setStage] = useState(lead.stage);
  const [notes, setNotes] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await api(`maps/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage, notes }),
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Your Maps prospect" onClose={onClose}>
      <div className="maps-editor-info">
        <span className="maps-attribution" translate="no">
          Google Maps
        </span>
        <h3>{lead.details?.displayName?.text || "Saved Maps listing"}</h3>
        <p>
          {lead.details?.formattedAddress ||
            `${lead.search_city}, ${lead.country}`}
        </p>
        <a href={mapsUrl(lead)} target="_blank" rel="noreferrer">
          View listing on Google Maps
          <ExternalLink size={13} />
        </a>
      </div>
      <label className="field">
        Pipeline stage
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {["new", "shortlisted", "contacted", "qualified", "archived"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      <label className="field">
        Your private notes
        <textarea
          rows={5}
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Your observations, next steps, and outreach context"
        />
      </label>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button" disabled={saving} onClick={save}>
          <Save size={15} />
          {saving ? "Saving…" : "Save lead"}
        </button>
      </div>
    </Modal>
  );
}
