"use client";

import { useState } from "react";
import { FileText, Search, Sparkles } from "lucide-react";
import PostCard from "./PostCard";
import { EmptyState } from "./ui";

export default function ContentStudio({
  data,
  busy,
  canGenerate,
  onGenerate,
  onOpen,
  onCopy,
}) {
  const [tab, setTab] = useState("All drafts");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const tabs = [
    "All drafts",
    "Approved",
    "Posted",
    "Reference library",
    "Archived",
  ];
  const pool =
    tab === "Reference library"
      ? data.references
      : data.posts.filter((post) =>
          tab === "All drafts"
            ? post.status === "draft"
            : post.status === tab.toLowerCase(),
        );
  const posts = pool.filter(
    (post) =>
      (platform === "all" || post.platform === platform) &&
      `${post.title} ${post.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section>
      <div className="page-title-row">
        <div>
          <span className="overline">CONSISTENCY WITHOUT THE BLANK PAGE</span>
          <h2>Ideas worth putting your name on.</h2>
          <p>
            Ready-to-review posts grounded in your own AI engineering voice.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || !canGenerate}
          onClick={() => onGenerate("content")}
        >
          <Sparkles size={16} />
          Generate today’s posts
        </button>
      </div>
      <div className="content-toolbar">
        <div className="tabs">
          {tabs.map((name) => (
            <button
              className={tab === name ? "active" : ""}
              key={name}
              onClick={() => setTab(name)}
            >
              {name}
              {name === "Reference library" && (
                <span>{data.references.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search posts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your content"
            />
          </label>
          <select
            aria-label="Content platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">All platforms</option>
            <option value="linkedin">LinkedIn</option>
            <option value="twitter">X / Twitter</option>
          </select>
        </div>
      </div>
      {posts.length ? (
        <div className="content-grid">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onOpen={onOpen}
              onCopy={onCopy}
            />
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={FileText}
            title={query ? "No matching posts" : "Your next idea belongs here."}
            description={
              query
                ? "Try another search or platform filter."
                : "Generate your first daily posts, then review and refine them before sharing."
            }
          >
            <button
              className="text-button"
              onClick={() => setTab("Reference library")}
            >
              Explore your existing reference library →
            </button>
          </EmptyState>
        </div>
      )}
      <p className="page-footnote">
        Approved means ready for you to copy and post. This workspace does not
        publish to social platforms.
      </p>
    </section>
  );
}
