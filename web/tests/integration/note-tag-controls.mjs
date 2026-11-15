/** Open the note's real tag editor without resetting any current draft. */
export async function openNoteTags(page) {
  const trigger = page.getByRole("button", {
    name: "Manage note tags",
    exact: true,
  });
  if ((await trigger.getAttribute("aria-expanded")) === "false")
    await trigger.click();
}
