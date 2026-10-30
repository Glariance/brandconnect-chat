import { test, expect, type Browser } from "@playwright/test";
import {
  agentLogin,
  attachConsole,
  loadEnv,
  readPresenceDiag,
  waitForHydratedWidgetIframe,
} from "../helpers";

test.describe("approved embedding — real browser", () => {
  const env = loadEnv();
  const unique = `e2e-embed-${Date.now()}`;

  test("presence without launcher, then chat round-trip", async ({ browser }) => {
    const consoleHits: string[] = [];

    const visitorCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const visitor = await visitorCtx.newPage();
    const agent = await agentCtx.newPage();
    attachConsole(visitor, consoleHits);

    const presencePosts: { url: string; status: number; chatOpened?: boolean }[] = [];
    visitor.on("response", async (res) => {
      if (!res.url().includes("/api/v1/widget/presence") || res.request().method() !== "POST") return;
      let chatOpened: boolean | undefined;
      try {
        const json = await res.json();
        chatOpened = json?.data?.chat_opened;
      } catch {
        /* ignore */
      }
      presencePosts.push({ url: res.url(), status: res.status(), chatOpened });
    });

    // Agent dashboard first (isolated context).
    await agentLogin(agent, env);
    await agent.goto(`${env.frontendOrigin}/visitors`, { waitUntil: "domcontentloaded" });

    // Approved parent — do not click launcher.
    await visitor.goto(env.approvedOrigin + "/", { waitUntil: "domcontentloaded" });
    await expect(visitor.getByTestId("fixture-title")).toContainText("approved");

    const hydrated = await waitForHydratedWidgetIframe(visitor);
    expect(hydrated.href).toContain(`/widget?brand=${env.brandPublicId}`);
    expect(consoleHits.some((l) => /frame-ancestors|Refused to (display|frame)/i.test(l))).toBe(false);

    await expect.poll(async () => {
      const ok = presencePosts.find((p) => p.status >= 200 && p.status < 300 && p.chatOpened === false);
      return Boolean(ok);
    }, { timeout: 45_000 }).toBe(true);

    // Live Visitors row (HTTP and/or websocket).
    await expect.poll(async () => {
      const text = await agent.locator("body").innerText();
      return /\d+ visitor/.test(text) && !/0 visitors online/.test(text);
    }, { timeout: 60_000 }).toBe(true);

    const beforeOpenDiag = await readPresenceDiag(visitor);
    expect(beforeOpenDiag?.some((e) => e.stage === "presence_ok")).toBeTruthy();

    const visitorLabelMatch = (await agent.locator("body").innerText()).match(/Visitor #\d+/);
    expect(visitorLabelMatch).toBeTruthy();
    const visitorLabel = visitorLabelMatch![0];

    // Open chat — same visitor identity must remain.
    await visitor.getByRole("button", { name: "Open chat" }).click();

    await expect.poll(async () => {
      const text = await agent.locator("body").innerText();
      return text.includes(visitorLabel) && /\bOpen\b/.test(text);
    }, { timeout: 45_000 }).toBe(true);

    await expect.poll(async () => {
      return presencePosts.some((p) => p.status >= 200 && p.status < 300 && p.chatOpened === true);
    }, { timeout: 30_000 }).toBe(true);

    // Send visitor message inside iframe.
    const iframe = visitor.frameLocator('iframe[title="Chat with us"]');
    const composer = iframe.getByLabel("Message");
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await composer.fill(unique);
    await iframe.getByRole("button", { name: "Send" }).click();

    // Agent inbox
    await agent.goto(`${env.frontendOrigin}/inbox`, { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await agent.locator("body").innerText()).includes(unique), {
      timeout: 60_000,
    }).toBe(true);

    // Click conversation if needed
    const conv = agent.getByText(unique).first();
    await conv.click({ timeout: 15_000 }).catch(() => undefined);

    const reply = `agent-reply-${unique}`;
    const agentComposer = agent.getByPlaceholder(/Write a reply|saved replies/i);
    await agentComposer.waitFor({ state: "visible", timeout: 30_000 });
    await agentComposer.fill(reply);
    await agent.getByRole("button", { name: /send/i }).click();

    await expect.poll(async () => {
      const body = await iframe.locator("body").innerText();
      return body.includes(reply);
    }, { timeout: 60_000 }).toBe(true);

    // No duplicate visitor label explosion on visitors page.
    await agent.goto(`${env.frontendOrigin}/visitors`, { waitUntil: "domcontentloaded" });
    await expect.poll(async () => {
      const text = await agent.locator("body").innerText();
      const matches = text.match(new RegExp(visitorLabel.replace("#", "\\#"), "g")) || [];
      return matches.length >= 1 && matches.length <= 3;
    }, { timeout: 30_000 }).toBe(true);

    const afterDiag = await readPresenceDiag(visitor);
    expect(afterDiag?.some((e) => e.stage === "chat_state" && e.detail === "open")).toBeTruthy();

    // Realtime may be WS or polling fallback; both are valid delivery paths.
    const visitorStatus = await iframe.locator("body").innerText();
    const agentStatus = await agent.locator("body").innerText();
    const deliveryPath =
      /Realtime connected/i.test(agentStatus) ||
      /polling/i.test(agentStatus) ||
      /Realtime unavailable|polling/i.test(visitorStatus);
    expect(deliveryPath).toBe(true);
    test.info().annotations.push({
      type: "delivery",
      description: /Realtime connected/i.test(agentStatus)
        ? "agent_ws"
        : /polling|Realtime unavailable/i.test(visitorStatus + agentStatus)
          ? "polling_fallback"
          : "unknown",
    });

    await visitorCtx.close();
    await agentCtx.close();
  });
});
