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
