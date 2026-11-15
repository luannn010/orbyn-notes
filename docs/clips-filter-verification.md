# Clips filter chips (#66)

Design reference: revision `9b69f7bfb2e84dd2ed22223adfa34833fb085045`,
Notes blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`, frame `read-later`,
shared `.filters` / `.pill` rules. No design source was copied.

The scope is filter spacing, chip dimensions and theme roles. Keep the existing
labels, counts, filtering, `aria-pressed` and keyboard focus. The existing mobile
content gutter remains 16px below 650px; the design's top/bottom spacing applies
at every width. Chips are at least 28px high and can grow for long labels.

From `web/`, start Vite, then run:

```sh
NOTES_PREVIEW_URL=http://127.0.0.1:5177 NOTES_UI_OUTPUT=test-results/clips-filter-chips node tests/integration/clips-filter-chips.mjs
```

Requires installed Chrome. The driver reuses the existing test-only Clips entry
with a disposable browser context, synthetic account identity and the production
Clips facade, WASM encryption and IndexedDB. It checks real All/Unread/Read later/
Archived results, counts, Space activation, Tab focus, computed spacing/colors,
and containment at 1160/768/600/390/320px in Light/Dark/Dim. A rendered-only long
label stresses wrapping without adding a production filter. Screenshots and a
measurement receipt go to `NOTES_UI_OUTPUT`.

Also run the existing `tests/integration/clips-browser.mjs` journey, the existing
Clips UI/data tests, `npm run check` and `npm run build`. The browser harness does
not qualify account-server authentication or installed native behavior.
