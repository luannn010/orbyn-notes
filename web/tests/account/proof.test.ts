// @vitest-environment node
import { it, expect } from "vitest";
import { solveSignupProof } from "../../src/account/proof";
it("solves the actual engine SHA256 challenge format from a random starting nonce", async () => {
  const challenge = "00".repeat(32);
  const result = await solveSignupProof({ challenge, bits: 9 }, () => {});
  const label = new TextEncoder().encode("orbyn/signup-pow/v1");
  const packet = new Uint8Array(label.length + 36);
  packet.set(label);
  new DataView(packet.buffer).setUint32(packet.length - 4, result.nonce, false);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", packet));
  expect(hash[0]).toBe(0);
  expect(hash[1]! & 128).toBe(0);
});
it("rejects invalid proof difficulty and honours cancellation", async () => {
  await expect(
    solveSignupProof({ challenge: "00".repeat(32), bits: 29 }, () => {}),
  ).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    solveSignupProof({ challenge: "00".repeat(32), bits: 18 }, () => {
      throw new Error("Cancelled fixture");
    }),
  ).rejects.toThrow("Cancelled fixture");
});
