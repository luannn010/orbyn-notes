import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Dialog } from "./primitives";

/** Remove private projections synchronously when their authority changes. */
export function SearchSurface({ active, privacyVersion, onClose, children }: {
  active: boolean;
  privacyVersion: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const previousPrivacy = useRef(privacyVersion);
  const revoked = previousPrivacy.current !== privacyVersion;
  useLayoutEffect(() => {
    previousPrivacy.current = privacyVersion;
  }, [privacyVersion]);
  if (!active || revoked) return null;
  return <Dialog title="Search" className="workspace-search" onClose={onClose}>{children}</Dialog>;
}
