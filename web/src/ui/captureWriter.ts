import type { Note, NoteDocument, NotesStore } from "../domain/contracts";
import { plainText } from "./model";
import { trackOperation } from "../desktop/closeGuard";

export const emptyDocument = (): NoteDocument => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export type CaptureContent = Pick<Note, "title" | "document" | "tags">;
export type CaptureState = {
  value: CaptureContent;
  note: Note | null;
  status: "empty" | "unsaved" | "saving" | "saved" | "error";
  error: string;
  copied: boolean;
};
export const meaningful = (value: CaptureContent) =>
  !!(value.title.trim() || plainText(value.document).trim());
export const captureTitle = (value: CaptureContent) =>
  value.title.trim() ||
  plainText(value.document)
    .split(/\n/)
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 200) ||
  "";

/** One creation identity and one serial writer for this window's capture. */
export class CaptureWriter {
  readonly id = crypto.randomUUID();
  private version = 0;
  private committed = 0;
  private copiedVersion = -1;
  private writing = false;
  private firstAttempt: { version: number; input: CaptureContent } | null =
    null;
  private disposed = false;
  state: CaptureState;
  constructor(
    private store: NotesStore,
    tags: string[],
    private publish: (state: CaptureState) => void,
    private onSaved: (note: Note) => void,
  ) {
    this.state = {
      value: { title: "", document: emptyDocument(), tags },
      note: null,
      status: "empty",
      error: "",
      copied: false,
    };
  }
  private emit() {
    if (!this.disposed) this.publish({ ...this.state });
  }
  change(value: CaptureContent) {
    this.version++;
    this.state = {
      ...this.state,
      value: structuredClone(value),
      error: "",
      copied: false,
      status: !this.state.note && !meaningful(value) ? "empty" : "unsaved",
    };
    this.emit();
    void this.save();
  }
  retry() {
    this.state.error = "";
    void this.save();
  }
  async copy() {
    const version = this.version;
    await navigator.clipboard.writeText(
      `${this.state.value.title}\n\n${plainText(this.state.value.document)}`,
    );
    if (this.version === version) {
      this.copiedVersion = version;
      this.state.copied = true;
      this.emit();
    }
  }
  canLeave() {
    return (
      !this.writing &&
      ((!meaningful(this.state.value) && !this.state.note) ||
        this.committed === this.version ||
        this.copiedVersion === this.version)
    );
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
  }
  private async save() {
    if (
      this.writing ||
      this.disposed ||
      this.state.error ||
      this.committed === this.version ||
      (!this.state.note && !meaningful(this.state.value))
    )
      return;
    this.writing = true;
    this.state.status = "saving";
    this.emit();
    try {
      while (!this.disposed && this.committed !== this.version) {
        const version = this.version,
          value = structuredClone(this.state.value);
        if (!this.state.note && !meaningful(value)) break;
        const input = { ...value, title: captureTitle(value) };
        if (!this.state.note && !this.firstAttempt)
          this.firstAttempt = { version, input };
        const committedVersion = this.state.note
          ? version
          : this.firstAttempt!.version;
        const note = await trackOperation(() =>
          this.state.note
            ? this.store.update(
                this.state.note.id,
                input,
                this.state.note.revision,
              )
            : this.store.create(this.firstAttempt!.input, this.id),
        );
        if (this.disposed) break;
        this.state.note = note;
        this.committed = committedVersion;
        this.onSaved(note);
      }
      if (!this.disposed)
        this.state.status = this.committed === this.version ? "saved" : "empty";
    } catch (error) {
      if (!this.disposed) {
        this.state.error =
          error instanceof Error
            ? error.message
            : "Couldn’t save. Your text is still here.";
        this.state.status = "error";
      }
    } finally {
      this.writing = false;
      this.emit();
    }
  }
}
