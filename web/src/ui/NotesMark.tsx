// Notes design artifact 06325398: logo-mark and logo-small-sizes.
export function NotesMark({ size }: { size: 16 | 48 }) {
  return size === 16 ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5.84 6.65h4.32M5.84 9.35h2.79" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="2.4" r="2.4" fill="currentColor" />
    </svg>
  ) : (
    <svg width="48" height="48" viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="124.5" fill="none" stroke="currentColor" strokeWidth="29" />
      <path d="M208 226h96M208 286h62" fill="none" stroke="currentColor" strokeWidth="29" strokeLinecap="round" />
      <circle cx="256" cy="131.5" r="31" fill="currentColor" />
    </svg>
  );
}
