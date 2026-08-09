import { useEffect, useState } from "react";
import { Brand } from "../components/brand";
import { Icon } from "../components/icon";
import { Toggle } from "../components/toggle";
import { api } from "../lib/api";
import type { DeveloperGuildSubscription, Plan, SiteSettings, SubscriptionPlan } from "../types";

export function DeveloperPanel() {
  const [settings, setSettings] = useState<SiteSettings | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api<SiteSettings>("/api/developer/settings")
      .then(setSettings)
      .catch((error) =>
        setError(error instanceof Error ? error.message : "Access denied"),
      );
  }, []);
  if (error)
    return (
      <main className="developer-page">
        <nav className="landing-nav">
          <a href="/" aria-label="Astra home">
            <Brand />
          </a>
        </nav>
        <section className="developer-empty">
          <h1>Developer access required.</h1>
          <p>
            Add your Discord user ID to <code>DEVELOPER_DISCORD_IDS</code> in
            `.env`, restart the server, then sign in again.
          </p>
        </section>
      </main>
    );
  if (!settings)
    return (
      <div className="boot">
        <Brand />
        <div className="boot-line">
          <i />
        </div>
      </div>
    );
  const updatePlan = (index: number, value: Partial<Plan>) =>
    setSettings({
      ...settings,
      plans: settings.plans.map((plan, current) =>
        current === index ? { ...plan, ...value } : plan,
      ),
    });
  const save = async () => {
    try {
      const updated = await api<SiteSettings>("/api/developer/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    }
  };
  return (
    <main className="developer-page">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/developer/premium">Subscriptions</a>
          <a href="/developer/ai">AI connection</a>
          <a href="/subscriptions">View plans</a>
          <a className="nav-login" href="/">
            Back to site
          </a>
        </div>
      </nav>
      <section className="developer-shell">
        <div className="developer-head">
          <div>
            <p className="eyebrow">
              <span />
              PRIVATE CONSOLE
            </p>
            <h1>Developer controls</h1>
            <p>
              Manage public plan content and site-wide notices. Payments remain
              disabled.
            </p>
          </div>
          <button className="button primary" onClick={save}>
            {saved ? "Saved" : "Save changes"}
          </button>
        </div>
        <section className="developer-card">
          <h2>Site status</h2>
          <Toggle
            checked={settings.maintenanceMode}
            onChange={(maintenanceMode) =>
              setSettings({ ...settings, maintenanceMode })
            }
            label="Maintenance mode"
            hint="Displays an unavailable state on the plans page"
          />
          <label>
            Announcement
            <input
              value={settings.announcement}
              onChange={(event) =>
                setSettings({ ...settings, announcement: event.target.value })
              }
              placeholder="Optional message for all visitors"
            />
          </label>
        </section>
        <div className="developer-plans">
          {settings.plans.map((plan, index) => (
            <section className="developer-card" key={plan.id}>
              <h2>{plan.name} plan</h2>
              <Toggle
                checked={plan.enabled}
                onChange={(enabled) => updatePlan(index, { enabled })}
                label="Publicly available"
                hint="Show this plan on the subscriptions page"
              />
              <div className="developer-fields">
                <label>
                  Plan name
                  <input
                    value={plan.name}
                    onChange={(event) =>
                      updatePlan(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Monthly price (USD)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={plan.monthlyPrice}
                    onChange={(event) =>
                      updatePlan(index, {
                        monthlyPrice: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Yearly price (USD)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={plan.yearlyPrice}
                    onChange={(event) =>
                      updatePlan(index, {
                        yearlyPrice: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="wide">
                  Features, one per line
                  <textarea
                    rows={8}
                    value={plan.features.join("\n")}
                    onChange={(event) =>
                      updatePlan(index, {
                        features: event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
            </section>
          ))}
        </div>
        {error && <p className="module-error">{error}</p>}
      </section>
    </main>
  );
}

function SubscriptionEditor({ guild }: { guild: DeveloperGuildSubscription }) {
  const [plan, setPlan] = useState<SubscriptionPlan>(guild.subscription.plan);
  const [expiresAt, setExpiresAt] = useState(
    guild.subscription.expiresAt
      ? new Date(guild.subscription.expiresAt).toISOString().slice(0, 10)
      : "",
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const save = async () => {
    setState("saving");
    try {
      await api(`/api/developer/subscriptions/${guild.id}`, {
        method: "PUT",
        body: JSON.stringify({
          plan,
          expiresAt: expiresAt ? `${expiresAt}T23:59:59.999Z` : null,
        }),
      });
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  };
  return (
    <article className="subscription-row">
      <div>
        <b>{guild.name}</b>
        <small>
          {guild.memberCount.toLocaleString()} members · {guild.id}
        </small>
      </div>
      <select
        value={plan}
        onChange={(event) => setPlan(event.target.value as SubscriptionPlan)}
      >
        <option value="free">Free</option>
        <option value="standard">Standard</option>
        <option value="premium">Premium</option>
        <option value="ai">Astra AI</option>
      </select>
      <input
        type="date"
        value={expiresAt}
        onChange={(event) => setExpiresAt(event.target.value)}
        aria-label="Expiration date"
      />
      <button onClick={save} disabled={state === "saving"}>
        {state === "saving"
          ? "Saving..."
          : state === "saved"
            ? "Saved"
            : state === "error"
              ? "Try again"
              : "Apply"}
      </button>
    </article>
  );
}

export function PremiumAccessPanel() {
  const [guilds, setGuilds] = useState<DeveloperGuildSubscription[] | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    api<DeveloperGuildSubscription[]>("/api/developer/subscriptions")
      .then(setGuilds)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Access denied"),
      );
  }, []);
  return (
    <main className="developer-page">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/developer">Plan editor</a>
          <a className="nav-login" href="/">
            Back to site
          </a>
        </div>
      </nav>
      <section className="developer-shell">
        <div className="developer-head">
          <div>
            <p className="eyebrow">
              <span />
              PRIVATE CONSOLE
            </p>
            <h1>Server subscriptions</h1>
            <p>
              Assign plans and expiration dates while payment processing is
              disabled.
            </p>
          </div>
        </div>
        {error ? (
          <section className="developer-card">
            <h2>Access unavailable</h2>
            <p className="module-error">{error}</p>
          </section>
        ) : guilds ? (
          <section className="developer-card subscription-manager">
            <div className="subscription-manager-head">
              <h2>Connected servers</h2>
              <span>{guilds.length} servers</span>
            </div>
            {guilds.length ? (
              guilds.map((guild) => (
                <SubscriptionEditor key={guild.id} guild={guild} />
              ))
            ) : (
              <p>No connected servers.</p>
            )}
          </section>
        ) : (
          <div className="loader">
            <Icon name="orbit" size={42} />
            <span>Loading access controls...</span>
          </div>
        )}
      </section>
    </main>
  );
}

export function AiProviderPanel() {
  const [settings, setSettings] = useState<SiteSettings | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api<SiteSettings>("/api/developer/settings")
      .then(setSettings)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Access denied"),
      );
  }, []);
  const defaults = {
    openai: "gpt-4o-mini",
    openrouter: "openai/gpt-4o-mini",
    gemini: "gemini-2.0-flash",
    moonshot: "moonshot-v1-8k",
    custom: "your-model-id",
  };
  const changeProvider = (aiProvider: SiteSettings["aiProvider"]) =>
    settings &&
    setSettings({
      ...settings,
      aiProvider,
      aiModel: defaults[aiProvider],
      aiBaseUrl: aiProvider === "custom" ? settings.aiBaseUrl : "",
    });
  const save = async () => {
    if (!settings) return;
    try {
      const updated = await api<SiteSettings>("/api/developer/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    }
  };
  return (
    <main className="developer-page">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/developer">Plan editor</a>
          <a href="/developer/premium">AI access</a>
          <a className="nav-login" href="/">
            Back to site
          </a>
        </div>
      </nav>
      <section className="developer-shell">
        <div className="developer-head">
          <div>
            <p className="eyebrow">
              <span />
              PRIVATE CONSOLE
            </p>
            <h1>AI connection</h1>
            <p>
              Change Astra's moderation provider and default model without
              changing application code.
            </p>
          </div>
          {settings && (
            <button className="button primary" onClick={save}>
              {saved ? "Saved" : "Save connection"}
            </button>
          )}
        </div>
        {error ? (
          <section className="developer-card">
            <p className="module-error">{error}</p>
          </section>
        ) : settings ? (
          <section className="developer-card ai-connection-card">
            <h2>Default moderation provider</h2>
            <div className="developer-fields">
              <label>
                Provider
                <select
                  value={settings.aiProvider}
                  onChange={(event) =>
                    changeProvider(
                      event.target.value as SiteSettings["aiProvider"],
                    )
                  }
                >
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="moonshot">Moonshot AI</option>
                  <option value="custom">Custom OpenAI-compatible API</option>
                </select>
              </label>
              <label>
                Default model
                <input
                  value={settings.aiModel}
                  onChange={(event) =>
                    setSettings({ ...settings, aiModel: event.target.value })
                  }
                  placeholder={defaults[settings.aiProvider]}
                />
              </label>
              {settings.aiProvider === "custom" && (
                <label className="wide">
                  API base URL
                  <input
                    value={settings.aiBaseUrl}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        aiBaseUrl: event.target.value,
                      })
                    }
                    placeholder="https://api.example.com/v1"
                  />
                </label>
              )}
            </div>
            <div className="api-key-note">
              <Icon name="shield" />
              <span>
                <b>API keys remain private</b>
                <small>
                  Configure{" "}
                  {settings.aiProvider === "openai"
                    ? "OPENAI_API_KEY"
                    : settings.aiProvider === "openrouter"
                      ? "OPENROUTER_API_KEY"
                      : settings.aiProvider === "gemini"
                        ? "GEMINI_API_KEY"
                        : settings.aiProvider === "moonshot"
                          ? "MOONSHOT_API_KEY"
                          : "AI_API_KEY"}{" "}
                  in the server environment. Keys are never returned to this
                  page.
                </small>
              </span>
            </div>
          </section>
        ) : (
          <div className="loader">
            <Icon name="orbit" size={42} />
            <span>Loading AI settings...</span>
          </div>
        )}
      </section>
    </main>
  );
}


