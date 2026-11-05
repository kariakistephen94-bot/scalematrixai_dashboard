"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import MarketAreas from "./MarketAreas";
import { liveMessage } from "../lib/messaging";
import { safeWebUrl } from "../lib/crm-display";

export default function Agent({ notify }) {
  const preferencesPending = useRef(Promise.resolve());
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setData(await api("agent"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  async function run(contactId, allMessages = false) {
    setBusy(true);
    try {
      await preferencesPending.current;
      const result = await api(
        allMessages
          ? "agent/messages"
          : contactId
            ? `crm/${contactId}/research-owner`
            : "agent/run",
        {
          method: "POST",
          body: JSON.stringify({ request_id: crypto.randomUUID() }),
        },
      );
      notify(result.message);
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function preferences(changes) {
    setSavingPreferences(true);
    const pending = api("agent/settings", {
      method: "PUT",
      body: JSON.stringify({ ...data.preferences, ...changes }),
    });
    preferencesPending.current = pending;
    try {
      await pending;
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setSavingPreferences(false);
      preferencesPending.current = Promise.resolve();
    }
  }
  const running = data?.runs.some(
    (r) => r.status === "running" || r.status === "queued",
  );
  return (
    <section className="agent-space">
      <div className="agent-intro">
        <div>
          <span className="heading-kicker">YOUR RESEARCH ASSISTANT</span>
          <h2>Find the person behind the business.</h2>
          <p>
            Research public owner information, save supporting sources, and
            prepare outreach drafts. Every owner candidate stays marked for
            review.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || running || savingPreferences || !data}
          onClick={() => run()}
        >
          <Sparkles size={16} />
          {running ? "Agent working…" : "Run Agent"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="agent-controls">
            <label>
              <input
                type="checkbox"
                disabled={savingPreferences}
                checked={data.preferences.auto_run}
                onChange={(e) => preferences({ auto_run: e.target.checked })}
              />{" "}
              Run automatically after each lead search
            </label>
            <label>
              Manual batch size{" "}
              <select
                disabled={savingPreferences}
                value={data.preferences.batch_size}
                onChange={(e) =>
                  preferences({ batch_size: Number(e.target.value) })
                }
              >
                {[1, 3, 5, 10, 15].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button className="text-button" onClick={refresh}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="agent-focus">
            <div>
              <span className="heading-kicker">OUTREACH FOCUS</span>
              <h3>Your offer. Your target area.</h3>
              <p>
                Choose who to contact and the services to offer. These filters
                apply to agent runs and custom messages. New prospect searches
                still use your discovery settings.
              </p>
            </div>
            {[
              [
                "Services to offer",
                "focus_services",
                [
                  "Lead generation",
                  "Outreach",
                  "Buyer qualification",
                  "Calendar booking",
                ],
              ],
              [
                "Countries",
                "focus_countries",
                ["Nigeria", "United Kingdom", "United States", "China"],
              ],
              [
                "Business niches",
                "focus_niches",
                [
                  "Solar businesses",
                  "Commercial cleaning",
                  "Facility management",
                ],
              ],
            ].map(([label, key, options]) => (
              <fieldset key={key} disabled={savingPreferences}>
                <legend>{label}</legend>
                <div className="agent-focus-options">
                  {options.map((option) => (
                    <label key={option}>
                      <input
                        type="checkbox"
                        checked={(data.preferences[key] || []).includes(option)}
                        onChange={(e) => {
                          const selected = data.preferences[key] || [];
                          const next = e.target.checked
                            ? [...selected, option]
                            : selected.filter((v) => v !== option);
                          if (key === "focus_services" && !next.length)
                            return notify("Select at least one service.");
                          preferences({ [key]: next });
                        }}
                      />
                      {option}
                    </label>
                  ))}
                </div>
                {key !== "focus_services" && (
                  <small>Leave all unchecked to include all.</small>
                )}
              </fieldset>
            ))}
            <MarketAreas
              countries={data.preferences.focus_countries}
              tiers={data.preferences.focus_tiers}
              areas={data.preferences.focus_areas}
              disabled={savingPreferences}
              onChange={({ tiers, areas }) =>
                preferences({ focus_tiers: tiers, focus_areas: areas })
              }
            />
            <label>
              Cities or states{" "}
              <input
                className="agent-location-input"
                placeholder="e.g. Lagos, Abuja, Ibadan"
                defaultValue={data.preferences.focus_locations || ""}
                key={data.preferences.focus_locations}
                onBlur={(e) => {
                  if (e.target.value !== data.preferences.focus_locations)
                    preferences({ focus_locations: e.target.value });
                }}
              />
            </label>
            <small>
              Separate locations with commas. Leave blank for all locations.
            </small>
            <label>
              US greeting timezone{" "}
              <select
                value={data.preferences.us_timezone || "America/New_York"}
                onChange={(e) => preferences({ us_timezone: e.target.value })}
              >
                {[
                  ["America/New_York", "Eastern"],
                  ["America/Chicago", "Central"],
                  ["America/Denver", "Mountain"],
                  ["America/Los_Angeles", "Pacific"],
                ].map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Nigeria uses Lagos time, the UK uses London time, and China uses
              Shanghai time. US states use their local timezone when known.
              Greetings update when you view or copy a message.
            </p>
            <button
              className="button"
              disabled={busy || running || savingPreferences}
              onClick={() => run(null, true)}
            >
              Generate custom messages for all matching leads
            </button>
            <small>
              Includes matching saved prospects and CRM leads. Adds matching
              prospects to CRM. Messages are saved for review.
            </small>
          </div>
          <p className="agent-note">
            Automatic runs add newly discovered leads to CRM and research up to
            15 per search. Manual runs research the next unresearched CRM leads.
            Existing contact details stay intact. Nothing is sent or published.
          </p>
          {data.runs
            .filter((r) => r.status === "queued" || r.status === "running")
            .map((r) => (
              <div className="running-banner" role="status" key={r.run_id}>
                {r.status === "queued"
                  ? "Queued"
                  : r.mode === "messages"
                    ? "Preparing messages"
                    : "Researching owners"}
                : {r.processed} / {r.total} leads processed · {r.failed} failed
              </div>
            ))}
          <div className="agent-results">
            {!data.results.length && (
              <div className="agent-empty">
                <Sparkles size={28} />
                <h3>Your research will appear here.</h3>
                <p>
                  Add prospects to CRM, then select Run Agent. Future lead
                  searches also trigger research automatically.
                </p>
              </div>
            )}
            {[...data.results]
              .sort((a, b) =>
                (b.updated_at || "").localeCompare(a.updated_at || ""),
              )
              .map((result) => (
                <article className="agent-result" key={result.contact_id}>
                  <div className="agent-result-heading">
                    <div>
                      <h3>{result.company || "CRM lead"}</h3>
                      <span className={`agent-status ${result.status}`}>
                        {result.status === "needs_review"
                          ? "Owner candidate · review needed"
                          : result.status === "not_found"
                            ? "Owner not found"
                            : result.status === "unresearched"
                              ? "Custom message ready"
                              : "Research needs attention"}
                      </span>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy || running || savingPreferences}
                      onClick={() => run(result.contact_id)}
                    >
                      Research again
                    </button>
                  </div>
                  {result.owner_name && (
                    <p>
                      <strong>{result.owner_name}</strong>
                      {result.role ? ` · ${result.role}` : ""}
                    </p>
                  )}
                  <p>{result.evidence}</p>
                  <div className="agent-sources">
                    {(result.sources || [])
                      .filter((s) => safeWebUrl(s.url))
                      .map((s) => (
                        <a
                          href={safeWebUrl(s.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          key={s.url}
                        >
                          <ExternalLink size={13} />
                          {s.title || new URL(s.url).hostname}
                        </a>
                      ))}
                  </div>
                  {result.outreach_draft && (
                    <details>
                      <summary>Review outreach draft</summary>
                      <p className="agent-draft">{liveMessage(result)}</p>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              liveMessage(result),
                            );
                            notify("Draft copied.");
                          } catch {
                            notify("Select the draft text to copy it.");
                          }
                        }}
                      >
                        Copy draft
                      </button>
                    </details>
                  )}
                  <small>
                    Researched {new Date(result.updated_at).toLocaleString()}
                  </small>
                </article>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
