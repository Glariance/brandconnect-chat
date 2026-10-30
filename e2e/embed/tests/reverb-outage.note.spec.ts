import { test } from "@playwright/test";

/**
 * Reverb-outage browser disruption is intentionally Not run when reusing the
 * shared `npm run dev:all` stack. Stopping Reverb here would break other
 * developer sessions.
 *
 * Backend coverage: api/tests/Feature/PresenceBroadcastResilienceTest.php
 * Runner records this as Not run in e2e/embed/.runtime/results.json.
 */
test("reverb-outage browser scenario documented as not run on shared stack", async () => {
  test.info().annotations.push({
    type: "not-run",
    description:
      "Shared developer stack reused. Do not stop Reverb. PresenceBroadcastResilienceTest covers heartbeat without HTTP 500.",
  });
});
