import { AccountError } from "../domain/contracts";
// Public signup work only. The engine protocol hashes this exact label,32 challenge bytes,
// and a big-endian u32 nonce; no passwords or account keys enter this function.
export async function solveSignupProof(
  input: { challenge: unknown; bits: unknown },
  checkCancelled: () => void,
): Promise<{ challenge: string; nonce: number }> {
  if (
    typeof input.challenge !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.challenge) ||
    typeof input.bits !== "number" ||
    !Number.isInteger(input.bits) ||
    input.bits < 0 ||
    input.bits > 28
  )
    throw new AccountError(
      "invalid_response",
      "The service returned an invalid sign-up proof challenge.",
    );
  const challenge = input.challenge;
  const bits = input.bits;
  const prefix = new TextEncoder().encode("orbyn/signup-pow/v1");
  const bytes = new Uint8Array(prefix.length + 32 + 4);
  bytes.set(prefix);
  for (let i = 0; i < 32; i++)
    bytes[prefix.length + i] = parseInt(challenge.slice(i * 2, i * 2 + 2), 16);
  let nonce = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    checkCancelled();
    const candidates = Array.from({ length: 64 }, () => {
      const candidate = nonce;
      nonce = (nonce + 1) >>> 0;
      const packet = bytes.slice();
      new DataView(packet.buffer).setUint32(
        packet.length - 4,
        candidate,
        false,
      );
      return { nonce: candidate, packet };
    });
    const hashes = await Promise.all(
      candidates.map(async (candidate) => ({
        nonce: candidate.nonce,
        hash: new Uint8Array(
          await crypto.subtle.digest("SHA-256", candidate.packet),
        ),
      })),
    );
    checkCancelled();
    for (const candidate of hashes) {
      let zeros = 0;
      for (const byte of candidate.hash) {
        if (byte === 0) zeros += 8;
        else {
          zeros += Math.clz32(byte) - 24;
          break;
        }
      }
      if (zeros >= bits) return { challenge, nonce: candidate.nonce };
    }
  }
  throw new AccountError(
    "proof_timeout",
    "Sign-up verification took too long on this device. Please retry.",
  );
}
