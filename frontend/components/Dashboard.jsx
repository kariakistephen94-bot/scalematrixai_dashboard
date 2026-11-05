"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FileText,
  LayoutDashboard,
  Loader2,
  Menu,
  Mail,
  RefreshCw,
  Send,
  Film,
  Settings2,
  Sparkles,
  Target,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { api, defaults } from "../lib/api";
import references from "../lib/reference-posts.json";
import CRM from "./CRM";
import SocialLeads from "./SocialLeads";
import Emails from "./Emails";
import Agent from "./Agent";
import Outreach from "./Outreach";
import Projects from "./Projects";
import Overview from "./Overview";
import ContentStudio from "./ContentStudio";
import Prospects from "./Prospects";
import Activity from "./Activity";
import WorkspaceSettings from "./WorkspaceSettings";
import { DiscoveryDialog, PostEditor, ProspectEditor } from "./Editors";
import { Badge, StatusDot } from "./ui";

const navigation = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Content studio", icon: FileText },
  { name: "Prospects", icon: Target },
  { name: "Social Leads", icon: UsersRound },
  { name: "Emails", icon: Mail },
  { name: "CRM", icon: BookOpen },
  { name: "Outreach", icon: Send },
  { name: "Projects", icon: Film },
  { name: "AI Agent", icon: Sparkles },
  { name: "Activity", icon: ActivityIcon },
  { name: "Settings", icon: Settings2 },
];
const initial = {
  posts: [],
  prospects: [],
  runs: [],
  references,
  settings: defaults,
  storage_connected: false,
  openai_configured: false,
  maps_configured: false,
  maps_lead_count: 0,
  model: "gpt-5.4-mini",
  scheduler_running: false,
};

export default function Dashboard() {
  const [data, setData] = useState(initial);
  const [page, setPage] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [activePost, setActivePost] = useState(null);
  const [activeProspect, setActiveProspect] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [crmSeed, setCRMSeed] = useState(null);
  const [sidebar, setSidebar] = useState(false);
  const notifiedRuns = useRef(new Set());
  const activeRuns = data.runs.some(
    (run) =>
      run.status === "running" &&
      new Date(run.started_at).getTime() > Date.now() - 20 * 60000,
  );
  const canGenerate =
    data.storage_connected && data.openai_configured && !offline;
  const canDiscover = data.storage_connected && !offline;
  const canRunDaily =
    data.storage_connected &&
    (data.openai_configured || data.maps_configured) &&
    !offline;
  const inProgress = busy || activeRuns;
  const refresh = useCallback(async () => {
    try {
      const result = await api("dashboard");
      setData(result);
      setOffline("");
    } catch (error) {
      setOffline(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const interval = setInterval(refresh, activeRuns ? 4000 : 30000);
    return () => clearInterval(interval);
  }, [refresh, activeRuns]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    for (const run of data.runs) {
      if (run.status === "running") notifiedRuns.current.add(run.id);
      else if (notifiedRuns.current.has(run.id)) {
        setToast(
          run.status === "completed"
            ? "Your brief is ready. Review your new content and prospects."
            : "The run needs attention. See Activity for details.",
        );
        notifiedRuns.current.delete(run.id);
      }
    }
  }, [data.runs]);

  function navigate(name) {
    setPage(name);
    setSidebar(false);
  }
  function addToCRM(lead, source) {
    setCRMSeed({
      company:
        source === "google_maps"
          ? `${lead.niche} · ${lead.search_city}`
          : lead.name,
      source_type: source,
      source_id: lead.id,
      business:
        source === "google_maps" && lead.details
          ? {
              name: lead.details.displayName?.text,
              phone:
                lead.details.internationalPhoneNumber ||
                lead.details.nationalPhoneNumber,
              website: lead.details.websiteUri,
              address: lead.details.formattedAddress,
              place_id: lead.place_id,
              maps_url: lead.details.googleMapsUri,
              attributions: lead.details.attributions || [],
              status: lead.details.websiteUri
                ? "phone_and_website"
                : "phone_only",
            }
          : source === "web_research"
            ? {
                name: lead.name,
                website: lead.website,
                address: lead.location,
                status: "web_research",
              }
            : null,
    });
    navigate("CRM");
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied. Review it once more before sharing.");
    } catch {
      setToast(
        "Clipboard unavailable. Select and copy the text in the editor.",
      );
    }
  }
  async function generate(kind) {
    if (inProgress || !(kind === "content" ? canGenerate : canRunDaily)) return;
    setBusy(true);
    try {
      const result = await api(`generate/${kind}`, {
        method: "POST",
        body: "{}",
      });
      setToast(
        result.already_exists
          ? "A run already exists for this selection today. See Activity for its status."
          : "Research started. You can keep working while your brief is prepared.",
      );
      await refresh();
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(form) {
    setBusy(true);
    try {
      await api("settings", { method: "PUT", body: JSON.stringify(form) });
      await refresh();
      setToast("Daily workflow preferences saved.");
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function discover(form) {
    if (inProgress || !canDiscover) return;
    setBusy(true);
    try {
      const result = await api("search/quick", {
        method: "POST",
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          workspace: form,
        }),
      });
      setDiscovering(false);
      navigate("Prospects");
      setToast(
        result.already_exists
          ? "This search is already running. See Activity."
          : "Prospect research started. We’ll save source-backed matches as they’re ready.",
      );
      await refresh();
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  }
  const pageDescriptions = {
    Emails:
      "Published founder emails. US solar businesses. Sources you can check.",
    "Social Leads":
      "Business profiles, clear sources, and a relevant opening message.",
    "AI Agent": "Owner research, sources, and outreach drafts for your review.",
    Overview: "A little clarity. A lot of forward motion.",
    "Content studio": "Your ideas, sharpened and ready for review.",
    Prospects: "The right businesses. A relevant reason to connect.",
    CRM: "Turn good conversations into lasting client relationships.",
    Outreach:
      "150 fresh leads a day, paced WhatsApp messages, and who replied.",
    Projects:
      "Upload demos of what you’ve built. They go live on your website.",
    Activity: "Know what ran, what worked, and what needs a look.",
    Settings: "A workflow built around the way you work.",
  };
  const date = new Date(data.server_time || Date.now()).toLocaleDateString(
    "en-US",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: data.settings.timezone,
    },
  );
  return (
    <div className="workspace">
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a href="/" className="dashboard-brand">
          <img
            className="dashboard-logo-symbol"
            src="/favicon.svg"
            alt="ScaleMatrix AI"
            width="44"
            height="44"
          />
          <small>AGENCY WORKSPACE</small>
        </a>
        <div className="workspace-selector">
          <span className="workspace-avatar">SM</span>
          <span>
            <strong>ScaleMatrix AI</strong>
            <small>Personal workspace</small>
          </span>
          <Badge>LOCAL</Badge>
        </div>
        <span className="nav-caption">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "active" : ""}`}
              onClick={() => navigate(name)}
              aria-current={page === name ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Content studio" &&
                data.posts.filter((p) => p.status === "draft").length > 0 && (
                  <span className="nav-count">
                    {data.posts.filter((p) => p.status === "draft").length}
                  </span>
                )}
              {name === "Overview" && <span className="active-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-engine">
          <div className="engine-mini">
            <Sparkles size={17} />
            <span>YOUR GROWTH ENGINE</span>
          </div>
          <strong>
            Better groundwork.
            <br />
            Better next moves.
          </strong>
          <p>
            Content and opportunities,
            <br />
            prepared for you every day.
          </p>
          <button onClick={() => navigate("Settings")}>
            Manage your engine
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <StatusDot ready={!offline && !loading} />
            Local workspace<span>v1.0</span>
          </div>
          <div className="profile">
            <span className="profile-avatar">S</span>
            <span>
              <strong>Stephen</strong>
              <small>Agency owner</small>
            </span>
            <button
              className="icon-button"
              onClick={() => navigate("Settings")}
              aria-label="Open settings"
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebar(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace
              <ChevronRight size={13} />
              <strong>{page}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="button"
              disabled={!canDiscover || inProgress}
              onClick={() => discover(data.settings)}
            >
              <Target size={15} />
              {inProgress ? "Research running…" : "Quick Search"}
            </button>
            <span className="private-label">
              <span />
              Private workspace
            </span>
            <button
              className="icon-button"
              onClick={() => {
                refresh();
                setToast("Refreshing your workspace…");
              }}
              aria-label="Refresh workspace"
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              onClick={() => navigate("Activity")}
              aria-label="View activity"
            >
              <Bell size={17} />
              {activeRuns && <span className="notification-dot" />}
            </button>
            <span className="topbar-avatar">S</span>
          </div>
        </header>
        <main id="workspace-main" className="main-content">
          <div className="page-heading">
            <div>
              <div className="heading-kicker">
                SCALEMATRIX AI / {page.toUpperCase()}
              </div>
              <h1>
                {page === "Overview" ? "Good things start with a plan." : page}
              </h1>
              <p>{pageDescriptions[page]}</p>
            </div>
            <span className="date-badge">
              <CalendarDays size={15} />
              {date}
            </span>
          </div>
          {(offline || !canGenerate || data.storage_error) && (
            <div className="setup-banner">
              <span className="setup-icon">
                <Sparkles size={17} />
              </span>
              <div>
                <strong>
                  {loading
                    ? "Opening your workspace…"
                    : offline
                      ? "Your backend needs a connection."
                      : "A quick setup, then you’re off."}
                </strong>
                <p>
                  {offline ||
                    data.storage_error ||
                    "Add your OpenAI key and Supabase project details to backend/.env, then apply the database migration."}
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => navigate("Settings")}
              >
                Finish setup
                <ArrowRightIcon />
              </button>
            </div>
          )}
          {activeRuns && (
            <div className="running-banner" role="status">
              <Loader2 size={16} className="spin" />
              Your engine is researching sources and preparing your brief.
              <button onClick={() => navigate("Activity")}>
                View progress →
              </button>
            </div>
          )}
          {page === "Overview" && (
            <Overview
              data={data}
              canGenerate={canGenerate}
              canRunDaily={canRunDaily}
              busy={inProgress}
              onGenerate={generate}
              onNavigate={navigate}
              onOpenPost={setActivePost}
              onCopy={copy}
              onOpenProspect={setActiveProspect}
            />
          )}
          {page === "Content studio" && (
            <ContentStudio
              data={data}
              canGenerate={canGenerate}
              busy={inProgress}
              onGenerate={generate}
              onOpen={setActivePost}
              onCopy={copy}
            />
          )}
          {page === "Prospects" && (
            <Prospects
              data={data}
              canGenerate={canDiscover}
              busy={inProgress}
              onDiscover={() => setDiscovering(true)}
              onQuickSearch={() => discover(data.settings)}
              onAddCRM={addToCRM}
              onOpen={setActiveProspect}
            />
          )}
          {page === "Social Leads" && <SocialLeads notify={setToast} />}
          {page === "Emails" && <Emails notify={setToast} />}
          {page === "AI Agent" && <Agent notify={setToast} />}
          {page === "Outreach" && <Outreach notify={setToast} />}
          {page === "Projects" && <Projects notify={setToast} />}
          {page === "CRM" && (
            <CRM
              data={data}
              notify={setToast}
              onSearch={() => discover(data.settings)}
              searching={inProgress}
              seed={crmSeed}
              onSeedUsed={() => setCRMSeed(null)}
            />
          )}
          {page === "Activity" && (
            <Activity
              data={data}
              busy={inProgress}
              onGenerate={(kind) =>
                kind === "agent"
                  ? navigate("AI Agent")
                  : kind === "quick"
                    ? discover(data.settings)
                    : generate(kind)
              }
            />
          )}
          {page === "Settings" && (
            <WorkspaceSettings
              key={JSON.stringify(data.settings)}
              data={data}
              busy={busy}
              onSave={saveSettings}
            />
          )}
          <footer className="workspace-footer">
            <span>
              <Zap size={12} />
              SCALEMATRIX AI<span>Built for your next stage.</span>
            </span>
            <span>Research → Create → Review → Grow</span>
          </footer>
        </main>
      </div>
      {activePost && (
        <PostEditor
          post={activePost}
          onClose={() => setActivePost(null)}
          onSaved={refresh}
          notify={setToast}
          copy={copy}
        />
      )}
      {activeProspect && (
        <ProspectEditor
          prospect={activeProspect}
          onClose={() => setActiveProspect(null)}
          onSaved={refresh}
          notify={setToast}
          copy={copy}
        />
      )}
      {discovering && (
        <DiscoveryDialog
          settings={data.settings}
          connections={data}
          onClose={() => setDiscovering(false)}
          onDiscover={discover}
          busy={busy}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ArrowRightIcon() {
  return <ChevronRight size={14} />;
}
