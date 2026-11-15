import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Session-local navigation only; never retains documents or crosses accounts. */
export function useWorkspaceHistory<T>(value: T, key: string, enabled: boolean,
  apply: (value: T) => void, requestLeave: (action: () => void) => void) {
  const history = useRef<{ key: string; value: T }[]>([]);
  const index = useRef(-1);
  const replay = useRef<string | null>(null);
  const latest = useRef({ apply, requestLeave });
  latest.current = { apply, requestLeave };
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) return;
    if (replay.current === key) { replay.current = null; return; }
    if (history.current[index.current]?.key === key) return;
    history.current = [...history.current.slice(0, index.current + 1), { key, value }].slice(-100);
    index.current = history.current.length - 1;
    refresh(v => v + 1);
  }, [key, enabled]);
  const move = useCallback((delta: number) => {
    latest.current.requestLeave(() => {
      const target = index.current + delta;
      const entry = history.current[target];
      if (!entry) return;
      index.current = target;
      replay.current = entry.key;
      latest.current.apply(entry.value);
      refresh(v => v + 1);
    });
  }, []);
  const back = useCallback(() => move(-1), [move]);
  const forward = useCallback(() => move(1), [move]);
  return { canBack: index.current > 0, canForward: index.current < history.current.length - 1, back, forward };
}
