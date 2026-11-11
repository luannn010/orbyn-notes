type Guard = () => boolean;
const guards = new Set<Guard>();
let operations = 0;
let closing = false;

export function lockClosing(): () => void {
  closing = true;
  return () => { closing = false; };
}

export function registerCloseGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function checkClose(): "allowed" | "draft" | "working" {
  let blocked = false;
  for (const guard of guards) {
    try { if (!guard()) blocked = true; } catch { blocked = true; }
  }
  if (blocked) return "draft";
  return operations ? "working" : "allowed";
}

export async function trackOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (closing) throw new Error("The window is closing. Try again if it stays open.");
  operations++;
  try { return await operation(); } finally { operations--; }
}

/** Keep existing account/store ownership while native close waits for its writes. */
export function protectOperations<T extends object>(target: T, methods: readonly string[]): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value: unknown = Reflect.get(object, property, receiver);
      if (typeof property !== "string" || !methods.includes(property) || typeof value !== "function")
        return value;
      return (...args: unknown[]) => trackOperation(() => value.apply(object, args));
    },
  });
}
