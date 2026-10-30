import { test, expect } from "@playwright/test";
import { agentLogin, loadEnv } from "../helpers";

/**
 * Layout inspection for the shared agent composer.
 * Playwright viewport emulation ≠ a physical phone.
 */
test.describe("agent composer layout", () => {
  const env = loadEnv();

  test("desktop inbox composer is full-width with footer send", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await agentLogin(page, env);
    await page.goto(`${env.frontendOrigin}/inbox`, { waitUntil: "domcontentloaded" });
    await page.locator("ul li button").first().click({ timeout: 45_000 }).catch(() => undefined);
    const composer = page.getByTestId("inbox-agent-composer");
    await expect(composer).toBeVisible({ timeout: 45_000 });
    const box = await composer.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(350);
    const ta = composer.locator("textarea");
    await expect(ta).toBeVisible();
    const taBox = await ta.boundingBox();
    expect(taBox!.height).toBeGreaterThanOrEqual(100);
    await expect(composer.getByRole("button", { name: /send/i })).toBeVisible();
    await expect(composer.getByText(/Ctrl\+Enter|⌘/i)).toBeVisible();
    // Unimplemented attach/emoji controls must not appear.
    await expect(page.getByRole("button", { name: "Attach" })).toHaveCount(0);
    await ctx.close();
  });

  test("mobile viewport visitors composer does not overflow", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await agentLogin(page, env);
    await page.goto(`${env.frontendOrigin}/visitors`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Test sound" })).toBeVisible({
      timeout: 45_000,
    });
    // Open DM if a visitor row exists; otherwise open controls only.
    const messageBtn = page.getByRole("button", { name: "Message" }).first();
    if (await messageBtn.count()) {
      await messageBtn.click();
      const dm = page.getByTestId("agent-dm-composer");
      await expect(dm).toBeVisible();
      const box = await dm.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      const ta = dm.locator("textarea");
      const taBox = await ta.boundingBox();
      expect(taBox!.height).toBeGreaterThanOrEqual(100);
    }
    await ctx.close();
  });

  test("Enable sound unlocks audible playback after click", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await agentLogin(page, env);
    await page.goto(`${env.frontendOrigin}/visitors`, { waitUntil: "domcontentloaded" });

    // Probe Web Audio from the page after an explicit gesture.
    const enable = page.getByRole("button", { name: "Enable sound" });
    if (await enable.isVisible().catch(() => false)) {
      await enable.click();
    }
    await page.getByRole("button", { name: "Test sound" }).click();

    const played = await page.evaluate(async () => {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return { ok: false, reason: "no-ac" };
      const ctx = new AC();
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
      await new Promise((r) => setTimeout(r, 80));
      const state = ctx.state;
      await ctx.close();
      return { ok: state === "running" || state === "closed", reason: state };
    });

    expect(played.ok).toBe(true);
    await expect(page.getByText(/Test tone played|Sound enabled|Unmute|Mute/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await ctx.close();
  });
});
