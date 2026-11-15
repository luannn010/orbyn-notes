# Journal history rows

Issue #65 follows Notes artifact blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`,
frame `journal-history`, revalidated at design revision
`9b69f7bfb2e84dd2ed22223adfa34833fb085045`.

Only the history list and rows change: 2px list gap, zero list padding,
20px/flexible/auto icon-text-status grid, 1px/12px gaps, 9px/12px padding,
10px radius, 13.5px date, 12.5px snippet and 12px habit count.
Dates and entry text remain complete in accessible names; CSS ellipsizes them.

Run a local Vite server, then:

```sh
NOTES_PREVIEW_URL=http://127.0.0.1:5193 node tests/integration/journal-history-browser.mjs --run
```

Run from `web/`. `NOTES_UI_OUTPUT` optionally selects the capture directory.
The driver uses disposable synthetic profiles with the existing real encrypted
Journal/WASM/IndexedDB fixture. It measures the source-derived row values in
Light, Dark and Dim at 1200, 390 and 320 CSS pixels, captures focused rows,
checks text beyond 160 characters and real habit counts, opens the selected
date by pointer and Enter, and verifies that locking removes history plaintext.

Validation: all nine browser cases passed; eight existing Journal test files
(94 tests), application typecheck and production build passed. Inspected captures:
Light/1200, Dark/390, Dim/320. Installed-native behavior, account-server behavior,
full-frame pixel parity and performance benchmarks were not qualified.
