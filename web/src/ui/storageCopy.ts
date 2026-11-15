// Keep storage guidance tied to the actual runtime, without implying sync or backup.
const browserCopy = {
  entry: "Encrypted notes in this browser.",
  account: "Your Orbyn account, one browser at a time.",
  warning: "This beta does not sync. Clearing browser data removes your notes. Export a copy to keep them.",
  approvalHeading: "This browser needs approval before Notes can open.",
  approvalHelp: "Approve this browser from a trusted device.",
  saved: "Saved in this browser",
  encryptedHelp: "Notes stay encrypted in this browser. This beta does not sync.",
  offline: "You’re offline. Notes still saves in this browser. This beta does not sync.",
  signOut: "Your encrypted notes stay in this browser. Sign in to the same account in this browser to open them again. They are not backed up or synced.",
  eraseTitle: "Erase notes from this browser?",
  eraseLabel: "Erase this browser",
  exportWarning: "Local only. Clearing browser data removes your notes. Export a copy first.",
  openingError: "Notes needs working browser storage and encryption. Nothing was opened or changed. Try another browser or allow this site to store data.",
};

const desktopCopy: typeof browserCopy = {
  entry: "Encrypted notes in this app on this device.",
  account: "Your Orbyn account, on this device.",
  warning: "This beta does not sync. Clearing this app’s data removes your notes. Export a copy to keep them.",
  approvalHeading: "This app needs approval before Notes can open.",
  approvalHelp: "Approve this app from a trusted device.",
  saved: "Saved on this device",
  encryptedHelp: "Notes stay encrypted in this app on this device. This beta does not sync.",
  offline: "You’re offline. Notes still saves in this app on this device. This beta does not sync.",
  signOut: "Your encrypted notes stay in this app on this device. Sign in to the same account in this app to open them again. They are not backed up or synced.",
  eraseTitle: "Erase notes from this app on this device?",
  eraseLabel: "Erase this app’s data",
  exportWarning: "Local only. Clearing this app’s data removes your notes. Export a copy first.",
  openingError: "Notes needs working app storage and encryption. Nothing was opened or changed. Try reopening Notes and check that this app can store data on this device.",
};

export function storageCopy(desktop: boolean) {
  return desktop ? desktopCopy : browserCopy;
}
