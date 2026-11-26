# Study review card geometry

The approved Notes design artifact version `a582a9ba4fb950d4024ac50541a63e9c01f7669a` supplies frames `st-review-front`, `st-review-back`, and `st-review-phone`. The issue's original design version is `f610ced1da443b04699137333c1309925092fffa` (Notes blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`).

Run from `web/` with a Vite server and set `NOTES_PREVIEW_URL` to its address; `node tests/integration/study-review-geometry.mjs` uses a disposable headless Edge context with actual encrypted collections storage, WASM and the real scheduler. `NOTES_UI_OUTPUT` selects evidence output. When dependencies are a junction, configure Vite to allow the resolved `node_modules` path. The test explicitly loads and checks Geist and JetBrains Mono before measurement.

The driver checks front and back in Light, Dark and Dim at 1160×760 and 390×844, with Basic, Reversed and Cloze cards, long wrapping content and reduced motion for Cloze. It verifies the 520/560px desktop stack, 6px progress, type sizes, colours, keyboard badges, phone card/control placement, grade and Undo, and outgoing inert/hidden controls. It does not qualify native platforms or account services.
