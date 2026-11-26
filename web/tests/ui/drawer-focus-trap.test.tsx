import { describe, expect, it } from "vitest";
import { DRAWER_FOCUSABLE, drawerFocusables } from "../../src/ui/Workspace";

function root(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("mobile drawer focus trap", () => {
  it("includes links and other focusables, not only inputs and buttons", () => {
    const host = root(`
      <input aria-label="Search" />
      <button>New note</button>
      <a href="#main">Download again</a>
      <select aria-label="Sort"><option>Edited</option></select>
      <textarea aria-label="Note"></textarea>
    `);
    const labels = drawerFocusables(host).map(
      (element) => element.tagName.toLowerCase(),
    );
    expect(labels).toEqual(["input", "button", "a", "select", "textarea"]);
  });

  it("keeps the sample-data link inside the trap", () => {
    const host = root(`
      <button>Settings</button>
      <a href="#sample">Explore sample data</a>
      <button>Search</button>
    `);
    const elements = drawerFocusables(host);
    expect(elements.map((element) => element.textContent)).toEqual([
      "Settings",
      "Explore sample data",
      "Search",
    ]);
    // The old query only matched inputs and buttons, so Tab skipped the link.
    expect(elements.filter((element) => element.matches("input,button"))).toHaveLength(2);
    expect(elements).toHaveLength(3);
  });

  it("ignores tabindex=-1 and returns nothing without a root", () => {
    const host = root(`
      <button>Real</button>
      <div tabindex="-1">Not tabbable</div>
    `);
    expect(drawerFocusables(host)).toHaveLength(1);
    expect(drawerFocusables(null)).toEqual([]);
  });

  it("keeps the selector usable by querySelectorAll", () => {
    const host = root(`<a href="#a">a</a><span>b</span>`);
    expect(host.querySelectorAll(DRAWER_FOCUSABLE)).toHaveLength(1);
  });
});
