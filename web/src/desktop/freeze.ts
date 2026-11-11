/** Modal dialogs escape ancestor inertness, so freeze them explicitly as well. */
export function freezeWindow(root: HTMLElement): () => void {
  const previousRoot = root.inert === true;
  const dialogs = new Map<HTMLDialogElement, boolean>();
  const freezeDialogs = () => {
    for (const dialog of document.querySelectorAll("dialog")) {
      if (!dialogs.has(dialog)) dialogs.set(dialog, dialog.inert === true);
      dialog.inert = true;
    }
  };
  root.inert = true;
  freezeDialogs();
  const observer = new MutationObserver(freezeDialogs);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    root.inert = previousRoot;
    for (const [dialog, previous] of dialogs) dialog.inert = previous;
  };
}
