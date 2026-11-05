"use client";

import { useState } from "react";
import { ArrowUpRight, Download, Globe2, Search, Target } from "lucide-react";
import { api, downloadCSV, markets, niches } from "../lib/api";
import { Badge, EmptyState } from "./ui";
import GoogleMapsLeads from "./GoogleMapsLeads";

export default function Prospects({
  data,
  canGenerate,
  busy,
  onDiscover,
  onQuickSearch,
  onAddCRM,
  onOpen,
}) {
  const [source, setSource] = useState(
    data.settings.prospect_source || "google_maps",
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [importError, setImportError] = useState("");
  const [query, setQuery] = useState("");
  const [niche, setNiche] = useState("All niches");
  const [market, setMarket] = useState("All markets");
  const [stage, setStage] = useState("all");
  const list = data.prospects.filter(
    (p) =>
      `${p.name} ${p.industry} ${p.location}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (niche === "All niches" ||
        p.industry.toLowerCase().includes(niche.toLowerCase().split(" ")[0])) &&
      (market === "All markets" ||
        p.location.toLowerCase().includes(market.toLowerCase())) &&
      (stage === "all" ? p.stage !== "archived" : p.stage === stage),
  );
  async function addAllToCRM() {
    if (importing) return;
    setImporting(true);
    setImportResult("");
    setImportError("");
    try {
      const result = await api("crm/import", {
        method: "POST",
        body: JSON.stringify({ source_type: source }),
      });
      setImportResult(
        `${result.added} added to CRM. ${result.skipped} already in your CRM and left unchanged.`,
      );
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImporting(false);
    }
  }
  return (
    <section>
      <div className="page-title-row">
        <div>
          <span className="overline">
            REAL BUSINESSES. RELEVANT CONVERSATIONS.
          </span>
          <h2>Find your next good fit.</h2>
          <p>
            Research-backed prospects, a thoughtful opening, and a pipeline you
            control.
          </p>
        </div>
        <button
          className="button"
          disabled={!canGenerate || busy}
          onClick={onQuickSearch}
        >
          <Target size={16} />
          Quick Search
        </button>
      </div>
      <div className="target-summary">
        <Globe2 size={17} />
        <span>
          <strong>Your search territory</strong>
          {data.settings.target_industry} <span>in</span>{" "}
          {data.settings.target_location}
        </span>
        <button
          className="text-button"
          onClick={onDiscover}
          disabled={!canGenerate || busy}
        >
          Adjust search
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="tabs maps-source-tabs">
        <button
          className={source === "google_maps" ? "active" : ""}
          onClick={() => {
            setSource("google_maps");
            setImportResult("");
            setImportError("");
          }}
          disabled={importing}
        >
          Google Maps <span>{data.maps_lead_count || 0}</span>
        </button>
        <button
          className={source === "web_research" ? "active" : ""}
          onClick={() => {
            setSource("web_research");
            setImportResult("");
            setImportError("");
          }}
          disabled={importing}
        >
          Web research <span>{data.prospects.length}</span>
        </button>
      </div>
      <div className="crm-bulk-action">
        <div>
          <strong>Keep every opportunity in your pipeline.</strong>
          <p>
            Add all saved, non-archived{" "}
            {source === "google_maps" ? "Google Maps" : "web research"}{" "}
            prospects, including other pages. Existing CRM contacts stay
            unchanged.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={addAllToCRM}
          disabled={
            importing ||
            !data.storage_connected ||
            !(source === "google_maps"
              ? data.maps_lead_count
              : data.prospects.some((p) => p.stage !== "archived"))
          }
        >
          {importing ? "Adding to CRM…" : "Add all to CRM"}
        </button>
      </div>
      {importResult && (
        <p className="crm-import-result" role="status">
          {importResult}
        </p>
      )}
      {importError && (
        <p className="error-box" role="alert">
          {importError} You can retry safely; existing contacts will be skipped.
        </p>
      )}
      {source === "google_maps" ? (
        <GoogleMapsLeads
          data={data}
          onDiscover={onDiscover}
          busy={busy}
          canDiscover={canGenerate}
          onAddCRM={onAddCRM}
        />
      ) : (
        <>
          <div className="prospect-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="Search businesses"
                placeholder="Search businesses or locations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            >
              <option>All niches</option>
              {niches.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <select
              aria-label="Filter market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option>All markets</option>
              {markets.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              aria-label="Pipeline stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="all">All active stages</option>
              {["new", "shortlisted", "contacted", "qualified", "archived"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
            <button
              className="button secondary"
              disabled={!list.length}
              onClick={() => downloadCSV(list)}
            >
              <Download size={15} />
              Export
            </button>
          </div>
          <div className="panel prospect-table">
            {list.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Market</th>
                      <th>Potential opportunity</th>
                      <th>Pipeline</th>
                      <th>
                        <span className="sr-only">Open prospect</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="company-cell"
                            onClick={() => onOpen(p)}
                          >
                            <span className="company-avatar">
                              {p.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>{p.industry}</small>
                            </span>
                          </button>
                        </td>
                        <td>{p.location}</td>
                        <td>
                          <span className="opportunity-text">
                            {p.opportunity}
                          </span>
                        </td>
                        <td>
                          <Badge
                            tone={
                              p.stage === "qualified"
                                ? "green"
                                : p.stage === "shortlisted"
                                  ? "purple"
                                  : "neutral"
                            }
                          >
                            {p.stage}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => onAddCRM(p, "web_research")}
                          >
                            Add to CRM
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Open ${p.name}`}
                            onClick={() => onOpen(p)}
                          >
                            <ArrowUpRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Target}
                title={
                  data.prospects.length
                    ? "No businesses match these filters."
                    : "A better conversation starts here."
                }
                description={
                  data.prospects.length
                    ? "Try a broader niche, market, or stage."
                    : "Choose a niche and market. AI will research public company sources and prepare a shortlist with a relevant opening."
                }
              >
                <button
                  className="button"
                  disabled={!canGenerate || busy}
                  onClick={onDiscover}
                >
                  <Search size={15} />
                  Find my first prospects
                </button>
              </EmptyState>
            )}
          </div>
          <p className="page-footnote">
            Opportunities are hypotheses to validate, not confirmed buying
            intent. Contact details are never guessed, and no outreach is sent.
          </p>
        </>
      )}
    </section>
  );
}
