// Test-only entry. Never imported by the production application.
import { createRoot } from "react-dom/client";
import { Workspace } from "../../src/ui/Workspace";
import { applyInitialPreferences } from "../../src/ui/primitives";
import { openNotesStore } from "../../src/data";
import { establish } from "../../src/account/session";
import { loadEngine, DeviceKeys } from "../../src/data/engine";
import {
  newWrappingKey,
  wrappingSecret,
  readRecord,
  mutateRecord,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

const identity = {
  accountId: "99999999-9999-4999-8999-999999999999",
  deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "isolated-source-fixture@example.test",
  deviceState: "trusted" as const,
};
applyInitialPreferences();
async function start() {
  await loadEngine();
  if (!(await readRecord<DeviceRecord>("devices", identity.email))) {
    const wrapKey = await newWrappingKey(),
      secret = await wrappingSecret(wrapKey),
      keys = DeviceKeys.create();
    try {
      await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
        ...identity,
        wrapKey,
        sealedKeys: keys.export(secret),
        generation: 0,
      }));
    } finally {
      secret.fill(0);
      keys.free();
    }
  }
  establish(identity);
  const notes = await openNotesStore(identity);
  const {openCollectionsStore}=await import("../../src/collections/store");
  const inspector=await openCollectionsStore(identity);
  const {createStudySourceService}=await import("../../src/study/sourceStore");
  const sources=createStudySourceService(notes,inspector);
  Object.assign(window,{__studySourceFixture:{metadata:async()=>{const state=await inspector.read();const list=await notes.list();return{entries:state.study.entries.map(entry=>({id:entry.id,type:entry.type,source:entry.source})),cards:state.study.cards.map(card=>({id:card.id,entryId:card.entryId})),notes:list.map(note=>({id:note.id,title:note.title,revision:note.revision}))};},annotations:(id:string)=>sources.annotations(id),erase:()=>notes.erase()}});
  createRoot(document.getElementById("root")!).render(
    <Workspace
      store={notes}
      sourceOwner={notes}
      library={notes.library}
      session={identity}
      onSignOut={async () => {
        notes.close();
      }}
    />,
  );
}
void start().catch((error) => {
  document.getElementById("root")!.textContent =
    error instanceof Error ? error.message : "Fixture failed";
});
