"use client";

import { ArrowUpRight, Copy, FileText, Linkedin } from "lucide-react";
import { Badge } from "./ui";

export default function PostCard({ post, onOpen, onCopy, compact = false }) {
  const reference = post.status === "reference";
  return (
    <article className={`post-card ${compact ? "compact" : ""}`}>
      <div className="post-card-top">
        <div className={`platform-icon ${post.platform}`}>
          {post.platform === "linkedin" ? (
            <Linkedin size={17} />
          ) : (
            <span>𝕏</span>
          )}
        </div>
        <span className="platform-name">
          {post.platform === "linkedin" ? "LinkedIn" : "X / Twitter"}
        </span>
        <Badge
          tone={
            reference
              ? "neutral"
              : post.status === "approved"
                ? "green"
                : "purple"
          }
        >
          {reference ? "From your library" : post.status}
        </Badge>
      </div>
      <h3>{post.title}</h3>
      <p className="post-excerpt">{post.body}</p>
      <div className="post-card-bottom">
        <span>
          {reference ? (
            <>
              <FileText size={12} /> Writing reference
            </>
          ) : (
            <>
              {post.body.length} characters · {post.topic}
            </>
          )}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label={`Copy ${post.title}`}
            onClick={() => onCopy(post.body)}
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Open ${post.title}`}
            onClick={() => onOpen(post)}
          >
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}
