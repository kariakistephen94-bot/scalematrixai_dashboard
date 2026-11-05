"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { safeWebUrl } from "../lib/crm-display";
import { Modal } from "./ui";

function SiteLink({ url, children }) {
  const href = safeWebUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} />
    </a>
  ) : (
    <span>{children}</span>
  );
}
function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function Emails({ notify }) {
  const [data, setData] = useState({
    contacts: [],
    total: 0,
    matched: 0,
    companies: 0,
    states: [],
    goal: 100,
  });
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState("");
  const sequence = useRef(0);
  const params = useCallback(
    (limit = 25) =>
      new URLSearchParams({
        q: query,
        state,
        offset: String(limit === 25 ? offset : 0),
        limit: String(limit),
      }),
    [query, state, offset],
  );
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await api(`emails?${params()}`);
      if (request === sequence.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (request === sequence.current) setError(e.message);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [params]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    const poll = setInterval(load, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(email) {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(email);
    } catch {
      notify(
        "Clipboard unavailable. You can select and copy the email address.",
      );
    }
  }
  async function exportContacts() {
    setExporting(true);
    try {
      const result = await api(`emails?${params(1000)}`);
      const fields = [
        "founder_name",
        "founder_role",
        "email",
        "company",
        "website",
        "state",
        "country",
        "role_source_url",
        "role_quote",
        "email_source_url",
        "email_quote",
        "email_source_year",
        "notes",
        "checked_at",
      ];
      const csv = [
        fields.map(csvCell).join(","),
        ...result.contacts.map((row) =>
          fields.map((key) => csvCell(row[key])).join(","),
        ),
      ].join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "scalematrix-us-solar-founder-emails.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(
        `Exported ${result.contacts.length} founder contacts with their sources.`,
      );
    } catch (e) {
      notify(e.message);
    } finally {
      setExporting(false);
    }
  }
  const complete = data.total >= data.goal;
  return (
    <div className="emails-page">
      <section className="emails-intro">
        <div className="emails-intro-copy">
          <span className="emails-eyebrow">
            <Mail size={14} /> US SOLAR / FOUNDER CONTACTS
          </span>
          <h2>Founder emails. Clear sources.</h2>
          <p>
            Named founders and co-founders with publicly listed professional
            emails. No inferred addresses or non-founder contacts.
          </p>
          <div className="emails-scope">
            <span>United States only</span>
            <span>Solar businesses</span>
            <span>Founder evidence required</span>
          </div>
        </div>
        <div className="emails-goal">
          <span>
            {complete ? "RESEARCH TARGET REACHED" : "SOURCE-BACKED CONTACTS"}
          </span>
          <div>
            <strong>{data.total}</strong>
            <small>/ {data.goal}</small>
          </div>
          <div
            className="emails-progress"
            role="progressbar"
            aria-label="Founder contact research"
            aria-valuemin={0}
            aria-valuemax={data.goal}
            aria-valuenow={Math.min(data.total, data.goal)}
          >
            <i
              style={{
                width: `${Math.min(100, (data.total / data.goal) * 100)}%`,
              }}
            />
          </div>
          <p>
            {data.companies} companies · {data.states.length} states
          </p>
        </div>
      </section>
      <div className="emails-toolbar">
        <label className="emails-search">
          <Search size={16} />
          <input
            aria-label="Search founder emails"
            placeholder="Search founder, company or email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
          {query && (
            <button
              className="icon-button"
              onClick={() => {
                setQuery("");
                setOffset(0);
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter by state"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All US states</option>
          {data.states.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <button className="button" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Refresh
        </button>
        <button
          className="button primary"
          disabled={!data.matched || exporting}
          onClick={exportContacts}
        >
          {exporting ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Download size={14} />
          )}
          Export contacts
        </button>
      </div>
      {error && (
        <div className="emails-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      <div className="emails-results-head">
        <span>
          {data.matched} {data.matched === 1 ? "contact" : "contacts"}
          {query || state
            ? " matching your filters"
            : " with founder and email sources"}
        </span>
        {loading && (
          <span role="status">
            <Loader2 size={12} className="spin" />
            Updating…
          </span>
        )}
      </div>
      <div className="social-table-wrap">
        <table className="social-table emails-table">
          <thead>
            <tr>
              <th>Founder</th>
              <th>Published email</th>
              <th>Company & website</th>
              <th>Location</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {data.contacts.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.founder_name}</strong>
                  <small>{row.founder_role}</small>
                </td>
                <td>
                  <div className="emails-address">
                    <span>{row.email}</span>
                    <button
                      className="icon-button"
                      onClick={() => copy(row.email)}
                      aria-label={`Copy ${row.founder_name}'s email`}
                    >
                      {copied === row.email ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <small>Publicly listed professional address</small>
                </td>
                <td>
                  <strong>{row.company}</strong>
                  <SiteLink url={row.website}>{host(row.website)}</SiteLink>
                </td>
                <td>
                  {row.state}
                  <small>United States</small>
                </td>
                <td>
                  <button
                    className="emails-proof"
                    onClick={() => setSelected(row)}
                  >
                    <FileCheck2 size={14} />
                    View sources
                    <ArrowRight size={12} />
                  </button>
                  {row.checked_at && (
                    <small>
                      Checked{" "}
                      {new Date(row.checked_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </small>
                  )}
                </td>
              </tr>
            ))}
            {!data.contacts.length && (
              <tr>
                <td colSpan={5}>
                  <div className="emails-empty">
                    <Mail size={26} />
                    <h3>
                      {loading
                        ? "Loading founder contacts…"
                        : query || state
                          ? "No matching founders"
                          : "Founder research is in progress"}
                    </h3>
                    <p>
                      {query || state
                        ? "Try another name or clear your filters."
                        : "Only contacts with an identified founder and a published email attributed to that person will appear here."}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="emails-pagination">
        <span>
          {data.matched
            ? `${offset + 1}–${Math.min(offset + 25, data.matched)} of ${data.matched}`
            : "0 contacts"}
        </span>
        <div>
          <button
            className="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            <ArrowLeft size={14} />
            Previous
          </button>
          <button
            className="button"
            disabled={offset + 25 >= data.matched || loading}
            onClick={() => setOffset(offset + 25)}
          >
            Next
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      {selected && (
        <Modal
          title="Founder contact sources"
          onClose={() => setSelected(null)}
        >
          <div className="emails-evidence">
            <span className="emails-eyebrow">{selected.company}</span>
            <h3>{selected.founder_name}</h3>
            <div className="emails-evidence-address">
              <Mail size={16} />
              <strong>{selected.email}</strong>
              <button
                className="icon-button"
                onClick={() => copy(selected.email)}
                aria-label="Copy email"
              >
                <Copy size={14} />
              </button>
            </div>
            <article>
              <span>01 / FOUNDER ROLE</span>
              <h4>{selected.founder_role}</h4>
              <p>{selected.role_quote}</p>
              <SiteLink url={selected.role_source_url}>
                View founder source
              </SiteLink>
            </article>
            <article>
              <span>02 / PUBLISHED EMAIL</span>
              <h4>Named professional contact</h4>
              {selected.email_source_year && (
                <p>Source dated {selected.email_source_year}</p>
              )}
              <p>{selected.email_quote}</p>
              <SiteLink url={selected.email_source_url}>
                View email source
              </SiteLink>
            </article>
            {selected.notes && (
              <p className="emails-source-note">{selected.notes}</p>
            )}
            <p className="emails-source-note">
              These sources establish the founder role and published address.
              Mailbox delivery has not been tested.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
