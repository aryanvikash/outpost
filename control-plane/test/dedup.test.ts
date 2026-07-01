import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { DB } from "../src/db/index";

// The webhook handlers claim a delivery id before processing and release it
// (forgetDelivery) if processing throws, so a transient failure doesn't dedup a
// push away permanently. This exercises the claim/release mechanism directly.
describe("webhook delivery dedup claim + release", () => {
  it("claims once, rejects a duplicate, and re-allows after release", async () => {
    const db = new DB(env.DB);

    // First claim succeeds; an immediate re-claim is rejected as a duplicate.
    expect(await db.markDeliverySeen("del-release", "github", 1000)).toBe(true);
    expect(await db.markDeliverySeen("del-release", "github", 1000)).toBe(false);

    // Releasing it (as the handler does on a processing failure) lets a retry
    // claim it again and reprocess.
    await db.forgetDelivery("del-release");
    expect(await db.markDeliverySeen("del-release", "github", 2000)).toBe(true);
  });
});
