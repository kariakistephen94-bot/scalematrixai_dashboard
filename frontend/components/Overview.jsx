"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  FolderHeart,
  Linkedin,
  ListChecks,
  Radio,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import PostCard from "./PostCard";
import { Badge, EmptyState, StatusDot } from "./ui";

export default function Overview({
  data,
  canGenerate,
  canRunDaily,
  busy,
  onGenerate,
  onNavigate,
  onOpenPost,
  onCopy,
  onOpenProspect,
}) {
  const today = data.server_time?.slice(0, 10);
  const todaysPosts = data.posts.filter(
    (post) => post.generation_date === today && post.status !== "archived",
  );
  const selected = todaysPosts.length
    ? todaysPosts
    : data.posts.filter((post) => post.status !== "archived").slice(0, 2);
  const ready = data.posts.filter((post) => post.status === "approved").length;
  const reference = data.references.at(-1);
  const stats = [
    {
      label: "Drafts to review",
      value: data.posts.filter((p) => p.status === "draft").length,
      detail: "Your next conversations",
      icon: FileText,
      color: "purple",
    },
    {
      label: "Ready to post",
      value: ready,
      detail: "Reviewed and approved",
      icon: Check,
      color: "green",
    },
    {
      label: "Business prospects",
      value:
        data.prospects.filter((p) => p.stage !== "archived").length +
        (data.maps_lead_count || 0),
      detail: "Source-backed opportunities",
      icon: Target,
      color: "blue",
    },
    {
      label: "Writing references",
      value: data.references.length,
      detail: "Grounded in your own voice",
      icon: FolderHeart,
      color: "orange",
    },
  ];
  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="banner-kicker">
            <span />
            YOUR DAILY ADVANTAGE
          </div>
          <h2>
            Show up consistently.
            <br />
            <span>Grow deliberately.</span>
          </h2>
          <p>
            Your ideas, your voice, your next clients.
            <br />
            Let AI do the groundwork. You make the next move.
          </p>
          <button
            className="button dark-button"
            disabled={!canRunDaily || busy}
            onClick={() => onGenerate("daily")}
          >
            <Sparkles size={16} />
            {busy ? "Your engine is working…" : "Generate my daily brief"}
            <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="engine-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="visual-label label-top">
            <span className="mini-linkedin">in</span> LinkedIn draft{" "}
            <Check size={12} />
          </div>
          <div className="engine-core">
            <Zap size={35} fill="currentColor" />
            <small>SCALEMATRIX</small>
          </div>
          <div className="visual-label label-right">
            <Target size={15} /> Next opportunity
          </div>
          <div className="visual-label label-bottom">
            <span className="mini-x">𝕏</span> Your next post{" "}
            <Sparkles size={12} />
          </div>
          <span className="orbit-dot dot-one" />
          <span className="orbit-dot dot-two" />
        </div>
      </section>
      <section className="stat-grid" aria-label="Workspace statistics">
        {stats.map(({ label, value, detail, icon: Icon, color }) => (
          <article className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <div className={`stat-icon ${color}`}>
                <Icon size={17} />
              </div>
            </div>
            <strong>{value.toString().padStart(2, "0")}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <div className="overview-columns">
        <section>
          <div className="section-head">
            <div>
              <span className="overline">YOUR VOICE, AMPLIFIED</span>
              <h2>On your content desk</h2>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("Content studio")}
            >
              View studio
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="desk-grid">
            {selected.length ? (
              selected.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpen={onOpenPost}
                  onCopy={onCopy}
                />
              ))
            ) : (
              <>
                <PostCard
                  post={reference}
                  onOpen={onOpenPost}
                  onCopy={onCopy}
                />
                <article className="post-card new-draft">
                  <div className="post-card-top">
                    <div className="platform-icon twitter">𝕏</div>
                    <span className="platform-name">X / Twitter</span>
                    <Badge>Not generated</Badge>
                  </div>
                  <div className="new-draft-inner">
                    <div className="draft-line" />
                    <div className="draft-line medium" />
                    <div className="draft-line short" />
                    <h3>Big ideas. Fewer characters.</h3>
                    <p>
                      A sharp, standalone X post.
                      <br />
                      Written for your voice, every day.
                    </p>
                    <button
                      className="text-button purple-text"
                      disabled={!canGenerate || busy}
                      onClick={() => onGenerate("content")}
                    >
                      Generate today’s posts
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="post-card-bottom">
                    <span>
                      <CircleDashed size={12} />
                      Waiting for first generation
                    </span>
                  </div>
                </article>
              </>
            )}
          </div>
          <div className="library-note">
            <FolderHeart size={14} />
            <span>
              {selected.length
                ? "Drafts are saved privately. Review, edit, and copy before posting."
                : "Your existing LinkedIn library is connected as writing context. The example above is a saved reference, not a newly generated post."}
            </span>
          </div>
        </section>
        <aside className="daily-plan panel">
          <div className="panel-heading">
            <h2>Your daily rhythm</h2>
            <Clock3 size={17} />
          </div>
          <div className="schedule-time">
            <span>{data.settings.generation_time}</span>
            <Badge
              tone={
                canRunDaily &&
                data.settings.schedule_enabled &&
                data.scheduler_running
                  ? "green"
                  : "neutral"
              }
            >
              {canRunDaily &&
              data.settings.schedule_enabled &&
              data.scheduler_running
                ? "Scheduled"
                : data.settings.schedule_enabled
                  ? "Setup needed"
                  : "Paused"}
            </Badge>
          </div>
          <p className="timezone-label">
            {data.settings.timezone.replaceAll("_", " ")}
          </p>
          <ol className="rhythm">
            <li>
              <span>
                <Linkedin size={15} />
              </span>
              <div>
                <strong>One useful LinkedIn post</strong>
                <small>Practical AI engineering. Your voice.</small>
              </div>
            </li>
            <li>
              <span className="x-small">𝕏</span>
              <div>
                <strong>One sharp X post</strong>
                <small>A standalone idea in 280 characters.</small>
              </div>
            </li>
            <li>
              <span>
                <Target size={15} />
              </span>
              <div>
                <strong>
                  {data.settings.daily_prospect_count} fresh business prospects
                </strong>
                <small>Public sources. A relevant opening.</small>
              </div>
            </li>
            <li>
              <span>
                <ListChecks size={15} />
              </span>
              <div>
                <strong>Ready for your review</strong>
                <small>You decide what goes out.</small>
              </div>
            </li>
          </ol>
          <div className="rhythm-footer">
            <Radio size={14} />
            <span>
              {canRunDaily
                ? "Generation runs while FastAPI is online."
                : "Connect OpenAI & Supabase to start."}
            </span>
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate("Settings")}
          >
            Manage daily workflow
            <ChevronRight size={14} />
          </button>
        </aside>
      </div>
      <section className="panel prospect-preview">
        <div className="panel-heading">
          <div>
            <span className="overline">BUILD YOUR NEXT CONVERSATION</span>
            <h2>Businesses on your radar</h2>
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate("Prospects")}
          >
            All prospects
            <ArrowRight size={14} />
          </button>
        </div>
        {data.prospects.length ? (
          <div className="mini-prospects">
            {data.prospects
              .filter((p) => p.stage !== "archived")
              .slice(0, 4)
              .map((p) => (
                <button key={p.id} onClick={() => onOpenProspect(p)}>
                  <span className="company-avatar">
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.industry} · {p.location}
                    </small>
                  </span>
                  <Badge>{p.stage}</Badge>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
        ) : (
          <div className="radar-empty">
            <div className="radar-glyph">
              <Target size={26} />
            </div>
            <div>
              <h3>Your next clients start with the right research.</h3>
              <p>
                Cleaning, solar, and facility management businesses across your
                selected markets.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => onNavigate("Prospects")}
            >
              Explore prospects
              <ArrowUpRight size={15} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
