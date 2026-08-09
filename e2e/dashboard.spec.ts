import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { defaultConfig } from "../src/server/config";

const guildId = "223456789012345678";
const me = {
  user: { id: "owner", username: "owner", global_name: "Orbit Owner", avatar: null },
  guilds: [{
    id: guildId,
    name: "Astra Test Guild",
    icon: null,
    botPresent: true,
    accessLevel: "admin",
  }],
};
const guildData = {
  config: defaultConfig,
  subscription: { plan: "premium", status: "active", startsAt: 1, expiresAt: null },
  capabilities: {
    welcomeGoodbye: true,
    autoRole: true,
    basicAutomod: true,
    logs: true,
    moderationCommands: true,
    reactionRoles: true,
    customCommands: true,
    joinGuard: true,
    eventMessages: true,
    advancedAutomod: true,
    aiCommands: false,
    tickets: true,
  },
  limits: { reactionRoles: null, customCommands: null, moderationCases: 100, aiCommandsPerDay: 0 },
  premium: true,
  stats: { members: 1280, channels: 42, roles: 18 },
  channels: [{ id: "123456789012345679", name: "general" }],
  categories: [{ id: "123456789012345680", name: "Support" }],
  roles: [{ id: "123456789012345681", name: "Member", color: "#9876f3" }],
  reactionRoles: [],
  customCommands: [],
  cases: [],
  auditEvents: [],
  tickets: [],
  transcriptEncryptionAvailable: true,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: me }));
  await page.route(`**/api/guilds/${guildId}`, (route) =>
    route.fulfill({ json: guildData }),
  );
});

test("dashboard keeps unsaved changes during background revalidation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Setup and access" })).toBeVisible();
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  const welcome = page.getByRole("checkbox", { name: /Welcome messages/i });
  await page.getByText("Welcome messages", { exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(welcome).toBeChecked();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(welcome).toBeChecked();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("dashboard has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Setup and access" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact || "")))
    .toEqual([]);
});
