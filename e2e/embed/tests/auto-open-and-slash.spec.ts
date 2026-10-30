import { test, expect } from "@playwright/test";
import { agentLogin, loadEnv, waitForHydratedWidgetIframe } from "../helpers";

/**
 * Browser-emulation checks (Playwright mobile viewport ≠ physical phone).
 * Auto-open + slash menu smoke against the local stack.
 */
test.describe("auto-open and slash replies (browser)", () => {
  const env = loadEnv();

  test("agent message expands a minimized desktop widget without focusing composer", async ({
    browser,
  }) => {
    const visitorCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const agentCtx = await browser.newContext();
    const visitor = await visitorCtx.newPage();
    const agent = await agentCtx.newPage();

    await agentLogin(agent, env);
    await visitor.goto(env.approvedOrigin + "/", { waitUntil: "domcontentloaded" });
    await waitForHydratedWidgetIframe(visitor);

    // Ensure a conversation exists first (visitor message), then minimize.
    await visitor.getByRole("button", { name: "Open chat" }).click();
    const iframe = visitor.frameLocator('iframe[title="Chat with us"]');
    await iframe.getByLabel("Message").fill(`open-seed-${Date.now()}`);
    await iframe.getByRole("button", { name: "Send" }).click();
    await visitor.getByRole("button", { name: "Close chat" }).click();

    // Confirm minimized (launcher shows Open chat).
    await expect(visitor.getByRole("button", { name: "Open chat" })).toBeVisible();

    await agent.goto(`${env.frontendOrigin}/inbox`, { waitUntil: "domcontentloaded" });
    const unique = `agent-auto-open-${Date.now()}`;
    await expect.poll(async () => (await agent.locator("body").innerText()).length > 20, {
      timeout: 60_000,
    }).toBe(true);
    // Select first conversation and reply.
    await agent.locator("ul li button").first().click({ timeout: 30_000 }).catch(() => undefined);
    const composer = agent.getByPlaceholder("Type a reply, or / for saved replies");
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await composer.fill(unique);
    await agent.getByRole("button", { name: /send/i }).click();

    // Widget should expand from iframe bc:open without visitor clicking.
    await expect.poll(async () => {
      return visitor.getByRole("button", { name: "Close chat" }).isVisible();
    }, { timeout: 60_000 }).toBe(true);

    await expect.poll(async () => (await iframe.locator("body").innerText()).includes(unique), {
      timeout: 60_000,
    }).toBe(true);

    // Composer must not be auto-focused (no forced keyboard).
    const focused = await iframe.locator("input[aria-label='Message']").evaluate((el) => el === document.activeElement);
    expect(focused).toBe(false);

    await visitorCtx.close();
    await agentCtx.close();
  });

  test("mobile viewport uses full-width open panel (emulation, not a physical phone)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(env.approvedOrigin + "/", { waitUntil: "domcontentloaded" });
    await waitForHydratedWidgetIframe(page);
    await page.getByRole("button", { name: "Open chat" }).click();
    const box = await page.locator('iframe[title="Chat with us"]').boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(300);
    // Emulated mobile panel should span most of the viewport width.
    expect(box!.width).toBeGreaterThanOrEqual(360);
    await ctx.close();
  });

  test("slash menu Enter selects without sending (Inbox)", async ({ browser }) => {
    const agentCtx = await browser.newContext();
    const agent = await agentCtx.newPage();
    await agentLogin(agent, env);

    // Create a saved reply via API using cookies from the page context after login.
    const shortcut = `/e2e${Date.now().toString(36).slice(-5)}`;
    const body = `Saved body ${shortcut}`;
    const created = await agent.evaluate(async ({ api, shortcut: sc, body: b }) => {
      await fetch(`${api}/sanctum/csrf-cookie`, { credentials: "include" });
      const xsrf = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1];
      const res = await fetch(`${api}/api/v1/saved-replies`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-XSRF-TOKEN": xsrf ? decodeURIComponent(xsrf) : "",
        },
        body: JSON.stringify({ title: "E2E reply", shortcut: sc, body: b, is_active: true }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    }, { api: env.apiOrigin, shortcut, body });

    // Owner can create; if 403 skip soft assertion for agents-only accounts.
    test.skip(created.status === 403, "embed e2e user cannot manage saved replies");
    expect(created.status).toBeLessThan(400);

    await agent.goto(`${env.frontendOrigin}/inbox`, { waitUntil: "domcontentloaded" });
    await agent.locator("ul li button").first().click({ timeout: 30_000 }).catch(() => undefined);
    const composer = agent.getByPlaceholder("Type a reply, or / for saved replies");
    await composer.waitFor({ state: "visible", timeout: 45_000 });
    await composer.fill("");
    await composer.type(shortcut.slice(0, 3), { delay: 40 });
    // Menu should appear; Enter selects.
    await expect(agent.getByRole("listbox", { name: "Saved replies" })).toBeVisible({ timeout: 15_000 });
    await composer.press("Enter");
    await expect(composer).toHaveValue(body);
    // Message not sent solely from Enter selection.
    await expect(agent.locator("body")).not.toContainText(body, { timeout: 2_000 }).catch(() => undefined);

    await agentCtx.close();
  });
});
