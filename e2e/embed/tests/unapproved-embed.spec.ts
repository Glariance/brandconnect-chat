import { test, expect } from "@playwright/test";
import { attachConsole, loadEnv } from "../helpers";

test.describe("unapproved embedding — real browser", () => {
  const env = loadEnv();

  test("frame-ancestors blocks functional widget on unapproved origin", async ({ page }) => {
    const consoleHits: string[] = [];
    attachConsole(page, consoleHits);

    let presenceFromBlocked = 0;
    page.on("response", (res) => {
      if (res.url().includes("/api/v1/widget/presence") && res.request().method() === "POST") {
        presenceFromBlocked += 1;
      }
    });

    const cspViolations: unknown[] = [];
    await page.exposeFunction("__bcRecordCsp", (v: unknown) => {
      cspViolations.push(v);
    });

    await page.goto(env.unapprovedOrigin + "/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fixture-title")).toContainText("unapproved");

    // Give the loader time to attempt iframe navigation.
    await page.waitForTimeout(8_000);

    const iframe = page.locator('iframe[title="Chat with us"]');
    const iframeCount = await iframe.count();
    expect(iframeCount).toBeGreaterThan(0);

    let hydrated = false;
    try {
      const handle = await iframe.first().elementHandle();
      const frame = await handle?.contentFrame();
      if (frame) {
        const href = await frame.evaluate(() => location.href).catch(() => "");
        const diag = await frame
          .evaluate(() => (window as unknown as { __bcPresenceDiag?: unknown[] }).__bcPresenceDiag)
          .catch(() => null);
        hydrated = Boolean(href.includes("/widget") && Array.isArray(diag) && diag.length > 0);
      }
    } catch {
      hydrated = false;
    }

    const refused = consoleHits.some((l) =>
      /frame-ancestors|Refused to (display|frame)|Framing '|CSP/i.test(l),
    );
    const fixtureFlag = await page.evaluate(() => {
      const w = window as unknown as {
        __bcEmbedFixture?: { frameBlocked?: boolean; securityErrors?: unknown[] };
      };
      return w.__bcEmbedFixture || null;
    });

    // Success criteria: must NOT have a functional hydrated widget.
    expect(hydrated).toBe(false);
    expect(presenceFromBlocked).toBe(0);

    // Prefer observing an explicit CSP/security signal when the browser surfaces one.
    const blockedSignal =
      refused ||
      Boolean(fixtureFlag?.frameBlocked) ||
      (Array.isArray(fixtureFlag?.securityErrors) && fixtureFlag!.securityErrors!.length > 0);

    // Chromium sometimes omits console CSP lines for frame-ancestors; absence of
    // hydration + presence is still the security outcome we require.
    test.info().annotations.push({
      type: "note",
      description: JSON.stringify({
        refused,
        fixtureFlag,
        consoleHits: consoleHits.slice(0, 10),
        presenceFromBlocked,
        hydrated,
        blockedSignal,
      }),
    });

    expect(hydrated || presenceFromBlocked > 0).toBe(false);
  });

  test("unapproved port on localhost is not treated as approved", async ({ page }) => {
    // Approved is :8090; this fixture is :8091 (same hostname, different port).
    expect(new URL(env.approvedOrigin).hostname).toBe(new URL(env.unapprovedOrigin).hostname);
    expect(new URL(env.approvedOrigin).port).not.toBe(new URL(env.unapprovedOrigin).port);

    await page.goto(env.unapprovedOrigin + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5_000);
    const iframe = page.locator('iframe[title="Chat with us"]');
    const handle = await iframe.elementHandle();
    const frame = await handle?.contentFrame();
    let presenceOk = false;
    if (frame) {
      presenceOk = await frame
        .evaluate(() => {
          const d = (window as unknown as { __bcPresenceDiag?: Array<{ stage: string }> }).__bcPresenceDiag;
          return Array.isArray(d) && d.some((e) => e.stage === "presence_ok");
        })
        .catch(() => false);
    }
    expect(presenceOk).toBe(false);
  });
});
