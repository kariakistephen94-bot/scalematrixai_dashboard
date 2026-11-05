"use client";

import { useState } from "react";
import {
  Check,
  Clock3,
  Database,
  MapPin,
  KeyRound,
  Save,
  Sparkles,
} from "lucide-react";
import MarketAreas from "./MarketAreas";
import { markets, niches } from "../lib/api";
import { Badge, StatusDot } from "./ui";

export function TargetChoices({ value, options, onChange, label }) {
  const selected = value.split("; ").filter(Boolean);
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choices">
        {options.map((option) => (
          <label
            key={option}
            className={selected.includes(option) ? "selected" : ""}
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() =>
                onChange(
                  (selected.includes(option)
                    ? selected.filter((v) => v !== option)
                    : [...selected, option]
                  ).join("; "),
                )
              }
            />
            <Check size={14} />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DiscoverySource({ value, onChange }) {
  return (
    <label className="field">
      Lead discovery source
      <select
        value={value || "google_maps"}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="google_maps">
          Google Maps: local business listings
        </option>
        <option value="web_research">
          OpenAI web research: source-backed opportunities
        </option>
      </select>
      <small>
        Google Maps discovery does not require an OpenAI key. Content generation
        still uses OpenAI.
      </small>
    </label>
  );
}

export default function WorkspaceSettings({ data, onSave, busy }) {
  const [form, setForm] = useState(data.settings);
  const update = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="settings-layout">
      <form
        className="panel settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.target_industry || !form.target_location) return;
          onSave(form);
        }}
      >
        <div className="panel-heading">
          <div>
            <h2>Make it your growth engine</h2>
            <p>Your targeting and daily generation preferences.</p>
          </div>
          <Sparkles size={20} />
        </div>
        <DiscoverySource
          value={form.prospect_source}
          onChange={(value) => update("prospect_source", value)}
        />
        <TargetChoices
          label="Target niches"
          value={form.target_industry}
          options={niches}
          onChange={(value) => update("target_industry", value)}
        />
        <TargetChoices
          label="Target markets"
          value={form.target_location}
          options={markets}
          onChange={(value) => update("target_location", value)}
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
          Content focus
          <textarea
            value={form.content_focus}
            onChange={(event) => update("content_focus", event.target.value)}
            required
            minLength={5}
            maxLength={500}
            rows={3}
          />
          <small>
            Content follows your AI engineering voice. Prospecting targets are
            separate.
          </small>
        </label>
        <div className="two-fields">
          <label className="field">
            Daily run time
            <input
              type="time"
              value={form.generation_time}
              onChange={(event) =>
                update("generation_time", event.target.value)
              }
              required
            />
          </label>
          <label className="field">
            Businesses per run
            <input
              type="number"
              min="1"
              max="15"
              value={form.daily_prospect_count}
              onChange={(event) =>
                update("daily_prospect_count", Number(event.target.value))
              }
              required
            />
          </label>
        </div>
        <label className="field">
          Timezone
          <select
            value={form.timezone}
            onChange={(event) => update("timezone", event.target.value)}
          >
            <option>America/Los_Angeles</option>
            <option>Europe/London</option>
            <option>Africa/Lagos</option>
            <option>UTC</option>
          </select>
        </label>
        <label className="toggle-row">
          <div>
            <strong>Daily generation</strong>
            <small>
              One LinkedIn draft, one X post, and a fresh prospect shortlist.
            </small>
          </div>
          <input
            type="checkbox"
            role="switch"
            checked={form.schedule_enabled}
            onChange={(event) =>
              update("schedule_enabled", event.target.checked)
            }
          />
        </label>
        <div className="form-footer">
          <small>FastAPI must remain running for daily generation.</small>
          <button
            className="button"
            disabled={
              busy ||
              !data.storage_connected ||
              !form.target_industry ||
              !form.target_location
            }
          >
            <Save size={15} />
            Save preferences
          </button>
        </div>
      </form>
      <aside>
        <div className="panel integration-panel">
          <div className="panel-heading">
            <h2>Your connections</h2>
            <KeyRound size={17} />
          </div>
          <Connection
            name="OpenAI"
            detail={data.model}
            ready={data.openai_configured}
            icon={Sparkles}
          />
          <Connection
            name="Google Maps"
            detail="Places API (New) · live business data"
            ready={data.maps_configured}
            icon={MapPin}
          />
          <Connection
            name="Supabase"
            detail="Database & durable history"
            ready={data.storage_connected}
            icon={Database}
          />
          <Connection
            name="Daily scheduler"
            detail={
              data.scheduler_running
                ? data.settings.timezone
                : "Restart backend to enable"
            }
            ready={
              data.scheduler_running &&
              (data.openai_configured || data.maps_configured) &&
              data.storage_connected &&
              data.settings.schedule_enabled
            }
            icon={Clock3}
          />
          <p className="connection-footnote">
            Connection indicators show configuration. Model access is confirmed
            when a generation succeeds.
          </p>
        </div>
        <div className="panel env-note">
          <Badge tone="purple">LOCAL CONFIGURATION</Badge>
          <h3>Keys stay on the server.</h3>
          <p>
            Add these to <code>backend/.env</code>, then restart FastAPI:
          </p>
          <code className="env-list">
            GOOGLE_MAPS_API_KEY
            <br />
            OPENAI_API_KEY
            <br />
            SUPABASE_URL
            <br />
            SUPABASE_SECRET_KEY
          </code>
          <p>
            Run <code>supabase/migrations/001_workspace.sql</code> in your
            Supabase SQL Editor, followed by <code>002_google_maps.sql</code>.
            No keys are stored in your browser.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Connection({ name, detail, ready, icon: Icon }) {
  return (
    <div className="connection-row">
      <div className="connection-icon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <StatusDot ready={ready} />
    </div>
  );
}
