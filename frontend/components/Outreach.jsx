"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import {
  formatLagos,
  formatPhone,
  formatUntil,
  messageLabels,
  lagosInputToMs,
  msToLagosInput,
  outreachApi,
  pipelineLabels,
  pipelineStatuses,
  stageLabels,
} from "../lib/outreach";
import { Badge, EmptyState, Modal } from "./ui";

const ranges = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["all", "All time"],
];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (map, key) => {
  const [text, tone] = map[key] || [key || "—", "neutral"];
  return <Badge tone={tone}>{text}</Badge>;
};

export default function Outreach({ notify }) {
  const [range, setRange] = useState("today");
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("leads");
  const [qrAccount, setQrAccount] = useState(null);

  const load = useCallback(async () => {
    try {
      setOverview(await outreachApi(`overview?range=${range}`));
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }, [range]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  async function act(path, body, success) {
    try {
      await outreachApi(path, { method: "POST", body: JSON.stringify(body) });
      if (success) notify(success);
    } catch (failure) {
      notify(failure.message);
    }
    load();
  }

  if (!overview) {
    return error ? (
      <div className="panel">
        <EmptyState
          icon={Send}
          title="Outreach service not reachable"
          description={error}
        >
          <button className="button secondary" onClick={load}>
            <RefreshCw size={14} /> Try again
          </button>
        </EmptyState>
      </div>
    ) : (
      <div className="panel ob-loading">Loading outreach…</div>
    );
  }

  const { tiles, leadsToday, pipeline, accounts, sending, collector, calls } =
    overview;
  const pct = Math.min(
    100,
    Math.round((leadsToday.total / leadsToday.target) * 100),
  );
  const outcomes = {
    target_reached: "reached the daily target",
    run_limit_reached: "stopped at today's run limit",
    scraper_exhausted: "the scraper has no more new solar companies right now",
    ai_research_on:
      "paused: the AI Agent's automatic owner research is on and would spend OpenAI credits on every search. Turn it off on the AI Agent page",
    scraper_unreachable:
      "the dashboard backend (FastAPI) isn't running, so nothing could be searched",
    scraper_unauthorized: "the scraper token was rejected; run npm run init",
    scraper_not_configured: "the scraper token isn't set; run npm run init",
    scraper_error: "the scraper reported an error; see Activity",
  };
  const stat = (title, value, sub, extra) => (
    <div className="stat-card">
      <div>
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      <small>{extra || sub}</small>
    </div>
  );

  return (
    <div className="ob">
      {error && <div className="error-box">{error}</div>}
      <div className="ob-bar">
        <Badge tone={sending.paused ? "neutral" : "green"}>
          {sending.paused ? "Sending paused" : "Sending live"}
        </Badge>
        <button
          className={sending.paused ? "button" : "button secondary"}
          onClick={() =>
            act("control", {
              action: sending.paused ? "resume_all" : "pause_all",
            })
          }
        >
          {sending.paused ? <Play size={14} /> : <Pause size={14} />}
          {sending.paused ? "Resume sending" : "Pause sending"}
        </button>
        <span className="ob-spacer" />
        <div className="ob-seg" role="group" aria-label="Date range">
          {ranges.map(([value, text]) => (
            <button
              key={value}
              className={range === value ? "active" : ""}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid ob-stats">
        {stat("Sent", tiles.sent, "handed to WhatsApp")}
        {stat("Failed", tiles.failed, "rejected by the gateway")}
        {stat("Sent + failed", tiles.sentPlusFailed, "all attempts")}
        {stat("Uncertain", tiles.uncertain, "no answer, not retried")}
        {stat("Delivered", tiles.delivered, "reached the phone")}
        {stat("Read", tiles.read, "blue ticks")}
        {stat(
          "Replied leads",
          tiles.repliedLeads,
          "",
          <button
            className="text-button"
            onClick={() => {
              setTab("replies");
              document
                .getElementById("outreach-tabs")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            View who replied →
          </button>,
        )}
        {stat(
          "Reply conversion",
          `${tiles.replyConversion}%`,
          `${tiles.repliedLeads} replied / ${tiles.contacted} contacted leads`,
        )}
      </div>

      <div className="ob-grid2">
        <section className="panel ob-pad">
          <h2 className="ob-h">Leads found today</h2>
          <div className="ob-big">
            {leadsToday.total} <span>/ {leadsToday.target}</span>
          </div>
          <div className="ob-bar-track">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="ob-kv">
            <span>Abuja</span>
            <b>
              {leadsToday.Abuja} / {leadsToday.abujaQuota}
            </b>
          </div>
          <div className="ob-kv">
            <span>Lagos</span>
            <b>
              {leadsToday.Lagos} / {leadsToday.lagosQuota}
            </b>
          </div>
          <div className="ob-kv">
            <span>Banked for tomorrow</span>
            <b>{pipeline.banked}</b>
          </div>
          <p className="ob-note">
            Mobile numbers only, {collector.minReviews}+ Google reviews.
            Landlines are kept as call-only.
          </p>
        </section>
        <section className="panel ob-pad">
          <h2 className="ob-h">Send queue</h2>
          <div className="ob-kv">
            <span>Total leads</span>
            <b>{pipeline.total}</b>
          </div>
          <div className="ob-kv">
            <span>Ready to message</span>
            <b>{pipeline.ready}</b>
          </div>
          <div className="ob-kv">
            <span>Follow-ups due</span>
            <b>{pipeline.followupsDue}</b>
          </div>
          <div className="ob-kv">
            <span>Contacted / replied</span>
            <b>
              {pipeline.contacted + pipeline.replied} / {pipeline.replied}
            </b>
          </div>
          <div className="ob-kv">
            <span>Opted out</span>
            <b>{pipeline.optedOut}</b>
          </div>
          <div className="ob-kv">
            <span>Call-only (landline)</span>
            <b>{pipeline.callOnly}</b>
          </div>
          {pipeline.sendFailed > 0 && (
            <div className="ob-kv">
              <span>Parked after failed sends</span>
              <b>{pipeline.sendFailed}</b>
            </div>
          )}
          <p className="ob-note">
            Sends {sending.days.map((day) => weekdays[day]).join(", ")}{" "}
            {sending.window} Lagos time
            {sending.followupDays.length > 0 &&
              `, follow-ups after day ${sending.followupDays.join(" and ")}`}
            . Window is {sending.windowOpen ? "open" : "closed"} now.
          </p>
        </section>
      </div>

      <CallPipeline calls={calls} />

      <div className="ob-accounts">
        {accounts.map((account) => {
          const status =
            account.reachable === false
              ? ["Gateway not running", "red"]
              : account.connected
                ? ["Connected", "green"]
                : account.needsQr
                  ? ["Needs pairing", "purple"]
                  : [
                      account.state === "unknown" ? "Checking…" : account.state,
                      "neutral",
                    ];
          const next = account.paused
            ? "paused"
            : sending.paused
              ? "sending paused"
              : !sending.windowOpen
                ? "next window"
                : account.nextSendAt
                  ? `in ${formatUntil(account.nextSendAt)}`
                  : "ready";
          return (
            <section className="panel ob-pad" key={account.id}>
              <div className="ob-row">
                <h2 className="ob-h">{account.label}</h2>
                <Badge tone={status[1]}>{status[0]}</Badge>
              </div>
              <div className="ob-note ob-phone">
                <Smartphone size={12} />
                {account.number ? `+${account.number}` : "Not linked yet"}
              </div>
              <div className="ob-kv">
                <span>Sent today</span>
                <b>
                  {account.sentToday} / {account.cap}
                </b>
              </div>
              <div className="ob-bar-track">
                <i
                  style={{
                    width: `${Math.min(100, Math.round((account.sentToday / account.cap) * 100))}%`,
                  }}
                />
              </div>
              <div className="ob-kv">
                <span>Next send</span>
                <b>{next}</b>
              </div>
              <div className="ob-row ob-actions">
                {!account.connected && account.reachable !== false && (
                  <button
                    className="button"
                    onClick={() => setQrAccount(account.id)}
                  >
                    <QrCode size={14} /> Connect WhatsApp
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() =>
                    act("control", {
                      action: account.paused
                        ? "resume_account"
                        : "pause_account",
                      account: account.id,
                    })
                  }
                >
                  {account.paused ? "Resume" : "Pause"} this account
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel ob-pad">
        <div className="ob-row">
          <h2 className="ob-h">Lead discovery (your Google Maps scraper)</h2>
          <Badge
            tone={
              collector.scanning
                ? "purple"
                : !collector.configured
                  ? "red"
                  : collector.enabled
                    ? "green"
                    : "neutral"
            }
          >
            {collector.scanning
              ? "Running now"
              : !collector.configured
                ? "Not linked"
                : collector.enabled
                  ? "On"
                  : "Off"}
          </Badge>
          <span className="ob-spacer" />
          <button
            className="button"
            disabled={collector.scanning || !collector.configured}
            onClick={() =>
              act("collector", { action: "run" }, "Finding leads now…")
            }
          >
            Find leads now
          </button>
          <button
            className="button secondary"
            onClick={() =>
              act("collector", {
                action: collector.enabled ? "disable" : "enable",
              })
            }
          >
            {collector.enabled ? "Turn off daily run" : "Turn on daily run"}
          </button>
        </div>
        <p className="ob-note">
          Solar businesses in Abuja and Lagos, {collector.minReviews}+ reviews.
          Scraper runs today:{" "}
          <b>
            {collector.runsToday} / {collector.runLimit}
          </b>{" "}
          (each saves up to 15 leads)
          {collector.last &&
            ` · last run ${formatLagos(collector.last.at)}: ${outcomes[collector.last.outcome] || collector.last.outcome}, +${collector.last.added} leads`}
        </p>
      </section>

      <section className="panel ob-pad" id="outreach-tabs">
        <div className="tabs ob-tabs" role="tablist">
          {[
            ["leads", "Leads"],
            ["replies", "Replies"],
            ["messages", "Messages"],
            ["activity", "Activity"],
          ].map(([value, text]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {text}
            </button>
          ))}
        </div>
        <OutreachTable tab={tab} range={range} notify={notify} />
      </section>

      {qrAccount && (
        <PairingDialog
          account={accounts.find((a) => a.id === qrAccount)}
          onClose={() => {
            setQrAccount(null);
            load();
          }}
          onLinked={load}
        />
      )}
    </div>
  );
}

function PairingDialog({ account, onClose, onLinked }) {
  const [qr, setQr] = useState(null);
  const [state, setState] = useState("Waiting for QR…");
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const [code, status] = await Promise.all([
          outreachApi(`accounts/${account.id}/qr`),
          outreachApi("overview?range=today"),
        ]);
        if (stopped) return;
        const current = status.accounts.find((a) => a.id === account.id);
        if (current?.connected) {
          setLinked(true);
          setQr(null);
          onLinked();
          return;
        }
        setQr(code.dataUrl || null);
        setState(
          code.dataUrl
            ? "Scan this code. It refreshes automatically."
            : current?.reachable === false
              ? "The gateway is not running. Start it with `npm run gateways` in outreach/."
              : "Waiting for QR…",
        );
      } catch (failure) {
        if (!stopped) setState(failure.message);
      }
    }
    poll();
    const interval = setInterval(() => !linked && poll(), 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, linked]);

  return (
    <Modal title={`Link ${account.label}`} onClose={onClose}>
      <div className="ob-qr">
        <p className="ob-note">
          On the phone: WhatsApp → Settings → Linked devices → Link a device,
          then scan.
        </p>
        {linked ? (
          <p className="ob-linked">✓ Linked. You can close this.</p>
        ) : (
          <>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="WhatsApp pairing QR code" />
            )}
            <p className="ob-note">{state}</p>
          </>
        )}
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function OutreachTable({ tab, range, notify }) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("all");
  const [city, setCity] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const path =
    tab === "leads"
      ? `leads?${new URLSearchParams({
          stage,
          city,
          pipeline: pipelineFilter,
          q: query,
          limit: "100",
        })}`
      : tab === "replies"
        ? `replies?range=${range}`
        : tab === "messages"
          ? "messages?limit=150"
          : "activity?limit=150";

  const load = useCallback(async () => {
    try {
      const value = await outreachApi(path);
      setLoaded({ path, value });
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }, [path]);

  useEffect(() => {
    setLoaded(null);
    setError("");
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  async function exportCSV() {
    try {
      const csv = await outreachApi(
        `leads.csv?${new URLSearchParams({ stage, city, pipeline: pipelineFilter, q: query })}`,
      );
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      link.download = "solar-leads.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (failure) {
      notify(failure.message);
    }
  }

  async function optOut(id) {
    if (
      !window.confirm(
        "Mark this lead as opted out? They will not be messaged again.",
      )
    )
      return false;
    try {
      await outreachApi(`leads/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "opt_out" }),
      });
      notify("Lead marked as opted out.");
      load();
      return true;
    } catch (failure) {
      notify(failure.message);
      return false;
    }
  }

  // Only render data fetched for this tab and filter set; a late or stale response must never reach another view.
  const data = loaded && loaded.path === path ? loaded.value : null;
  if (error) return <div className="ob-empty">Could not load: {error}</div>;
  if (!data) return <div className="ob-empty">Loading…</div>;

  const table = (head, rows, empty) =>
    rows.length ? (
      <div className="table-scroll">
        <table className="ob-table">
          <thead>
            <tr>
              {head.map((text) => (
                <th key={text}>{text}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    ) : (
      <div className="ob-empty">{empty}</div>
    );

  if (tab === "leads") {
    return (
      <>
        <div className="ob-row ob-toolbar">
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            aria-label="Stage"
          >
            <option value="all">All stages</option>
            {[
              "new",
              "contacted",
              "replied",
              "opted_out",
              "no_mobile",
              "banked",
              "other_niche",
              "send_failed",
              "archived",
            ].map((value) => (
              <option key={value} value={value}>
                {stageLabels[value][0]}
              </option>
            ))}
          </select>
          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
            aria-label="City"
          >
            <option value="all">All cities</option>
            <option>Abuja</option>
            <option>Lagos</option>
            <option>Port Harcourt</option>
            <option>Uyo</option>
          </select>
          <select
            value={pipelineFilter}
            onChange={(event) => setPipelineFilter(event.target.value)}
            aria-label="Call pipeline"
          >
            <option value="all">All call statuses</option>
            <option value="none">Not worked yet</option>
            <option value="any">Any call status</option>
            {pipelineStatuses.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search name, area, phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="ob-spacer" />
          <span className="ob-note">{data.total} leads</span>
          <button className="button secondary" onClick={exportCSV}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        {table(
          [
            "Business",
            "City",
            "WhatsApp",
            "Reviews",
            "Stage",
            "Call pipeline",
            "Last message",
            "Found",
            "",
          ],
          data.items.map((lead) => (
            <tr key={lead.id}>
              <td>
                <b>{lead.name}</b>
                <div className="ob-note">
                  {lead.area} · {lead.category}
                </div>
              </td>
              <td>{lead.city}</td>
              <td className="num">
                {lead.phone_type === "mobile" ? (
                  <a
                    className="ob-link"
                    href={`https://wa.me/${lead.phone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {formatPhone(lead.phone)}
                  </a>
                ) : (
                  <>
                    {formatPhone(lead.phone)}{" "}
                    <span className="ob-note">(landline)</span>
                  </>
                )}
              </td>
              <td className="num">
                ★ {lead.rating ?? "—"} ({lead.review_count ?? 0})
              </td>
              <td>{label(stageLabels, lead.stage)}</td>
              <td>
                {lead.pipeline_status ? (
                  <>
                    {label(pipelineLabels, lead.pipeline_status)}
                    {lead.pipeline_at && (
                      <div className="ob-note">
                        {formatLagos(lead.pipeline_at)}
                      </div>
                    )}
                    {lead.pipeline_note && (
                      <div className="ob-note" title={lead.pipeline_note}>
                        {lead.pipeline_note.slice(0, 40)}
                        {lead.pipeline_note.length > 40 ? "…" : ""}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="ob-note">—</span>
                )}
              </td>
              <td>
                {lead.last_message_status
                  ? label(messageLabels, lead.last_message_status)
                  : "—"}
              </td>
              <td className="num">{lead.discovery_day}</td>
              <td>
                <button
                  className="text-button"
                  onClick={() => setEditing(lead)}
                >
                  Update
                </button>
              </td>
            </tr>
          )),
          "No leads match yet.",
        )}
        {editing && (
          <PipelineDialog
            lead={editing}
            notify={notify}
            onClose={() => setEditing(null)}
            onOptOut={async () => {
              if (await optOut(editing.id)) setEditing(null);
            }}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </>
    );
  }

  if (tab === "replies") {
    return table(
      ["When", "Business", "City", "Message", "Via", ""],
      data.items.map((reply) => (
        <tr key={reply.id}>
          <td className="num">{formatLagos(reply.received_at)}</td>
          <td>
            <b>{reply.name}</b>
            <div className="ob-note">{reply.area}</div>
          </td>
          <td>{reply.city}</td>
          <td className="ob-text">
            {reply.is_stop ? <Badge tone="red">Opt-out</Badge> : null}{" "}
            {reply.text || "(non-text message)"}
          </td>
          <td>{reply.account.toUpperCase()}</td>
          <td>
            <a
              className="ob-link"
              href={`https://wa.me/${reply.phone}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open chat <ExternalLink size={11} />
            </a>
          </td>
        </tr>
      )),
      "No replies in this range yet.",
    );
  }

  if (tab === "messages") {
    return table(
      ["When", "Account", "Business", "Step", "Status", "Message"],
      data.items.map((message) => (
        <tr key={message.id}>
          <td className="num">{formatLagos(message.created_at)}</td>
          <td>{message.account.toUpperCase()}</td>
          <td>
            <b>{message.name}</b>
          </td>
          <td>{message.step === 0 ? "First" : `Follow-up ${message.step}`}</td>
          <td>
            {label(messageLabels, message.status)}
            {message.error && <div className="ob-note">{message.error}</div>}
          </td>
          <td className="ob-text ob-small">{message.body}</td>
        </tr>
      )),
      "Nothing sent yet.",
    );
  }

  return table(
    ["When", "Type", "Detail"],
    data.items.map((item, index) => (
      <tr key={`${item.at}-${index}`}>
        <td className="num">{formatLagos(item.at)}</td>
        <td>{item.kind}</td>
        <td>{item.detail}</td>
      </tr>
    )),
    "No activity yet.",
  );
}

function CallPipeline({ calls }) {
  const counts = calls?.counts || {};
  const upcoming = calls?.upcoming || [];
  const worked = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <section className="panel ob-pad" aria-labelledby="call-pipeline">
      <h2 className="ob-h" id="call-pipeline">
        Call pipeline
      </h2>
      <p className="ob-note">
        Update any lead from the Leads tab: cold called, interested, call back,
        meeting booked and more. {worked} lead{worked === 1 ? "" : "s"} worked
        so far.
      </p>
      <div className="ob-row" style={{ flexWrap: "wrap", gap: 8 }}>
        {pipelineStatuses.map(([key, text, tone]) => (
          <Badge key={key} tone={counts[key] ? tone : "neutral"}>
            {text}: {counts[key] || 0}
          </Badge>
        ))}
      </div>
      <h3 className="ob-h" style={{ marginTop: 18 }}>
        Upcoming call backs &amp; meetings (Lagos time)
      </h3>
      {upcoming.length ? (
        <div className="table-scroll">
          <table className="ob-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Business</th>
                <th>Type</th>
                <th>Phone</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((u) => (
                <tr key={u.id}>
                  <td className="num">
                    {formatLagos(u.at)}{" "}
                    {u.overdue && <Badge tone="red">Overdue</Badge>}
                  </td>
                  <td>
                    <b>{u.name}</b>
                    <div className="ob-note">{u.city}</div>
                  </td>
                  <td>{label(pipelineLabels, u.status)}</td>
                  <td className="num">{formatPhone(u.phone)}</td>
                  <td className="ob-text">{u.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ob-note">Nothing scheduled yet.</p>
      )}
    </section>
  );
}

function PipelineDialog({ lead, notify, onClose, onSaved, onOptOut }) {
  const [status, setStatus] = useState(lead.pipeline_status || "called");
  const [when, setWhen] = useState(msToLagosInput(lead.pipeline_at));
  const [note, setNote] = useState(lead.pipeline_note || "");
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const needsTime = pipelineLabels[status]?.[2];

  useEffect(() => {
    outreachApi(`leads/${lead.id}/events`)
      .then((result) => setHistory(result.items))
      .catch(() => {});
  }, [lead.id]);

  async function save(event) {
    event.preventDefault();
    setError("");
    const at = needsTime ? lagosInputToMs(when) : undefined;
    if (needsTime && !at) {
      setError("Choose the date and time (Lagos time).");
      return;
    }
    setSaving(true);
    try {
      await outreachApi(`leads/${lead.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "set_status", status, at, note }),
      });
      notify(`${lead.name}: ${pipelineLabels[status][0]}`);
      onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Update ${lead.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="modal-intro">
          {formatPhone(lead.phone)} · {lead.city}
          {pipelineLabels[status]?.[0] &&
            [
              "interested",
              "callback",
              "meeting_booked",
              "proposal_sent",
              "won",
              "not_interested",
              "lost",
              "wrong_number",
              "do_not_contact",
            ].includes(status) &&
            " · WhatsApp messages to this lead will stop automatically."}
        </p>
        <label className="field">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {pipelineStatuses.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {needsTime && (
          <label className="field">
            {status === "meeting_booked" ? "Meeting" : "Call back"} date and
            time (Lagos time)
            <input
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          Note
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was said, who you spoke to, next step…"
          />
        </label>
        {history.length > 0 && (
          <>
            <h3 className="ob-h">History</h3>
            <ul className="ob-note" style={{ paddingLeft: 18 }}>
              {history.map((h) => (
                <li key={h.id}>
                  {formatLagos(h.created_at)} —{" "}
                  {label(pipelineLabels, h.status)}
                  {h.scheduled_at ? ` for ${formatLagos(h.scheduled_at)}` : ""}
                  {h.note ? `: ${h.note}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {lead.stage !== "opted_out" && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid rgba(220,60,60,0.35)",
            }}
          >
            <p className="ob-note">
              Danger zone: stops all WhatsApp messages to this business for
              good.
            </p>
            <button
              type="button"
              className="button secondary"
              style={{ color: "#c0392b", borderColor: "#c0392b" }}
              onClick={onOptOut}
            >
              Opt out this lead…
            </button>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
