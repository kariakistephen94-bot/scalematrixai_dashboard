"use client";
import MarketAreas from "./MarketAreas";

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Save,
  Search,
  Target,
} from "lucide-react";
import { api, markets, niches } from "../lib/api";
import { Badge, Modal } from "./ui";
import { TargetChoices, DiscoverySource } from "./WorkspaceSettings";

export function PostEditor({ post, onClose, onSaved, notify, copy }) {
  const [body, setBody] = useState(post.body);
  const [status, setStatus] = useState(post.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const reference = post.status === "reference";
  const limit = post.platform === "twitter" ? 280 : 3000;
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body, status }),
      });
      notify("Post saved to Supabase.");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={reference ? "From your writing library" : "Make this post yours"}
      onClose={onClose}
      wide
    >
      <div className="editor-title">
        <Badge tone="purple">
          {post.platform === "linkedin" ? "LinkedIn" : "X / Twitter"}
        </Badge>
        <h3>{post.title}</h3>
      </div>
      <label className="field">
        Post copy
        <textarea
          className="post-editor"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          readOnly={reference}
          rows={13}
        />
      </label>
      <div className="character-count">
        <span>
          {reference
            ? "Original saved reference · read only"
            : "Your changes save only to your private workspace."}
        </span>
        <span className={body.length > limit ? "error-text" : ""}>
          {body.length} / {limit}
        </span>
      </div>
      {!reference && (
        <label className="field">
          Review status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft: needs review</option>
            <option value="approved">Approved: ready to copy</option>
            <option value="posted">Posted: I published this manually</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      )}
      {post.rationale && (
        <div className="editor-note">
          <strong>Why this angle</strong>
          <p>{post.rationale}</p>
        </div>
      )}
      {post.visual_brief && (
        <div className="editor-note">
          <strong>Suggested visual · design brief only</strong>
          <p>{post.visual_brief}</p>
        </div>
      )}
      {post.sources?.length > 0 && (
        <div className="source-links">
          <strong>Research sources</strong>
          {post.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.title || source.url}
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={() => copy(body)}>
          <Copy size={15} />
          Copy post
        </button>
        {!reference && (
          <button
            className="button"
            disabled={saving || !body.trim() || body.length > limit}
            onClick={save}
          >
            <Save size={15} />
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function ProspectEditor({ prospect, onClose, onSaved, notify, copy }) {
  const [stage, setStage] = useState(prospect.stage);
  const [notes, setNotes] = useState(prospect.notes || "");
  const [draft, setDraft] = useState(prospect.outreach_draft || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`prospects/${prospect.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage, notes, outreach_draft: draft }),
      });
      notify("Prospect updated.");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Your next conversation" onClose={onClose} wide>
      <div className="prospect-editor-head">
        <span className="company-avatar large">
          {prospect.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h3>{prospect.name}</h3>
          <p>
            {prospect.industry} · {prospect.location}
          </p>
        </div>
      </div>
      <div className="prospect-links">
        <a href={prospect.website} target="_blank" rel="noreferrer">
          Company website
          <ArrowUpRight size={13} />
        </a>
        <a href={prospect.source_url} target="_blank" rel="noreferrer">
          Research source
          <ExternalLink size={13} />
        </a>
        {prospect.contact_url && (
          <a href={prospect.contact_url} target="_blank" rel="noreferrer">
            Public contact page
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="editor-note">
        <strong>What the source supports</strong>
        <p>{prospect.evidence}</p>
      </div>
      <div className="opportunity-note">
        <Target size={18} />
        <div>
          <strong>Potential automation angle</strong>
          <p>{prospect.opportunity}</p>
          <small>Hypothesis to validate with the business.</small>
        </div>
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
        Your opening message
        <textarea
          rows={6}
          value={draft}
          maxLength={3000}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <label className="field">
        Private notes
        <textarea
          rows={3}
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What should you remember before reaching out?"
        />
      </label>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={() => copy(draft)}>
          <Copy size={15} />
          Copy outreach draft
        </button>
        <button className="button" disabled={saving} onClick={save}>
          <Save size={15} />
          {saving ? "Saving…" : "Save prospect"}
        </button>
      </div>
      <p className="page-footnote">
        This prepares a message. It does not send it or verify a decision-maker.
      </p>
    </Modal>
  );
}

export function DiscoveryDialog({
  settings,
  connections,
  onClose,
  onDiscover,
  busy,
}) {
  const [form, setForm] = useState(settings);
  const providerReady =
    form.prospect_source === "google_maps"
      ? connections.maps_configured
      : connections.openai_configured;
  return (
    <Modal title="Where should we look next?" onClose={onClose}>
      <p className="modal-intro">
        Select your agency’s target niches and markets. Your selected source
        will discover businesses and save a shortlist for you to review.
      </p>
      <DiscoverySource
        value={form.prospect_source}
        onChange={(value) => setForm({ ...form, prospect_source: value })}
      />
      {!providerReady && (
        <p className="error-box">
          Add{" "}
          {form.prospect_source === "google_maps"
            ? "GOOGLE_MAPS_API_KEY"
            : "OPENAI_API_KEY"}{" "}
          to backend/.env and restart FastAPI to use this source.
        </p>
      )}
      <TargetChoices
        label="Business niches"
        value={form.target_industry}
        options={niches}
        onChange={(value) => setForm({ ...form, target_industry: value })}
      />
      <TargetChoices
        label="Markets"
        value={form.target_location}
        options={markets}
        onChange={(value) => setForm({ ...form, target_location: value })}
      />
      <MarketAreas
        countries={form.target_location
          .split(";")
          .map((v) => v.trim())
          .filter(Boolean)}
        tiers={form.target_tiers}
        areas={form.target_areas}
        disabled={busy}
        onChange={({ tiers, areas }) =>
          setForm({ ...form, target_tiers: tiers, target_areas: areas })
        }
      />
      <label className="field">
        Businesses to research
        <input
          type="number"
          min="1"
          max="15"
          value={form.daily_prospect_count}
          onChange={(e) =>
            setForm({ ...form, daily_prospect_count: Number(e.target.value) })
          }
        />
      </label>
      <p className="page-footnote">
        This starts a search now. Your daily schedule stays unchanged. Searches
        use your selected provider’s API quota.
      </p>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button"
          disabled={
            busy ||
            !form.target_industry ||
            !form.target_location ||
            form.daily_prospect_count < 1 ||
            form.daily_prospect_count > 15 ||
            !providerReady
          }
          onClick={() => onDiscover(form)}
        >
          <Search size={15} />
          {busy ? "Starting research…" : "Find relevant businesses"}
        </button>
      </div>
    </Modal>
  );
}
