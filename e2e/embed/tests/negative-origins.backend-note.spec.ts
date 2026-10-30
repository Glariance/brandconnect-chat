import { test, expect } from "@playwright/test";
import { loadEnv } from "../helpers";

/**
 * These checks call the live API for variants that cannot be hosted as
 * local fixture parents. They complement Playwright embed tests and the
 * PHPUnit OriginAllowlist / BrandOrigins suites.
 */
test.describe("exact-origin negative cases (API + headers)", () => {
  const env = loadEnv();

  test("widget config for brand A does not authorize brand B origin", async ({ request }) => {
    const a = await request.get(`${env.apiOrigin}/api/v1/widget/brands/${env.brandPublicId}/config`);
    expect(a.ok()).toBeTruthy();
    const aj = await a.json();
    expect(aj.data.allowed_origins).toEqual([env.approvedOrigin]);
    expect(aj.data.frame_ancestors).toContain(env.approvedOrigin);
    expect(aj.data.frame_ancestors).not.toContain("https://brand-b.example.com");
  });

  test("127.0.0.1 is distinct from localhost in served CSP", async ({ request }) => {
    const res = await request.get(`${env.frontendOrigin}/widget?brand=${env.brandPublicId}`, {
      maxRedirects: 5,
    });
    const csp = res.headers()["content-security-policy"] || "";
    // Brand allowlists only localhost:8090; preview adds both localhost and 127.0.0.1 :8080.
    expect(csp).toContain("http://localhost:8090");
    expect(csp).not.toContain("http://127.0.0.1:8090");
  });
});
