"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Film, Pencil, Trash2, Upload } from "lucide-react";
import { api } from "../lib/api";
import { Modal, Badge, EmptyState } from "./ui";

const blank = {
  title: "",
  summary: "",
  video_url: "",
  thumbnail_url: "",
  link: "",
  tags: "",
  published: true,
  order: 0,
};

async function uploadFile(file, kind) {
  const response = await fetch(`/api/projects/upload?kind=${kind}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail || "Upload failed.");
  return result.url;
}

function ProjectForm({ project, onClose, onSaved, notify }) {
  const [form, setForm] = useState(project);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function pick(event, kind, key) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(kind);
    setError("");
    try {
      field(key, await uploadFile(file, kind));
      notify(kind === "video" ? "Video uploaded." : "Thumbnail uploaded.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setUploading("");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      ...form,
      order: Number(form.order) || 0,
      tags: String(form.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      await api(project.id ? `projects/${project.id}` : "projects", {
        method: project.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      notify(
        body.published
          ? "Saved and published to your website."
          : "Saved as a draft.",
      );
      onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={project.id ? "Edit project" : "Upload a project"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <p className="modal-intro">
          Published projects appear under “See what we’ve built” on your
          website within about a minute.
        </p>
        <label className="field">
          Project name
          <input
            required
            minLength={2}
            maxLength={120}
            value={form.title}
            onChange={(e) => field("title", e.target.value)}
            placeholder="AI WhatsApp lead-reply assistant"
          />
        </label>
        <label className="field">
          What it does and the result
          <textarea
            rows={4}
            maxLength={1200}
            value={form.summary}
            onChange={(e) => field("summary", e.target.value)}
            placeholder="Replies to new enquiries in under a minute, qualifies the lead and books the call."
          />
        </label>
        <label className="field">
          Demo video link (YouTube, Vimeo or Loom)
          <input
            value={form.video_url}
            onChange={(e) => field("video_url", e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </label>
        <p className="modal-intro">
          Or upload a recording directly (MP4, WebM or MOV, up to 50 MB). For
          longer demos, upload to YouTube as unlisted and paste the link.
        </p>
        <label className="button secondary" style={{ cursor: "pointer" }}>
          <Upload size={15} />
          {uploading === "video" ? "Uploading video…" : "Upload video file"}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            hidden
            disabled={!!uploading}
            onChange={(e) => pick(e, "video", "video_url")}
          />
        </label>
        <div className="crm-form-grid">
          <label className="field">
            Thumbnail image (optional)
            <input
              value={form.thumbnail_url}
              onChange={(e) => field("thumbnail_url", e.target.value)}
              placeholder="https://… or upload below"
            />
          </label>
          <label className="field">
            Live link (optional)
            <input
              value={form.link}
              onChange={(e) => field("link", e.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>
        <label className="button secondary" style={{ cursor: "pointer" }}>
          <Upload size={15} />
          {uploading === "image" ? "Uploading…" : "Upload thumbnail"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            disabled={!!uploading}
            onChange={(e) => pick(e, "image", "thumbnail_url")}
          />
        </label>
        <div className="crm-form-grid">
          <label className="field">
            Tags (comma separated)
            <input
              value={form.tags}
              onChange={(e) => field("tags", e.target.value)}
              placeholder="WhatsApp, AI agent, Automation"
            />
          </label>
          <label className="field">
            Display order (0 = first)
            <input
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => field("order", e.target.value)}
            />
          </label>
        </div>
        <label className="field" style={{ display: "flex", gap: 10 }}>
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => field("published", e.target.checked)}
            style={{ width: "auto", margin: 0 }}
          />
          Show on website
        </label>
        {form.video_url && /\.(mp4|webm|mov)$/i.test(form.video_url) && (
          <video
            src={form.video_url}
            controls
            preload="metadata"
            style={{ width: "100%", borderRadius: 8 }}
          />
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button"
            disabled={saving || !!uploading}
          >
            {saving ? "Saving…" : "Save project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Projects({ notify }) {
  const [items, setItems] = useState([]);
  const [feed, setFeed] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await api("projects");
      setItems(result.projects);
      setFeed(result.feed_url);
      setError("");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(project) {
    if (
      !window.confirm(
        `Delete “${project.title}”? It will be removed from your website.`,
      )
    )
      return;
    try {
      await api(`projects/${project.id}`, { method: "DELETE" });
      notify("Project deleted.");
      load();
    } catch (failure) {
      notify(failure.message);
    }
  }

  return (
    <>
      <div className="page-actions" style={{ marginBottom: 18 }}>
        <button className="button" onClick={() => setActive({ ...blank })}>
          <Plus size={15} />
          Upload project
        </button>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading your projects…</p>
      ) : !items.length && !error ? (
        <div className="panel">
          <EmptyState
            icon={Film}
            title="Show what you’ve built."
            description="Add a demo video of a project you’ve built. It appears on your website under “See what we’ve built”."
          >
            <button className="button" onClick={() => setActive({ ...blank })}>
              <Plus size={15} />
              Upload your first project
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="panel crm-table-panel">
          <div className="table-scroll">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Demo</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                      <p className="crm-table-notes">{p.summary}</p>
                    </td>
                    <td>
                      {p.video_url ? (
                        <a href={p.video_url} target="_blank" rel="noreferrer">
                          Watch ↗
                        </a>
                      ) : (
                        <span className="crm-muted">No video yet</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={p.published ? "green" : "neutral"}>
                        {p.published ? "On website" : "Draft"}
                      </Badge>
                    </td>
                    <td>{p.order}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${p.title}`}
                        onClick={() =>
                          setActive({ ...p, tags: (p.tags || []).join(", ") })
                        }
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => remove(p)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {feed && (
        <p className="ob-note" style={{ marginTop: 14 }}>
          Website feed: <a href={feed} target="_blank" rel="noreferrer">{feed}</a>
        </p>
      )}
      {active && (
        <ProjectForm
          project={active}
          notify={notify}
          onClose={() => setActive(null)}
          onSaved={() => {
            setActive(null);
            load();
          }}
        />
      )}
    </>
  );
}
