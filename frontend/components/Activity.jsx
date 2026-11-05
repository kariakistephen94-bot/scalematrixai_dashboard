"use client";

import {
  Activity as ActivityIcon,
  CheckCircle2,
  Clock3,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { dateLabel } from "../lib/api";
import { Badge, EmptyState } from "./ui";

function isInterrupted(run) {
  return (
    run.status === "running" &&
    Date.now() - new Date(run.started_at).getTime() > 20 * 60 * 1000
  );
}

export default function Activity({ data, busy, onGenerate }) {
  return (
    <section>
      <div className="page-title-row">
        <div>
          <span className="overline">A CLEAR RECORD OF THE WORK</span>
          <h2>Your engine, in motion.</h2>
          <p>
            Every run, its outcome, and the next step. No hidden background
            work.
          </p>
        </div>
        <Badge tone="purple">{data.runs.length} recorded runs</Badge>
      </div>
      <div className="panel activity-panel">
        {data.runs.length ? (
          data.runs.map((run) => (
            <article className="activity-item" key={run.id}>
              <div className={`run-icon ${run.status}`}>
                {run.status === "completed" ? (
                  <CheckCircle2 size={21} />
                ) : run.status === "failed" ? (
                  <XCircle size={21} />
                ) : (
                  <Clock3 size={21} />
                )}
              </div>
              <div>
                <div className="activity-title">
                  <h3>
                    {run.run_key?.startsWith("agent:")
                      ? "AI owner research"
                      : run.run_key?.startsWith("quick:")
                        ? "Quick Search"
                        : run.kind === "daily"
                          ? "Daily agency brief"
                          : run.kind === "content"
                            ? "Content generation"
                            : "Prospect discovery"}
                  </h3>
                  <Badge
                    tone={
                      run.status === "completed"
                        ? "green"
                        : run.status === "failed"
                          ? "red"
                          : "purple"
                    }
                  >
                    {isInterrupted(run) ? "Interrupted" : run.status}
                  </Badge>
                </div>
                <p>
                  {run.summary ||
                    (isInterrupted(run)
                      ? "The previous run was interrupted. Retry to continue; already saved drafts will be preserved."
                      : "Researching sources and preparing your workspace…")}
                </p>
                <small>
                  {dateLabel(run.started_at, {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: data.settings.timezone,
                  })}
                </small>
              </div>
              {(run.status === "failed" || isInterrupted(run)) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    onGenerate(
                      run.run_key?.startsWith("agent:")
                        ? "agent"
                        : run.run_key?.startsWith("quick:")
                          ? "quick"
                          : run.kind,
                    )
                  }
                >
                  <RefreshCw size={14} />
                  Retry today
                </button>
              )}
            </article>
          ))
        ) : (
          <EmptyState
            icon={ActivityIcon}
            title="Every run leaves a clear trail."
            description="Daily briefs, generated drafts, and prospect discoveries will appear here once your integrations are connected."
          />
        )}
      </div>
    </section>
  );
}
