import { useEffect, useState, type CSSProperties } from "react";
import astraLogoLarge from "../assets/astra-logo-512.webp";
import { Brand } from "../components/brand";
import { Icon } from "../components/icon";
import { api } from "../lib/api";
import type { BillingOverview, IconName, SiteSettings } from "../types";

export function Landing() {
  return (
    <main className="landing">
      <div className="noise" />
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <nav className="landing-nav">
        <Brand />
        <div className="nav-links">
          <a href="/features">Features</a>
          <a href="/subscriptions">Plans</a>
          <a href="/privacy">Privacy</a>
          <a className="nav-login" href="/api/auth/login">
            Open dashboard <Icon name="arrow" size={16} />
          </a>
        </div>
      </nav>
      <section className="hero">
        <div className="eyebrow">
          <span />
          Built for communities in motion
        </div>
        <h1>
          Your Discord.
          <br />
          <em>In your orbit.</em>
        </h1>
        <p>
          Welcome members, stop chaos, automate the routine, and shape every
          detail from one beautifully simple command center.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="/api/auth/login">
            Launch Astra <Icon name="arrow" />
          </a>
          <a className="button ghost" href="/features">
            Explore modules
          </a>
        </div>
        <div className="orbit-stage" aria-hidden>
          <img className="hero-logo" src={astraLogoLarge} alt="" />
          <div className="ring ring-one">
            <i />
            <i />
            <i />
          </div>
          <div className="ring ring-two">
            <i />
            <i />
          </div>
        </div>
      </section>
      <section className="feature-strip" id="features">
        <article>
          <span>01</span>
          <Icon name="spark" />
          <h2>Warm welcomes</h2>
          <p>Branded arrivals, farewells, and automatic roles.</p>
        </article>
        <article>
          <span>02</span>
          <Icon name="shield" />
          <h2>Quiet protection</h2>
          <p>Adaptive filters and powerful moderation commands.</p>
        </article>
        <article>
          <span>03</span>
          <Icon name="sliders" />
          <h2>Total control</h2>
          <p>Every server keeps its own rules, voice, and style.</p>
        </article>
      </section>
    </main>
  );
}

export function Privacy() {
  const tr = navigator.language.toLowerCase().startsWith("tr");
  return (
    <main className="legal-page">
      <nav className="landing-nav"><a href="/"><Brand /></a><a className="button ghost" href="/">{tr ? "Ana sayfa" : "Home"}</a></nav>
      <article className="legal-card">
        <p className="eyebrow">PRIVACY / GİZLİLİK</p>
        <h1>{tr ? "Veriniz üzerinde kontrol sizde." : "You stay in control of your data."}</h1>
        <p>{tr ? "Astra yalnızca yapılandırma, yetkilendirme, moderasyon ve etkinleştirdiğiniz destek özellikleri için gereken veriyi işler." : "Astra processes only the data needed for configuration, authorization, moderation, and support features you enable."}</p>
        <h2>{tr ? "Saklanan veriler" : "Data we retain"}</h2>
        <ul>
          <li>{tr ? "Sunucu yapılandırması, roller, özel komutlar ve plan ataması" : "Guild configuration, role mappings, custom commands, and plan assignment"}</li>
          <li>{tr ? "7 günlük dashboard oturumları ile moderasyon/audit kayıtları" : "Seven-day dashboard sessions and moderation/audit records"}</li>
          <li>{tr ? "Etkinse AES-256-GCM şifreli ticket transcriptleri; 0, 30 veya 90 gün" : "When enabled, AES-256-GCM encrypted ticket transcripts for 0, 30, or 90 days"}</li>
        </ul>
        <h2>{tr ? "Mesajlar ve AI" : "Messages and AI"}</h2>
        <p>{tr ? "AutoMod mesaj içeriğini kalıcı olarak saklamaz ve AI moderasyonu yapmaz. Yalnızca bir kullanıcı `/ai` komutunu çağırdığında gerekli metin seçili AI sağlayıcısına gönderilir." : "AutoMod does not persist message content and does not use AI moderation. Text is sent to the configured AI provider only when a user invokes an `/ai` command."}</p>
        <h2>{tr ? "Dışa aktarma ve silme" : "Export and deletion"}</h2>
        <p>{tr ? "Sunucu yöneticileri dashboard üzerinden veri dışa aktarabilir. Sunucu sahibi, sunucu adını yazarak operasyonel verileri kalıcı olarak silebilir. Plan ataması dolandırıcılık ve erişim bütünlüğü için korunur." : "Administrators can export guild data from the dashboard. The guild owner can permanently erase operational data by confirming the exact guild name. Plan assignment is retained for access integrity."}</p>
      </article>
    </main>
  );
}

export function Subscriptions() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  useEffect(() => {
    api<SiteSettings>("/api/public/site-settings")
      .then(setSettings)
      .catch(() => null);
  }, []);
  const plans = settings?.plans.filter((plan) => plan.enabled) || [];
  return (
    <main className="subscriptions">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/">Home</a>
          <a className="nav-login" href="/api/auth/login">
            Open dashboard <Icon name="arrow" size={16} />
          </a>
        </div>
      </nav>
      {settings?.announcement && (
        <p className="site-announcement">{settings.announcement}</p>
      )}
      <section className="pricing-hero">
        <p className="eyebrow">
          <span />
          ASTRA PLANS
        </p>
        <h1>
          More orbit.
          <br />
          <em>More possibilities.</em>
        </h1>
        <p>
          {settings?.maintenanceMode
            ? "Plans are temporarily unavailable while Astra is under maintenance."
            : "Astra is free while we prepare subscriptions. Explore the plans that will become available soon."}
        </p>
      </section>
      <section className={`pricing-grid plans-${plans.length}`}>
        {plans.map((plan) => (
          <article className={`price-card ${plan.accent}`} key={plan.id}>
            <div>
              <h2>{plan.name}</h2>
              <p>For one selected Discord server.</p>
            </div>
            <div className="price">
              <b>${plan.monthlyPrice.toFixed(2)}</b>
              <span>/ month</span>
              <small>${plan.yearlyPrice.toFixed(2)} billed yearly</small>
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={16} />
                  {feature}
                </li>
              ))}
            </ul>
            <button disabled>
              {settings?.maintenanceMode ? "Unavailable" : "Coming soon"}
            </button>
          </article>
        ))}
      </section>
      <p className="pricing-note">
        No payment details are collected. Billing is not active yet.
      </p>
    </main>
  );
}

export function BillingPortal() {
  const [overview, setOverview] = useState<BillingOverview | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api<BillingOverview>("/api/billing/overview")
      .then((value) => {
        setOverview(value);
        setSelectedId(value.guilds[0]?.id || "");
      })
      .catch(() =>
        setOverview({ guilds: [], plans: [], paymentsEnabled: false }),
      );
  }, []);
  if (!overview)
    return (
      <div className="boot">
        <Brand />
        <div className="boot-line">
          <i />
        </div>
      </div>
    );
  if (!overview.guilds.length)
    return (
      <main className="billing-page">
        <nav className="landing-nav">
          <a href="/" aria-label="Astra home">
            <Brand />
          </a>
        </nav>
        <section className="billing-empty">
          <h1>No managed servers found.</h1>
          <p>
            Sign in with Discord and invite Astra to a server you manage before
            managing its plan.
          </p>
          <a className="button primary" href="/api/auth/login">
            Sign in with Discord <Icon name="arrow" />
          </a>
        </section>
      </main>
    );
  const guild =
    overview.guilds.find((item) => item.id === selectedId) ||
    overview.guilds[0];
  const planName =
    guild.subscription.status === "expired"
      ? "Free"
      : guild.subscription.plan === "ai"
        ? "Astra AI"
        : guild.subscription.plan;
  return (
    <main className="billing-page">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/subscriptions">Plans</a>
          <a className="nav-login" href="/api/auth/login">
            Dashboard <Icon name="arrow" size={16} />
          </a>
        </div>
      </nav>
      <section className="billing-shell">
        <header className="billing-header">
          <div>
            <p className="eyebrow">
              <span />
              SERVER BILLING
            </p>
            <h1>
              Your plans,
              <br />
              <em>in one orbit.</em>
            </h1>
            <p>
              Choose a server, review its subscription, and select the plan that
              fits your community.
            </p>
          </div>
          <div className="billing-server-picker">
            <span>MANAGING SERVER</span>
            <select
              value={guild.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setNotice("");
              }}
            >
              {overview.guilds.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </header>
        <section className="billing-current">
          <div className={`billing-orb ${guild.subscription.plan}`}>
            <Icon name="orbit" size={31} />
          </div>
          <div>
            <p>CURRENT PLAN</p>
            <h2>{planName}</h2>
            <span>
              {guild.subscription.status === "expired"
                ? "Your subscription ended. Select a plan to continue paid features."
                : guild.subscription.expiresAt
                  ? `Renews or expires on ${new Date(guild.subscription.expiresAt).toLocaleDateString()}`
                  : "No scheduled expiration"}
            </span>
          </div>
          <div className="billing-server-name">
            <b>{guild.name}</b>
            <small>Server subscription</small>
          </div>
        </section>
        <section className={`billing-plan-grid plans-${overview.plans.length}`}>
          {overview.plans.map((plan) => {
            const current =
              guild.subscription.status === "active" &&
              guild.subscription.plan === plan.id;
            return (
              <article
                className={`billing-plan ${plan.accent} ${current ? "current" : ""}`}
                key={plan.id}
              >
                {current && <span className="current-pill">CURRENT PLAN</span>}
                <h2>{plan.name}</h2>
                <p>For {guild.name}</p>
                <strong>
                  ${plan.monthlyPrice.toFixed(2)}
                  <small>/ month</small>
                </strong>
                <span className="annual">
                  ${plan.yearlyPrice.toFixed(2)} billed yearly
                </span>
                <ul>
                  {plan.features.slice(0, 5).map((feature) => (
                    <li key={feature}>
                      <Icon name="check" size={15} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  className={current ? "current-button" : "button primary"}
                  disabled={current}
                  onClick={() =>
                    setNotice(
                      "iyzico checkout is not configured yet. This plan selection will be available once payments are enabled.",
                    )
                  }
                >
                  {current ? "Current plan" : `Choose ${plan.name}`}
                </button>
              </article>
            );
          })}
        </section>
        {notice && <p className="billing-notice">{notice}</p>}
        <p className="billing-footnote">
          Payments are not active yet. No charge is made when selecting a plan.
        </p>
      </section>
    </main>
  );
}

export function Features() {
  const modules: Array<{
    icon: IconName;
    label: string;
    title: string;
    text: string;
    accent: string;
    points: string[];
  }> = [
    {
      icon: "spark",
      label: "MEMBER JOURNEY",
      title: "Every arrival feels intentional.",
      text: "Welcome new members, assign their first role, celebrate boosts, and make departures feel human.",
      accent: "violet",
      points: [
        "Welcome and goodbye embeds",
        "Automatic join roles",
        "Boost and role events",
      ],
    },
    {
      icon: "shield",
      label: "AUTOMOD",
      title: "Quiet protection, always awake.",
      text: "Astra catches disruptive content before it becomes a problem while moderators remain in control.",
      accent: "amber",
      points: [
        "Invite and link filters",
        "Caps and blocked-word detection",
        "New-account Join Guard",
      ],
    },
    {
      icon: "roles",
      label: "SELF SERVICE",
      title: "Roles without the busywork.",
      text: "Members shape their experience through reactions while Astra handles every role change in real time.",
      accent: "cyan",
      points: [
        "Reaction role messages",
        "Automatic add and remove",
        "Per-server role rules",
      ],
    },
    {
      icon: "sliders",
      label: "COMMANDS",
      title: "Your community, your language.",
      text: "Create instant replies and use focused moderation commands without a complicated workflow.",
      accent: "rose",
      points: [
        "Custom command prefixes",
        "Reusable response templates",
        "Slash moderation tools",
      ],
    },
    {
      icon: "log",
      label: "ACCOUNTABILITY",
      title: "A clear trail through every action.",
      text: "Keep moderation cases, activity logs, and optional member notifications in one dependable system.",
      accent: "violet",
      points: [
        "Moderation case history",
        "Configurable activity channels",
        "Direct action notifications",
      ],
    },
    {
      icon: "grid",
      label: "TICKET SUPPORT",
      title: "Private help, without the noise.",
      text: "Give members a direct route to your team through private, organized support tickets.",
      accent: "cyan",
      points: [
        "Private ticket channels",
        "Configurable staff roles",
        "One-click support panels",
      ],
    },
  ];
  return (
    <main className="features-page">
      <div className="noise" />
      <nav className="landing-nav">
        <a href="/" aria-label="Astra home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="/subscriptions">Plans</a>
          <a className="nav-login" href="/api/auth/login">
            Open dashboard <Icon name="arrow" size={16} />
          </a>
        </div>
      </nav>
      <section className="features-hero">
        <div className="features-copy">
          <p className="eyebrow">
            <span />
            MEET ASTRA
          </p>
          <h1>
            A calmer server.
            <br />
            <em>A stronger orbit.</em>
          </h1>
          <p>
            Six connected systems work quietly in the background so your team
            can spend less time managing and more time building community.
          </p>
          <a className="button primary" href="/api/auth/login">
            Add Astra to Discord <Icon name="arrow" />
          </a>
        </div>
        <div className="constellation" aria-hidden>
          <div className="constellation-core">
            <img src={astraLogoLarge} alt="" />
          </div>
          {modules.map((module, index) => (
            <span
              style={{ "--index": index } as CSSProperties}
              key={module.title}
            >
              <Icon name={module.icon} size={18} />
            </span>
          ))}
          <i className="constellation-ring one" />
          <i className="constellation-ring two" />
        </div>
      </section>
      <section className="feature-marquee" aria-hidden>
        <div>
          {[...modules, ...modules].map((module, index) => (
            <span key={`${module.label}-${index}`}>
              <i /> {module.label}
            </span>
          ))}
        </div>
      </section>
      <section className="feature-story">
        {modules.map((module, index) => (
          <article
            className={`feature-chapter ${module.accent}`}
            key={module.title}
          >
            <div className="chapter-number">0{index + 1}</div>
            <div className="chapter-icon">
              <Icon name={module.icon} size={28} />
            </div>
            <div className="chapter-copy">
              <p>{module.label}</p>
              <h2>{module.title}</h2>
              <span>{module.text}</span>
            </div>
            <ul>
              {module.points.map((point) => (
                <li key={point}>
                  <Icon name="check" size={16} />
                  {point}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <section className="automod-demo">
        <div>
          <p className="eyebrow">
            <span />
            LIVE RESPONSE
          </p>
          <h2>
            Chaos enters.
            <br />
            Astra answers.
          </h2>
          <p>
            Rules are evaluated instantly, logged clearly, and applied without
            interrupting healthy conversation.
          </p>
        </div>
        <div className="message-flow">
          <div className="demo-message danger">
            <b>!</b>
            <span>
              <strong>Suspicious invite detected</strong>
              <small>discord.gg/unknown-server</small>
            </span>
          </div>
          <div className="scan-track">
            <i />
          </div>
          <div className="demo-message safe">
            <Icon name="shield" />
            <span>
              <strong>Message removed</strong>
              <small>Action logged in #moderation</small>
            </span>
            <em>42ms</em>
          </div>
        </div>
      </section>
      <section className="features-cta">
        <img src={astraLogoLarge} alt="" />
        <p className="eyebrow">
          <span />
          READY FOR TAKEOFF
        </p>
        <h2>
          Put your community
          <br />
          in Astra's orbit.
        </h2>
        <a className="button primary" href="/api/auth/login">
          Launch command center <Icon name="arrow" />
        </a>
      </section>
    </main>
  );
}


