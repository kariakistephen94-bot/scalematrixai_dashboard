"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { liveMessage } from "../lib/messaging";

export default function LeadMessage({ contactId, notify }) {
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startedAfter = useRef(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const data = await api(`crm/${contactId}/message`);
        if (!active) return;
        setMessage(data.message);
        setError("");
        if (
          startedAfter.current !== null &&
          data.message?.updated_at &&
          data.message.updated_at !== startedAfter.current
        ) {
          setBusy(false);
          startedAfter.current = null;
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [contactId]);
  async function generate() {
    setBusy(true);
    startedAfter.current = message?.updated_at || "";
    try {
      const result = await api(`crm/${contactId}/message`, {
        method: "POST",
        body: "{}",
      });
      notify(result.message);
    } catch (e) {
      notify(e.message);
      setBusy(false);
      startedAfter.current = null;
    }
  }
  return (
    <section className="crm-message-card">
      <div>
        <h3>Custom outreach message</h3>
        <p>
          Based on this business and your selected outreach services. The
          greeting uses the recipient’s local time.
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
      {message?.outreach_draft ? (
        <>
          <p className="agent-draft">{liveMessage(message)}</p>
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(liveMessage(message));
                notify("Custom message copied.");
              } catch {
                notify("Select the text to copy your message.");
              }
            }}
          >
            Copy message
          </button>
        </>
      ) : (
        <p>No custom message yet. Generate one for this lead.</p>
      )}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={generate}
      >
        {busy
          ? "Preparing your message…"
          : message?.outreach_draft
            ? "Regenerate message"
            : "Generate custom message"}
      </button>
    </section>
  );
}
