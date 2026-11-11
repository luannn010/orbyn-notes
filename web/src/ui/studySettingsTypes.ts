import type { AccountSession } from "../domain/contracts";
import type { CollectionsStore } from "../collections/contracts";
export type StudySettingsOwner =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "unavailable" }
  | {
      status: "ready";
      store: CollectionsStore;
      identity: Pick<AccountSession, "accountId" | "deviceId" | "email">;
      retry: () => void;
    };
export interface SettingsLeaveGuard {
  canClose(): boolean;
  requestLeave(continueLeave: () => void): void;
}
