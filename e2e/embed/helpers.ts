import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, ConsoleMessage } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));

export type EmbedEnv = {
  email: string;
  password: string;
  brandId: number;
  brandPublicId: string;
  brandBPublicId?: string;
  approvedOrigin: string;
  unapprovedOrigin: string;
  frontendOrigin: string;
  apiOrigin: string;
  widgetOrigin: string;
};

export function loadEnv(): EmbedEnv {
  const p = path.join(root, ".runtime", "env.json");
  if (!fs.existsSync(p)) {
    throw new Error("Missing e2e/embed/.runtime/env.json — run setup first (npm run test:e2e:embed).");
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as EmbedEnv;
}

export function attachConsole(page: Page, bucket: string[]) {
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (/security|frame-ancestors|Refused to (display|frame)|CSP/i.test(text)) {
      bucket.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (err) => {
    bucket.push(`[pageerror] ${err.message}`);
  });
}

/** Wait for widget iframe and confirm same-origin document access (hydrated). */
export async function waitForHydratedWidgetIframe(page: Page, timeoutMs = 45_000) {
  const frameLocator = page.locator('iframe[title="Chat with us"]');
  await frameLocator.waitFor({ state: "attached", timeout: timeoutMs });

  const handle = await frameLocator.elementHandle();
  if (!handle) throw new Error("iframe element handle missing");

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = await handle.contentFrame();
    if (frame) {
      try {
        const ready = await frame.evaluate(() => {
          const w = window as unknown as { __bcPresenceDiag?: unknown[] };
          return {
            href: location.href,
            hasDiag: Array.isArray(w.__bcPresenceDiag),
            presenceOk: Array.isArray(w.__bcPresenceDiag)
              ? w.__bcPresenceDiag.some((e: { stage?: string }) => e.stage === "presence_ok")
              : false,
            bodyText: (document.body?.innerText || "").slice(0, 200),
          };
        });
        if (ready.href.includes("/widget") && (ready.presenceOk || ready.bodyText.length > 0)) {
          return { frame, ...ready };
        }
      } catch {
        // Cross-origin or about:blank while blocked / navigating.
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Widget iframe did not hydrate in time");
}

export async function agentLogin(page: Page, env: EmbedEnv) {
  await page.goto(`${env.frontendOrigin}/login`, { waitUntil: "networkidle" });
  // Wait for React hydration — native submit before hydrate navigates to /login? and clears fields.
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await email.fill(env.email);
  await password.fill(env.password);
  await expectFilled(email, env.email);

  const loginResponse = page.waitForResponse(
    (res) => res.url().includes("/api/v1/auth/login") && res.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const res = await loginResponse;
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(`Agent login HTTP ${res.status()}: ${body.slice(0, 200)}`);
  }
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

async function expectFilled(locator: ReturnType<Page["locator"]>, value: string) {
  const actual = await locator.inputValue();
  if (actual !== value) {
    throw new Error(`Expected input value length ${value.length}, got ${actual.length}`);
  }
}

export async function readPresenceDiag(page: Page) {
  const handle = await page.locator('iframe[title="Chat with us"]').elementHandle();
  if (!handle) return null;
  const frame = await handle.contentFrame();
  if (!frame) return null;
  try {
    return await frame.evaluate(() => {
      const w = window as unknown as {
        __bcPresenceDiag?: Array<{ stage: string; detail?: string; t: number }>;
      };
      return w.__bcPresenceDiag ?? null;
    });
  } catch {
    return null;
  }
}
