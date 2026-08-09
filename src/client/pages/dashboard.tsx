import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "../components/brand";
import { Icon } from "../components/icon";
import { Toggle } from "../components/toggle";
import { api } from "../lib/api";
import { Landing } from "./public";
import type { AuditEvent, Config, Guild, GuildData, IconName, ModerationCase, Ticket, User } from "../types";

function Avatar({ user }: { user: User }) {
  const [error, setError] = useState(false);
  const src = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
    : null;
  if (!src || error)
    return (
      <span className="avatar fallback">{user.username[0].toUpperCase()}</span>
    );
  return <img className="avatar" src={src} alt="" onError={() => setError(true)} />;
}

function GuildIcon({ guild }: { guild: Guild }) {
  const [error, setError] = useState(false);
  const src = guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith("a_") ? "gif" : "png"}?size=128`
    : null;
  if (!src || error)
    return (
      <span>
        {guild.name
          .split(/\s+/)
          .map((word) => word[0])
          .join("")
          .slice(0, 2)}
      </span>
    );
  return <img src={src} alt="" onError={() => setError(true)} />;
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          #{option.name}
        </option>
      ))}
    </select>
  );
}

function Settings({
  data,
  setConfig,
  guildId,
  guildName,
  refresh,
}: {
  data: GuildData;
  setConfig: (config: Config) => void;
  guildId: string;
  guildName: string;
  refresh: (acceptServerConfig?: boolean) => Promise<void>;
}) {
  const config = data.config;
  const text = (en: string, tr: string) => (config.locale === "tr" ? tr : en);
  const patch = (value: Partial<Config>) => setConfig({ ...config, ...value });
  const [reaction, setReaction] = useState({
    channelId: "",
    messageId: "",
    emoji: "✨",
    roleId: "",
  });
  const [command, setCommand] = useState({ name: "", response: "" });
  const [moduleError, setModuleError] = useState("");
  const [setupTemplate, setSetupTemplate] = useState<Config["setupTemplate"]>(
    config.setupTemplate,
  );
  const [setupPreview, setSetupPreview] = useState<Config | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busyTicket, setBusyTicket] = useState<number | null>(null);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketStatus, setTicketStatus] = useState<"all" | Ticket["status"]>("all");
  const reactionLimitReached =
    data.limits.reactionRoles !== null &&
    data.reactionRoles.length >= data.limits.reactionRoles;
  const commandLimitReached =
    data.limits.customCommands !== null &&
    data.customCommands.length >= data.limits.customCommands;
  const visibleTickets = data.tickets.filter(
    (ticket) =>
      (ticketStatus === "all" || ticket.status === ticketStatus) &&
      (!ticketQuery ||
        [ticket.ownerName, ticket.ownerId, ticket.assigneeId || "", ticket.channelId]
          .join(" ")
          .toLowerCase()
          .includes(ticketQuery.toLowerCase())),
  );
  async function createReactionRole() {
    try {
      setModuleError("");
      await api(`/api/guilds/${guildId}/reaction-roles`, {
        method: "POST",
        body: JSON.stringify(reaction),
      });
      setReaction({ channelId: "", messageId: "", emoji: "✨", roleId: "" });
      await refresh();
    } catch (error) {
      setModuleError(
        error instanceof Error
          ? error.message
          : "Could not create reaction role",
      );
    }
  }
  async function createCustomCommand() {
    try {
      setModuleError("");
      await api(`/api/guilds/${guildId}/custom-commands`, {
        method: "POST",
        body: JSON.stringify(command),
      });
      setCommand({ name: "", response: "" });
      await refresh();
    } catch (error) {
      setModuleError(
        error instanceof Error ? error.message : "Could not create command",
      );
    }
  }
  async function remove(
    kind: "reaction-roles" | "custom-commands",
    id: number,
  ) {
    await api(`/api/guilds/${guildId}/${kind}/${id}`, { method: "DELETE" });
    await refresh();
  }
  async function previewSetup() {
    const result = await api<{ config: Config }>(
      `/api/guilds/${guildId}/setup/preview`,
      { method: "POST", body: JSON.stringify({ template: setupTemplate }) },
    );
    setSetupPreview(result.config);
  }
  async function applySetup() {
    const result = await api<{ config: Config }>(
      `/api/guilds/${guildId}/setup/apply`,
      {
        method: "POST",
        body: JSON.stringify({ template: setupTemplate, confirm: true }),
      },
    );
    setConfig(result.config);
    setSetupPreview(null);
    await refresh(true);
  }
  async function ticketAction(id: number, action: "claim" | "close" | "delete") {
    setBusyTicket(id);
    setModuleError("");
    try {
      if (action === "claim")
        await api(`/api/guilds/${guildId}/tickets/${id}`, {
          method: "PATCH",
          body: JSON.stringify({}),
        });
      else if (action === "close")
        await api(`/api/guilds/${guildId}/tickets/${id}/close`, { method: "POST" });
      else
        await api(`/api/guilds/${guildId}/tickets/${id}/transcript`, {
          method: "DELETE",
        });
      await refresh();
    } catch (error) {
      setModuleError(error instanceof Error ? error.message : "Ticket operation failed");
    } finally {
      setBusyTicket(null);
    }
  }
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  useEffect(() => {
    if (!deleteDialogOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleteDialogOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [deleteDialogOpen]);
  async function deleteGuildData() {
    if (deleteConfirmation !== guildName) return;
    await api(`/api/guilds/${guildId}/privacy/delete`, {
      method: "POST",
      body: JSON.stringify({ confirmation: deleteConfirmation }),
    });
    location.reload();
  }
  return (
    <div className="settings-grid">
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon purple"><Icon name="grid" /></div>
          <div>
            <h2>{text("Setup and access", "Kurulum ve erişim")}</h2>
            <p>{text("Choose a starting template, language, and trusted roles.", "Başlangıç şablonunu, dili ve güvenilir rolleri seçin.")}</p>
          </div>
        </div>
        <div className="split-fields">
          <div className="setting-group">
            <label>
              {text("Dashboard and bot language", "Dashboard ve bot dili")}
              <select
                value={config.locale}
                onChange={(event) => patch({ locale: event.target.value as Config["locale"] })}
              >
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </label>
            <label>
              {text("Setup template", "Kurulum şablonu")}
              <select
                value={setupTemplate}
                onChange={(event) => {
                  setSetupTemplate(event.target.value as Config["setupTemplate"]);
                  setSetupPreview(null);
                }}
              >
                <option value="gaming">Gaming</option>
                <option value="creator">Creator</option>
                <option value="support">Product / Support</option>
                <option value="empty">{text("Empty", "Boş")}</option>
              </select>
            </label>
            <div className="button-row">
              <button className="module-button" onClick={previewSetup}>
                {text("Preview template", "Şablonu önizle")}
              </button>
              {setupPreview && (
                <button className="module-button" onClick={applySetup}>
                  {text("Apply confirmed preview", "Onaylanan önizlemeyi uygula")}
                </button>
              )}
            </div>
            {setupPreview && (
              <small>
                {text("Preview:", "Önizleme:")} {[
                  setupPreview.automodEnabled && "AutoMod",
                  setupPreview.joinGuardEnabled && "Join Guard",
                  setupPreview.ticketsEnabled && "Tickets",
                  setupPreview.logsEnabled && "Logs",
                ].filter(Boolean).join(" · ") || text("Manual configuration", "Manuel yapılandırma")}
              </small>
            )}
          </div>
          <div className="setting-group">
            <label>
              {text("Dashboard administrator roles", "Dashboard yönetici rolleri")}
              <select
                multiple
                value={config.dashboardAdminRoleIds}
                onChange={(event) =>
                  patch({
                    dashboardAdminRoleIds: Array.from(event.target.selectedOptions, (item) => item.value),
                  })
                }
              >
                {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label>
              {text("Moderator roles", "Moderatör rolleri")}
              <select
                multiple
                value={config.moderatorRoleIds}
                onChange={(event) =>
                  patch({
                    moderatorRoleIds: Array.from(event.target.selectedOptions, (item) => item.value),
                  })
                }
              >
                {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <small>{text("Use Ctrl/Cmd to select multiple roles.", "Birden fazla rol için Ctrl/Cmd kullanın.")}</small>
            </label>
          </div>
        </div>
      </section>
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon purple">
            <Icon name="spark" />
          </div>
          <div>
            <h2>Member journey</h2>
            <p>Make every arrival and departure feel intentional.</p>
          </div>
        </div>
        <div className="split-fields">
          <div className="setting-group">
            <Toggle
              checked={config.welcomeEnabled}
              onChange={(welcomeEnabled) => patch({ welcomeEnabled })}
              label="Welcome messages"
              hint="Greet new members with a custom embed"
            />
            <label>
              Welcome channel
              <Select
                value={config.welcomeChannelId}
                onChange={(welcomeChannelId) => patch({ welcomeChannelId })}
                options={data.channels}
                placeholder="Choose a channel"
              />
            </label>
            <label>
              Welcome message
              <textarea
                value={config.welcomeMessage}
                onChange={(event) =>
                  patch({ welcomeMessage: event.target.value })
                }
                rows={3}
              />
              <small>Variables: {`{user} {username} {server} {count}`}</small>
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={config.welcomeColor}
                onChange={(event) =>
                  patch({ welcomeColor: event.target.value })
                }
              />
            </label>
          </div>
          <div className="setting-group">
            <Toggle
              checked={config.goodbyeEnabled}
              onChange={(goodbyeEnabled) => patch({ goodbyeEnabled })}
              label="Goodbye messages"
              hint="Acknowledge members when they leave"
            />
            <label>
              Goodbye channel
              <Select
                value={config.goodbyeChannelId}
                onChange={(goodbyeChannelId) => patch({ goodbyeChannelId })}
                options={data.channels}
                placeholder="Choose a channel"
              />
            </label>
            <label>
              Goodbye message
              <textarea
                value={config.goodbyeMessage}
                onChange={(event) =>
                  patch({ goodbyeMessage: event.target.value })
                }
                rows={3}
              />
            </label>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div className="module-icon cyan">
            <Icon name="roles" />
          </div>
          <div>
            <h2>Auto role</h2>
            <p>Give newcomers a starting role.</p>
          </div>
        </div>
        <Toggle
          checked={config.autoRoleEnabled}
          onChange={(autoRoleEnabled) => patch({ autoRoleEnabled })}
          label="Assign on join"
          hint="Astra's role must sit above this role"
        />
        <label>
          Member role
          <select
            value={config.autoRoleId}
            onChange={(event) => patch({ autoRoleId: event.target.value })}
          >
            <option value="">Choose a role</option>
            {data.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div className="module-icon rose">
            <Icon name="log" />
          </div>
          <div>
            <h2>Activity log</h2>
            <p>Keep a clean moderation trail.</p>
          </div>
        </div>
        <Toggle
          checked={config.logsEnabled}
          onChange={(logsEnabled) => patch({ logsEnabled })}
          label="Server logs"
          hint="Member and moderation activity"
        />
        <label>
          Log channel
          <Select
            value={config.logsChannelId}
            onChange={(logsChannelId) => patch({ logsChannelId })}
            options={data.channels}
            placeholder="Choose a channel"
          />
        </label>
      </section>
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon amber">
            <Icon name="shield" />
          </div>
          <div>
            <h2>AutoMod shield</h2>
            <p>Stop unwanted content before it takes over.</p>
          </div>
        </div>
        <Toggle
          checked={config.automodEnabled}
          onChange={(automodEnabled) => patch({ automodEnabled })}
          label="Enable AutoMod"
          hint="Members with Manage Messages bypass filters"
        />
        <div className="filter-grid">
          <Toggle
            checked={config.blockInvites}
            onChange={(blockInvites) => patch({ blockInvites })}
            label="Block invites"
            hint="Remove Discord invite links"
          />
          <Toggle
            checked={config.blockLinks}
            onChange={(blockLinks) => patch({ blockLinks })}
            label="Block links"
            hint="Remove all web links"
          />
          <Toggle
            checked={config.spamEnabled}
            onChange={(spamEnabled) => patch({ spamEnabled })}
            label={text("Flood protection", "Flood koruması")}
            hint={text("Limit rapid messages per member", "Üye başına hızlı mesajları sınırlar")}
          />
          <Toggle
            checked={config.duplicateEnabled}
            onChange={(duplicateEnabled) => patch({ duplicateEnabled })}
            label={text("Repeated messages", "Tekrarlanan mesajlar")}
            hint={text("Remove repeated identical content", "Aynı içeriğin tekrarını kaldırır")}
          />
          <Toggle
            checked={config.mentionSpamEnabled}
            onChange={(mentionSpamEnabled) => patch({ mentionSpamEnabled })}
            label={text("Mention spam", "Etiket spamı")}
            hint={`${text("Maximum mentions", "En fazla etiket")}: ${config.mentionLimit}`}
          />
          <div className="advanced-controls">
            <label>{text("Messages per window", "Pencere başına mesaj")}
              <input type="number" min="3" max="20" value={config.spamMessageLimit} onChange={(event) => patch({ spamMessageLimit: Number(event.target.value) })} />
            </label>
            <label>{text("Window seconds", "Pencere süresi")}
              <input type="number" min="3" max="60" value={config.spamWindowSeconds} onChange={(event) => patch({ spamWindowSeconds: Number(event.target.value) })} />
            </label>
            <label>{text("Duplicate limit", "Tekrar limiti")}
              <input type="number" min="2" max="10" value={config.duplicateMessageLimit} onChange={(event) => patch({ duplicateMessageLimit: Number(event.target.value) })} />
            </label>
            <label>{text("Mention limit", "Etiket limiti")}
              <input type="number" min="2" max="30" value={config.mentionLimit} onChange={(event) => patch({ mentionLimit: Number(event.target.value) })} />
            </label>
          </div>
          <div
            className={`advanced-controls ${data.capabilities.advancedAutomod ? "" : "inline-locked"}`}
          >
            <label>
              Maximum capital letters <b>{config.maxCapsPercent}%</b>
              <input
                type="range"
                min="0"
                max="100"
                disabled={!data.capabilities.advancedAutomod}
                value={config.maxCapsPercent}
                onChange={(event) =>
                  patch({ maxCapsPercent: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Blocked words
              <input
                disabled={!data.capabilities.advancedAutomod}
                value={config.bannedWords.join(", ")}
                onChange={(event) =>
                  patch({
                    bannedWords: event.target.value
                      .split(",")
                      .map((word) => word.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="word, another word"
              />
              <small>
                {data.capabilities.advancedAutomod
                  ? "Separate words with commas"
                  : "Premium plan required"}
              </small>
            </label>
            <Toggle
              checked={config.regexEnabled}
              onChange={(regexEnabled) => patch({ regexEnabled })}
              label={text("Regex rules", "Regex kuralları")}
              hint={text("Premium safe-pattern matching", "Premium güvenli kalıp eşleştirme")}
            />
            <label>
              {text("Blocked patterns", "Engellenen kalıplar")}
              <textarea
                disabled={!data.capabilities.advancedAutomod}
                value={config.regexRules.join("\n")}
                onChange={(event) => patch({ regexRules: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}
                rows={3}
                placeholder="pattern per line"
              />
            </label>
            {!data.capabilities.advancedAutomod && (
              <i className="inline-plan-badge">PREMIUM</i>
            )}
          </div>
        </div>
      </section>
      <section className="module-title span-two">
        <span>EXPANDED MODULES</span>
        <h2>Community systems</h2>
        <p>Set up richer member experiences and self-service tools.</p>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div className="module-icon purple">
            <Icon name="spark" />
          </div>
          <div>
            <h2>Reaction roles</h2>
            <p>
              Let members select their own roles.{" "}
              <b className="usage-count">
                {data.reactionRoles.length}/{data.limits.reactionRoles ?? "∞"}
              </b>
            </p>
          </div>
        </div>
        <div className="compact-fields">
          <label>
            Message channel
            <Select
              value={reaction.channelId}
              onChange={(channelId) => setReaction({ ...reaction, channelId })}
              options={data.channels}
              placeholder="Choose a channel"
            />
          </label>
          <label>
            Message ID
            <input
              value={reaction.messageId}
              onChange={(event) =>
                setReaction({ ...reaction, messageId: event.target.value })
              }
              placeholder="Copy ID from Discord"
            />
          </label>
          <label>
            Emoji
            <input
              value={reaction.emoji}
              onChange={(event) =>
                setReaction({ ...reaction, emoji: event.target.value })
              }
            />
          </label>
          <label>
            Role
            <select
              value={reaction.roleId}
              onChange={(event) =>
                setReaction({ ...reaction, roleId: event.target.value })
              }
            >
              <option value="">Choose a role</option>
              {data.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="module-button"
          onClick={createReactionRole}
          disabled={reactionLimitReached}
        >
          {reactionLimitReached ? "Plan limit reached" : "Add reaction role"}
        </button>
        <div className="module-list">
          {data.reactionRoles.length ? (
            data.reactionRoles.map((item) => (
              <div key={item.id}>
                <span>
                  {item.emoji}{" "}
                  {data.roles.find((role) => role.id === item.roleId)?.name ||
                    "Deleted role"}
                </span>
                <button onClick={() => remove("reaction-roles", item.id)}>
                  Remove
                </button>
              </div>
            ))
          ) : (
            <small>No reaction roles configured.</small>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div className="module-icon cyan">
            <Icon name="sliders" />
          </div>
          <div>
            <h2>Custom commands</h2>
            <p>
              Create simple replies with your own prefix.{" "}
              <b className="usage-count">
                {data.customCommands.length}/{data.limits.customCommands ?? "∞"}
              </b>
            </p>
          </div>
        </div>
        <Toggle
          checked={config.customCommandsEnabled}
          onChange={(customCommandsEnabled) => patch({ customCommandsEnabled })}
          label="Enable custom commands"
          hint="Replies run when a member uses your prefix"
        />
        <div className="compact-fields">
          <label>
            Prefix
            <input
              value={config.prefix}
              maxLength={5}
              onChange={(event) => patch({ prefix: event.target.value })}
            />
          </label>
          <label>
            Command name
            <input
              value={command.name}
              onChange={(event) =>
                setCommand({ ...command, name: event.target.value })
              }
              placeholder="rules"
            />
          </label>
          <label className="wide">
            Response
            <textarea
              value={command.response}
              onChange={(event) =>
                setCommand({ ...command, response: event.target.value })
              }
              rows={2}
              placeholder="Please read #rules before chatting."
            />
          </label>
        </div>
        <button
          className="module-button"
          onClick={createCustomCommand}
          disabled={commandLimitReached}
        >
          {commandLimitReached ? "Plan limit reached" : "Save command"}
        </button>
        <div className="module-list">
          {data.customCommands.length ? (
            data.customCommands.map((item) => (
              <div key={item.id}>
                <span>
                  {config.prefix}
                  {item.name}
                </span>
                <button onClick={() => remove("custom-commands", item.id)}>
                  Remove
                </button>
              </div>
            ))
          ) : (
            <small>No custom commands configured.</small>
          )}
        </div>
      </section>
      <section
        className={`panel ${data.capabilities.joinGuard ? "" : "feature-locked"}`}
      >
        <div className="panel-head">
          <div className="module-icon amber">
            <Icon name="shield" />
          </div>
          <div>
            <h2>Join Guard</h2>
            <p>Stop suspicious new accounts at the door.</p>
          </div>
        </div>
        <Toggle
          checked={config.joinGuardEnabled}
          onChange={(joinGuardEnabled) => patch({ joinGuardEnabled })}
          label="Protect new joins"
          hint="Accounts younger than this limit are removed"
        />
        <label>
          Minimum account age (days)
          <input
            type="number"
            min="0"
            max="365"
            value={config.minimumAccountAgeDays}
            onChange={(event) =>
              patch({ minimumAccountAgeDays: Number(event.target.value) })
            }
          />
        </label>
        {!data.capabilities.joinGuard && (
          <div className="plan-lock-overlay">
            <Icon name="shield" />
            <b>Standard plan required</b>
            <a href="/subscriptions">View plans</a>
          </div>
        )}
      </section>
      <section className={`panel ${data.capabilities.tickets ? "" : "feature-locked"}`}>
        <div className="panel-head"><div className="module-icon cyan"><Icon name="log" /></div><div><h2>Ticket system</h2><p>Private support channels for your members.</p></div></div>
        <Toggle checked={config.ticketsEnabled} onChange={(ticketsEnabled) => patch({ ticketsEnabled })} label="Enable tickets" hint="Use /ticket panel to publish the support button" />
        <label>Ticket category<Select value={config.ticketCategoryId} onChange={(ticketCategoryId) => patch({ ticketCategoryId })} options={data.categories} placeholder="Optional category" /></label>
        <label>Support staff role<select value={config.ticketStaffRoleId} onChange={(event) => patch({ ticketStaffRoleId: event.target.value })}><option value="">Choose a staff role</option>{data.roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
        <label>{text("Transcript retention", "Transcript saklama")}
          <select value={config.ticketRetentionDays} onChange={(event) => patch({ ticketRetentionDays: Number(event.target.value) as Config["ticketRetentionDays"] })}>
            <option value={0}>{text("Do not retain content", "İçeriği saklama")}</option>
            <option value={30}>30 {text("days", "gün")}</option>
            <option value={90}>90 {text("days", "gün")}</option>
          </select>
        </label>
        {config.ticketRetentionDays > 0 && !data.transcriptEncryptionAvailable && (
          <p className="module-error">DATA_ENCRYPTION_KEY {text("is required before transcripts can be stored.", "transcript saklanmadan önce gereklidir.")}</p>
        )}
        {!data.capabilities.tickets && <div className="plan-lock-overlay"><Icon name="shield"/><b>Standard plan required</b><a href="/subscriptions">View plans</a></div>}
      </section>
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon cyan"><Icon name="log" /></div>
          <div><h2>{text("Ticket inbox", "Ticket gelen kutusu")}</h2><p>{text("Assign, close, download, and erase support records.", "Destek kayıtlarını atayın, kapatın, indirin ve silin.")}</p></div>
        </div>
        <div className="compact-fields">
          <label>{text("Search tickets", "Ticket ara")}<input value={ticketQuery} onChange={(event) => setTicketQuery(event.target.value)} placeholder={text("Owner, assignee, or channel", "Sahip, görevli veya kanal")} /></label>
          <label>{text("Status", "Durum")}<select value={ticketStatus} onChange={(event) => setTicketStatus(event.target.value as typeof ticketStatus)}><option value="all">{text("All", "Tümü")}</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="closed">Closed</option></select></label>
        </div>
        <div className="case-list">
          {visibleTickets.length ? visibleTickets.map((ticket) => (
            <div key={ticket.id}>
              <b>#{ticket.id} · {ticket.status} · {ticket.ownerName}</b>
              <span>{ticket.assigneeId ? `${text("Assigned", "Atanan")}: ${ticket.assigneeId}` : text("Unassigned", "Atanmamış")}</span>
              <small>{new Date(ticket.createdAt).toLocaleString(config.locale)}</small>
              <div className="button-row">
                {ticket.status !== "closed" && <button disabled={busyTicket === ticket.id} onClick={() => ticketAction(ticket.id, "claim")}>{text("Claim", "Üstlen")}</button>}
                {ticket.status !== "closed" && <button disabled={busyTicket === ticket.id} onClick={() => ticketAction(ticket.id, "close")}>{text("Close", "Kapat")}</button>}
                {ticket.hasTranscript && <a className="button ghost" href={`/api/guilds/${guildId}/tickets/${ticket.id}/transcript`}>{text("Download", "İndir")}</a>}
                {ticket.hasTranscript && <button disabled={busyTicket === ticket.id} onClick={() => ticketAction(ticket.id, "delete")}>{text("Erase transcript", "Transcripti sil")}</button>}
              </div>
            </div>
          )) : <small>{text("No tickets yet.", "Henüz ticket yok.")}</small>}
        </div>
      </section>
      <section
        className={`panel ${data.capabilities.eventMessages ? "" : "feature-locked"}`}
      >
        <div className="panel-head">
          <div className="module-icon rose">
            <Icon name="log" />
          </div>
          <div>
            <h2>Event messages</h2>
            <p>Celebrate boosts and role changes.</p>
          </div>
        </div>
        <Toggle
          checked={config.boostEnabled}
          onChange={(boostEnabled) => patch({ boostEnabled })}
          label="Boost messages"
          hint="Thank members when they boost"
        />
        <label>
          Boost channel
          <Select
            value={config.boostChannelId}
            onChange={(boostChannelId) => patch({ boostChannelId })}
            options={data.channels}
            placeholder="Choose a channel"
          />
        </label>
        <label>
          Boost message
          <input
            value={config.boostMessage}
            onChange={(event) => patch({ boostMessage: event.target.value })}
          />
        </label>
        <Toggle
          checked={config.roleMessageEnabled}
          onChange={(roleMessageEnabled) => patch({ roleMessageEnabled })}
          label="Role messages"
          hint="Announce member role changes"
        />
        <label>
          Role message channel
          <Select
            value={config.roleMessageChannelId}
            onChange={(roleMessageChannelId) => patch({ roleMessageChannelId })}
            options={data.channels}
            placeholder="Choose a channel"
          />
        </label>
        {!data.capabilities.eventMessages && (
          <div className="plan-lock-overlay">
            <Icon name="shield" />
            <b>Standard plan required</b>
            <a href="/subscriptions">View plans</a>
          </div>
        )}
      </section>
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon rose">
            <Icon name="log" />
          </div>
          <div>
            <h2>Moderation cases</h2>
            <p>
              Review actions completed through Astra's moderation commands.{" "}
              <b className="usage-count">Last {data.limits.moderationCases}</b>
            </p>
          </div>
        </div>
        <Toggle
          checked={config.notifyUsers}
          onChange={(notifyUsers) => patch({ notifyUsers })}
          label="Notify users"
          hint="Send a direct message after a moderation action"
        />
        <div className="case-list">
          {data.cases.length ? (
            data.cases.map((item) => (
              <div key={item.id}>
                <b>
                  #{item.id} {item.action}
                </b>
                <span>{item.reason}</span>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
            ))
          ) : (
            <small>No moderation cases yet.</small>
          )}
        </div>
      </section>
      <section className="panel span-two">
        <div className="panel-head">
          <div className="module-icon amber"><Icon name="shield" /></div>
          <div><h2>{text("Audit trail", "Denetim kaydı")}</h2><p>{text("Configuration, moderation, privacy, and ticket activity.", "Yapılandırma, moderasyon, gizlilik ve ticket hareketleri.")}</p></div>
        </div>
        <div className="case-list">
          {data.auditEvents.length ? data.auditEvents.map((event) => (
            <div key={event.id}>
              <b>#{event.id} · {event.action}</b>
              <span>{event.actorId}{event.targetId ? ` → ${event.targetId}` : ""}</span>
              <small>{new Date(event.createdAt).toLocaleString(config.locale)}</small>
            </div>
          )) : <small>{text("No audit events yet.", "Henüz denetim kaydı yok.")}</small>}
        </div>
      </section>
      <section className="panel span-two danger-panel">
        <div className="panel-head">
          <div className="module-icon rose"><Icon name="shield" /></div>
          <div><h2>{text("Privacy and data", "Gizlilik ve veriler")}</h2><p>{text("Export or permanently erase operational guild data.", "Operasyonel sunucu verilerini dışa aktarın veya kalıcı olarak silin.")}</p></div>
        </div>
        <div className="split-fields">
          <div className="setting-group">
            <a className="button ghost" href={`/api/guilds/${guildId}/privacy/export`}>
              {text("Download guild export", "Sunucu dışa aktarımını indir")}
            </a>
          </div>
          <div className="setting-group">
            <label>{text(`Type “${guildName}” to confirm deletion`, `Silmeyi onaylamak için “${guildName}” yazın`)}
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
            </label>
            <button className="module-button danger-action" disabled={deleteConfirmation !== guildName} onClick={() => setDeleteDialogOpen(true)}>
              {text("Delete operational data", "Operasyonel verileri sil")}
            </button>
            <small>{text("The subscription assignment is preserved.", "Abonelik ataması korunur.")}</small>
          </div>
        </div>
      </section>
      {moduleError && <p className="module-error span-two">{moduleError}</p>}
      {deleteDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDeleteDialogOpen(false)}>
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="module-icon rose"><Icon name="shield" /></div>
            <h2 id="delete-dialog-title">{text("Delete operational data?", "Operasyonel veriler silinsin mi?")}</h2>
            <p>{text("This cannot be undone. Your subscription assignment will remain.", "Bu işlem geri alınamaz. Abonelik ataması korunur.")}</p>
            <div className="dialog-actions">
              <button className="button ghost" onClick={() => setDeleteDialogOpen(false)} autoFocus>{text("Cancel", "İptal")}</button>
              <button className="button danger" onClick={deleteGuildData}>{text("Delete permanently", "Kalıcı olarak sil")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ModeratorWorkspace({ guildId }: { guildId: string }) {
  const [state, setState] = useState<{
    cases: ModerationCase[];
    auditEvents: AuditEvent[];
    tickets: Ticket[];
  }>({ cases: [], auditEvents: [], tickets: [] });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [moderation, ticketData] = await Promise.all([
      api<{ cases: ModerationCase[]; auditEvents: AuditEvent[] }>(
        `/api/guilds/${guildId}/moderation`,
      ),
      api<{ tickets: Ticket[] }>(`/api/guilds/${guildId}/tickets`),
    ]);
    setState({ ...moderation, tickets: ticketData.tickets });
  }, [guildId]);
  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load moderation data"));
  }, [load]);
  async function action(ticket: Ticket, kind: "claim" | "close") {
    try {
      setError("");
      await api(
        kind === "claim"
          ? `/api/guilds/${guildId}/tickets/${ticket.id}`
          : `/api/guilds/${guildId}/tickets/${ticket.id}/close`,
        { method: kind === "claim" ? "PATCH" : "POST", body: kind === "claim" ? "{}" : undefined },
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ticket operation failed");
    }
  }
  return (
    <div className="dashboard-body">
      <div className="welcome-line"><div><p>MODERATOR WORKSPACE</p><h1>Cases and support operations.</h1><span>Configuration changes remain restricted to server administrators.</span></div></div>
      {error && <p className="module-error">{error}</p>}
      <div className="settings-grid">
        <section className="panel span-two"><div className="panel-head"><div className="module-icon rose"><Icon name="shield" /></div><div><h2>Moderation cases</h2><p>Recent actions and AutoMod decisions.</p></div></div><div className="case-list">{state.cases.map((item) => <div key={item.id}><b>#{item.id} · {item.action}</b><span>{item.reason}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>)}</div></section>
        <section className="panel span-two"><div className="panel-head"><div className="module-icon cyan"><Icon name="log" /></div><div><h2>Ticket inbox</h2><p>Claim and close member requests.</p></div></div><div className="case-list">{state.tickets.map((ticket) => <div key={ticket.id}><b>#{ticket.id} · {ticket.status} · {ticket.ownerName}</b><div className="button-row">{ticket.status !== "closed" && <button onClick={() => action(ticket, "claim")}>Claim</button>}{ticket.status !== "closed" && <button onClick={() => action(ticket, "close")}>Close</button>}{ticket.hasTranscript && <a className="button ghost" href={`/api/guilds/${guildId}/tickets/${ticket.id}/transcript`}>Download transcript</a>}</div></div>)}</div></section>
        <section className="panel span-two"><div className="panel-head"><div className="module-icon amber"><Icon name="log" /></div><div><h2>Audit trail</h2><p>Recent operational activity.</p></div></div><div className="case-list">{state.auditEvents.map((event) => <div key={event.id}><b>#{event.id} · {event.action}</b><span>{event.actorId}</span><small>{new Date(event.createdAt).toLocaleString()}</small></div>)}</div></section>
      </div>
    </div>
  );
}

function Dashboard({ me }: { me: { user: User; guilds: Guild[] } }) {
  const [selectedId, setSelectedId] = useState(
    me.guilds.find((guild) => guild.botPresent)?.id || me.guilds[0]?.id || "",
  );
  const [data, setData] = useState<GuildData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baselineConfig, setBaselineConfig] = useState<Config | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dataRef = useRef<GuildData | null>(null);
  const baselineRef = useRef<Config | null>(null);
  const guild = me.guilds.find((item) => item.id === selectedId);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  dataRef.current = data;
  baselineRef.current = baselineConfig;
  const dirty = Boolean(
    data && baselineConfig &&
    JSON.stringify(data.config) !== JSON.stringify(baselineConfig),
  );
  const refresh = useCallback(async (acceptServerConfig = false) => {
    if (!selectedId || !guild?.botPresent || guild.accessLevel === "moderator") return;
    const requestedId = selectedId;
    const value = await api<GuildData>(`/api/guilds/${selectedId}`);
    if (selectedIdRef.current !== requestedId) return;
    const current = dataRef.current;
    const hasUnsavedChanges = Boolean(
      current && baselineRef.current &&
      JSON.stringify(current.config) !== JSON.stringify(baselineRef.current),
    );
    if (hasUnsavedChanges && !acceptServerConfig)
      setData({ ...value, config: current!.config });
    else {
      setData(value);
      setBaselineConfig(value.config);
    }
  }, [selectedId, guild?.botPresent, guild?.accessLevel]);

  useEffect(() => {
    if (!selectedId || !guild?.botPresent || guild.accessLevel === "moderator") {
      setData(null);
      setBaselineConfig(null);
      setLoading(false);
      return;
    }
    let active = true;
    setData(null);
    setBaselineConfig(null);
    setLoading(true);
    setError("");
    refresh()
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, selectedId, guild?.botPresent, guild?.accessLevel]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  useEffect(() => {
    if (!selectedId || !guild?.botPresent || guild.accessLevel === "moderator") return;
    const revalidate = () => {
      if (document.visibilityState === "visible") {
        void refresh().catch(() => undefined);
      }
    };
    const interval = window.setInterval(revalidate, 30_000);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [refresh, selectedId, guild?.botPresent, guild?.accessLevel]);

  async function invite() {
    const { url } = await api<{ url: string }>("/api/invite");
    window.location.href = url;
  }
  async function save() {
    if (!data || !dirty || saving) return;
    const requestedId = selectedId;
    setError("");
    setSaving(true);
    try {
      const result = await api<{ config: Config }>(
        `/api/guilds/${requestedId}/config`,
        {
          method: "PUT",
          body: JSON.stringify(data.config),
        },
      );
      if (selectedIdRef.current !== requestedId) return;
      setData((current) =>
        current ? { ...current, config: result.config } : current,
      );
      setBaselineConfig(result.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  }

  return (
    <div className="app-shell">
      <aside id="server-navigation" className={mobileOpen ? "sidebar open" : "sidebar"} aria-label="Server navigation">
        <div className="side-top">
          <Brand />
          <button ref={closeButtonRef} className="mobile-close" aria-label="Close server navigation" onClick={() => { setMobileOpen(false); menuButtonRef.current?.focus(); }}>
            <Icon name="close" />
          </button>
        </div>
        <p className="side-label">YOUR SERVERS</p>
        <div className="guild-list">
          {me.guilds.map((item) => (
            <button
              className={item.id === selectedId ? "guild active" : "guild"}
              key={item.id}
              onClick={() => {
                if (dirty && !window.confirm("Discard unsaved changes and switch servers?")) return;
                setSelectedId(item.id);
                setMobileOpen(false);
              }}
            >
              <span className="guild-icon">
                <GuildIcon guild={item} />
              </span>
              <span>
                <b>{item.name}</b>
                <small>
                  {item.botPresent ? "Astra connected" : "Setup needed"}
                </small>
              </span>
              <i className={item.botPresent ? "status online" : "status"} />
            </button>
          ))}
        </div>
        <div className="side-user">
          <Avatar user={me.user} />
          <span>
            <b>{me.user.global_name || me.user.username}</b>
            <small>@{me.user.username}</small>
          </span>
          <button onClick={logout} title="Log out">
            <Icon name="arrow" />
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      )}
      <main className="dashboard">
        <header className="topbar">
          <button ref={menuButtonRef} className="menu-button" aria-label="Open server navigation" aria-controls="server-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Icon name="menu" />
          </button>
          <div>
            <span>COMMAND CENTER</span>
            <b>{guild?.name || "Choose a server"}</b>
          </div>
          <div className="top-actions">
            <span className="save-status" role="status" aria-live="polite">
              {error ? <span className="error-toast">{error}</span> : dirty ? "Unsaved changes" : saved ? "Changes saved" : ""}
            </span>
            <a className="billing-link" href="/billing">
              Manage plan
            </a>
            {data && (
              <button className={saved && !dirty ? "save saved" : "save"} onClick={save} disabled={!dirty || saving} aria-busy={saving}>
                {saving ? "Saving…" : saved && !dirty ? (
                  <>
                    <Icon name="check" /> Saved
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
            )}
          </div>
        </header>
        {!guild ? (
          <Empty
            title="No manageable servers"
            text="You need Manage Server permission in a Discord server to configure Astra."
            action="Invite Astra"
            onAction={invite}
          />
        ) : !guild.botPresent ? (
          <Empty
            title="Bring Astra aboard"
            text={`Astra is not connected to ${guild.name} yet. Invite the bot, then return here to unlock every module.`}
            action="Invite to server"
            onAction={invite}
          />
        ) : guild.accessLevel === "moderator" ? (
          <ModeratorWorkspace guildId={guild.id} />
        ) : loading ? (
          <div className="loader">
            <Icon name="orbit" size={42} />
            <span>Syncing with Discord...</span>
          </div>
        ) : data ? (
          <div className="dashboard-body">
            <div className="welcome-line">
              <div>
                <p>SERVER OVERVIEW</p>
                <h1>
                  Good to see you, {me.user.global_name || me.user.username}.
                </h1>
                <span>Your systems are ready to customize.</span>
                <div
                  className={`current-plan ${data.subscription.status === "expired" ? "expired" : data.subscription.plan}`}
                >
                  <b>
                    {data.subscription.status === "expired"
                      ? "Free"
                      : data.subscription.plan === "ai"
                        ? "Astra AI"
                        : data.subscription.plan}{" "}
                    plan
                  </b>
                  {data.subscription.expiresAt && (
                    <small>
                      {data.subscription.status === "expired"
                        ? "Expired"
                        : `Until ${new Date(data.subscription.expiresAt).toLocaleDateString()}`}
                    </small>
                  )}
                </div>
              </div>
              <div className="stats">
                <Stat icon="users" value={data.stats.members} label="Members" />
                <Stat
                  icon="hash"
                  value={data.stats.channels}
                  label="Channels"
                />
                <Stat icon="roles" value={data.stats.roles} label="Roles" />
              </div>
            </div>
            <Settings
              data={data}
              setConfig={(config) => setData({ ...data, config })}
              guildId={selectedId}
              guildName={guild.name}
              refresh={refresh}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: IconName;
  value: number;
  label: string;
}) {
  return (
    <div className="stat">
      <Icon name={icon} />
      <span>
        <b>{value.toLocaleString()}</b>
        <small>{label}</small>
      </span>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit">
        <Icon name="orbit" size={48} />
      </div>
      <h1>{title}</h1>
      <p>{text}</p>
      <button className="button primary" onClick={onAction}>
        {action}
        <Icon name="arrow" />
      </button>
    </div>
  );
}

export function AstraApp() {
  const [state, setState] = useState<{
    loading: boolean;
    me: { user: User; guilds: Guild[] } | null;
  }>({ loading: true, me: null });
  useEffect(() => {
    api<{ user: User; guilds: Guild[] }>("/api/me")
      .then((me) => setState({ loading: false, me }))
      .catch(() => setState({ loading: false, me: null }));
  }, []);
  if (state.loading)
    return (
      <div className="boot">
        <Brand />
        <div className="boot-line">
          <i />
        </div>
      </div>
    );
  return state.me ? <Dashboard me={state.me} /> : <Landing />;
}

