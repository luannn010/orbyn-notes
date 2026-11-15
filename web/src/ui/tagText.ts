/** Commas separate tags; quotes preserve existing tag names containing commas. */
export function formatTagText(tags: readonly string[]): string {
  return tags
    .map((tag) =>
      /[",\r\n]|^#|^\s|\s$/.test(tag) ? `"${tag.replaceAll('"', '""')}"` : tag,
    )
    .join(", ");
}
export function parseTagText(input: string): string[] {
  if (input.length > 24000)
    throw Error("Enter at most 100 tags, with up to 100 characters each.");
  const tags: string[] = [];
  let index = 0;
  while (index < input.length) {
    while (/\s/.test(input[index] ?? "")) index++;
    let value = "",
      quoted = input[index] === '"';
    if (quoted) {
      index++;
      let closed = false;
      while (index < input.length) {
        if (input[index] === '"') {
          if (input[index + 1] === '"') {
            value += '"';
            index += 2;
          } else {
            index++;
            closed = true;
            break;
          }
        } else value += input[index++];
      }
      if (!closed) throw Error("Close the quote around the tag name.");
      while (/\s/.test(input[index] ?? "")) index++;
      if (index < input.length && input[index] !== ",")
        throw Error("Separate tag names with commas.");
    } else {
      while (index < input.length && input[index] !== ",")
        value += input[index++];
      value = value.trim().replace(/^#+/, "");
    }
    if (value) {
      if (value.length > 100)
        throw Error("Each tag can have up to 100 characters.");
      if (!tags.includes(value)) tags.push(value);
      if (tags.length > 100) throw Error("A note can have up to 100 tags.");
    }
    if (input[index] === ",") index++;
  }
  return tags;
}

/** Only a newly entered comma + space outside quoted fields confirms tags. */
export function confirmedTagPrefix(
  previous: string,
  next: string,
): { text: string; rest: string } | null {
  let start = 0,
    suffix = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  )
    start++;
  while (
    suffix < previous.length - start &&
    suffix < next.length - start &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  const end = next.length - suffix;
  // Edits before an unchanged suffix remain a full-list draft until applied.
  if (end <= start || suffix > 0) return null;
  let quoted = false,
    fieldStart = true,
    boundary = -1;
  for (let i = 0; i < next.length; i++) {
    const char = next[i];
    if (quoted) {
      if (char === '"') {
        if (next[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (fieldStart && char === '"') {
      quoted = true;
      fieldStart = false;
      continue;
    }
    if (char === ",") {
      if (next[i + 1] === " ") {
        if ((i >= start && i < end) || (i + 1 >= start && i + 1 < end))
          boundary = i + 2;
      }
      fieldStart = true;
    } else if (!/\s/.test(char ?? "")) fieldStart = false;
  }
  return boundary >= 0
    ? { text: next.slice(0, boundary), rest: next.slice(boundary) }
    : null;
}
