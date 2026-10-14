# Ruteplanlægger – notes for maintaining this repo

Static web app served by GitHub Pages from `main` (root). Pushing to `main` deploys; the owner (Martin, Danish speaker) and a 65+ user open https://martinsieburg42-alt.github.io/ruteplan/. All UI text is Danish and must stay simple.

- No build step. `index.html` loads `vendor/jszip.min.js`, Leaflet from cdnjs, `solver.js`, `app.js`.
- `solver.js` defines global `solveVRP(D, {time, service, limit, timeMs, maxIter, seed})`: D = cost matrix (metres for "færrest km", seconds for "kortest tid"), `time` = seconds matrix used for the day limit. Index 0 is the home address. Also loaded in `solver-worker.js`.
- Road data: OSRM demo server (`/table` in 45×45 chunks with `annotations=duration,distance`, `/route` per day with `continue_straight=false`). Geocoding: Nominatim (1 req/s) with Photon fallback. Never plan by straight-line distance; straight-line is only a flagged fallback when OSRM fails.
- Excel output must keep the `Ruteplan` sheet columns `Stop`, `Dag`, `Fuld adresse`, `Bredde`, `Længde`, `Område`, `Vej`, `Husnr`, `Hus-ID`, `Aftalt med`, `Note`, and the `Oversigt` sheet with day code in column A / name in column B ending at the `I alt` row: the phone page (a claude.ai artifact) imports this file.
- Bump `VERSION` in `app.js`, the `?v=` query strings and footer in `index.html`, and `CACHE` in `sw.js` on each release (GitHub Pages caches files for ~10 min; the worker loads `solver.js` with the same `?v=`).
- `solveVRP` must keep every multi-house day within the time limit even when the cost is km (km-shorter order can be slower). Check with a stress test where cost and time disagree.
- Test locally with a static server (Workers do not run from file://) and mocked network; the Excel files with real addresses are private and must not be committed.
