# Sutta Archive — CLAUDE.md

## Project Overview

Static GitHub Pages site for reading Buddhist suttas (Nikaya) in three languages:
Pali (original), English (Bhikkhu Sujato), Vietnamese.

- **Live URL**: https://dhammaarchive.info/
- **Hosting**: GitHub Pages (static, no build step, no bundler)
- **License**: CC0 (Sujato translations), Dhamma-dana spirit

## Tech Stack

- Pure HTML/CSS/JS (ES5 compatible, no transpiler)
- No framework, no npm, no build tool
- `<script defer>` load order for module dependency
- Data: Bilara JSON format, packed into JS files under `sutta/`

## Architecture

### Module System

All modules are IIFEs sharing state via `window.SA` namespace.
Load order matters — each module depends on exports from earlier ones.

```
index.html loads (in order via <script defer>):
  toc.js          → SUTRA_INDEX (table of contents data)
  js/utils.js     → SA namespace, $, escapeHtml, debounce, throttle, storage
  js/bilara.js    → SA.loadMerged, pack loading, LRU cache
  js/state.js     → SA.dom, SA.state, anchor get/set, bookmarks, view cache
  js/ui.js        → panels, settings, guide, zoom, language toggles
  js/anchor.js    → scroll anchor save/restore, reading progress, back-to-top
  js/render.js    → virtual scroll, chunk observers, renderSutra, welcome screen
  js/menu.js      → TOC navigation, search, share/copy, bookmark UI
  js/tts.js       → TTS, print PDF, nav buttons, init(), dark mode, touch fixes
```

### Key Concepts

- **Bilara segments**: Each text row has a key like `dn1:2.3.4` — sutta ID, section, paragraph, segment
- **Virtual scroll**: Rows are grouped into chunks (~50 rows each). Only visible chunks are materialized in the DOM (IntersectionObserver). Chunks above/below viewport are dematerialized to save memory.
- **Anchor system**: Saves the topmost visible segment key to sessionStorage + localStorage. On page reload or sutta re-open, restores scroll to that exact segment. Uses dual storage for persistence (localStorage) and per-tab isolation (sessionStorage).
- **DOM mode cache**: Caches rendered DOM for instant language toggle without re-render.
- **View data cache**: LRU cache for processed row data (paragraph merging, AN/SN markers).
- **Single-language paragraph mode**: When only one language column is visible, adjacent segments with the same scope are merged into paragraphs for readability.

### Data Flow

```
User clicks sutta → openSutra(id)
  → renderSutra(id)
    → loadMerged(id)           // fetch pli/en/vi pack scripts
    → getViewData(id, rows)    // process rows, merge paragraphs if single-lang
    → create chunk divs        // placeholder divs with estimated height
    → eagerAroundAnchor()      // materialize chunks near saved anchor
    → setupChunkObservers()    // IntersectionObserver for lazy materialize
    → restoreScrollByAnchor()  // scroll to exact saved position
```

## File Structure

```
realizing/
├── index.html              Main app page
├── about.html              About & terms page
├── styles.css              All CSS (single file, ~2800 lines)
├── toc.js                  Table of contents data (SUTRA_INDEX array)
├── tts.js                  TTS module (lazy-loaded on first use)
├── CNAME                   Custom domain: dhammaarchive.info
├── robots.txt
├── js/                     Application modules (loaded in order)
│   ├── utils.js            [1] SA namespace, helpers, storage wrapper
│   ├── bilara.js           [2] Pack loading, merged cache, service worker purge
│   ├── state.js            [3] DOM refs, shared state, anchors, bookmarks, view cache
│   ├── ui.js               [4] UI panels, settings, guide, zoom, language toggles
│   ├── anchor.js           [5] Scroll anchor observer, save/restore, progress bar
│   ├── render.js           [6] Virtual scroll engine, chunk lifecycle, renderSutra
│   ├── menu.js             [7] TOC tree, search, share/copy, bookmark UI, delegations
│   └── tts.js              [8] TTS, print, nav, init(), dark mode, touch fixes
└── sutta/                  Bilara data packs
    ├── pli/                Pali texts (e.g., pli/dn01.js)
    ├── en/                 English translations
    ├── vi/                 Vietnamese translations
    └── comment/            Commentary (e.g., comment/dn01_en.js)
```

## SA Namespace — Key Exports

### From utils.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.$` | `fn(id)` | `document.getElementById` shorthand |
| `SA.escapeHtml` | `fn(str)` | HTML entity escape |
| `SA.escapeAttr` | `fn(val)` | Attribute-safe escape |
| `SA.safeDomId` | `fn(base)` | Sanitize string for DOM id |
| `SA.debounce` | `fn(fn, ms)` | Debounce with `.cancel()` |
| `SA.throttle` | `fn(fn, ms)` | Simple throttle |
| `SA.storage` | `object` | Safe localStorage wrapper (get/set/remove) |
| `SA.safeCssEscape` | `fn(str)` | CSS.escape polyfill |

### From bilara.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.loadMerged` | `async fn(id)` | Load & merge pli/en/vi packs, returns `{ rows, keys, paliMap, engMap, vieMap, ... }` |
| `SA.MERGED_CACHE` | `Map` | LRU cache of loaded suttas (max 20) |
| `SA.LOADED_PACKS` | `Set` | Track which pack scripts are loaded |

### From state.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.dom` | `object` | All DOM element references (grid, titleEl, btnPali, etc.) |
| `SA.state` | `object` | Shared mutable state (currentSutraId, virtChunks, showPali, etc.) |
| `SA.anchorSet/Get/Remove` | `fn` | Dual sessionStorage + localStorage anchor ops |
| `SA.getAnchorKeyFor` | `fn(id)` | Get saved anchor key (checks URL hash first, then storage) |
| `SA._parseAnchorHash` | `fn` | Parse `#suttaId:segment` from URL |
| `SA.loadBookmarks` | `fn` | Load bookmarks from localStorage |
| `SA.isBookmarked` | `fn(id)` | Check bookmark status |
| `SA.toggleBookmark` | `fn(id)` | Toggle bookmark, returns new state |
| `SA.getSingleVisibleLang` | `fn` | Returns lang key if exactly one column visible, else null |
| `SA.mergeRowsToParagraphRows` | `fn` | Merge adjacent segments into paragraphs |
| `SA.getViewData` | `fn` | Build/cache view data with paragraph merge + AN/SN markers |
| `SA._dmSaveCurrent` | `fn` | Save current DOM to mode cache |
| `SA._dmTryRestore` | `fn` | Try restore DOM from mode cache |

### From ui.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.togglePanel` | `fn(el, force)` | Open/close/toggle side panel |
| `SA.closePanels` | `fn` | Close all panels |
| `SA.openGuide / closeGuide` | `fn` | Guide dialog |
| `SA.applyVisibility` | `fn` | Apply column visibility to DOM |
| `SA.updateVisibleCols` | `fn` | Sync card layout class to visible columns |
| `SA.preserveTopAndSave` | `fn(callback)` | Run callback while preserving scroll position |
| `SA.loadZoom / loadLineHeight` | `fn` | Load saved zoom/line-height from storage |
| `SA.syncCmtButtons` | `fn` | Sync comment toggle button states |

### From anchor.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.getScrollRoot` | `fn` | Returns the scrolling container (readerArea or grid) |
| `SA.setupAnchorObserver` | `fn` | Start IntersectionObserver to track topmost visible segment |
| `SA.computeTopVisibleKey` | `fn` | Calculate which segment key is at scroll top |
| `SA.restoreScrollByAnchor` | `fn(id)` | Restore scroll to saved anchor; returns true/false |
| `SA.updateReadingProgress` | `fn` | Update reading progress bar |
| `SA.toggleBackTop` | `fn(show)` | Show/hide back-to-top button |

### From render.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.findMetaById` | `fn(id)` | Find sutta metadata from SUTRA_INDEX |
| `SA.renderSutra` | `async fn(id)` | Full sutta render pipeline |
| `SA.renderWelcomeScreen` | `fn` | Render home/welcome screen |
| `SA.setupChunkObservers` | `fn` | Start materialize/dematerialize IntersectionObservers |
| `SA.teardownChunkObservers` | `fn` | Stop chunk observers |
| `SA.ensureRowRendered` | `fn(idx)` | Force-materialize the chunk containing row idx |
| `SA.buildSuttaPrintHtml` | `fn(id, merged)` | Generate print-ready HTML |

### From menu.js
| Export | Type | Description |
|--------|------|-------------|
| `SA.buildSutraMenuFromIndex` | `fn` | Build TOC tree from SUTRA_INDEX |
| `SA.highlightActiveInMenu` | `fn` | Highlight current sutta in menu |
| `SA.syncTileToCurrentSutta` | `fn` | Auto-select correct nikaya tile |
| `SA.findNikayaOfSutta` | `fn(id)` | Find which nikaya a sutta belongs to |
| `SA.initDelegations` | `fn` | Wire click handlers for grid and menu |
| `SA.applyTitleBookmarkState` | `fn` | Sync bookmark star in title bar |
| `SA.updateBookmarksCount` | `fn` | Update bookmark counter badge |
| `SA.reflectBookmarkState` | `fn(id, on)` | Update bookmark UI across menu |
| `SA.revealCurrentSuttaInMenu` | `fn` | Scroll menu to reveal active sutta |
| `SA._showToast` | `fn(msg)` | Show brief toast notification |

### From js/tts.js (init module)
| Export | Type | Description |
|--------|------|-------------|
| `SA.openSutra` | `fn(id)` | Open sutta (resolves prefix, calls renderSutra) |
| `SA.resetTts` | `fn(clearHL, clearStorage)` | Stop TTS and reset state |
| `SA.setTtsUiState` | `fn(state)` | Update TTS button states (idle/playing/paused) |
| `SA.updateNavButtons` | `fn` | Update prev/next nav buttons |
| `SA.scheduleNextPreload` | `fn(id)` | Preload adjacent suttas on idle |

## State Object (`SA.state`)

Key fields on the shared state:

| Field | Type | Description |
|-------|------|-------------|
| `currentSutraId` | `string\|null` | Currently displayed sutta file ID (e.g., `"dn01"`) |
| `uiLang` | `string` | UI language: `"en"` or `"vi"` |
| `showPali/showEng/showVie` | `bool` | Column visibility |
| `isRendering` | `bool` | True during async renderSutra |
| `virtChunks` | `array` | Virtual scroll chunk metadata |
| `virtAllRows` | `array` | All processed rows for current sutta |
| `keyToRowIdx` | `object` | Map segment key → row index |
| `firstVisibleKey` | `string\|null` | Topmost visible segment (updated by observer) |
| `anchorObserver` | `IntersectionObserver\|null` | Tracks visible segments |
| `_progScrollUntil` | `number` | Timestamp: suppress anchor save until (programmatic scroll) |
| `SUTRA_ORDER` | `array` | Flat list of all sutta IDs in menu order |
| `FLAT_SUTTAS` | `array` | Flat search index |
| `DEBUG` | `bool` | Enable debug panel |

## Anchor System Details

The anchor system preserves reading position across page reloads and sutta switches.

### Save flow (triggered by scroll)
```
scroll event → throttled saveScrollAnchorNow()
  → skip if isRendering or _progScrollUntil active
  → computeTopVisibleKey() or use firstVisibleKey from observer
  → anchorSet(KEY_ANCHOR_K(suttaId), key)  // writes to both sessionStorage + localStorage
  → _writeAnchorHash(key)                  // updates URL hash
```

### Restore flow (on sutta load)
```
renderSutra(id)
  → eagerAroundAnchor()                    // materialize chunks near anchor, scroll to chunk
  → restoreScrollByAnchor(id)              // precise scroll to exact row
    → getAnchorKeyFor(id)                  // check hash first, then storage
    → find row index in virtAllRows
    → ensureRowRendered(idx)               // force-materialize chunk
    → scrollTo({ top: y, behavior: 'instant' })  // instant (not smooth!)
    → rAF correction steps at +0, +100ms, +500ms
```

### Important invariants
- Always use `behavior: 'instant'` for programmatic scroll (CSS has `scroll-behavior: smooth` on the grid)
- Set `_progScrollUntil` before programmatic scroll to suppress anchor save
- When no anchor exists (first open), scroll to top explicitly
- `isRendering = true` blocks anchor save; retry is scheduled

## CSS Notes

- Single file: `styles.css` (~2800 lines)
- CSS custom properties for theming (light/dark via `[data-theme="dark"]`)
- `#sutraGrid { scroll-behavior: smooth }` — affects JS `scrollTop` assignment!
- Touch device fixes: `html.is-touch` class, nuclear `:hover` rule stripping
- Responsive: mobile-first with breakpoints at 600px, 768px, 1024px

## Common Tasks

### Adding a new sutta
1. Add bilara pack files: `sutta/pli/<id>.js`, `sutta/en/<id>.js`, `sutta/vi/<id>.js`
2. Add entry to `toc.js` in the correct nikaya/group

### Changing column/panel behavior
- Column visibility: `js/ui.js` → `applyVisibility()`, `updateVisibleCols()`
- Panel open/close: `js/ui.js` → `togglePanel()`

### Debugging scroll/anchor issues
1. Set `window.DEBUG_ANCHOR = true` in console
2. Open debug panel (bug icon, top-right) — shows anchor state, chunk stats, FPS
3. Check: `SA.anchorGet(SA.KEY_ANCHOR_K('suttaId'))` for saved anchor
4. Check: `SA.state.firstVisibleKey` for current observed top key

### Version bumping (cache bust)
Update `?v=XX` in `index.html` script tags when deploying changes.

## Git Conventions

- Branch: `main` (deployed via GitHub Pages)
- Commit messages: English, imperative, concise
- Co-author: include `Co-Authored-By:` when AI-assisted
