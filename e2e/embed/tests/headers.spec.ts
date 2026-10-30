import { test, expect } from "@playwright/test";
import { loadEnv } from "../helpers";

test.describe("served HTML security headers (browser-fetch)", () => {
  const env = loadEnv();

  test("valid brand /widget has brand frame-ancestors + no-store", async ({ request }) => {
    const res = await request.get(`${env.frontendOrigin}/widget?brand=${env.brandPublicId}`, {
      maxRedirects: 5,
    });
    expect(res.ok()).toBeTruthy();
    const csp = res.headers()["content-security-policy"] || "";
    const cache = res.headers()["cache-control"] || "";
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("http://localhost:8090");
    expect(csp).toContain("http://localhost:8080");
    expect(csp).not.toContain("'none'");
    expect(cache).toMatch(/no-store/i);
  });

  test("missing brand /widget fails closed", async ({ request }) => {
    const res = await request.get(`${env.frontendOrigin}/widget?brand=brd_does_not_exist_e2e`, {
      maxRedirects: 5,
    });
    expect(res.ok()).toBeTruthy();
    const csp = res.headers()["content-security-policy"] || "";
    expect(csp).toBe("frame-ancestors 'none'");
  });

  test("dashboard HTML denies framing", async ({ request }) => {
    const res = await request.get(`${env.frontendOrigin}/login`, { maxRedirects: 5 });
    expect(res.ok()).toBeTruthy();
    const csp = res.headers()["content-security-policy"] || "";
    expect(csp).toBe("frame-ancestors 'none'");
  });

  test("brand A policy does not appear on brand B HTML or config", async ({ request }) => {
    const a = await request.get(
      `${env.apiOrigin}/api/v1/widget/brands/${env.brandPublicId}/config`,
    );
    expect(a.ok()).toBeTruthy();
    const aJson = await a.json();
    expect(aJson.data.frame_ancestors).toContain("http://localhost:8090");
    expect(aJson.data.frame_ancestors).not.toContain("https://brand-b.example.com");

    if (!env.brandBPublicId) {
      test.skip(true, "brand B public id missing from setup");
      return;
    }
    const b = await request.get(
      `${env.apiOrigin}/api/v1/widget/brands/${env.brandBPublicId}/config`,
    );
    expect(b.ok()).toBeTruthy();
    const bJson = await b.json();
    expect(bJson.data.frame_ancestors).toContain("https://brand-b.example.com");
    expect(bJson.data.frame_ancestors).not.toContain("http://localhost:8090");

    const htmlA = await request.get(`${env.frontendOrigin}/widget?brand=${env.brandPublicId}`, {
      maxRedirects: 5,
    });
    const htmlB = await request.get(`${env.frontendOrigin}/widget?brand=${env.brandBPublicId}`, {
      maxRedirects: 5,
    });
    const cspA = htmlA.headers()["content-security-policy"] || "";
    const cspB = htmlB.headers()["content-security-policy"] || "";
    expect(cspA).toContain("http://localhost:8090");
    expect(cspA).not.toContain("https://brand-b.example.com");
    expect(cspB).toContain("https://brand-b.example.com");
    expect(cspB).not.toContain("http://localhost:8090");
  });
});
