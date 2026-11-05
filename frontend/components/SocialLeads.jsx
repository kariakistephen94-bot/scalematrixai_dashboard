"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Twitter,
  Instagram,
  Linkedin,
  Music2,
  Globe2,
  Search,
  ExternalLink,
  Download,
  Loader2,
  X,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { api, niches, markets } from "../lib/api";
import { liveMessage } from "../lib/messaging";
import { safeWebUrl } from "../lib/crm-display";
import { Modal } from "./ui";

const platforms = [
  { id: "twitter", name: "X / Twitter", icon: Twitter },
  { id: "instagram", name: "Instagram", icon: Instagram },
  { id: "tiktok", name: "TikTok", icon: Music2 },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin },
];
const statusLabel = {
  queued: "Preparing research",
  running: "Research in progress",
  stopping: "Finishing current batches",
  stopped: "Stopped",
  completed: "Target reached",
  needs_more_research: "More research needed",
  failed: "Needs attention",
  needs_credits: "Add OpenAI credits",
  interrupted: "Interrupted",
};

export default function SocialLeads({ notify }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [platform, setPlatform] = useState("");
  const [niche, setNiche] = useState("Solar businesses");
  const [country, setCountry] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geography, setGeography] = useState("countrywide");
  const [target, setTarget] = useState(100);
  const [mode, setMode] = useState("per_platform");
  const [chosenNiches, setChosenNiches] = useState(["Solar businesses"]);
  const [chosenPlatforms, setChosenPlatforms] = useState(
    platforms.map((p) => p.id),
  );
  const [chosenCountries, setChosenCountries] = useState(markets);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: "25",
      });
      if (platform) params.set("platform", platform);
      if (niche) params.set("niche", niche);
      if (country) params.set("country", country);
      if (query) params.set("q", query);
      const [state, data] = await Promise.all([
        api("social"),
        api(`social/leads?${params}`),
      ]);
      setSummary(state);
      setRows(data.leads);
      setTotal(data.total);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [platform, niche, country, query, offset]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);
  const active = summary?.runs.find(
    (r) =>
      ["running", "queued", "stopping"].includes(r.status) &&
      Date.now() - new Date(r.updated_at).getTime() < 900000,
  );
  const latest = active || summary?.runs[0];
  const goal = latest?.target_per_niche || 100;
  function progressFor(name) {
    if ((latest?.target_mode || "per_platform") === "across_platforms")
      return Math.min(100, (100 * (summary?.counts[name] || 0)) / goal);
    const selected = latest?.platforms || platforms.map((p) => p.id);
    return (
      (100 *
        selected.reduce(
          (sum, id) =>
            sum +
            Math.min(goal, summary?.niche_platform_counts?.[name]?.[id] || 0),
          0,
        )) /
      (goal * selected.length)
    );
  }
  async function start() {
    setBusy(true);
    try {
      const result = await api("social/search", {
        method: "POST",
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          niches: chosenNiches,
          platforms: chosenPlatforms,
          countries: chosenCountries,
          target_per_niche: Number(target),
          target_mode: mode,
          geography,
        }),
      });
      notify(
        result.already_running
          ? "A research job is already running. Your saved leads are available below."
          : "Social research started. Results save as they are verified.",
      );
      setSettingsOpen(false);
      await load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!active) return;
    setBusy(true);
    try {
      await api(`social/runs/${active.id}/stop`, {
        method: "POST",
        body: "{}",
      });
      notify(
        "Stopping after the current research batches. Saved leads stay available.",
      );
      await load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(lead) {
    try {
      await navigator.clipboard.writeText(liveMessage(lead));
      notify("Custom message copied.");
    } catch {
      notify("Select the message text to copy it.");
    }
  }
  async function exportRows() {
    setBusy(true);
    try {
      const all = [];
      for (let page = 0; ; page += 100) {
        const params = new URLSearchParams({
          limit: "100",
          offset: String(page),
        });
        if (platform) params.set("platform", platform);
        if (niche) params.set("niche", niche);
        if (country) params.set("country", country);
        if (query) params.set("q", query);
        const result = await api(`social/leads?${params}`);
        all.push(...result.leads);
        if (all.length >= result.total || !result.leads.length) break;
      }
      const quote = (value) =>
        `"${String(value ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""')}"`;
      const fields = [
        "Business",
        "Niche",
        "Country",
        "Location",
        "Website",
        ...platforms.map((p) => p.name),
        "Evidence",
        "Contact name",
        "Founders / owners",
        "Custom message",
      ];
      const csv = [
        fields,
        ...all.map((row) => [
          row.company,
          row.niche,
          row.country,
          row.location,
          row.website,
          ...platforms.map((p) => row.profiles[p.id] || ""),
          row.evidence.map((e) => `${e.summary} (${e.source_url})`).join(" | "),
          row.founder_research?.founders?.[0]?.name || row.company,
          (row.founder_research?.founders || []).map((p) => `${p.name} (${p.role}) ${p.profile_url || ""} Source: ${p.source_url}`).join(" | "),
          liveMessage(row),
        ]),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "scalematrix-social-leads.csv";
      link.click();
      URL.revokeObjectURL(url);
      notify(`Exported ${all.length} businesses.`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  function toggle(value, selected, setter) {
    setter(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }
  return (
    <section className="social-leads">
      <div className="social-hero">
        <div>
          <span className="heading-kicker">
            YOUR NEXT CONVERSATION STARTS HERE
          </span>
          <h2>Real businesses. A direct way to reach them.</h2>
          <p>
            Public company profiles matched to your niches, with source evidence
            and an individual opening message. Saved directly to your workspace.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || !!active}
          onClick={() => setSettingsOpen(true)}
        >
          <Search size={16} />
          {active ? "Research running…" : "Find social leads"}
        </button>
      </div>
      <div className="social-stats">
        {niches.map((name) => (
          <div key={name}>
            <span>{name}</span>
            <strong>
              {summary?.counts[name] ?? 0}
              <small>businesses</small>
            </strong>
            <div className="social-progress">
              <span
                style={{
                  width: `${progressFor(name)}%`,
                }}
              />
            </div>
            <small>
              Goal: {latest?.target_per_niche || 100} per niche
              {latest?.target_mode === "per_platform"
                ? " on each platform"
                : " across platforms"}
            </small>
          </div>
        ))}
      </div>
      <div className="social-matrix-wrap">
        <table className="social-target-matrix">
          <caption>{goal} businesses per niche on each platform</caption>
          <thead>
            <tr>
              <th>Contact</th>
              {platforms.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {niches.map((name) => (
              <tr key={name}>
                <th>{name}</th>
                {platforms.map((p) => {
                  const count =
                    summary?.niche_platform_counts?.[name]?.[p.id] || 0;
                  return (
                    <td
                      className={count >= goal ? "target-met" : ""}
                      key={p.id}
                    >
                      <strong>{count}</strong>
                      <span> / {goal}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {latest && (
        <div className="social-run-status" role="status">
          <div>
            {active && <Loader2 size={17} className="spin" />}
            <strong>{statusLabel[latest.status] || latest.status}</strong>
            <span>
              {latest.processed_batches} batches checked · {latest.saved}{" "}
              profile matches saved · {latest.failures} batches need attention
            </span>
          </div>
          {latest.current && <p>{latest.current}</p>}
          {active && (
            <button
              className="text-button"
              disabled={busy || active.status === "stopping"}
              onClick={stop}
            >
              <X size={14} /> Stop research
            </button>
          )}
          {latest.last_error && <p>{latest.last_error}</p>}
        </div>
      )}
      <div
        className="social-platform-tabs"
        role="tablist"
        aria-label="Social platform"
      >
        <button
          role="tab"
          aria-selected={!platform}
          className={!platform ? "active" : ""}
          onClick={() => {
            setPlatform("");
            setOffset(0);
          }}
        >
          <Globe2 size={16} />
          All platforms <span>{summary?.total || 0}</span>
        </button>
        {platforms.map(({ id, name, icon: Icon }) => (
          <button
            role="tab"
            aria-selected={platform === id}
            className={platform === id ? "active" : ""}
            key={id}
            onClick={() => {
              setPlatform(id);
              setOffset(0);
            }}
          >
            <Icon size={16} />
            {name}
            <span>{summary?.platform_counts[id] || 0}</span>
          </button>
        ))}
      </div>
      <div className="social-filters">
        <label className="social-search">
          <Search size={16} />
          <input
            aria-label="Search social leads"
            placeholder="Search businesses or locations…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <select
          aria-label="Filter social leads by niche"
          value={niche}
          onChange={(e) => {
            setNiche(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All niches</option>
          {niches.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <select
          aria-label="Filter social leads by country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All countries</option>
          {markets.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button
          className="button secondary"
          disabled={busy || !total}
          onClick={exportRows}
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <div className="social-table-wrap">
        <table className="social-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Company profiles</th>
              <th>Research</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.company}</strong>
                  {safeWebUrl(row.website) && (
                    <a
                      href={safeWebUrl(row.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Company website <ExternalLink size={11} />
                    </a>
                  )}
                </td>
                <td>{row.founder_research?.founders?.length ? row.founder_research.founders.map((person) => (
                  <div key={person.name}><a href={safeWebUrl(person.profile_url || person.source_url)} target="_blank" rel="noopener noreferrer">{person.name} <ExternalLink size={11} /></a><small>{person.role}</small></div>
                )) : <div><strong>{row.company}</strong><small>Company / profile name</small></div>}</td>
                <td>
                  {row.location}
                  <small>{row.country}</small>
                </td>
                <td>
                  <div className="social-profile-links">
                    {platforms
                      .filter((p) => row.profiles[p.id])
                      .map(({ id, name, icon: Icon }) => (
                        <a
                          key={id}
                          href={row.profiles[id]}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${row.company} on ${name}`}
                          title={name}
                        >
                          <Icon size={16} />
                          <span>{name}</span>
                          <ExternalLink size={11} />
                        </a>
                      ))}
                  </div>
                </td>
                <td>
                  <span className="social-verification">Source backed</span>
                  <small>{new Date(row.updated_at).toLocaleDateString()}</small>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setSelected(row)}
                  >
                    Review lead →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="social-empty">
            <Globe2 size={30} />
            <h3>
              {summary
                ? "Your profile shortlist is taking shape."
                : "Opening your social workspace…"}
            </h3>
            <p>
              {active
                ? "Research is running. Source-backed leads will appear here as they are saved."
                : "Start a search or adjust your filters to see matching businesses."}
            </p>
          </div>
        )}
      </div>
      <div className="social-pagination">
        <span>
          {total
            ? `${offset + 1}–${Math.min(offset + 25, total)} of ${total}`
            : "0 businesses"}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous social leads page"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Next social leads page"
            disabled={offset + 25 >= total}
            onClick={() => setOffset(offset + 25)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <p className="page-footnote">
        Counts represent distinct businesses, not followers or duplicate
        accounts. Search sourced means the public profile appeared in search
        evidence; current activity and account ownership still need your review.
        Unverified handles are excluded.
      </p>
      {selected && (
        <Modal title={selected.company} onClose={() => setSelected(null)}>
          <div className="social-lead-detail">
            <span className="social-verification">
              {selected.niche} · {selected.country}
            </span>
            <p>{selected.location}</p>
            <h3>Contact</h3>
            {selected.founder_research?.founders?.length ? selected.founder_research.founders.map((person) => (
              <article key={person.name}><strong>{person.name} · {person.role}</strong><p>{person.evidence}</p><a href={safeWebUrl(person.source_url)} target="_blank" rel="noopener noreferrer">View affiliation source</a>{safeWebUrl(person.profile_url) && <p><a href={safeWebUrl(person.profile_url)} target="_blank" rel="noopener noreferrer">Open founder profile</a></p>}</article>
            )) : <article><strong>{selected.company}</strong><p>Company / profile name. Use this when a founder or owner has not been confirmed.</p></article>}
            {selected.solar_offering && <article><h3>Solar offering check</h3><p>{selected.solar_offering.excerpt}</p><a href={safeWebUrl(selected.solar_offering.source_url)} target="_blank" rel="noopener noreferrer">View the company’s solar offering</a></article>}
            <h3>Profile evidence</h3>
            {selected.evidence.map((e, i) => (
              <article key={i}>
                <a
                  href={e.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {platforms.find((p) => p.id === e.platform)?.name} profile{" "}
                  <ExternalLink size={13} />
                </a>
                <p>{e.summary}</p>
                <a
                  className="text-button"
                  href={e.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open research source
                </a>
              </article>
            ))}
            <h3>Your custom opening message</h3>
            <p className="agent-draft">{liveMessage(selected)}</p>
            <button className="button" onClick={() => copy(selected)}>
              Copy message
            </button>
            <small>
              The greeting updates to the business’s local time when copied.
              Nothing is sent automatically.
            </small>
          </div>
        </Modal>
      )}
      {settingsOpen && (
        <Modal
          title="Find your next business leads"
          onClose={() => setSettingsOpen(false)}
        >
          <div className="social-research-form">
            <p>
              Research public business accounts, verify source matches and save
              them to Supabase. Existing businesses are deduplicated. Your AI
              Agent geographic focus also applies.
            </p>
            {[
              ["Business niches", niches, chosenNiches, setChosenNiches],
              [
                "Platforms",
                platforms.map((p) => p.id),
                chosenPlatforms,
                setChosenPlatforms,
              ],
              ["Countries", markets, chosenCountries, setChosenCountries],
            ].map(([label, options, chosen, setter]) => (
              <fieldset key={label}>
                <legend>{label}</legend>
                <div className="agent-focus-options">
                  {options.map((value) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(value)}
                        onChange={() => toggle(value, chosen, setter)}
                      />
                      {platforms.find((p) => p.id === value)?.name || value}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label className="field">
              Geographic scope
              <select
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
              >
                <option value="presets">Selected market presets</option>
                <option value="countrywide">
                  Whole countries (Nigeria still limited to the three cities)
                </option>
              </select>
            </label>
            <label className="field">
              Target per niche
              <input
                type="number"
                min="1"
                max="1000"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <label className="field">
              How to count the target
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="across_platforms">
                  Across all selected platforms
                </option>
                <option value="per_platform">On each selected platform</option>
              </select>
            </label>
            <p className="page-footnote">
              Research uses your OpenAI quota and can take time. You can keep
              working, stop a run and resume with saved results. The target is
              reached only with supported matches.
            </p>
            <button
              className="button"
              disabled={
                busy ||
                !chosenNiches.length ||
                !chosenPlatforms.length ||
                !chosenCountries.length ||
                Number(target) < 1 ||
                Number(target) > 1000
              }
              onClick={start}
            >
              Start research
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
