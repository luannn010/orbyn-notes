// Disposable genuine Journal owner-lifetime regression; never imported by production.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (!process.argv.includes("--run")) throw new Error("Pass --run to create disposable local test profiles.");
const web = fileURLToPath(new URL("../../", import.meta.url));
const output = process.env.NOTES_UI_OUTPUT ?? resolve(web, "test-results/journal-owner-close-browser");
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
const sources = ["src/ui/JournalView.tsx", "src/collections/journalVault.ts", "src/generated/wasm/orbyn_wasm_bg.wasm", "tests/integration/collections-browser.tsx", "tests/integration/journal-owner-close-browser.mjs"];
const hashes = () => Promise.all(sources.map(async path => ({path, sha256:createHash("sha256").update(await readFile(resolve(web,path))).digest("hex")})));
const before = await hashes(), runs = [];
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true});
const phrase = "Synthetic owner-close browser phrase only";
const marker = "Synthetic private Journal owner-close entry";
try {
 for (const [mode,theme] of [["creating","light"],["locked","dim"],["unlocking","dark"],["unlocked-form","light"]]) {
  const context = await browser.newContext({viewport:{width:1160,height:850}}),page=await context.newPage(),errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  try {
   await context.addInitScript(theme=>localStorage.setItem("notes.theme",theme),theme);
   await page.goto(`${base}/tests/integration/collections-browser.html?view=journal`);
   await page.getByLabel("Passphrase",{exact:true}).fill(phrase);
   await page.getByLabel("Confirm passphrase",{exact:true}).fill(phrase);
   if(mode!=="creating") {
    await page.getByRole("button",{name:"Lock Journal",exact:true}).click();
    const editor=page.getByRole("textbox",{name:"Journal entry",exact:true});
    await expect(editor).toBeVisible();
    await editor.fill(marker);
    await expect.poll(()=>page.evaluate(()=>{const s=window.__journalFixture.status();return !s.saving&&!s.dirty;})).toBe(true);
    if(mode==="unlocked-form") {
     await page.getByRole("button",{name:"Add a habit",exact:true}).click();
     await page.getByRole("dialog").getByLabel("Name",{exact:true}).fill("Synthetic private unsubmitted habit");
    } else {
     await page.evaluate(()=>window.__journalFixture.lock());
     await page.getByLabel("Passphrase",{exact:true}).fill(phrase);
     if(mode==="unlocking") {
      await page.evaluate(()=>{
       let release;const wait=new Promise(resolve=>{release=resolve;});
       const actual=crypto.subtle.decrypt.bind(crypto.subtle);
       const gate={reached:false,done:false,release};window.__journalCloseCryptoGate=gate;
       crypto.subtle.decrypt=async(...args)=>{if(!gate.reached){gate.reached=true;await wait;}try{return await actual(...args);}finally{gate.done=true;}};
      });
      await page.getByRole("button",{name:"Unlock Journal",exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.__journalCloseCryptoGate.reached)).toBe(true);
     }
    }
   }
   const beforeClose=await page.evaluate(()=>({phase:window.__journalFixture.status().phase,credentialNodes:document.querySelectorAll("input[type=password]").length,privateEntry:!!document.querySelector('[aria-label="Journal entry"]')}));
   const immediate=await page.evaluate(()=>{
    window.__collectionsFixture.close();
    return {phase:window.__journalFixture.status().phase,credentialNodes:document.querySelectorAll("input[type=password]").length,privateEntry:!!document.querySelector('[aria-label="Journal entry"]'),privateHabit:!!document.querySelector(".journal-form"),dialogs:document.querySelectorAll("dialog").length};
   });
   expect(immediate).toEqual({phase:"revoked",credentialNodes:0,privateEntry:false,privateHabit:false,dialogs:0});
   if(mode==="unlocking") {
    await page.evaluate(()=>window.__journalCloseCryptoGate.release());
    await expect.poll(()=>page.evaluate(()=>window.__journalCloseCryptoGate.done)).toBe(true);
   }
   await expect(page.getByRole("heading",{name:"Journal access changed",exact:true})).toBeVisible();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await expect(page.getByRole("textbox",{name:"Journal entry",exact:true})).toHaveCount(0);
   await expect(page.locator('input[type="password"]')).toHaveCount(0);
   expect(await page.locator("body").textContent()).not.toContain(marker);
   const closeGuard=await page.evaluate(async()=>(await import("/src/desktop/closeGuard.ts")).checkClose());
   expect(closeGuard).toBe("allowed");
   if(mode==="unlocked-form") {
    await page.reload();
    await page.getByLabel("Passphrase",{exact:true}).fill(phrase);
    await page.getByRole("button",{name:"Unlock Journal",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"Journal entry",exact:true})).toContainText(marker);
   }
   expect(errors).toEqual([]);
   runs.push({mode,theme,beforeClose,immediate,closeGuard,pendingCryptoReleased:mode==="unlocking",savedEntryReopened:mode==="unlocked-form",errors});
  } finally {await context.close();}
 }
 const after=await hashes();expect(after).toEqual(before);
 await writeFile(resolve(output,"result.json"),JSON.stringify({qualification:"Real local WASM/IDB, genuine Collections close and JournalVault/JournalView; synthetic disposable profiles; no native physical-input or server-account claim",before,after,runs},null,2));
 console.log(JSON.stringify({contexts:runs.length,sourceDrift:false,errors:0}));
} finally {await browser.close();}
