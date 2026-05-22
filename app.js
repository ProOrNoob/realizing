(function () {
'use strict';
// ── utils-state.js ──────────────────────────────────────────────
try { if (history.scrollRestoration) history.scrollRestoration = 'manual'; } catch(_) {}
var DEBUG = true;
var $ = (id) => document.getElementById(id);
function escapeHtml(str) {
if (str === undefined || str === null) return '';
return String(str)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(val) {
if (val === undefined || val === null) return '';
return String(val)
.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
.replace(/</g, '&lt;').replace(/`/g, '&#96;').replace(/>/g, '&gt;');
}
function safeDomId(base) { return String(base).replace(/[^a-z0-9_-]/gi, '-'); }
function debounce(fn, wait = 200) {
let t;
var debounced = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
debounced.cancel = () => { clearTimeout(t); t = null; };
return debounced;
}
function throttle(fn, wait = 120) {
let last = 0;
return (...args) => { const now = Date.now(); if (now - last >= wait) { last = now; fn(...args); } };
}
/* ============================================================
FIX: Safe localStorage wrapper — handles private browsing / quota errors
============================================================ */
var storage = {
get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* ignore */ } },
remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
};
/* ============================================================
FIX: Safe CSS selector escape — handles colons in bilara keys like "sn1.1:1.1"
============================================================ */
function safeCssEscape(str) {
if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
return CSS.escape(str);
}
return String(str).replace(/([^\w-])/g, '\\$1');
}
/* ============================================================
Lazy load packs
============================================================ */
var LOADED_PACKS = new Set();
var PACK_PROMISES = new Map();
// Mobile fix: <script> tag có thể "treo" mãi mãi (không fire onload/onerror) khi:
//  - SW cũ từ deploy trước intercept request rồi không trả lời.
//  - HTTP cache mobile trả response dở dang sau network drop.
//  - bfcache / connection migration ăn mất event.
// Timeout đảm bảo loadMerged luôn settled → renderSutra không kẹt aria-busy forever.
var PACK_LOAD_TIMEOUT_MS = 15000;
function loadPackIfNeeded(pack) {
if (!pack) return Promise.resolve();
if (LOADED_PACKS.has(pack)) return Promise.resolve();
if (PACK_PROMISES.has(pack)) return PACK_PROMISES.get(pack);
var p = new Promise((res, rej) => {
var settled = false;
var s = null;
var tid = null;
var cleanup = function () {
if (tid) { clearTimeout(tid); tid = null; }
if (s) { try { s.onload = s.onerror = null; if (s.parentNode) s.parentNode.removeChild(s); } catch(_){} s = null; }
PACK_PROMISES.delete(pack);
};
try {
s = document.createElement('script');
s.src = pack + '.js'; s.async = true;
s.onload = () => { if (settled) return; settled = true; LOADED_PACKS.add(pack); cleanup(); res(); };
s.onerror = (e) => { if (settled) return; settled = true; cleanup(); rej(e || new Error('load fail: ' + pack)); };
tid = setTimeout(function () {
if (settled) return; settled = true; cleanup();
rej(new Error('pack load timeout: ' + pack));
}, PACK_LOAD_TIMEOUT_MS);
document.body.appendChild(s);
} catch (e) { settled = true; cleanup(); rej(e); }
});
PACK_PROMISES.set(pack, p);
return p;
}
// Self-heal: unregister bất kỳ Service Worker cũ nào còn sót lại từ deploy trước.
// Site hiện tại KHÔNG đăng ký SW, nhưng visitor cũ có thể còn SW phantom intercept
// request → gây "treo loading vĩnh viễn, phải xoá cache mới load lại". Chạy 1 lần
// khi page load, idempotent nếu không có SW nào.
(function purgeStaleServiceWorkers() {
try {
if (!('serviceWorker' in navigator)) return;
navigator.serviceWorker.getRegistrations().then(function (regs) {
if (!regs || !regs.length) return;
regs.forEach(function (r) { try { r.unregister(); } catch(_){} });
if (window.caches && caches.keys) {
caches.keys().then(function (keys) {
keys.forEach(function (k) { try { caches.delete(k); } catch(_){} });
}).catch(function(){});
}
}).catch(function(){});
} catch(_){}
})();
/* ============================================================
Bilara loader
============================================================ */
window.BILARA = window.BILARA || {};
var BILARA_BASE_DIR = './sutta';
function getBilaraPack(lang, id) {
if (!id) return null;
if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
return BILARA_BASE_DIR + '/' + lang + '/' + id;
}
var MERGED_CACHE = new Map();
var MERGED_PROMISES = new Map();
var CACHE_ORDER = [];
var MAX_CACHE_SUTTAS = 20;
function touchCache(id) {
var i = CACHE_ORDER.indexOf(id);
if (i !== -1) CACHE_ORDER.splice(i, 1);
CACHE_ORDER.push(id);
while (CACHE_ORDER.length > MAX_CACHE_SUTTAS) {
var old = CACHE_ORDER.shift();
if (old) MERGED_CACHE.delete(old);
}
}
function unionKeys3(a, b, c) {
var set = new Set();
if (a) Object.keys(a).forEach(function (k) { set.add(k); });
if (b) Object.keys(b).forEach(function (k) { set.add(k); });
if (c) Object.keys(c).forEach(function (k) { set.add(k); });
return Array.from(set);
}
var _BILARA_COLLATOR = (typeof Intl !== 'undefined' && Intl.Collator)
? new Intl.Collator('en', { numeric: true })
: null;
function sortBilaraKeys(keys) {
if (_BILARA_COLLATOR) return keys.sort(_BILARA_COLLATOR.compare);
return keys.sort(function (x, y) { return x.localeCompare(y, 'en', { numeric: true }); });
}
function getCommentPack(lang, id) {
// lang: 'pli' | 'en' | 'vi'  →  ./sutta/comment/<id>_<lang>
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
return BILARA_BASE_DIR + '/comment/' + id + '_' + lang;
}
// Manifest (tùy chọn): nếu file sutta/comment/_index.js khai báo window.COMMENT_INDEX
// = { 'dn01': ['pli','en','vi'], 'sn3_v1': ['vi'], ... } thì chỉ load pack được khai báo.
// Không có manifest → fallback load-all (404-tolerant, có console noise nhưng vô hại).
function shouldLoadCommentPack(lang, id) {
var idx = window.COMMENT_INDEX;
if (!idx || typeof idx !== 'object') return true; // no manifest → try all
var entry = idx[id];
if (!entry) return false;
if (Array.isArray(entry)) return entry.indexOf(lang) !== -1;
return !!entry; // truthy value without array → load all for this id
}
async function loadMerged(id) {
if (!id) return null;
if (MERGED_CACHE.has(id)) return MERGED_CACHE.get(id);
if (MERGED_PROMISES.has(id)) return MERGED_PROMISES.get(id);
var p = (async function () {
var swallow = function (e) { /* 404/load-fail for optional packs → no data */ };
var tasks = [
loadPackIfNeeded(getBilaraPack('pli', id)),
loadPackIfNeeded(getBilaraPack('en', id)),
loadPackIfNeeded(getBilaraPack('vi', id))
];
// Commentary disabled tạm thời — UI section đã ẩn (#commentRow display:none).
// Bỏ comment 4 dòng dưới khi muốn bật lại để tiết kiệm bandwidth + render.
// if (shouldLoadCommentPack('pli', id)) tasks.push(loadPackIfNeeded(getCommentPack('pli', id)).catch(swallow));
// if (shouldLoadCommentPack('en', id))  tasks.push(loadPackIfNeeded(getCommentPack('en', id)).catch(swallow));
// if (shouldLoadCommentPack('vi', id))  tasks.push(loadPackIfNeeded(getCommentPack('vi', id)).catch(swallow));
// if (!window.COMMENT_INDEX) tasks.push(loadPackIfNeeded(getBilaraPack('comment', id)).catch(swallow));
await Promise.all(tasks);
var entry = window.BILARA[id] || {};
var paliMap = entry.pli || {};
var engMap  = entry.en  || {};
var vieMap  = entry.vi  || {};
var cmtPli  = entry.commentPli || {};
var cmtEn   = entry.commentEn  || {};
var cmtVi   = entry.commentVi  || {};
var cmtLegacy = entry.comment  || {};
var keys = sortBilaraKeys(unionKeys3(paliMap, engMap, vieMap));
var rows = keys.map(function (k) {
return {
key: k,
pali: paliMap[k]||'',
eng:  engMap[k]||'',
vie:  vieMap[k]||'',
commentPli: cmtPli[k] || '',
commentEn:  cmtEn[k]  || '',
commentVie: cmtVi[k]  || '',
comment:    cmtLegacy[k] || ''
};
});
var merged = { paliMap: paliMap, engMap: engMap, vieMap: vieMap,
commentPliMap: cmtPli, commentEnMap: cmtEn, commentVieMap: cmtVi,
commentMap: cmtLegacy, keys: keys, rows: rows };
MERGED_CACHE.set(id, merged);
touchCache(id);
MERGED_PROMISES.delete(id);
return merged;
})().catch(function (e) { MERGED_PROMISES.delete(id); throw e; });
MERGED_PROMISES.set(id, p);
return p;
}
/* ============================================================
DOM refs
============================================================ */
var card        = $('card');
var titleEl      = $('title');
var subtitleEl   = $('subtitle');
var superTitleEl = $('supertitle');
var titleMetaEl  = $('titleMeta');
// readerArea (nếu có trong DOM) là scroll container. Fallback về grid cho HTML cũ.
var readerArea   = $('readerArea');
var scrollEl     = readerArea || null;  // gán lại sau khi grid khởi tạo
var grid        = $('sutraGrid');
if (!scrollEl) scrollEl = grid;  // fallback khi HTML cũ không có #readerArea
var btnSutraMenu  = $('sidebar-btn');
var btnSettings   = $('btnSettings');
var btnGuide      = $('btnGuide');
var btnBackTop    = $('btnBackTop');
var btnUiLang     = $('btnUiLang');
var settingsPanel  = $('settingsPanel');
var sutraMenuPanel = $('sutraMenuPanel');
var sutraMenuList  = $('sutraMenuList');
var guideOverlay   = $('guideOverlay');
var searchInput    = $('sutraSearch');
var searchResultsEl = $('sutraSearchResults');
var btnPali      = $('btnPali');
var btnEng       = $('btnEng');
var btnVie       = $('btnVie');
var btnLayout    = $('btnLayout');
var btnReadTts   = $('btnReadTts');
var btnPauseTts  = $('btnPauseTts');
var btnStopTts   = $('btnStopTts');
var btnFullWidth = $('btnFullWidth');
/* ============================================================
State
============================================================ */
var currentSutraId = null;
var SUTRA_ORDER = [];
var FLAT_SUTTAS = [];
var showPali = true, showEng = true, showVie = true;
var isRendering = false;
var renderToken = 0;
var lastSingleLangMode = null;
var cachedRows = [];
// Virtual scroll state
var virtChunks = [];    // [{div, rowStart, rowEnd, materialized, measuredH}]
var virtAllRows = [];   // row data array (cho TTS + anchor khi chunk chưa materialize)
var virtMatObs = null;
var virtDemObs = null;
var LANG_STORAGE_KEY = 'sutra_ui_lang';
var uiLang = storage.get(LANG_STORAGE_KEY) === 'en' ? 'en' : 'vi';
window.SUTRA_UI_LANG = uiLang;
var KEY_LAST     = 'lastSutraId';
var KEY_VIEW     = 'sutra_view_prefs';
var KEY_ANCHOR_K = function (id) { return 'scroll_anchor_key_' + id; };
// Multi-tab fix: sessionStorage là per-tab (không share giữa các tab),
// localStorage shared. Nếu chỉ dùng localStorage, tab B save anchor sẽ đè
// anchor của tab A → tab A reload bị restore về vị trí của tab B.
// Solution: write cả 2 (session = nguồn chân lý cho TAB NÀY, local = fallback
// cho lần đóng/mở lại tab khi session storage mất). Read: session trước, local sau.
var _ssOk = (function(){ try{ sessionStorage.setItem('__t','1'); sessionStorage.removeItem('__t'); return true; } catch(_){ return false; } })();
function anchorSet(key, val) {
storage.set(key, val);
if (_ssOk) { try { sessionStorage.setItem(key, val); } catch(_){} }
}
function anchorGet(key) {
if (_ssOk) {
try { var v = sessionStorage.getItem(key); if (v) return v; } catch(_){}
}
return storage.get(key);
}
function anchorRemove(key) {
storage.remove(key);
if (_ssOk) { try { sessionStorage.removeItem(key); } catch(_){} }
}
// ── URL hash live sync ─────────────────────────────────────────────
// Format: #<segPrefix>:<path>  (vd  #dn1:2.3.4) — segment key chuẩn Bilara.
// segPrefix khác sutta id của file: dn1↔dn01, sn1↔sn1_v1, an10↔an10_v1...
var _SEG_PREFIX_MAP = null;
function _resolveSegPrefixToSuttaId(prefix) {
if (_SEG_PREFIX_MAP === null) {
_SEG_PREFIX_MAP = {};
if (window.SUTRA_INDEX) {
(function walk(arr) {
for (var i = 0; i < arr.length; i++) {
var n = arr[i];
if (n && n.type === 'sutta' && n.id) {
var p = String(n.id).replace(/_v\d+$/, '').replace(/^([a-z]+)0+(\d)/, '$1$2');
_SEG_PREFIX_MAP[p] = n.id;
}
if (n && n.children) walk(n.children);
}
})(window.SUTRA_INDEX);
}
}
return _SEG_PREFIX_MAP[prefix]
|| _SEG_PREFIX_MAP[prefix.replace(/\.\d+$/, '')]
|| prefix;
}
function _parseAnchorHash() {
var h = String(location.hash || '').replace(/^#/, '');
if (!h) return null;
var m = h.match(/^([A-Za-z0-9._-]+)(?::.+)?$/);
if (!m) return null;
var rawPrefix = m[1].toLowerCase();
var suttaId = _resolveSegPrefixToSuttaId(rawPrefix);
return { sutta: suttaId, key: h };
}
function _writeAnchorHash(key) {
if (!key) return;
try { history.replaceState(null, '', '#' + key); } catch (e) { /* ignore */ }
}
function _clearAnchorHash() {
try {
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
} catch (e) { /* ignore */ }
}
// Hash ưu tiên hơn localStorage NẾU hash trỏ đúng sutta đang xem.
function getAnchorKeyFor(id) {
var h = _parseAnchorHash();
if (h && h.sutta === id && h.key) return h.key;
return anchorGet(KEY_ANCHOR_K(id));
}
var WIDE_STORAGE_KEY = 'sutra_layout_wide';
var isWide = storage.get(WIDE_STORAGE_KEY) === '1';
/* ============================================================
Bookmarks (favorites)
============================================================ */
var KEY_BOOKMARKS = 'sutra_bookmarks';
var BOOKMARKS = new Set();
function loadBookmarks() {
var raw = storage.get(KEY_BOOKMARKS);
if (!raw) return;
try {
var arr = JSON.parse(raw);
if (Array.isArray(arr)) {
for (var i = 0; i < arr.length; i++) {
if (typeof arr[i] === 'string' && arr[i]) BOOKMARKS.add(arr[i]);
}
}
} catch (e) { /* ignore malformed */ }
}
function saveBookmarks() {
storage.set(KEY_BOOKMARKS, JSON.stringify(Array.from(BOOKMARKS)));
}
function isBookmarked(id) { return !!id && BOOKMARKS.has(id); }
function setBookmark(id, on) {
if (!id) return false;
if (on) BOOKMARKS.add(id); else BOOKMARKS.delete(id);
saveBookmarks();
return BOOKMARKS.has(id);
}
function toggleBookmark(id) { return setBookmark(id, !isBookmarked(id)); }
function bookmarkLabels() {
return uiLang === 'en'
? { on: 'Remove bookmark', off: 'Add bookmark', empty: 'No bookmarks yet. Tap ☆ next to any sutta to save it.' }
: { on: 'Bỏ đánh dấu', off: 'Lưu bài kinh', empty: 'Chưa có bài kinh nào được lưu. Bấm ☆ cạnh tên bài kinh để lưu.' };
}

// ── text-cache.js ───────────────────────────────────────────────
/* ============================================================
Single-language helpers
============================================================ */
function getSingleVisibleLang() {
var count = (showPali?1:0) + (showEng?1:0) + (showVie?1:0);
if (count !== 1) return null;
if (showPali) return 'pali';
if (showEng) return 'eng';
if (showVie) return 'vie';
return null;
}
function isNumberedHeadingLine(text) { return /^\d+\.\s*/.test((text||'').trim()); }
function mergeRowsToParagraphRows(rows, lang) {
var out = [];
if (!Array.isArray(rows)||!rows.length) return out;
var cmtField = lang==='pali' ? 'commentPli' : lang==='eng' ? 'commentEn' : 'commentVie';
var buf = '', bufKey = null;
var bufComments = [];
var bufSegCount = 0;
var flush = function () {
var text = (buf||'').trim();
if (!text) { buf=''; bufKey=null; bufComments=[]; bufSegCount=0; return; }
var r = { key: bufKey||'', pali:'', eng:'', vie:'', _merged: true };
if (lang==='pali') r.pali=text;
if (lang==='eng') r.eng=text;
if (lang==='vie') r.vie=text;
if (bufComments.length) r._mergedComments = bufComments.slice();
out.push(r); buf=''; bufKey=null; bufComments=[]; bufSegCount=0;
};
for (var i = 0; i < rows.length; i++) {
var r = rows[i];
var key = String(r.key||'');
var raw = lang==='pali'?(r.pali||''):lang==='eng'?(r.eng||''):(r.vie||'');
var t = (raw||'').trim();
if (!t) continue;
var cmtText = (r[cmtField] || '').trim();
// :0.1 = nikāya reference ("Tăng Chi Bộ Kinh 1" / "Saṁyutta Nikāya 3") — bỏ qua
// trong merged view, là metadata chứ không phải nội dung, không nên dính vào paragraph.
if (/:0\.1$/.test(key)) continue;
// :0.2 = numbered heading (vd "4. Phẩm Tâm Không Được Điều Phục") → flush, output riêng
if (isNumberedHeadingLine(t)) {
flush();
var rr = { key: key, pali:'', eng:'', vie:'', _merged: true, _isHeading: true };
if (lang==='pali') rr.pali=t;
if (lang==='eng') rr.eng=t;
if (lang==='vie') rr.vie=t;
if (cmtText) rr._mergedComments = [{ segKey: key, text: cmtText }];
out.push(rr); continue;
}
// :0.3 = sutta title → flush + output riêng như subtitle (NO _merged → createRow apply is-subtitle)
if (/:0\.3$/.test(key)) {
flush();
var ss = { key: key, pali:'', eng:'', vie:'' };
if (lang==='pali') ss.pali=t;
if (lang==='eng') ss.eng=t;
if (lang==='vie') ss.vie=t;
if (cmtText) ss._mergedComments = [{ segKey: key, text: cmtText }];
out.push(ss); continue;
}
if (!buf) { buf=t; bufKey=key; } else buf+=' '+t;
bufSegCount++;
if (cmtText) {
bufComments.push({ segKey: key, text: cmtText });
flush();
continue;
}
if (paragraphBreak && bufSegCount >= PARAGRAPH_BREAK_LEN) flush();
}
flush(); return out;
}
/* ============================================================
DOM mode cache — Phương án B: Cache cây DOM theo (suttaId, mode).
Khi user toggle giữa multi ↔ single (hoặc giữa các ngôn ngữ single),
detach chunk DIVs hiện tại, attach chunks đã cache → swap ~10ms thay vì rebuild ~150ms.
Lần đầu mỗi mode vẫn full build; lần 2+ instant.
============================================================ */
var DOM_MODE_CACHE = new Map();           // 'id|mode' → snapshot
// Adaptive cache size: bài DN dài ~3000 segments → ~60 chunks × DOM materialized → có thể nuốt
// hàng chục MB RAM nếu giữ 6 snapshot trên phone cấu hình thấp. Scale theo navigator.deviceMemory.
var DOM_MODE_CACHE_MAX = (function () {
var mem = navigator.deviceMemory;
if (mem && mem < 2) return 2;       // 1GB phones: chỉ giữ 2 mode gần nhất
if (mem && mem < 4) return 3;       // 2GB phones: 3 mode
return 6;                           // 4GB+ hoặc unknown: full cache (~1.5 sutta × 4 mode)
})();
function _dmCacheKey(id, mode) { return id + '|' + (mode || 'multi'); }
function _dmSnapshotCurrent() {
if (!currentSutraId || !virtChunks || !virtChunks.length) return null;
return {
chunks: virtChunks.slice(),
rows: virtAllRows,
cachedRows: cachedRows.slice(),
keyToRowIdx: keyToRowIdx,
vaggaMarkers: vaggaMarkers,
suttaMarkers: suttaMarkers,
isAN: isAN, isSN: isSN,
fallbackTitle: fallbackTitle,
scrollTop: grid ? grid.scrollTop : 0,
scrollKey: firstVisibleKey
};
}
// Cleanup chunk DOM khỏi snapshot khi evict — tránh memory leak từ materialized chunks
// giữ tham chiếu DOM tree (~50 chunks × ~50 rows × 10 nodes/row = thousands of nodes/snapshot).
function _dmReleaseSnap(snap) {
if (!snap || !snap.chunks) return;
for (var ci = 0; ci < snap.chunks.length; ci++) {
var c = snap.chunks[ci];
if (c && c.div && c.materialized) {
while (c.div.firstChild) c.div.removeChild(c.div.firstChild);
c.materialized = false;
}
}
}
function _dmSaveCurrent() {
if (!currentSutraId) return;
var mode = lastSingleLangMode || 'multi';
var snap = _dmSnapshotCurrent();
if (!snap) return;
var k = _dmCacheKey(currentSutraId, mode);
DOM_MODE_CACHE.delete(k); DOM_MODE_CACHE.set(k, snap);
while (DOM_MODE_CACHE.size > DOM_MODE_CACHE_MAX) {
var oldestKey = DOM_MODE_CACHE.keys().next().value;
var evicted = DOM_MODE_CACHE.get(oldestKey);
_dmReleaseSnap(evicted);
DOM_MODE_CACHE.delete(oldestKey);
}
}
function _dmInvalidateForSutta(id) {
if (!id) return;
var keys = [];
DOM_MODE_CACHE.forEach(function (_v, k) { if (k.indexOf(id + '|') === 0) keys.push(k); });
keys.forEach(function (k) { _dmReleaseSnap(DOM_MODE_CACHE.get(k)); DOM_MODE_CACHE.delete(k); });
}
function _dmTryRestore(targetMode) {
if (!currentSutraId || !grid) return false;
var k = _dmCacheKey(currentSutraId, targetMode);
var snap = DOM_MODE_CACHE.get(k);
if (!snap) return false;
// Lưu state hiện tại trước khi swap (lần sau quay lại sẽ instant)
_dmSaveCurrent();
// Touch LRU cho entry sắp dùng
DOM_MODE_CACHE.delete(k); DOM_MODE_CACHE.set(k, snap);
// Tear down observers cũ
if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
teardownChunkObservers();
// Detach divs hiện tại — chúng đã được snap khác giữ reference
while (grid.firstChild) grid.removeChild(grid.firstChild);
// Restore module state
virtChunks = snap.chunks;
virtAllRows = snap.rows;
cachedRows = snap.cachedRows;
keyToRowIdx = snap.keyToRowIdx;
vaggaMarkers = snap.vaggaMarkers;
suttaMarkers = snap.suttaMarkers;
isAN = snap.isAN; isSN = snap.isSN;
fallbackTitle = snap.fallbackTitle;
lastAppliedVaggaIdx = -2; lastAppliedSuttaIdx = -2;
// Re-attach chunk DIVs
var frag = document.createDocumentFragment();
for (var i = 0; i < snap.chunks.length; i++) frag.appendChild(snap.chunks[i].div);
grid.appendChild(frag);
applyVisibility();
// Re-setup observers (chunk obs trigger materialize cho chunks visible)
setupChunkObservers();
setupAnchorObserver();
// Restore scroll
if (typeof snap.scrollTop === 'number') grid.scrollTop = snap.scrollTop;
firstVisibleKey = snap.scrollKey || null;
lastSingleLangMode = targetMode;
return true;
}
var _modeRerenderTimer = null;
function maybeRerenderIfModeChanged() {
var mode = getSingleVisibleLang();
if (mode === lastSingleLangMode) return;
// Debounce: gộp các toggle liên tục lại để tránh rerender chồng chất.
clearTimeout(_modeRerenderTimer);
_modeRerenderTimer = setTimeout(function () {
_modeRerenderTimer = null;
var modeNow = getSingleVisibleLang();
if (modeNow === lastSingleLangMode) return;
// Cache hit → swap DOM ~10ms thay vì rebuild ~150ms
if (_dmTryRestore(modeNow)) return;
if (currentSutraId) renderSutra(currentSutraId);
}, 180);
}
/* ============================================================
View-mode cache: pre-computed rowsForView + keyIndex + markers per (suttaId, mode).
Tránh chạy lại mergeRowsToParagraphRows + duyệt toàn bộ virtAllRows mỗi lần toggle
cột ngôn ngữ. LRU ~30 entries.
============================================================ */
var VIEW_CACHE = new Map();
var VIEW_CACHE_MAX = 30;
function buildViewData(rowsRaw, lang, isAN, isSN) {
var rows = lang ? mergeRowsToParagraphRows(rowsRaw, lang) : rowsRaw;
var keyIdx = Object.create(null);
var vagga = [];
var sutta = [];
// Lookup table cho title ngắn — luôn lấy từ raw segment data, kể cả ở merged mode
// (vì trong merged mode, rows[i].vie ở key :0.3 = TOÀN BỘ paragraph text, không phải title).
var rawByKey = Object.create(null);
for (var j = 0; j < rowsRaw.length; j++) {
rawByKey[String(rowsRaw[j].key || '')] = rowsRaw[j];
}
for (var i = 0; i < rows.length; i++) {
var k = String(rows[i].key || '');
keyIdx[k] = i;
if ((isAN || isSN) && /:0\.2$/.test(k)) {
var rv = rawByKey[k] || rows[i];
vagga.push({
rowIdx: i,
titleVi: (rv.vie || '').trim(),
titleEn: (rv.eng || '').trim(),
titlePali: (rv.pali || '').trim()
});
}
if (isSN && /:0\.3$/.test(k)) {
var rs = rawByKey[k] || rows[i];
sutta.push({
rowIdx: i,
titleVi: (rs.vie || '').trim(),
titleEn: (rs.eng || '').trim(),
titlePali: (rs.pali || '').trim()
});
}
}
return { rows: rows, keyToRowIdx: keyIdx, vaggaMarkers: vagga, suttaMarkers: sutta };
}
function getViewData(id, rowsRaw, lang, isAN, isSN) {
var cacheKey = id + '|' + (lang || 'multi');
if (VIEW_CACHE.has(cacheKey)) {
var cached = VIEW_CACHE.get(cacheKey);
// LRU touch
VIEW_CACHE.delete(cacheKey);
VIEW_CACHE.set(cacheKey, cached);
return cached;
}
var v = buildViewData(rowsRaw, lang, isAN, isSN);
VIEW_CACHE.set(cacheKey, v);
while (VIEW_CACHE.size > VIEW_CACHE_MAX) {
var firstKey = VIEW_CACHE.keys().next().value;
VIEW_CACHE.delete(firstKey);
}
return v;
}

// ── ui-panels.js ────────────────────────────────────────────────
/* ============================================================
UI Language flags
============================================================ */
// Lang icon dạng chữ đơn giản (Option C) — không dùng cờ màu → subtle, hợp theme dark
var FLAG_VI = '<span class="lang-letters">VN</span>';
var FLAG_EN = '<span class="lang-letters">EN</span>';
function renderUiLangFlag() {
if (!btnUiLang) return;
btnUiLang.innerHTML = uiLang === 'en' ? FLAG_EN : FLAG_VI;
btnUiLang.setAttribute('aria-label', uiLang === 'en'
? 'Interface: English — click to switch to Vietnamese'
: 'Giao diện: Tiếng Việt — bấm để chuyển sang English');
}
function applyUiLanguageToSearchUi() {
if (!searchInput) return;
searchInput.placeholder = uiLang === 'en' ? 'Search sutta...' : 'Tìm bài kinh...';
}
function applyUiLanguageToSettingsPanel() {
var isEn = uiLang === 'en';
var setText = function (id, text) { var el=$(id); if(el) el.textContent=text; };
setText('settingsTitle',          isEn ? 'Settings'            : 'Tuỳ chỉnh');
setText('settingsLangLabel',      isEn ? 'Languages'           : 'Ngôn ngữ');
setText('settingsLangSub',        isEn ? 'Show / hide columns' : 'Hiện / ẩn cột');
setText('settingsHlLabel',        isEn ? 'Emphasize'           : 'Nổi bật');
setText('settingsHlSub',          isEn ? 'Italic + darker ink' : 'In nghiêng + đậm');
setText('settingsLayoutSub',      isEn ? 'Display options'     : 'Cách hiển thị');
setText('settingsCmtLabel',       isEn ? 'Commentary'          : 'Chú giải');
setText('settingsCmtSub',         isEn ? 'Show / hide by lang' : 'Hiện / ẩn theo ngôn ngữ');
setText('settingsLayoutLabel',    isEn ? 'Layout'              : 'Bố cục');
setText('settingsDisplayLabel',   isEn ? 'Display'             : 'Hiển thị');
setText('settingsFontSizeLabel',  isEn ? 'Font size'           : 'Cỡ chữ');
setText('settingsLineHeightLabel',isEn ? 'Line spacing'        : 'Giãn dòng');
setText('settingsTtsTitle',       isEn ? 'Read aloud'          : 'Đọc kinh');
setText('settingsTtsUiLabel',     isEn ? 'Text-to-Speech'      : 'Text-to-Speech');
setText('settingsFullWidthLabel', isEn ? 'Full width'          : 'Toàn màn hình');
var note = $('settingsTtsNote');
if (note) note.innerHTML = isEn
? '* Uses browser built-in voices, quality may vary by device.'
: '* TTS dùng giọng có sẵn của trình duyệt, có thể khác nhau giữa thiết bị.';
if (btnLayout) btnLayout.innerHTML = isEn
? '<span class="pill-icon">☰</span> Stacked'
: '<span class="pill-icon">☰</span> Xếp dọc';
var _btn3C = $('btn3Cols');
if (_btn3C) _btn3C.innerHTML = isEn
? '<span class="pill-icon">⫴</span> 3 columns'
: '<span class="pill-icon">⫴</span> 3 cột ngang';
var _btnCM = $('btnCmtMaster');
if (_btnCM) _btnCM.innerHTML = isEn
? '<span class="pill-icon">💬</span> Commentary'
: '<span class="pill-icon">💬</span> Chú giải';
var _btnCP = $('btnCmtPli');
if (_btnCP) _btnCP.innerHTML = '<span class="pill-icon">💬</span> Pāli';
var _btnCE = $('btnCmtEng');
if (_btnCE) _btnCE.innerHTML = '<span class="pill-icon">💬</span> Eng';
var _btnCV = $('btnCmtVie');
if (_btnCV) _btnCV.innerHTML = isEn
? '<span class="pill-icon">💬</span> Viet'
: '<span class="pill-icon">💬</span> Việt';
var btnFW = $('btnFullWidth');
if (btnFW) btnFW.innerHTML = isEn
? '<span class="pill-icon">⛶</span> Full width'
: '<span class="pill-icon">⛶</span> Toàn màn hình';
if (btnGuide)     btnGuide.setAttribute('aria-label',     isEn ? 'User guide'       : 'Hướng dẫn sử dụng');
if (btnSutraMenu) btnSutraMenu.setAttribute('aria-label', isEn ? 'Sutta Index'      : 'Danh mục bài kinh');
if (btnSettings)  btnSettings.setAttribute('aria-label',  isEn ? 'Display settings'  : 'Cài đặt hiển thị');
if (btnBackTop)   btnBackTop.setAttribute('aria-label',   isEn ? 'Back to top'       : 'Lên đầu trang');
if (btnPauseTts)  btnPauseTts.setAttribute('aria-label',
isEn ? 'Pause (current sentence will restart)' : 'Tạm dừng (câu hiện tại sẽ đọc lại từ đầu)');
var sideLabel = document.querySelector('#sidebar-btn .sidebar-label');
if (sideLabel) sideLabel.textContent = isEn ? 'Library' : 'Thư viện';
// Footer button text labels (.label-full): hiện cạnh icon trên desktop ≥960px
setText('btnSettingsLabel', isEn ? 'Settings' : 'Cài đặt');
setText('btnGuideLabel',    isEn ? 'Guide'    : 'Hướng dẫn');
}
function renderGuideDialog() {
if (!guideOverlay) return;
var dlg = guideOverlay.querySelector('.guide-dialog');
if (!dlg) return;
var isEn = uiLang === 'en';
var viHtml =
'<h2>Hướng dẫn sử dụng</h2>' +
'<h3>📖 Thư viện bài kinh</h3>' +
'<ul>' +
'<li>Bấm <strong>Thư viện</strong> ở giữa footer để mở danh sách kinh. Hoặc nhập vào <strong>Tìm kiếm</strong> để tìm bài kinh.</li>' +
'</ul>' +
'<h3>⭐ Đánh dấu (Bookmark)</h3>' +
'<ul>' +
'<li>Bấm <strong>☆</strong> cạnh tiêu đề bài đang đọc (góc trên-trái) để lưu / bỏ lưu bài kinh yêu thích.</li>' +
'<li>Tile <strong>★ Đã lưu</strong> hiện số bài yêu thích đã lưu.</li>' +
'</ul>' +
'<h3>📜 Đọc kinh</h3>' +
'<ul>' +
'<li>Nút <strong>‹ TRƯỚC / SAU ›</strong>: dùng chuyển bài kinh.</li>' +
'<li><strong>⬆</strong>: về đầu bài kinh.</li>' +
'<li>Thanh tiến độ đọc dọc bên trái + badge <code>%</code> góc dưới-phải: cho biết đã đọc tới đâu. Tắt/bật trong Cài đặt (nút <code>▮ %</code>).</li>' +
'</ul>' +
'<h3>🔗 Chia sẻ & Sao chép</h3>' +
'<ul>' +
'<li><strong>🔗 Share đầu bài</strong> (góc trên-phải): chia sẻ link bài kinh.</li>' +
'<li><strong>🔗 Share đoạn</strong> (icon nhỏ cạnh mã đoạn): chia sẻ link đến đúng đoạn đó.</li>' +
'<li><strong>📋 Copy</strong> cạnh label <code>PĀLI</code> / <code>ENGLISH</code> / <code>VIỆT</code>: sao chép văn bản của cột đó cho đoạn hiện tại.</li>' +
'</ul>' +
'<h3>⚙ Cài đặt</h3>' +
'<ul>' +
'<li><strong>Giao diện</strong>: <strong>🌙/☀</strong> tối/sáng · <strong>VN/EN</strong> ngôn ngữ giao diện · <strong>🖨</strong> in / lưu PDF bài kinh hiện tại. Lưu ý: bài kinh dài (hàng ngàn đoạn) có thể mất vài giây đến vài chục giây để chuẩn bị — vui lòng đợi.</li>' +
'<li><strong>Ngôn ngữ</strong>: bật/tắt cột <code>PĀLI</code> · <code>ENGLISH</code> · <code>VIỆT</code>.</li>' +
'<li><strong>Bố cục</strong>: <code>☰ Xếp dọc</code> — stack 3 cột · <code># Segment</code> — ẩn/hiện mã đoạn · <code>▦ Label</code> — ẩn/hiện nhãn cột.</li>' +
'<li><strong>Cỡ chữ</strong>: slider 80–160% (chỉ áp cho nội dung). <strong>Giãn dòng</strong>: 1.3–2.6.</li>' +
'<li><strong>↺ A</strong> / <strong>↺ ☰</strong>: reset cỡ chữ / giãn dòng về mặc định.</li>' +
'<li><strong>▮ %</strong>: bật/tắt thanh tiến độ đọc (dọc bên trái + badge phần trăm).</li>' +
'<li><strong>🐞</strong>: debug.</li>' +
'</ul>' +
'<h3>🔊 Đọc to (TTS)</h3>' +
'<ul>' +
'<li><strong>▶ Play</strong>: đọc kinh theo ngôn ngữ giao diện (Việt hoặc Anh). Pāli chưa hỗ trợ.</li>' +
'<li><strong>⏸ Pause</strong>: giới hạn trình duyệt — khi tiếp tục sẽ đọc lại câu hiện tại từ đầu.</li>' +
'<li><strong>⏹ Stop</strong>: dừng hẳn, lần sau Play đọc từ đầu bài.</li>' +
'<li><em>*Một số thiết bị không hỗ trợ sẽ không đọc được.</em></li>' +
'</ul>' +
'<h3>ℹ Nguồn</h3>' +
'<p>Văn bản Pāli + bản dịch tiếng Anh Bhikkhu Sujato từ <a href="https://suttacentral.net/" target="_blank" rel="noopener">SuttaCentral</a> (dự án Bilara). Bản dịch tiếng Việt biên tập từ nhiều nguồn, có thể còn sai sót — vui lòng đối chiếu bản Pāli và tiếng Anh.</p>' +
'<p>Góp ý, báo lỗi: <a href="mailto:tuanctvn199@gmail.com">tuanctvn199@gmail.com</a></p>' +
'<button id="btnCloseGuide" type="button">Đóng</button>';
var enHtml =
'<h2>User Guide</h2>' +
'<h3>📖 Sutta Library</h3>' +
'<ul>' +
'<li>Tap <strong>Library</strong> in the footer center to open the sutta list. Or use <strong>Search</strong> to find a sutta.</li>' +
'</ul>' +
'<h3>⭐ Bookmarks</h3>' +
'<ul>' +
'<li>Tap <strong>☆</strong> next to the current sutta title (top-left) to save / unsave a favorite sutta.</li>' +
'<li>The <strong>★ Saved</strong> tile shows the count of saved suttas.</li>' +
'</ul>' +
'<h3>📜 Reading</h3>' +
'<ul>' +
'<li><strong>‹ PREV / NEXT ›</strong> buttons: navigate between suttas.</li>' +
'<li><strong>⬆</strong>: jump to the top of the sutta.</li>' +
'<li>Reading progress bar (left edge) + <code>%</code> badge (bottom-right): shows how far you have read. Toggle in Settings (<code>▮ %</code>).</li>' +
'</ul>' +
'<h3>🔗 Share & Copy</h3>' +
'<ul>' +
'<li><strong>🔗 Title share</strong> (top-right): share link to the sutta.</li>' +
'<li><strong>🔗 Segment share</strong> (small icon next to segment ID): share link to that exact segment.</li>' +
'<li><strong>📋 Copy</strong> next to <code>PĀLI</code> / <code>ENGLISH</code> / <code>VIỆT</code> labels: copy the text of that column for the current segment.</li>' +
'</ul>' +
'<h3>⚙ Settings</h3>' +
'<ul>' +
'<li><strong>Interface</strong>: <strong>🌙/☀</strong> dark/light · <strong>VN/EN</strong> interface language · <strong>🖨</strong> print / save current sutta to PDF. Note: long suttas (thousands of segments) may take a few seconds to tens of seconds to prepare — please wait.</li>' +
'<li><strong>Languages</strong>: toggle <code>PĀLI</code> · <code>ENGLISH</code> · <code>VIỆT</code> columns.</li>' +
'<li><strong>Layout</strong>: <code>☰ Stack</code> — stack 3 columns · <code># Segment</code> — show/hide segment IDs · <code>▦ Label</code> — show/hide column headers.</li>' +
'<li><strong>Font size</strong>: slider 80–160% (body text only). <strong>Line height</strong>: 1.3–2.6.</li>' +
'<li><strong>↺ A</strong> / <strong>↺ ☰</strong>: reset font size / line height.</li>' +
'<li><strong>▮ %</strong>: toggle reading progress bar.</li>' +
'<li><strong>🐞</strong>: debug.</li>' +
'</ul>' +
'<h3>🔊 Text-to-Speech (TTS)</h3>' +
'<ul>' +
'<li><strong>▶ Play</strong>: reads in UI language (VI or EN). Pāli not supported.</li>' +
'<li><strong>⏸ Pause</strong>: browser limitation — resume restarts the current sentence.</li>' +
'<li><strong>⏹ Stop</strong>: stops entirely; next Play starts from the beginning.</li>' +
'<li><em>*Some devices may not support TTS and won\'t read.</em></li>' +
'</ul>' +
'<h3>ℹ Sources</h3>' +
'<p>Pāli text and Bhikkhu Sujato English translations from <a href="https://suttacentral.net/" target="_blank" rel="noopener">SuttaCentral</a> (Bilara project). Vietnamese translations compiled from multiple sources — please cross-reference with Pāli and English originals.</p>' +
'<p>Feedback / bug reports: <a href="mailto:tuanctvn199@gmail.com">tuanctvn199@gmail.com</a></p>' +
'<button id="btnCloseGuide" type="button">Close</button>';
dlg.innerHTML = isEn ? enHtml : viHtml;
var btnClose = $('btnCloseGuide');
if (btnClose) btnClose.onclick = closeGuide;
}
function openGuide() {
if (!guideOverlay) return;
renderGuideDialog();
guideOverlay.classList.add('show');
guideOverlay.setAttribute('aria-hidden', 'false');
var dialog = guideOverlay.querySelector('.guide-dialog');
if (dialog) dialog.scrollTop = 0;
setTimeout(function () { var b = $('btnCloseGuide'); if (b) b.focus({ preventScroll: true }); }, 50);
}
function closeGuide() {
if (!guideOverlay) return;
guideOverlay.classList.remove('show');
guideOverlay.setAttribute('aria-hidden', 'true');
if (btnGuide) btnGuide.focus();
}
/* ============================================================
Panel top position
============================================================ */
// Tạo một biến để theo dõi sự thay đổi kích thước
var resizeObserver = new ResizeObserver(entries => {
for (let entry of entries) {
// Chỉ cập nhật khi trình duyệt rảnh (requestAnimationFrame)
requestAnimationFrame(() => {
if (sutraMenuPanel) {
sutraMenuPanel.style.top = entry.contentRect.height + 'px';
}
});
}
});
function updateMenuPanelTop() {
if (!card) return;
var topNote = card.querySelector('.top-note');
if (topNote) {
// Disconnect cũ trước khi observe element mới — tránh leak khi gọi nhiều lần.
resizeObserver.disconnect();
resizeObserver.observe(topNote);
} else if (sutraMenuPanel) {
sutraMenuPanel.style.top = '0px';
}
}
/* ============================================================
PANEL LOGIC
============================================================ */
function togglePanel(panel, force) {
if (!panel) return;
var isOpen = typeof force === 'boolean' ? force : !panel.classList.contains('open');
if (!isOpen && panel.contains(document.activeElement)) {
try {
// Trả focus về đúng nút trigger của panel đang đóng (settings → btnSettings,
// library → btnSutraMenu). Trước đây hardcode btnSutraMenu cho mọi panel.
var triggerBtn = (panel === settingsPanel) ? btnSettings
              : (panel === sutraMenuPanel) ? btnSutraMenu
              : null;
if (triggerBtn) triggerBtn.focus();
else document.activeElement.blur();
} catch(_){}
}
try {
panel.classList.toggle('open', isOpen);
if (isOpen) {
panel.setAttribute('aria-hidden', 'false');
panel.removeAttribute('inert');
} else {
panel.setAttribute('aria-hidden', 'true');
panel.setAttribute('inert', '');
}
} finally {
if (panel === settingsPanel && btnSettings) {
btnSettings.setAttribute('aria-expanded', String(isOpen));
btnSettings.classList.toggle('active', isOpen);
if (!isOpen) _clearStickyHover(btnSettings);
document.body.classList.toggle('settings-open', isOpen);
}
if (panel === sutraMenuPanel && btnSutraMenu) {
btnSutraMenu.setAttribute('aria-expanded', String(isOpen));
btnSutraMenu.classList.toggle('is-open', isOpen);
if (!isOpen) _clearStickyHover(btnSutraMenu);
}
}
}
/* Touch device fix: khi user tap nút để đóng panel, browser giữ :hover/:active
   trên element vừa touch → ghost background quanh nút. Blur + force "no-hover"
   class trong 280ms → CSS sẽ override mọi state về transparent → hết ghost. */
function _clearStickyHover(btn) {
if (!btn) return;
try { btn.blur(); } catch(_){}
btn.classList.add('no-hover');
setTimeout(function () { btn.classList.remove('no-hover'); }, 280);
}
function positionSettingsPanel() {
if (!settingsPanel || !btnSettings) return;
var r = btnSettings.getBoundingClientRect();
var footer = document.querySelector('.status');
var footerH = footer ? footer.offsetHeight : (window.innerHeight - r.top);
settingsPanel.style.left   = r.left + 'px';
settingsPanel.style.bottom = (footerH + 8) + 'px';
settingsPanel.style.top    = 'auto';
settingsPanel.style.right  = 'auto';
}
function closePanels() {
togglePanel(settingsPanel, false);
togglePanel(sutraMenuPanel, false);
}
if (btnSutraMenu) {
btnSutraMenu.onclick = function (e) {
e.stopPropagation();
var willOpen = !sutraMenuPanel.classList.contains('open');
togglePanel(settingsPanel, false);
togglePanel(sutraMenuPanel, willOpen);
// Defensive: nếu list rỗng khi mở (race condition / init chưa xong),
// re-render nikaya đang active để đảm bảo user luôn thấy danh sách.
if (willOpen && sutraMenuList && sutraMenuList.children.length === 0) {
var nikKey = activeNikayaKey || (window.SUTRA_INDEX && window.SUTRA_INDEX[0] && window.SUTRA_INDEX[0].key);
if (nikKey) {
if (!window.SUTRA_INDEX || !window.SUTRA_INDEX.length) return;
// Nếu buildSutraMenuFromIndex chưa chạy, chạy full flow
if (!FLAT_SUTTAS.length) buildSutraMenuFromIndex();
else setActiveNikaya(nikKey, false);
}
}
};
}
// Nút × đóng panel Thư viện (compat UI mới)
var menuCloseBtn = $('menuCloseBtn');
if (menuCloseBtn) {
menuCloseBtn.onclick = function (e) {
e.stopPropagation();
togglePanel(sutraMenuPanel, false);
};
}
if (btnSettings) {
btnSettings.onclick = function (e) {
e.stopPropagation();
var willOpen = !settingsPanel.classList.contains('open');
if (willOpen) {
/* Close sutraMenuPanel first (togglePanel will safely move focus
out of the panel before setting inert) */
togglePanel(sutraMenuPanel, false);
positionSettingsPanel();
}
togglePanel(settingsPanel, willOpen);
_blurIfMouse(btnSettings);
};
}
var btnSettingsClose = $('btnSettingsClose');
if (btnSettingsClose) {
btnSettingsClose.onclick = function (e) {
e.stopPropagation();
togglePanel(settingsPanel, false);
};
}
if (btnGuide && guideOverlay) {
btnGuide.onclick = function (e) {
e.stopPropagation();
openGuide();  // mở guide overlay, giữ nguyên sidebar
};
}
var dedTextEl = $('dedicationText');
if (dedTextEl) {
dedTextEl.classList.add('ded-clickable');
dedTextEl.setAttribute('title', uiLang === 'en' ? 'Double-click to return to home' : 'Nháy đôi để về trang chủ');
dedTextEl.addEventListener('dblclick', function (e) {
e.preventDefault();
try { storage.remove(KEY_LAST); } catch(_) {}
location.replace(location.pathname + location.search);
});
}
if (guideOverlay) {
guideOverlay.addEventListener('click', function (e) {
if (e.target === guideOverlay) closeGuide();
});
}
document.addEventListener('click', function (e) {
var t = e.target;
if (sutraMenuPanel && sutraMenuPanel.contains(t)) return;
if (settingsPanel && settingsPanel.contains(t)) return;
if (btnSutraMenu && btnSutraMenu.contains(t)) return;
// Don't close sidebar when interacting with guide overlay
if (guideOverlay && guideOverlay.contains(t)) return;
closePanels();
});
document.addEventListener('keydown', function (e) {
if (e.key === 'Escape') {
if (guideOverlay && guideOverlay.classList.contains('show')) return closeGuide();
closePanels();
}
});
var showSegKey = true;
var showColHdr = true;
// 3 toggle riêng cho comment theo lang. Master = derived state: "any of 3 is ON".
var showCmtPli = true;
var showCmtEng = true;
var showCmtVie = true;
// 3 toggle nổi bật (italic + ink đậm, giống Pāli hiện tại)
var hlPli = true;   // default ON — Pāli theo convention kinh điển italic
var hlEng = false;
var hlVie = false;
var show3Cols = false;      // bố cục 3 cột bằng nhau (thay vì Pali trên, Eng+Việt dưới)
var paragraphBreak = true;  // luôn ON — paragraph đều đặn
var PARAGRAPH_BREAK_LEN = 5;
function saveViewPrefs() {
storage.set(KEY_VIEW, JSON.stringify({
showPali: showPali, showEng: showEng, showVie: showVie,
stack: card ? card.classList.contains('stack') : false,
showSegKey: showSegKey, showColHdr: showColHdr,
showCmtPli: showCmtPli, showCmtEng: showCmtEng, showCmtVie: showCmtVie,
hlPli: hlPli, hlEng: hlEng, hlVie: hlVie,
show3Cols: show3Cols
}));
}
function loadViewPrefs() {
try {
var raw = storage.get(KEY_VIEW);
if (!raw) return;
var v = JSON.parse(raw);
if (typeof v.showPali === 'boolean') showPali = v.showPali;
if (typeof v.showEng  === 'boolean') showEng  = v.showEng;
if (typeof v.showVie  === 'boolean') showVie  = v.showVie;
if (card && typeof v.stack === 'boolean') card.classList.toggle('stack', v.stack);
if (typeof v.showSegKey === 'boolean') showSegKey = v.showSegKey;
if (typeof v.showColHdr === 'boolean') showColHdr = v.showColHdr;
if (typeof v.showCmtPli === 'boolean') showCmtPli = v.showCmtPli;
if (typeof v.showCmtEng === 'boolean') showCmtEng = v.showCmtEng;
if (typeof v.showCmtVie === 'boolean') showCmtVie = v.showCmtVie;
if (typeof v.hlPli === 'boolean') hlPli = v.hlPli;
if (typeof v.hlEng === 'boolean') hlEng = v.hlEng;
if (typeof v.hlVie === 'boolean') hlVie = v.hlVie;
if (typeof v.show3Cols === 'boolean') show3Cols = v.show3Cols;
} catch(e){}
}
function applySegKeyHdrVis() {
if (!grid) return;
grid.classList.toggle('hide-seg-key', !showSegKey);
grid.classList.toggle('hide-col-header', !showColHdr);
grid.classList.toggle('hide-cmt-pli', !showCmtPli);
grid.classList.toggle('hide-cmt-eng', !showCmtEng);
grid.classList.toggle('hide-cmt-vie', !showCmtVie);
grid.classList.toggle('hl-pli', !!hlPli);
grid.classList.toggle('hl-eng', !!hlEng);
grid.classList.toggle('hl-vie', !!hlVie);
if (card) card.classList.toggle('grid-3cols', !!show3Cols);
}
var mql = window.matchMedia('(max-width: 500px)');
function updateVisibleCols() {
var isNarrow = mql.matches;
var isStack = card?.classList.contains('stack') || false;
let count = (showPali ? 1 : 0) + (showEng ? 1 : 0) + (showVie ? 1 : 0);
count = Math.max(1, count);
requestAnimationFrame(() => {
document.documentElement.style.setProperty('--visible-cols', isNarrow || isStack ? '1' : String(count));
});
}
mql.addEventListener('change', updateVisibleCols);
function applyVisibility() {
if (!grid) return;
grid.classList.toggle('hide-pali', !showPali);
grid.classList.toggle('hide-eng',  !showEng);
grid.classList.toggle('hide-vie',  !showVie);
updateVisibleCols();
}
window.addEventListener('resize', function () { updateVisibleCols(); updateMenuPanelTop(); });
// Khi ẩn 1 ngôn ngữ → tắt Highlight + Commentary của ngôn ngữ đó (đồng bộ),
// nhưng nhớ trạng thái cũ vào _langDepsBackup để khôi phục khi hiện lại.
var _langDepsBackup = { pli: null, eng: null, vie: null };
function _applyHlBtnUi(lang) {
var on = lang === 'pli' ? hlPli : lang === 'eng' ? hlEng : hlVie;
var id = lang === 'pli' ? 'btnHlPli' : lang === 'eng' ? 'btnHlEng' : 'btnHlVie';
var b = $(id);
if (b) { b.classList.toggle('active', !!on); b.setAttribute('aria-pressed', String(!!on)); }
}
function _syncDepsOnLangHide(lang) {
if (lang === 'pli') {
_langDepsBackup.pli = { hl: hlPli, cmt: showCmtPli };
hlPli = false; showCmtPli = false;
} else if (lang === 'eng') {
_langDepsBackup.eng = { hl: hlEng, cmt: showCmtEng };
hlEng = false; showCmtEng = false;
} else if (lang === 'vie') {
_langDepsBackup.vie = { hl: hlVie, cmt: showCmtVie };
hlVie = false; showCmtVie = false;
}
_applyHlBtnUi(lang);
syncCmtButtons();
applySegKeyHdrVis();
}
function _syncDepsOnLangShow(lang) {
var bak = _langDepsBackup[lang];
if (!bak) return;  // không có backup → giữ nguyên (false)
if (lang === 'pli')      { hlPli = !!bak.hl; showCmtPli = !!bak.cmt; }
else if (lang === 'eng') { hlEng = !!bak.hl; showCmtEng = !!bak.cmt; }
else if (lang === 'vie') { hlVie = !!bak.hl; showCmtVie = !!bak.cmt; }
_langDepsBackup[lang] = null;
_applyHlBtnUi(lang);
syncCmtButtons();
applySegKeyHdrVis();
}
if (btnPali) btnPali.onclick = function () {
if (showPali && (showEng || showVie)) { /* will set false */ }
else if (!showPali) { /* will set true */ }
else { return; }
preserveTopAndSave(function () {
showPali = !showPali;
btnPali.classList.toggle('active', showPali);
btnPali.setAttribute('aria-pressed', String(showPali));
if (!showPali) _syncDepsOnLangHide('pli'); else _syncDepsOnLangShow('pli');
applyVisibility(); saveViewPrefs(); maybeRerenderIfModeChanged();
});
};
if (btnEng) btnEng.onclick = function () {
if (showEng && (showPali || showVie)) { /* will set false */ }
else if (!showEng) { /* will set true */ }
else { return; }
preserveTopAndSave(function () {
showEng = !showEng;
btnEng.classList.toggle('active', showEng);
btnEng.setAttribute('aria-pressed', String(showEng));
if (!showEng) _syncDepsOnLangHide('eng'); else _syncDepsOnLangShow('eng');
applyVisibility(); saveViewPrefs(); maybeRerenderIfModeChanged();
});
};
if (btnVie) btnVie.onclick = function () {
if (showVie && (showPali || showEng)) { /* will set false */ }
else if (!showVie) { /* will set true */ }
else { return; }
preserveTopAndSave(function () {
showVie = !showVie;
btnVie.classList.toggle('active', showVie);
btnVie.setAttribute('aria-pressed', String(showVie));
if (!showVie) _syncDepsOnLangHide('vie'); else _syncDepsOnLangShow('vie');
applyVisibility(); saveViewPrefs(); maybeRerenderIfModeChanged();
});
};
if (btnLayout) btnLayout.onclick = function () {
preserveTopAndSave(function () {
if (card) card.classList.toggle('stack');
var isStack = card ? card.classList.contains('stack') : false;
btnLayout.classList.toggle('active', isStack);
btnLayout.setAttribute('aria-pressed', String(isStack));
if (isStack && show3Cols) {
show3Cols = false;
if (card) card.classList.remove('grid-3cols');
var _b3c = $('btn3Cols');
if (_b3c) { _b3c.classList.remove('active'); _b3c.setAttribute('aria-pressed', 'false'); }
}
updateVisibleCols(); saveViewPrefs();
});
};
var btnSegKey = $('btnSegKey');
if (btnSegKey) btnSegKey.onclick = function () {
preserveTopAndSave(function () {
showSegKey = !showSegKey;
btnSegKey.classList.toggle('active', showSegKey);
btnSegKey.setAttribute('aria-pressed', String(showSegKey));
applySegKeyHdrVis();
saveViewPrefs();
});
};
var btnSegHdr = $('btnSegHdr');
if (btnSegHdr) btnSegHdr.onclick = function () {
preserveTopAndSave(function () {
showColHdr = !showColHdr;
btnSegHdr.classList.toggle('active', showColHdr);
btnSegHdr.setAttribute('aria-pressed', String(showColHdr));
applySegKeyHdrVis();
saveViewPrefs();
});
};
function anyCmtOn() { return showCmtPli || showCmtEng || showCmtVie; }
function syncCmtButtons() {
var pairs = [['btnCmtPli', showCmtPli], ['btnCmtEng', showCmtEng], ['btnCmtVie', showCmtVie]];
for (var i = 0; i < pairs.length; i++) {
var b = $(pairs[i][0]); if (!b) continue;
b.classList.toggle('active', pairs[i][1]);
b.setAttribute('aria-pressed', String(pairs[i][1]));
}
var m = $('btnCmtMaster');
if (m) {
var any = anyCmtOn();
m.classList.toggle('active', any);
m.setAttribute('aria-pressed', String(any));
}
}
function wireLangCmt(btnId, setter) {
var btn = $(btnId); if (!btn) return;
btn.onclick = function () {
preserveTopAndSave(function () {
setter();
syncCmtButtons();
applySegKeyHdrVis();
saveViewPrefs();
});
};
}
wireLangCmt('btnCmtPli', function(){ showCmtPli = !showCmtPli; });
wireLangCmt('btnCmtEng', function(){ showCmtEng = !showCmtEng; });
wireLangCmt('btnCmtVie', function(){ showCmtVie = !showCmtVie; });
var btnCmtMaster = $('btnCmtMaster');
if (btnCmtMaster) btnCmtMaster.onclick = function () {
preserveTopAndSave(function () {
var target = !anyCmtOn();
showCmtPli = target; showCmtEng = target; showCmtVie = target;
syncCmtButtons();
applySegKeyHdrVis();
saveViewPrefs();
});
};
function wireHlToggle(btnId, setter) {
var btn = $(btnId); if (!btn) return;
btn.onclick = function () {
preserveTopAndSave(function () {
setter();
applySegKeyHdrVis();
var active = (btnId === 'btnHlPli') ? hlPli : (btnId === 'btnHlEng') ? hlEng : hlVie;
btn.classList.toggle('active', active);
btn.setAttribute('aria-pressed', String(active));
saveViewPrefs();
});
};
}
wireHlToggle('btnHlPli', function(){ hlPli = !hlPli; });
wireHlToggle('btnHlEng', function(){ hlEng = !hlEng; });
wireHlToggle('btnHlVie', function(){ hlVie = !hlVie; });
var btn3Cols = $('btn3Cols');
if (btn3Cols) btn3Cols.onclick = function () {
preserveTopAndSave(function () {
show3Cols = !show3Cols;
btn3Cols.classList.toggle('active', show3Cols);
btn3Cols.setAttribute('aria-pressed', String(show3Cols));
if (card) card.classList.toggle('grid-3cols', show3Cols);
if (show3Cols && card && card.classList.contains('stack')) {
card.classList.remove('stack');
if (btnLayout) { btnLayout.classList.remove('active'); btnLayout.setAttribute('aria-pressed', 'false'); }
}
updateVisibleCols();
saveViewPrefs();
});
};
function applyWideLayout(on) {
isWide = !!on;
document.documentElement.classList.toggle('layout-wide', isWide);
if (btnFullWidth) {
btnFullWidth.classList.toggle('active', isWide);
btnFullWidth.setAttribute('aria-pressed', String(isWide));
}
}
if (btnFullWidth) {
applyWideLayout(isWide);
btnFullWidth.addEventListener('click', function () {
applyWideLayout(!isWide);
storage.set(WIDE_STORAGE_KEY, isWide ? '1' : '0');
});
}

// ── zoom.js ─────────────────────────────────────────────────────
var ZOOM_STORAGE_KEY = 'sutra_zoom';
var LH_STORAGE_KEY   = 'sutra_line_height';
var MIN_ZOOM=0.8, MAX_ZOOM=1.6, MIN_LH=1.3, MAX_LH=2.6;
var zoomLevel=1, lineHeightLevel=1.85;
var sliderZoom       = $('sliderZoom');
var sliderLineHeight = $('sliderLineHeight');
var zoomBadge        = $('zoomValueBadge');
var lhBadge          = $('lineHeightValueBadge');
var btnZoomReset     = $('btnZoomReset');
var btnLhReset       = $('btnLineHeightReset');
function clampZoom(z) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)); }
function clampLh(v)   { return Math.max(MIN_LH,   Math.min(MAX_LH, v)); }
function updateSliderFill(el, min, max, val) {
if (!el) return;
el.style.setProperty('--slider-pct', ((val - min) / (max - min) * 100).toFixed(1) + '%');
}
function applyZoom() {
document.documentElement.style.setProperty('--sutra-font-scale', String(zoomLevel));
var pct = Math.round(zoomLevel * 100);
if (zoomBadge) zoomBadge.textContent = pct + '%';
if (sliderZoom) { sliderZoom.value = String(pct); updateSliderFill(sliderZoom, 80, 160, pct); }
}
function applyLineHeight() {
document.documentElement.style.setProperty('--sutra-line-height', String(lineHeightLevel));
if (lhBadge) lhBadge.textContent = lineHeightLevel.toFixed(2);
if (sliderLineHeight) {
var val = Math.round(lineHeightLevel * 100);
sliderLineHeight.value = String(val);
updateSliderFill(sliderLineHeight, 130, 260, val);
}
}
function loadZoom() {
var s = storage.get(ZOOM_STORAGE_KEY);
if (s) { var v = parseFloat(s); if (!Number.isNaN(v)) zoomLevel = clampZoom(v); }
applyZoom();
}
function loadLineHeight() {
var s = storage.get(LH_STORAGE_KEY);
if (s) { var v = parseFloat(s); if (!Number.isNaN(v)) lineHeightLevel = clampLh(v); }
applyLineHeight();
}
function saveZoom()       { storage.set(ZOOM_STORAGE_KEY, String(zoomLevel)); }
function saveLineHeight() { storage.set(LH_STORAGE_KEY, String(lineHeightLevel)); }
if (sliderZoom) sliderZoom.addEventListener('input', function () {
zoomLevel = clampZoom(parseInt(sliderZoom.value, 10) / 100); applyZoom(); saveZoom();
});
if (sliderLineHeight) sliderLineHeight.addEventListener('input', function () {
lineHeightLevel = clampLh(parseInt(sliderLineHeight.value, 10) / 100); applyLineHeight(); saveLineHeight();
});
if (btnZoomReset) btnZoomReset.onclick = function () { zoomLevel = 1; applyZoom(); saveZoom(); };
if (btnLhReset)   btnLhReset.onclick   = function () { lineHeightLevel = 1.85; applyLineHeight(); saveLineHeight(); };
/* Reading progress toggle — persist via localStorage */
(function _wireProgressToggle() {
var btn = $('btnProgressToggle');
if (!btn) return;
var KEY = 'sutra_show_progress';
function apply(on) {
document.documentElement.classList.toggle('hide-reading-progress', !on);
btn.setAttribute('aria-pressed', String(!!on));
btn.classList.toggle('active', !!on);
}
var saved = null;
try { saved = storage.get(KEY); } catch(_){}
var isOn = saved !== '0';  // default ON
apply(isOn);
btn.addEventListener('click', function () {
isOn = !isOn;
apply(isOn);
try { storage.set(KEY, isOn ? '1' : '0'); } catch(_){}
if (isOn) try { updateReadingProgress(); } catch(_){}
});
})();

// ── anchor.js ───────────────────────────────────────────────────
var anchorObserver = null;
var firstVisibleKey = null;
var vaggaMarkers = [];
var suttaMarkers = [];
var keyToRowIdx = Object.create(null);
var isAN = false;
var isSN = false;
var fallbackTitle = '';
var fallbackTitleMeta = '';
var superLastSlotEl = null;
var lastAppliedVaggaIdx = -2;
var lastAppliedSuttaIdx = -2;
function getScrollRoot() {
return readerArea || grid;
}
function findActiveMarkerIdx(markers, curIdx) {
var idx = -1;
for (var v = 0; v < markers.length; v++) {
if (markers[v].rowIdx <= curIdx) idx = v;
else break;
}
return idx;
}
function pickPrimaryByLang(marker) {
return uiLang === 'en'
? (marker.titleEn || marker.titlePali || marker.titleVi || '').trim()
: (marker.titleVi || marker.titleEn || marker.titlePali || '').trim();
}
function pickAltByLang(marker) {
return uiLang === 'en'
? (marker.titleVi || marker.titlePali || '').trim()
: (marker.titleEn || marker.titlePali || '').trim();
}
function updateDynamicTitles() {
if (!isAN && !isSN) return;
var curIdx = firstVisibleKey ? (keyToRowIdx[firstVisibleKey]) : undefined;
if (curIdx === undefined) curIdx = -1;
if (isAN) {
var anIdx = findActiveMarkerIdx(vaggaMarkers, curIdx);
if (anIdx !== lastAppliedSuttaIdx) {
if (anIdx < 0) {
if (titleEl) titleEl.textContent = fallbackTitle;
if (titleMetaEl) titleMetaEl.textContent = fallbackTitleMeta;
} else {
var vmA = vaggaMarkers[anIdx];
if (titleEl) titleEl.textContent = pickPrimaryByLang(vmA) || fallbackTitle;
if (titleMetaEl) titleMetaEl.textContent = pickAltByLang(vmA) || fallbackTitleMeta;
}
lastAppliedSuttaIdx = anIdx;
}
return;
}
// SN: vagga appended AFTER Saṁyutta (not replacing) — sub-sutta drives h1 + titleMeta
var vIdx = findActiveMarkerIdx(vaggaMarkers, curIdx);
if (vIdx !== lastAppliedVaggaIdx && superLastSlotEl) {
var vaggaText = vIdx < 0 ? '' : (pickPrimaryByLang(vaggaMarkers[vIdx]) || '');
superLastSlotEl.textContent = vaggaText;
if (superLastSlotEl._sep) superLastSlotEl._sep.style.display = vaggaText ? '' : 'none';
lastAppliedVaggaIdx = vIdx;
}
var sIdx = findActiveMarkerIdx(suttaMarkers, curIdx);
if (sIdx !== lastAppliedSuttaIdx) {
if (sIdx < 0) {
if (titleEl) titleEl.textContent = fallbackTitle;
if (titleMetaEl) titleMetaEl.textContent = fallbackTitleMeta;
} else {
var sm = suttaMarkers[sIdx];
if (titleEl) titleEl.textContent = pickPrimaryByLang(sm) || fallbackTitle;
if (titleMetaEl) titleMetaEl.textContent = pickAltByLang(sm) || fallbackTitleMeta;
}
lastAppliedSuttaIdx = sIdx;
}
}
function setupAnchorObserver() {
if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
var scrollRoot = getScrollRoot();
if (!scrollRoot) return;
// IO `entries` chỉ chứa rows có intersection state CHANGED, không phải tất cả rows
// đang intersect. Pick `min(boundingClientRect.top)` từ batch sẽ chọn nhầm row đang
// SCROLL RA KHỎI TOP (top âm rất lớn vì đa phần đã trôi lên trên viewport) làm
// firstVisibleKey → save anchor lệch lên, restore bị "nhảy lên trên".
// Fix: dùng IO làm trigger thuần; key thật compute bằng DOM scan strict
// (computeTopVisibleKey — first row có top >= viewport top), throttle để tránh
// burst-fire khi nhiều rows đổi state cùng lúc trong fast-scroll.
var _ioRescan = throttle(function () {
var k = computeTopVisibleKey();
if (k) firstVisibleKey = k;
updateDynamicTitles();
}, 80);
anchorObserver = new IntersectionObserver(_ioRescan, { root: scrollRoot, rootMargin: '0px 0px -80% 0px', threshold: 0 });
scrollRoot.querySelectorAll('.sutra-row').forEach(function (r) { anchorObserver.observe(r); });
}
function computeTopVisibleKey() {
// Compute đồng bộ từ DOM — tránh lag của IntersectionObserver.
// Strict "first fully visible": row đầu tiên có top >= viewport.top.
// Matches test definition — không dùng tolerance để tránh off-by-1 mismatch.
var scrollRoot = getScrollRoot();
if (!scrollRoot) return null;
var rootRect = scrollRoot.getBoundingClientRect();
var topBoundary = rootRect.top;
var rows = scrollRoot.querySelectorAll('.sutra-row[data-key]');
for (var i = 0; i < rows.length; i++) {
var rect = rows[i].getBoundingClientRect();
if (rect.top >= topBoundary) {
return rows[i].getAttribute('data-key') || null;
}
}
// Fallback: first row with any visibility at top (only if no row fully visible)
for (var j = 0; j < rows.length; j++) {
var rect2 = rows[j].getBoundingClientRect();
if (rect2.bottom > topBoundary) {
return rows[j].getAttribute('data-key') || null;
}
}
return null;
}
var _progScrollUntil = 0; // timestamp sau đó scroll save resume
function preserveTopAndSave(action) {
var topKey = computeTopVisibleKey();
// Cancel mọi pending debounce save để không overwrite topKey mình sắp save
if (typeof _saveAnchorDebounced !== 'undefined' && _saveAnchorDebounced && _saveAnchorDebounced.cancel) {
_saveAnchorDebounced.cancel();
}
if (topKey && currentSutraId) {
_progScrollUntil = Date.now() + 1500;  // 1500ms cover smooth scroll + reflow trên low-end Android
firstVisibleKey = topKey;
anchorSet(KEY_ANCHOR_K(currentSutraId), topKey);
}
action();
if (!topKey || !currentSutraId) return;
requestAnimationFrame(function () {
var scrollRoot = getScrollRoot();
if (!scrollRoot) return;
var safeKey = safeCssEscape(topKey);
var row = scrollRoot.querySelector('.sutra-row[data-key="' + safeKey + '"]');
if (!row) return;
var tgt = row.closest('.sutra-row-wrap') || row;
var rootRect = scrollRoot.getBoundingClientRect();
var tgtRect = tgt.getBoundingClientRect();
var y = tgtRect.top - rootRect.top + scrollRoot.scrollTop;
var max = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
var targetY = Math.max(0, Math.min(y, max));
if (Math.abs(targetY - scrollRoot.scrollTop) > 1) {
_progScrollUntil = Date.now() + 1500;
scrollRoot.scrollTop = targetY;
}
if (_saveAnchorDebounced && _saveAnchorDebounced.cancel) _saveAnchorDebounced.cancel();
});
}
var _retrySaveTimer = 0;
function _scheduleRetrySave(after) {
// Single timer — coalesce multiple suppress-skip retries vào 1 lần fire sau cùng.
if (_retrySaveTimer) clearTimeout(_retrySaveTimer);
_retrySaveTimer = setTimeout(function () {
_retrySaveTimer = 0;
saveScrollAnchorNow();
}, Math.max(50, after));
}
function saveScrollAnchorNow() {
if (!currentSutraId) return;
var now = Date.now();
if (now < _progScrollUntil) {
// CRITICAL bug fix: nếu user scroll trong cửa sổ programmatic-scroll rồi DỪNG,
// debounced save fire 1 lần và bị skip ở đây → không lần save nào nữa cho đến scroll
// tiếp theo → anchor stale (vd: anchor 27.5 nhưng vị trí thực 3.1).
// Schedule retry sau khi window hết để bắt vị trí cuối user dừng.
if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — programmatic scroll window, retry in', _progScrollUntil - now);
_scheduleRetrySave(_progScrollUntil - now + 50);
return;
}
if (isRendering) {
if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — isRendering=true, retry in 150');
_scheduleRetrySave(150);
return;
}
var scrollRoot = getScrollRoot();
if (!scrollRoot || scrollRoot.scrollTop === 0) {
anchorRemove(KEY_ANCHOR_K(currentSutraId));
_clearAnchorHash();
if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] cleared (scrollTop=0) for', currentSutraId);
return;
}
// Ưu tiên cache từ IntersectionObserver (O(1)) — chỉ scan DOM khi cache trống.
// Trên file lớn (hàng nghìn rows), DOM scan + getBoundingClientRect loop là bottleneck chính.
var topKey = firstVisibleKey || computeTopVisibleKey();
if (!topKey) {
if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — no top key computable');
return;
}
firstVisibleKey = topKey; // sync cache để updateDynamicTitles nhất quán
anchorSet(KEY_ANCHOR_K(currentSutraId), topKey);
_writeAnchorHash(topKey);
if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE]', currentSutraId, '→', topKey, 'scrollTop=' + scrollRoot.scrollTop);
}
function restoreScrollByAnchor(id) {
var scrollRoot = getScrollRoot();
if (!scrollRoot) return false;
try {
var key = getAnchorKeyFor(id);
if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] id=' + id + ' key=' + key);
if (!key) return false;
var foundIdx = -1;
for (var j = 0; j < virtAllRows.length; j++) {
if (String(virtAllRows[j].key || '') === key) { foundIdx = j; break; }
}
if (foundIdx < 0) {
var savedScopeMatch = String(key).match(/^(.+):(\d+)/);
if (savedScopeMatch) {
var savedScope = savedScopeMatch[1] + ':' + savedScopeMatch[2];
for (var sk = 0; sk < virtAllRows.length; sk++) {
var curKey = String(virtAllRows[sk].key || '');
var m = curKey.match(/^(.+):(\d+)/);
if (m && (m[1] + ':' + m[2]) === savedScope) {
foundIdx = sk;
if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] fallback matched scope "' + savedScope + '" at idx=' + sk + ' key=' + curKey);
break;
}
}
}
}
if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] foundIdx=' + foundIdx + ' in virtAllRows.length=' + virtAllRows.length);
if (foundIdx < 0) return false;
// Chỉ materialize chunk chứa anchor (eager-around-anchor đã render ±1 chunks).
// IntersectionObserver sẽ tự materialize neighbors khi user scroll. Tránh render
// hàng nghìn row sync khi anchor ở cuối file dài.
ensureRowRendered(foundIdx);
if (window.DEBUG_ANCHOR) {
var matCnt = 0;
for (var mc = 0; mc < virtChunks.length; mc++) if (virtChunks[mc].materialized) matCnt++;
console.log('[ANCHOR RESTORE] chunks materialized after ensureRowRendered: ' + matCnt + '/' + virtChunks.length);
}
var safeKey = safeCssEscape(key);
var row = scrollRoot.querySelector('.sutra-row[data-key="' + safeKey + '"]');
if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] DOM row found:', !!row);
if (!row) return false;
var scrollTarget = row.closest('.sutra-row-wrap') || row;
// Suppress save-on-scroll trong correction window — tránh scroll listener fire
// giữa correction steps rồi save anchor ở vị trí trung gian (chưa settle).
// 700ms = 500ms settle-correction (last setTimeout) + 200ms buffer. KHÔNG dài hơn
// để khi user scroll ngay sau restore, save không bị skip quá lâu (kết hợp với
// retry-on-suppress trong saveScrollAnchorNow đã đủ an toàn).
_progScrollUntil = Date.now() + 700;
function scrollToSegmentTop(label) {
var rootRect = scrollRoot.getBoundingClientRect();
var tgtRect  = scrollTarget.getBoundingClientRect();
var y = tgtRect.top - rootRect.top + scrollRoot.scrollTop;
var max = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
y = Math.max(0, Math.min(y, max));
var oldTop = scrollRoot.scrollTop;
if (Math.abs(y - oldTop) > 1) scrollRoot.scrollTop = y;
if (window.DEBUG_ANCHOR) {
console.log('[ANCHOR RESTORE ' + label + '] tgt.top=' + tgtRect.top.toFixed(0) +
' root.top=' + rootRect.top.toFixed(0) +
' relTop=' + (tgtRect.top - rootRect.top).toFixed(0) +
' targetY=' + y.toFixed(0) + ' oldScrollTop=' + oldTop + ' → newScrollTop=' + scrollRoot.scrollTop);
}
}
scrollToSegmentTop('initial');
toggleBackTop(scrollRoot.scrollTop > 0);
requestAnimationFrame(function () { requestAnimationFrame(function () {
scrollToSegmentTop('rAF-correction');
setTimeout(function () { scrollToSegmentTop('timeout-correction'); }, 100);
// Mobile Chrome: address bar collapse/expand transition ~300-500ms khi quay lại tab.
// 100ms-correction có thể chạy giữa lúc layout còn đang shift → vị trí lệch.
// Thêm settle-correction ở 500ms để bắt cuối transition.
setTimeout(function () { scrollToSegmentTop('settle-correction'); }, 500);
}); });
return true;
} catch(e) {
if (window.DEBUG_ANCHOR) console.error('[ANCHOR RESTORE] error:', e);
return false;
}
}
window.addEventListener('pagehide', function (e) {
// Force fresh DOM scan — IO cache có thể stale nếu user vừa scroll xong rời trang ngay.
// Anchor đúng được lưu ở đây phục vụ lần load LẦN SAU (renderSutra → restoreScrollByAnchor),
// KHÔNG dùng cho tab-return (DOM ở memory thì browser tự giữ scrollTop).
firstVisibleKey = null;
saveScrollAnchorNow();
// Chỉ teardown observers khi page thật sự unload. Nếu vào BFCache (e.persisted=true),
// DOM được giữ nguyên → observers vẫn hữu ích khi pageshow restore.
if (!e.persisted) {
if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
teardownChunkObservers();
}
});
window.addEventListener('pageshow', function (e) {
// BFCache restore: DOM + scrollTop được browser giữ nguyên, KHÔNG forced re-anchor.
// (Trước đây block visibilitychange→visible forced restore là nguyên nhân scroll
// "nhảy" trên mobile Chrome — IO cache có lệch 1 segment thì restore kéo sai chỗ.
// Giờ trust browser giữ scrollTop; chỉ re-setup observers nếu pagehide đã teardown.)
if (!e.persisted || !currentSutraId) return;
if (!anchorObserver) setupAnchorObserver();
try { setupChunkObservers(); } catch(_) {}
});
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'hidden') {
// Force fresh DOM scan + bypass _progScrollUntil — user-action (rời tab),
// nếu skip / dùng cache stale thì anchor lưu là vị trí cũ → khi reload restore sai.
firstVisibleKey = null;
var prevProg = _progScrollUntil;
_progScrollUntil = 0;
try { saveScrollAnchorNow(); } finally { _progScrollUntil = prevProg; }
}
// visibilitychange → visible: KHÔNG forced re-anchor.
// Browser đã giữ nguyên scrollTop của DOM in-memory. Forced re-restore với cache có
// thể stale 1 segment → kéo scroll sang chỗ sai → "nhảy" rõ trên mobile Chrome.
// Tin tưởng browser. Drift IO backlog (nếu có) thường <vài px, ko đáng đánh đổi.
});
var suppressBackTop = false;
var _backTopPendingState = null;
var _backTopRAF = 0;
function toggleBackTop(show) {
if (!btnBackTop) return;
// Race fix: scroll fast → multi toggle false→true→false trong cùng frame có thể
// gây nhấp nháy. Batch qua RAF — chỉ áp state CUỐI CÙNG mỗi frame.
_backTopPendingState = !!show;
if (_backTopRAF) return;
_backTopRAF = requestAnimationFrame(function () {
_backTopRAF = 0;
var s = _backTopPendingState;
_backTopPendingState = null;
if (s === null) return;
btnBackTop.classList.toggle('visible', s);
// Android Chrome bug: opacity-based hide có thể bị sticky :hover/:focus thắng dù
// inline !important. display:none là KHÔNG THỂ override — element bị remove khỏi
// render tree → browser không thể keep :hover state.
if (s) {
btnBackTop.style.removeProperty('display');
} else {
btnBackTop.style.setProperty('display', 'none', 'important');
try { btnBackTop.blur(); } catch(_) {}
}
});
}
// Throttle save (leading-edge) + debounce (trailing-edge) cho final stable top sau khi user dừng scroll.
// `pagehide` + `visibilitychange` đã đảm bảo save lúc rời trang nên debounce ngắn là đủ.
// Skip nếu _progScrollUntil > now (suppress window cho programmatic scroll).
var _saveAnchorThrottled = throttle(saveScrollAnchorNow, 250);
var _saveAnchorDebounced = debounce(saveScrollAnchorNow, 200);
var _backTopThrottled = throttle(function (v) { toggleBackTop(v); }, 120);
var _progressIdleTimer = null;
function _ensureProgressElements(wrap) {
var bar = wrap.querySelector('.rp-bar');
if (!bar) {
bar = document.createElement('span');
bar.className = 'rp-bar';
wrap.insertBefore(bar, wrap.firstChild);
}
var existing = wrap.querySelectorAll('.rp-dot');
if (existing.length !== 5) {
Array.prototype.forEach.call(existing, function (d) { d.remove(); });
for (var i = 0; i < 5; i++) {
var d = document.createElement('span');
d.className = 'rp-dot';
d.dataset.idx = String(i);
wrap.appendChild(d);
}
}
return { bar: bar, dots: wrap.querySelectorAll('.rp-dot') };
}
function updateReadingProgress() {
var wrap = document.getElementById('readingProgress');
var pctEl = document.getElementById('readingProgressPct');
if (!wrap || !scrollEl) return;
var max = scrollEl.scrollHeight - scrollEl.clientHeight;
if (max <= 10 || !currentSutraId) {
wrap.classList.remove('visible');
return;
}
var gridRect = scrollEl.getBoundingClientRect();
wrap.style.top = gridRect.top + 'px';
wrap.style.bottom = Math.max(0, window.innerHeight - gridRect.bottom) + 'px';
var pct = Math.min(1, Math.max(0, scrollEl.scrollTop / max));
var wrapH = gridRect.height;
var BAR_HEIGHT = 48;
var DOT_SIZE = 4;
var DOT_SPACING_INIT = (BAR_HEIGHT - DOT_SIZE) / 4;
var leadStart = 8 + (BAR_HEIGHT - DOT_SIZE);
var range = Math.max(0, wrapH - 16 - leadStart);
var leadY = leadStart + pct * range;
var els = _ensureProgressElements(wrap);
var bar = els.bar;
var dots = els.dots;
var BAR_FULL_END = 0.05;
var BAR_FADE_END = 0.08;
var BALL_START_PCT = 0.025;
var BALL_FULL_AT = 0.04;
var BALL_PHASE_TRIGGER = 0.05;
var initLead = leadStart + BALL_PHASE_TRIGGER * range;
var ballPct = Math.max(0, pct - BALL_PHASE_TRIGGER);
var SPEEDS = [1.00, 0.82, 0.64, 0.46, 0.28];
var FADE_WIN = [null, [0.65, 0.97], [0.50, 0.80], [0.35, 0.63], [0.20, 0.43]];
var topDotY = pct < BALL_PHASE_TRIGGER
? (leadY - 4 * DOT_SPACING_INIT)
: (initLead - 4 * DOT_SPACING_INIT) + ballPct * SPEEDS[4] * range;
var barOp;
if (pct <= BAR_FULL_END) barOp = 1;
else if (pct >= BAR_FADE_END) barOp = 0;
else barOp = (BAR_FADE_END - pct) / (BAR_FADE_END - BAR_FULL_END);
bar.style.top = topDotY.toFixed(1) + 'px';
bar.style.height = '';
bar.style.opacity = barOp.toFixed(2);
var gradientFactor = Math.max(0, Math.min(1, (pct - 0.03) / 0.02));
var bottomMix = (100 - 75 * gradientFactor).toFixed(0);
bar.style.background = 'linear-gradient(to bottom,var(--accent) 0%,var(--accent) 30%,color-mix(in oklab,var(--accent) ' + bottomMix + '%,transparent) 100%)';
var dotAppearOp;
if (pct < BALL_START_PCT) dotAppearOp = 0;
else if (pct >= BALL_FULL_AT) dotAppearOp = 1;
else dotAppearOp = (pct - BALL_START_PCT) / (BALL_FULL_AT - BALL_START_PCT);
for (var i = 0; i < 5; i++) {
var dot = dots[i];
var dotY = pct < BALL_PHASE_TRIGGER
? (leadY - i * DOT_SPACING_INIT)
: (initLead - i * DOT_SPACING_INIT) + ballPct * SPEEDS[i] * range;
dot.style.top = dotY.toFixed(1) + 'px';
var op;
var fw = FADE_WIN[i];
if (!fw) {
op = dotAppearOp;
} else if (pct < fw[0]) {
op = dotAppearOp;
} else if (pct >= fw[1]) {
op = 0;
} else {
op = dotAppearOp * (1 - (pct - fw[0]) / (fw[1] - fw[0]));
}
dot.style.opacity = Math.max(0, Math.min(1, op)).toFixed(2);
}
if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
wrap.classList.add('visible');
wrap.classList.remove('idle');
clearTimeout(_progressIdleTimer);
_progressIdleTimer = setTimeout(function () {
wrap.classList.add('idle');
}, 1500);
}
var _readingProgressThrottled = throttle(updateReadingProgress, 80);
if (scrollEl) scrollEl.addEventListener('scroll', function () {
if (!suppressBackTop) _backTopThrottled(scrollEl.scrollTop > 0);
_saveAnchorThrottled();
_saveAnchorDebounced();
_readingProgressThrottled();
}, { passive: true });
window.addEventListener('resize', updateReadingProgress);
if (btnBackTop && scrollEl) btnBackTop.onclick = function () {
suppressBackTop = true;
toggleBackTop(false);
// Khoá chunk compensation suốt quá trình smooth-scroll. Nếu không, materializeChunk
// trên các chunk phía trên viewport sẽ gán `scrollTop += delta` giữa chừng, browser
// xem đó là user-input và HUỶ smooth-scroll → click bị khựng không lên tới top.
_progScrollUntil = Date.now() + 2000;
scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
var doneCalled = false;
var done = function () {
if (doneCalled) return;
doneCalled = true;
suppressBackTop = false;
_progScrollUntil = 0;
toggleBackTop(false);
if (currentSutraId) {
anchorRemove(KEY_ANCHOR_K(currentSutraId));
}
};
// Safety timeout 2s — đảm bảo done() chạy ngay cả khi scrollend không fire
// (browser cũ, page ngắn không scroll, scroll bị interrupt giữa chừng).
setTimeout(done, 2000);
if ('onscrollend' in scrollEl) {
scrollEl.addEventListener('scrollend', done, { once: true });
} else {
var prev = -1;
var poll = function () {
if (doneCalled) return;
var st = scrollEl.scrollTop;
if (st === 0 && st === prev) { done(); return; }
prev = st;
requestAnimationFrame(poll);
};
requestAnimationFrame(poll);
}
};

// ── toc-share.js ────────────────────────────────────────────────
function buildSuttaLinkHtml(s) {
var codePrefix = s.code ? s.code + ' – ' : '';
var viLabel = s.titleVi || '', enLabel = s.titleEn || '', paliLabel = s.titlePali || '';
var mainText, subText;
if (uiLang === 'en') {
mainText = codePrefix + (enLabel || viLabel || paliLabel || s.id);
subText  = paliLabel || viLabel || '';
} else {
mainText = codePrefix + (viLabel || enLabel || paliLabel || s.id);
subText  = paliLabel || enLabel || '';
}
var marked = isBookmarked(s.id);
var bl = bookmarkLabels();
var starTitle = marked ? bl.on : bl.off;
var starHtml =
'<button type="button" class="menu-bookmark-btn' + (marked ? ' is-on' : '') + '" ' +
'data-id="' + escapeAttr(s.id) + '" aria-pressed="' + (marked ? 'true' : 'false') + '" ' +
'aria-label="' + escapeAttr(starTitle) + '" title="' + escapeAttr(starTitle) + '">' +
'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
'<path d="M10 2.3l2.39 4.84 5.34.78-3.86 3.77.91 5.31L10 14.49l-4.78 2.51.91-5.31L2.27 7.92l5.34-.78z"/>' +
'</svg></button>';
return '<a href="#" class="menu-sutta-link" role="treeitem" data-id="' + escapeAttr(s.id) + '" aria-label="' + escapeAttr(mainText) + '">' +
'<div class="sutra-label">' +
'<div class="sutra-label-main">' + escapeHtml(mainText) + '</div>' +
(subText ? '<div class="sutra-label-sub">' + escapeHtml(subText) + '</div>' : '') +
'</div>' + starHtml + '</a>';
}
function extractGroupKey(code) {
var m = String(code || '').match(/^([A-Za-z]+\s*\d+)\s*[–\-]/);
return m ? m[1].trim() : String(code || '').trim();
}
function buildMenuChildren(children, parentId) {
if (!children || !children.length) return '';
var allSutta = true;
for (var k = 0; k < children.length; k++) {
if (children[k].type !== 'sutta') { allSutta = false; break; }
}
if (allSutta) {
var keys = [], groups = {};
for (var i = 0; i < children.length; i++) {
var gk = extractGroupKey(children[i].code);
if (!groups[gk]) { groups[gk] = []; keys.push(gk); }
groups[gk].push(children[i]);
}
var hasMultiChild = keys.some(function (kk) { return groups[kk].length > 1; });
if (keys.length >= 2 && hasMultiChild) {
var html = '';
for (var j = 0; j < keys.length; j++) {
var key = keys[j];
var grpId = safeDomId(parentId + '-' + key.replace(/\s+/g, '_'));
var subHtml = groups[key].map(buildSuttaLinkHtml).join('');
html += '<div class="menu-subblock" role="group">' +
'<button class="menu-toggle nested" type="button" data-target="' + escapeAttr(grpId) + '"' +
' aria-expanded="false" aria-controls="' + escapeAttr(grpId) + '">' +
'<span>' + escapeHtml(key) + '</span><span class="chevron" aria-hidden="true">▸</span>' +
'</button>' +
'<div id="' + escapeAttr(grpId) + '" class="menu-list collapsed">' + subHtml + '</div>' +
'</div>';
}
return html;
}
return children.map(buildSuttaLinkHtml).join('');
}
var html2 = '';
for (var m2 = 0; m2 < children.length; m2++) {
var child = children[m2];
if (child.type === 'group') {
var grpId2 = safeDomId(parentId + '-' + child.key);
var label = uiLang === 'en'
? child.labelEn || child.labelVi || child.key
: child.labelVi || child.labelEn || child.key;
html2 += '<div class="menu-subblock" role="group">' +
'<button class="menu-toggle nested" type="button" data-target="' + escapeAttr(grpId2) + '"' +
' aria-expanded="false" aria-controls="' + escapeAttr(grpId2) + '">' +
'<span>' + escapeHtml(label) + '</span><span class="chevron" aria-hidden="true">▸</span>' +
'</button>' +
'<div id="' + escapeAttr(grpId2) + '" class="menu-list collapsed">' + buildMenuChildren(child.children || [], grpId2) + '</div>' +
'</div>';
} else if (child.type === 'sutta') {
html2 += buildSuttaLinkHtml(child);
}
}
return html2;
}
var activeNikayaKey = null;
var KEY_ACTIVE_NIKAYA = 'active_nikaya_tile';
function rebuildGlobalSutraOrder() {
var index = window.SUTRA_INDEX || [];
var order = [];
function walk(children) {
if (!children || !children.length) return;
for (var i = 0; i < children.length; i++) {
var ch = children[i];
if (ch.type === 'sutta' && ch.id) order.push(ch.id);
else if (ch.type === 'group') walk(ch.children || []);
}
}
for (var i = 0; i < index.length; i++) walk(index[i].children || []);
SUTRA_ORDER = order;
}
function renderNikayaList(nikKey) {
if (!sutraMenuList) return;
var index = window.SUTRA_INDEX || [];
var nik = null;
for (var i = 0; i < index.length; i++) {
if (index[i].key === nikKey) { nik = index[i]; break; }
}
if (!nik) {
sutraMenuList.innerHTML = '';
return;
}
var secId = safeDomId('sec-' + nik.key);
sutraMenuList.innerHTML = buildMenuChildren(nik.children || [], secId);
highlightActiveInMenu();
}
function setActiveNikaya(nikKey, persist) {
activeNikayaKey = nikKey;
var tiles = document.querySelectorAll('.nikaya-tile');
for (var i = 0; i < tiles.length; i++) {
var isActive = tiles[i].getAttribute('data-nikaya') === nikKey;
tiles[i].classList.toggle('active', isActive);
tiles[i].setAttribute('aria-selected', String(isActive));
}
if (nikKey === 'BM') renderBookmarksList();
else renderNikayaList(nikKey);
if (persist) storage.set(KEY_ACTIVE_NIKAYA, nikKey);
}
function renderBookmarksList() {
if (!sutraMenuList) return;
var order = SUTRA_ORDER && SUTRA_ORDER.length ? SUTRA_ORDER : Array.from(BOOKMARKS);
var ids = order.filter(function (id) { return BOOKMARKS.has(id); });
if (!ids.length) {
var bl = bookmarkLabels();
sutraMenuList.innerHTML = '<li class="menu-empty" style="padding:18px 22px;color:var(--ink-light);font-style:italic;list-style:none">' + escapeHtml(bl.empty) + '</li>';
return;
}
var html = '';
for (var i = 0; i < ids.length; i++) {
var meta = findMetaById(ids[i]);
if (meta) html += buildSuttaLinkHtml(meta);
}
sutraMenuList.innerHTML = html;
highlightActiveInMenu();
}
function updateBookmarksCount() {
var el = $('bookmarksCount');
if (!el) return;
var n = BOOKMARKS.size;
el.textContent = n ? String(n) : '';
el.classList.toggle('is-empty', n === 0);
}
function reflectBookmarkState(id, on) {
var bl = bookmarkLabels();
var label = on ? bl.on : bl.off;
if (sutraMenuList) {
var starsInMenu = sutraMenuList.querySelectorAll('.menu-bookmark-btn[data-id="' + safeCssEscape(id) + '"]');
for (var i = 0; i < starsInMenu.length; i++) {
var b = starsInMenu[i];
b.classList.toggle('is-on', !!on);
b.setAttribute('aria-pressed', on ? 'true' : 'false');
b.setAttribute('aria-label', label);
b.setAttribute('title', label);
}
}
if (id === currentSutraId) applyTitleBookmarkState();
updateBookmarksCount();
}
function applyTitleBookmarkState() {
var btn = $('btnBookmarkCurrent');
if (!btn) return;
if (!currentSutraId) { btn.hidden = true; return; }
btn.hidden = false;
var on = isBookmarked(currentSutraId);
var bl = bookmarkLabels();
var label = on ? bl.on : bl.off;
btn.classList.toggle('is-on', on);
btn.setAttribute('aria-pressed', on ? 'true' : 'false');
btn.setAttribute('aria-label', label);
btn.setAttribute('title', label);
applyShareBtnVisibility();
}
/* ============================================================
SHARE: nút chia sẻ + dropdown (FB / Zalo / Twitter / Email / Copy / Native)
============================================================ */
function applyShareBtnVisibility() {
var b = $('btnShareCurrent');
if (!b) return;
b.hidden = !currentSutraId;
}
function _buildTitleShareUrl() {
if (!currentSutraId) return location.href;
// Title share: luôn link đến đầu bài kinh, không kèm segment hiện tại đang scroll
return location.origin + location.pathname + '#' + currentSutraId;
}
function _getShareTitle() {
var t = ($('title') || {}).textContent || '';
t = t.trim();
return t && t !== 'Chưa chọn bài' ? t : 'Sutta Archive';
}
function _showShareToast(msg) {
// Tận dụng _showToast (đã fix Safari fade transition)
if (typeof _showToast === 'function') { _showToast(msg); return; }
}
function _closeShareMenu() {
var menu = $('shareMenu');
var btn = $('btnShareCurrent');
if (!menu || !btn) return;
menu.setAttribute('aria-hidden', 'true');
setTimeout(function () { if (menu.getAttribute('aria-hidden') === 'true') menu.hidden = true; }, 200);
btn.setAttribute('aria-expanded', 'false');
}
function _openShareMenu() {
var menu = $('shareMenu');
var btn = $('btnShareCurrent');
if (!menu || !btn) return;
menu.hidden = false;
// Show below button by default; if not enough space, show above
var rect = btn.getBoundingClientRect();
var menuH = (typeof navigator.share === 'function') ? 280 : 240;
var spaceBelow = window.innerHeight - rect.bottom;
var top = spaceBelow > menuH + 16 ? rect.bottom + 8 : Math.max(8, rect.top - menuH - 8);
var left = Math.max(8, Math.min(rect.left, window.innerWidth - 220));
menu.style.top = top + 'px';
menu.style.left = left + 'px';
var nativeItem = $('shareItemNative');
if (nativeItem) nativeItem.hidden = !(typeof navigator.share === 'function');
requestAnimationFrame(function () {
menu.setAttribute('aria-hidden', 'false');
btn.setAttribute('aria-expanded', 'true');
});
}
async function _handleShareAction(action) {
var url = _buildTitleShareUrl();
var title = _getShareTitle();
var text = title + ' — Sutta Archive';
var en = (typeof uiLang !== 'undefined' && uiLang === 'en');
if (action === 'native' && typeof navigator.share === 'function') {
// Bỏ field `text` để iOS share sheet không copy text thay vì url
try { await navigator.share({ title: title, url: url }); } catch (_) {}
_closeShareMenu(); return;
}
if (action === 'copy') {
var msg = en ? 'Link copied' : 'Đã sao chép link';
try { await navigator.clipboard.writeText(url); _showShareToast(msg); }
catch (_) {
var ta = document.createElement('textarea');
ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
document.body.appendChild(ta); ta.select();
try { document.execCommand('copy'); _showShareToast(msg); } catch (__) {}
ta.remove();
}
_closeShareMenu(); return;
}
var pop = 'noopener,noreferrer,width=620,height=520';
if (action === 'facebook') {
window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank', pop);
} else if (action === 'zalo') {
window.open('https://zalo.me/share/?u=' + encodeURIComponent(url) + '&t=' + encodeURIComponent(text), '_blank', pop);
} else if (action === 'twitter') {
window.open('https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text), '_blank', pop);
} else if (action === 'email') {
location.href = 'mailto:?subject=' + encodeURIComponent(text) + '&body=' + encodeURIComponent(text + '\n\n' + url);
}
_closeShareMenu();
}
(function _wireShareUI() {
var btn = $('btnShareCurrent');
var menu = $('shareMenu');
if (!btn || !menu) return;
btn.addEventListener('click', function (e) {
e.stopPropagation();
var isOpen = menu.getAttribute('aria-hidden') !== 'true' && !menu.hidden;
if (isOpen) _closeShareMenu(); else _openShareMenu();
});
menu.addEventListener('click', function (e) {
var item = e.target.closest('.share-menu-item');
if (!item) return;
e.stopPropagation();
var action = item.getAttribute('data-share');
if (action) _handleShareAction(action);
});
document.addEventListener('click', function (e) {
if (menu.hidden || menu.getAttribute('aria-hidden') === 'true') return;
if (e.target.closest('#shareMenu') || e.target.closest('#btnShareCurrent')) return;
_closeShareMenu();
});
document.addEventListener('keydown', function (e) {
if (e.key === 'Escape' && !menu.hidden && menu.getAttribute('aria-hidden') !== 'true') {
_closeShareMenu(); btn.focus();
}
});
window.addEventListener('resize', function () {
if (!menu.hidden && menu.getAttribute('aria-hidden') !== 'true') _closeShareMenu();
});
})();
function findNikayaOfSutta(suttaId) {
var index = window.SUTRA_INDEX || [];
for (var i = 0; i < index.length; i++) {
var nik = index[i];
var found = false;
(function walk(children) {
if (!children || found) return;
for (var j = 0; j < children.length; j++) {
var ch = children[j];
if (ch.type === 'sutta' && ch.id === suttaId) { found = true; return; }
if (ch.type === 'group') walk(ch.children || []);
}
})(nik.children || []);
if (found) return nik.key;
}
return null;
}
function applyTileLabels() {
var tiles = document.querySelectorAll('.nikaya-tile .tile-label');
for (var i = 0; i < tiles.length; i++) {
var el = tiles[i];
el.textContent = uiLang === 'en' ? (el.getAttribute('data-en') || '') : (el.getAttribute('data-vi') || '');
}
}
function normStr(s) {
return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function populateFlatSuttas() {
FLAT_SUTTAS = [];
var index = window.SUTRA_INDEX || [];
function walk(children) {
if (!children || !children.length) return;
for (var i = 0; i < children.length; i++) {
var ch = children[i];
if (ch.type === 'sutta' && ch.id) {
var codePrefix = ch.code ? ch.code + ' – ' : '';
var viLabel = ch.titleVi || '', enLabel = ch.titleEn || '', paliLabel = ch.titlePali || '';
var mainText = uiLang === 'en'
? codePrefix + (enLabel || viLabel || paliLabel || ch.id)
: codePrefix + (viLabel || enLabel || paliLabel || ch.id);
var subText  = uiLang === 'en' ? (paliLabel || viLabel || '') : (paliLabel || enLabel || '');
FLAT_SUTTAS.push({
id: ch.id, main: mainText, sub: subText,
flat: normStr(mainText + ' ' + viLabel + ' ' + enLabel + ' ' + paliLabel + ' ' + ch.id)
});
}
else if (ch.type === 'group') walk(ch.children || []);
}
}
for (var i = 0; i < index.length; i++) walk(index[i].children || []);
}
function buildSutraMenuFromIndex() {
var index = window.SUTRA_INDEX || [];
if (!Array.isArray(index) || !index.length) {
if (sutraMenuList) {
var msg = uiLang === 'en' ? 'No sutta index found. Make sure toc.js is loaded.' : 'Chưa có mục lục. Hãy đảm bảo file toc.js đã được tải.';
sutraMenuList.innerHTML = '<li style="padding:10px;color:var(--ink-light);font-style:italic">' + escapeHtml(msg) + '</li>';
}
return;
}
rebuildGlobalSutraOrder();
populateFlatSuttas();
applyTileLabels();
if (sutraMenuPanel && !sutraMenuPanel._tileWired) {
sutraMenuPanel._tileWired = true;
sutraMenuPanel.addEventListener('click', function (e) {
var tile = e.target.closest('.nikaya-tile');
if (!tile || !sutraMenuPanel.contains(tile)) return;
e.stopPropagation();
var k = tile.getAttribute('data-nikaya');
if (k) setActiveNikaya(k, true);
});
}
var initial = null;
if (currentSutraId) initial = findNikayaOfSutta(currentSutraId);
if (!initial) initial = storage.get(KEY_ACTIVE_NIKAYA);
if (!initial && index[0]) initial = index[0].key;
setActiveNikaya(initial, false);
}
function highlightActiveInMenu() {
if (!sutraMenuList) return;
sutraMenuList.querySelectorAll('.menu-sutta-link').forEach(function (a) {
var isActive = a.getAttribute('data-id') === currentSutraId;
a.classList.toggle('active', isActive);
a.setAttribute('aria-current', isActive ? 'page' : 'false');
});
}
function syncTileToCurrentSutta() {
if (!currentSutraId) return;
var nik = findNikayaOfSutta(currentSutraId);
if (nik && nik !== activeNikayaKey) {
setActiveNikaya(nik, true);
}
}
function renderSearchResults(matches, q) {
if (!searchResultsEl) return;
if (!q) { searchResultsEl.innerHTML = ''; return; }
if (!matches.length) {
var msg = uiLang === 'en' ? 'No matching sutta found.' : 'Không tìm thấy kinh phù hợp.';
searchResultsEl.innerHTML = '<div class="search-result-empty" role="status">' + escapeHtml(msg) + '</div>';
return;
}
var html = '';
for (var i = 0; i < matches.length; i++) {
var m = matches[i];
html += '<button class="search-result-item" data-id="' + escapeAttr(m.id) + '" role="option">' +
'<span class="search-main">' + escapeHtml(m.main) + '</span>' +
(m.sub ? '<span class="search-sub">' + escapeHtml(m.sub) + '</span>' : '') +
'</button>';
}
searchResultsEl.innerHTML = html;
}
function applySearch(query) {
var q = normStr((query || '').trim());
if (!q) return renderSearchResults([], '');
var matches = FLAT_SUTTAS.filter(function (x) { return x.flat.includes(q); }).slice(0, 80);
renderSearchResults(matches, query);
}
if (searchInput) searchInput.addEventListener('input', debounce(function (e) { applySearch(e.target.value); }, 180));
// ── Share / copy segment link ──────────────────────────────────────
function _showToast(msg) {
var t = document.getElementById('appToast');
if (!t) {
t = document.createElement('div');
t.id = 'appToast';
t.className = 'app-toast';
t.setAttribute('role', 'status');
t.setAttribute('aria-live', 'polite');
document.body.appendChild(t);
}
t.textContent = msg;
// Safari fix: force re-trigger transition.
// 1. Remove .show + force reflow → reset state
// 2. Use rAF + add .show → Safari registers transition properly
t.classList.remove('show');
// eslint-disable-next-line no-unused-expressions
t.offsetWidth;
clearTimeout(_showToast._tm);
clearTimeout(_showToast._tm2);
requestAnimationFrame(function () { t.classList.add('show'); });
_showToast._tm = setTimeout(function () { t.classList.remove('show'); }, 1800);
}
function _buildShareUrl(keyRaw) {
return location.origin + location.pathname + '#' + keyRaw;
}
function shareSegment(keyRaw) {
if (!keyRaw) return;
var url = _buildShareUrl(keyRaw);
var titleText = (document.getElementById('title') || {}).textContent || 'Sutta Archive';
// Web Share API: bỏ field `text` vì iOS có thể copy text thay vì url khi user chọn Copy
// → chỉ truyền title + url để hệ thống share đúng URL đầy đủ (kèm domain).
if (navigator.share) {
navigator.share({ title: titleText, url: url }).catch(function () { /* user huỷ — không cần fallback */ });
return;
}
// Fallback: copy clipboard.
var done = function () { _showToast(uiLang === 'en' ? 'Link copied' : 'Đã sao chép link'); };
var fail = function () { _showToast(uiLang === 'en' ? 'Copy failed' : 'Sao chép thất bại'); };
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(url).then(done).catch(function () {
_legacyCopy(url) ? done() : fail();
});
} else {
_legacyCopy(url) ? done() : fail();
}
}
function _legacyCopy(text) {
try {
var ta = document.createElement('textarea');
ta.value = text;
// readonly + contenteditable=false: ngăn iOS Safari / Chrome Android bật bàn phím ảo
// khi gọi ta.select() — fallback path này hay fire khi clipboard API chặn (insecure
// context / permission denied), bàn phím bật lên giữa lúc copy gây giật + che toast.
ta.setAttribute('readonly', '');
ta.setAttribute('aria-hidden', 'true');
ta.style.position = 'fixed'; ta.style.left = '-9999px';
ta.style.fontSize = '16px'; // tránh iOS auto-zoom nếu lỡ focus
document.body.appendChild(ta);
ta.select();
var ok = document.execCommand('copy');
document.body.removeChild(ta);
return ok;
} catch (e) { return false; }
}
function initDelegations() {
if (grid && !grid._shareDel) {
grid.addEventListener('click', function (ev) {
var btn = ev.target.closest('.sutra-seg-share');
if (btn && grid.contains(btn)) {
ev.preventDefault();
ev.stopPropagation();
shareSegment(btn.getAttribute('data-share-key'));
return;
}
var copyBtn = ev.target.closest('.sutra-col-copy');
if (copyBtn && grid.contains(copyBtn)) {
ev.preventDefault();
ev.stopPropagation();
var col = copyBtn.closest('.sutra-col');
if (!col) return;
var body = col.querySelector('.sutra-col-body');
var text = body ? (body.textContent || '').trim() : '';
if (!text) return;
var done = function () { _showToast(uiLang === 'en' ? 'Text copied' : 'Đã sao chép'); };
var fail = function () { _showToast(uiLang === 'en' ? 'Copy failed' : 'Sao chép thất bại'); };
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(text).then(done).catch(function () { _legacyCopy(text) ? done() : fail(); });
} else {
_legacyCopy(text) ? done() : fail();
}
}
});
grid._shareDel = true;
}
if (sutraMenuList && !sutraMenuList._del) {
sutraMenuList.addEventListener('click', function (ev) {
var starBtn = ev.target.closest('.menu-bookmark-btn');
if (starBtn && sutraMenuList.contains(starBtn)) {
ev.preventDefault();
ev.stopPropagation();
var sid = starBtn.getAttribute('data-id');
if (sid) {
var now = toggleBookmark(sid);
reflectBookmarkState(sid, now);
if (activeNikayaKey === 'BM' && !now) renderBookmarksList();
}
return;
}
var btn = ev.target.closest('.menu-toggle');
if (btn && sutraMenuList.contains(btn)) {
ev.preventDefault();
var panel = document.getElementById(btn.dataset.target);
if (!panel) return;
var wasCollapsed = panel.classList.contains('collapsed');
var isNested = btn.classList.contains('nested');
if (wasCollapsed) {
var scope = isNested ? btn.closest('.menu-list') : sutraMenuList;
var sel   = isNested ? '.menu-toggle.nested' : '.menu-toggle:not(.nested)';
if (scope) scope.querySelectorAll(sel).forEach(function (o) {
if (o === btn) return;
var op = document.getElementById(o.dataset.target);
if (op && !op.classList.contains('collapsed')) {
op.classList.add('collapsed');
o.setAttribute('aria-expanded', 'false');
var c = o.querySelector('.chevron'); if (c) c.textContent = '▸';
if (!isNested) op.querySelectorAll('.menu-toggle.nested').forEach(function (nb) {
var np = document.getElementById(nb.dataset.target);
if (np && !np.classList.contains('collapsed')) np.classList.add('collapsed');
nb.setAttribute('aria-expanded', 'false');
var c2 = nb.querySelector('.chevron'); if (c2) c2.textContent = '▸';
});
}
});
}
panel.classList.toggle('collapsed', !wasCollapsed);
var isCollapsedNow = panel.classList.contains('collapsed');
btn.setAttribute('aria-expanded', isCollapsedNow ? 'false' : 'true');
var ch = btn.querySelector('.chevron');
if (ch) ch.textContent = isCollapsedNow ? '▸' : '▾';
return;
}
var a = ev.target.closest('.menu-sutta-link');
if (a && sutraMenuList.contains(a)) {
ev.preventDefault();
var id = a.getAttribute('data-id');
if (id) {
openSutra(id);
closePanels();
if (searchInput) searchInput.value = '';
if (searchResultsEl) searchResultsEl.innerHTML = '';
}
}
});
sutraMenuList._del = true;
}
if (searchResultsEl && !searchResultsEl._del) {
searchResultsEl.addEventListener('click', function (ev) {
var btn = ev.target.closest('.search-result-item');
if (btn) {
var id = btn.getAttribute('data-id');
if (id) {
openSutra(id);
closePanels();
if (searchInput) searchInput.value = '';
searchResultsEl.innerHTML = '';
}
}
});
searchResultsEl._del = true;
}
}

// ── render.js ───────────────────────────────────────────────────
function findMetaById(id) {
var index = window.SUTRA_INDEX || [];
var found = null;
function walk(children, currentParent, rootNikaya) {
if (!children || !children.length || found) return;
for (var i = 0; i < children.length; i++) {
if (found) return;
var ch = children[i];
if (ch.type === 'sutta' && ch.id === id) {
found = Object.assign({}, ch);
found.parentGroup = currentParent;
found.rootNikaya  = rootNikaya;
return;
}
if (ch.type === 'group') walk(ch.children || [], ch, rootNikaya);
}
}
for (var i = 0; i < index.length; i++) {
walk(index[i].children || [], index[i], index[i]);
if (found) break;
}
return found;
}
function getColHeaders() {
return uiLang === 'en'
? { pali: 'Pali', eng: 'English', vie: 'Vietnamese' }
: { pali: 'Pali', eng: 'English', vie: 'Tiếng Việt' };
}
function createRow(r) {
var wrap = document.createElement('div'); wrap.className = 'sutra-row-wrap';
var keyRaw = String(r.key || '');
var tp = (r.pali || '').trim();
var te = (r.eng  || '').trim();
var tv = (r.vie  || '').trim();
var isSectionNum = (tp.length <= 6 && te.length <= 6 && tv.length <= 6) &&
/^[IVXLCDM]+\.?$|^\d+\.?$/.test(tp || te || tv);
if (isSectionNum) wrap.classList.add('is-section-num');
if (/:source$/i.test(keyRaw)) wrap.classList.add('is-source');
// Merged paragraph rows (từ mergeRowsToParagraphRows) giữ key :0.3 để marker tra cứu
// nhưng KHÔNG áp is-subtitle vì nội dung là cả đoạn văn, không phải tiêu đề ngắn.
if (/:0\.[123]$/.test(keyRaw) && (!r._merged || r._isHeading)) wrap.classList.add('is-subtitle');
wrap.setAttribute('data-key', keyRaw);
var keyShort = '';
if (keyRaw.includes(':')) {
var parts = keyRaw.split(':');
var prefix = parts[0].replace(/([a-zA-Z]+)(\d*)/, function (_, letters, nums) { return letters.toUpperCase() + nums; });
keyShort = parts[1] ? prefix + '.' + parts[1] : prefix;
} else { keyShort = keyRaw.toUpperCase(); }
if (keyShort) {
var segWrap = document.createElement('div');
segWrap.className = 'sutra-seg-keywrap';
var seg = document.createElement('div');
seg.className = 'sutra-seg-key'; seg.textContent = keyShort;
seg.setAttribute('aria-hidden', 'true');
segWrap.appendChild(seg);
var shareBtn = document.createElement('button');
shareBtn.type = 'button';
shareBtn.className = 'sutra-seg-share';
shareBtn.setAttribute('data-share-key', keyRaw);
shareBtn.setAttribute('aria-label', uiLang === 'en' ? 'Share / copy link to this segment' : 'Chia sẻ / sao chép link đoạn này');
shareBtn.title = uiLang === 'en' ? 'Share / copy link' : 'Chia sẻ / sao chép link';
shareBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="10" r="2.4"/><circle cx="15" cy="5" r="2.4"/><circle cx="15" cy="15" r="2.4"/><path d="M7.2 8.9l5.6-3.4M7.2 11.1l5.6 3.4"/></svg>';
segWrap.appendChild(shareBtn);
wrap.appendChild(segWrap);
}
var row = document.createElement('div');
row.className = 'sutra-row'; row.setAttribute('data-key', keyRaw);
var headers = getColHeaders();
// Chú giải per-lang — nằm BÊN TRONG cột tương ứng. Ẩn cột → ẩn luôn comment cột đó.
var cPli = resolveCommentLang(r.commentPli);
var cEng = resolveCommentLang(r.commentEn);
var cVie = resolveCommentLang(r.commentVie);
function ensureCmtHeader(col) {
// Gắn header 1 lần cho col — text theo đúng ngôn ngữ của col (giống PĀLI/ENGLISH/VIETNAMESE).
// Pāli: Aṭṭhakathā (chú giải) · English: Commentary · Việt: Chú giải
if (col.querySelector('.sutra-col-comments-header')) return;
var h = document.createElement('div');
h.className = 'sutra-col-comments-header';
h.setAttribute('aria-hidden', 'true');
if (col.classList.contains('pali-col')) h.textContent = 'Aṭṭhakathā';
else if (col.classList.contains('eng-col')) h.textContent = 'Commentary';
else h.textContent = 'Chú giải';
col.appendChild(h);
}
function makeCol(className, headerText, contentText, contentClass, cmtText) {
var col  = document.createElement('div'); col.className = 'sutra-col ' + className;
var hdr  = document.createElement('div'); hdr.className = 'sutra-col-header';
var hdrLabel = document.createElement('span');
hdrLabel.className = 'sutra-col-header-label';
hdrLabel.textContent = headerText;
hdr.appendChild(hdrLabel);
var copyBtn = document.createElement('button');
copyBtn.type = 'button';
copyBtn.className = 'sutra-col-copy';
copyBtn.setAttribute('aria-label', uiLang === 'en' ? 'Copy this paragraph' : 'Sao chép đoạn này');
copyBtn.title = uiLang === 'en' ? 'Copy' : 'Sao chép';
copyBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1"/><path d="M2 9V3a1 1 0 0 1 1-1h6"/></svg>';
hdr.appendChild(copyBtn);
var body = document.createElement('div'); body.className = 'sutra-col-body';
var inner = document.createElement('div'); inner.className = contentClass;
inner.textContent = contentText || '';
body.appendChild(inner); col.appendChild(hdr); col.appendChild(body);
if (cmtText) {
ensureCmtHeader(col);
var cmt = document.createElement('div');
cmt.className = 'sutra-col-comment';
var icon = document.createElement('span');
icon.className = 'sutra-col-comment-icon'; icon.setAttribute('aria-hidden', 'true');
icon.textContent = '💬';
var txt = document.createElement('span');
txt.className = 'sutra-col-comment-text'; txt.textContent = cmtText;
cmt.appendChild(icon); cmt.appendChild(txt);
col.appendChild(cmt);
}
return col;
}
var pcol = makeCol('pali-col', headers.pali, r.pali, 'pali', cPli);
var ecol = makeCol('eng-col',  headers.eng,  r.eng,  'eng', cEng);
var vcol = makeCol('vie-col',  headers.vie,  r.vie,  'vie', cVie);
row.appendChild(pcol); row.appendChild(ecol); row.appendChild(vcol);
wrap.appendChild(row);
// Merged mode: aggregated comments vào col có text (không còn seg tag)
if (r._merged && Array.isArray(r._mergedComments) && r._mergedComments.length) {
var targetCol = r.pali ? pcol : (r.eng ? ecol : (r.vie ? vcol : null));
if (targetCol) {
ensureCmtHeader(targetCol);
for (var mi = 0; mi < r._mergedComments.length; mi++) {
var mc = r._mergedComments[mi];
var cBlk = document.createElement('div');
cBlk.className = 'sutra-col-comment sutra-col-comment-merged';
var icon = document.createElement('span');
icon.className = 'sutra-col-comment-icon'; icon.setAttribute('aria-hidden', 'true');
icon.textContent = '💬';
var txt = document.createElement('span');
txt.className = 'sutra-col-comment-text'; txt.textContent = mc.text;
cBlk.appendChild(icon); cBlk.appendChild(txt);
targetCol.appendChild(cBlk);
}
}
}
// Legacy single-file `comment` (không phân lang) — hiện full-width dưới row, chỉ khi
// không có per-lang data để tránh trùng lặp.
var cLegacy = resolveCommentText(r.comment);
if (cLegacy && !cPli && !cEng && !cVie) {
var legacy = document.createElement('div');
legacy.className = 'sutra-comment-legacy';
var li = document.createElement('span');
li.className = 'sutra-comment-legacy-icon'; li.setAttribute('aria-hidden', 'true');
li.textContent = '💬';
var lt = document.createElement('span');
lt.className = 'sutra-comment-legacy-text'; lt.textContent = cLegacy;
legacy.appendChild(li); legacy.appendChild(lt);
wrap.appendChild(legacy);
}
return wrap;
}
function resolveCommentLang(v) {
if (!v) return '';
if (typeof v === 'string') return v.trim();
return '';
}
function resolveCommentText(cmt) {
if (!cmt) return '';
if (typeof cmt === 'string') return cmt.trim();
if (typeof cmt === 'object') {
var pref = uiLang === 'en' ? ['en','vi','pli'] : ['vi','en','pli'];
for (var i = 0; i < pref.length; i++) {
var v = cmt[pref[i]];
if (typeof v === 'string' && v.trim()) return v.trim();
}
}
return '';
}
function getByExactOrSuffix(map, exactKey, suffix) {
if (!map) return '';
if (exactKey && map[exactKey]) return map[exactKey];
var keys = Object.keys(map);
var k = exactKey ? keys.find(function (x) { return x === exactKey; }) : null;
if (!k && suffix) k = keys.find(function (x) { return String(x).endsWith(suffix); });
return k ? map[k] || '' : '';
}
function pickTextForUiLangSuffix(merged, id, suffix) {
var exactKey = id + suffix;
if (uiLang === 'en') return getByExactOrSuffix(merged.engMap, exactKey, suffix)
|| getByExactOrSuffix(merged.vieMap, exactKey, suffix)
|| getByExactOrSuffix(merged.paliMap, exactKey, suffix) || '';
return getByExactOrSuffix(merged.vieMap, exactKey, suffix)
|| getByExactOrSuffix(merged.engMap, exactKey, suffix)
|| getByExactOrSuffix(merged.paliMap, exactKey, suffix) || '';
}
function renderWelcomeScreen() {
if (!grid || currentSutraId) return;
var isEn = uiLang === 'en';
if (superTitleEl) superTitleEl.textContent = '';
if (titleMetaEl)  titleMetaEl.textContent  = '';
if (titleEl)      titleEl.textContent      = '';
if (subtitleEl)   subtitleEl.textContent   = '';
document.documentElement.classList.add('is-welcome');
applyTitleBookmarkState();
var heroSub = isEn
? 'Reverently saluting the Blessed One, the Worthy One, the Perfectly Self-Awakened.<br>A library of canonical suttas for practitioners and scholars.'
: 'Cung kính đảnh lễ Đức Thế Tôn, bậc A-la-hán, Chánh Đẳng Giác.<br>Một thư viện kinh điển dành cho người tu học và nghiên cứu Phật pháp.';
// Petal dots: 9 chấm tại radius=46 quanh center (60,60), animate về (60,60).
// Mỗi dot share `--idx` với text label cùng góc → text+dot xuất hiện đồng thời,
// dot chạy về tâm rồi tan. One-time (forwards), không loop.
var R = 46, CX = 60, CY = 60;
var petalDots = '';
for (var pd = 0; pd < 9; pd++) {
var ang = pd * 40 * Math.PI / 180;
var x = (CX + R * Math.sin(ang)).toFixed(1);
var y = (CY - R * Math.cos(ang)).toFixed(1);
var dx = (CX - x).toFixed(1);
var dy = (CY - y).toFixed(1);
petalDots += '<circle class="welcome-petal-dot" cx="' + x + '" cy="' + y + '" r="1.6" style="--dx:' + dx + 'px;--dy:' + dy + 'px;--idx:' + pd + '"/>';
}
var mandalaSvg = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" aria-hidden="true">' +
'<g class="welcome-ring r1"><circle cx="60" cy="60" r="54" stroke-width=".7" opacity=".55"/><circle cx="60" cy="60" r="54" stroke-width=".7" stroke-dasharray="1 6" opacity=".8"/></g>' +
'<g class="welcome-ring r2"><circle cx="60" cy="60" r="42" stroke-width=".6" stroke-dasharray="2 4" opacity=".6"/></g>' +
'<g class="welcome-core" stroke-width=".9"><g opacity=".95">' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(45 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(90 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(135 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(180 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(225 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(270 60 60)"/>' +
'<path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(315 60 60)"/>' +
'</g><circle cx="60" cy="60" r="4" fill="currentColor" stroke="none"/></g>' +
'<g class="welcome-petals">' + petalDots + '</g>' +
'</svg>';
var verses = [
{ pali: 'Vayadhammā saṅkhārā, appamādena sampādetha',
  tr: isEn ? 'All conditioned things are subject to decay. Strive on with diligence' : 'Các pháp hữu vi đều vô thường, hãy tinh tấn chớ có buông lung',
  src: isEn ? "The Buddha's last words — Mahāparinibbāna Sutta (DN 16)" : 'Lời dạy cuối cùng của Đức Phật trước khi nhập Niết-bàn — Kinh Đại Bát Niết-bàn (DN 16)',
  segKey: 'dn16:3.51.4' },
{ pali: 'Attadīpā viharatha, attasaraṇā, anaññasaraṇā',
  tr: isEn ? 'Dwell as your own island, your own refuge, with no other refuge' : 'Hãy tự mình làm hòn đảo cho chính mình, hãy tự mình nương tựa chính mình, không nương tựa ai khác',
  src: isEn ? 'Mahāparinibbāna Sutta (DN 16)' : 'Kinh Đại Bát Niết-bàn (DN 16)',
  segKey: 'dn16:2.26.1' }
];
var versesHtml = verses.map(function (v) {
return '<article class="welcome-verse">' +
'<p class="welcome-verse-pali">' + escapeHtml(v.pali) + '</p>' +
'<p class="welcome-verse-tr">' + escapeHtml(v.tr) + '</p>' +
'<p class="welcome-verse-source">' + escapeHtml(v.src) + '</p>' +
'</article>';
}).join('');
// Cửu Đức Phật / Buddha's Nine Virtues — text labels cạnh từng dot ở 9 góc cánh hoa.
// Mỗi label cùng góc với 1 dot tương ứng → text fade-in stagger, sau đó dot bay từ
// vị trí radial (cùng góc, radius nhỏ hơn) vào tâm.
var virtues = [
{ pali: 'Arahaṃ',
  tr: isEn ? 'The Worthy One' : 'Ứng Cúng' },
{ pali: 'Sammāsambuddho',
  tr: isEn ? 'The Self-Awakened' : 'Chánh Biến Tri' },
{ pali: 'Vijjā­caraṇa­sampanno',
  tr: isEn ? 'Knowledge & Conduct' : 'Minh Hạnh Túc' },
{ pali: 'Sugato',
  tr: isEn ? 'The Well-Gone' : 'Thiện Thệ' },
{ pali: 'Lokavidū',
  tr: isEn ? 'Knower of the World' : 'Thế Gian Giải' },
{ pali: 'Anuttaro­purisa­damma­sārathi',
  tr: isEn ? 'Supreme Trainer' : 'Điều Ngự Trượng Phu' },
{ pali: 'Satthā­deva­manussānaṃ',
  tr: isEn ? 'Teacher of Gods & Humans' : 'Thiên Nhân Sư' },
{ pali: 'Buddho',
  tr: isEn ? 'The Awakened' : 'Phật' },
{ pali: 'Bhagavā',
  tr: isEn ? 'The Blessed One' : 'Thế Tôn' }
];
var virtuesHtml = '<ol class="welcome-virtues" aria-label="' +
(isEn ? 'Nine Virtues of the Buddha' : 'Cửu Đức Phật') + '">' +
virtues.map(function (v, i) {
var angle = (i * 40);
return '<li class="wv-item" style="--idx:' + i + ';--angle:' + angle + 'deg">' +
'<span class="wv-pali">' + escapeHtml(v.pali) + '</span>' +
'<span class="wv-tr">' + escapeHtml(v.tr) + '</span>' +
'</li>';
}).join('') + '</ol>';
var iconLib  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2 3v10M5 3v10M8 3v10M12 4l3 9M11 13h5"/></svg>';
var iconCog  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"/></svg>';
var iconHelp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.4-.9 2-1.6 2.4-.7.4-1.1.7-1.1 1.6v.4"/><path d="M12 16.2h.01"/></svg>';
var helperRows = isEn
? [{action:'guide', text: '<em>Help</em> — view the guide', icon: iconHelp},
   {action:'library', text: '<em>Library</em> — browse suttas', icon: iconLib}]
: [{action:'guide', text: '<em>Trợ giúp</em> — xem hướng dẫn', icon: iconHelp},
   {action:'library', text: '<em>Thư viện</em> — chọn bài kinh', icon: iconLib}];
var helperHtml = helperRows.map(function (r) {
return '<button type="button" class="welcome-help-row" data-action="' + r.action + '">' +
'<span class="welcome-help-text">' + r.text + '</span>' +
'<span class="welcome-help-key">' + r.icon + '</span>' +
'</button>';
}).join('');
grid.innerHTML =
'<div class="welcome-screen">' +
'<div class="welcome-mandala">' + mandalaSvg + virtuesHtml + '</div>' +
'<h1 class="welcome-hero-title" data-action="library" tabindex="0" role="button" aria-label="' + (isEn ? 'Open library' : 'Mở thư viện') + '" title="' + (isEn ? 'Open library' : 'Mở thư viện') + '">' + (isEn ? 'The <em>Sutta</em><br>Nikāya' : 'Tạng <em>Kinh</em><br>Nikāya') + '</h1>' +
'<p class="welcome-hero-sub">' + heroSub + '</p>' +
'<div class="welcome-hero-langs" role="tablist" aria-label="' + (isEn ? 'Interface language' : 'Ngôn ngữ giao diện') + '">' +
'<button type="button" class="welcome-lang-btn' + (uiLang === 'vi' ? ' active' : '') + '" data-ui-lang="vi" role="tab" aria-selected="' + (uiLang === 'vi' ? 'true' : 'false') + '">Việt</button>' +
'<span class="dot" aria-hidden="true"></span>' +
'<button type="button" class="welcome-lang-btn' + (uiLang === 'en' ? ' active' : '') + '" data-ui-lang="en" role="tab" aria-selected="' + (uiLang === 'en' ? 'true' : 'false') + '">English</button>' +
'</div>' +
'<section class="welcome-verses">' + versesHtml + '</section>' +
'<div class="welcome-helper">' + helperHtml + '</div>' +
'</div>';
grid.querySelectorAll('.welcome-help-row[data-action], .welcome-hero-title[data-action]').forEach(function (el) {
el.addEventListener('click', function (e) {
e.stopPropagation();
var action = el.getAttribute('data-action');
if (action === 'library' && btnSutraMenu) btnSutraMenu.click();
else if (action === 'guide' && btnGuide) btnGuide.click();
});
});
var heroTitleEl = grid.querySelector('.welcome-hero-title[data-action]');
if (heroTitleEl) {
heroTitleEl.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heroTitleEl.click(); }
});
}
grid.querySelectorAll('.welcome-lang-btn[data-ui-lang]').forEach(function (el) {
el.addEventListener('click', function (e) {
e.stopPropagation();
var chosen = el.getAttribute('data-ui-lang');
if (chosen === uiLang) return;
if (btnUiLang) btnUiLang.click();
});
});
}
function materializeChunk(chunkInfo) {
if (!chunkInfo || chunkInfo.materialized) return;
// Capture chunk bottom TRƯỚC khi materialize. Nếu chunk nằm hoàn toàn TRÊN viewport
// và height thực ≠ EST_ROW_H placeholder → content dưới shift → user thấy giật.
// Skip compensation trong programmatic scroll window (anchor restore, eager pre-scroll...)
// để không đè lên scroll adjustments của các code path đó.
var scroller = scrollEl;
var needsCompensation = false;
var oldChunkBottom = 0;
if (scroller && chunkInfo.div.parentNode === scroller && Date.now() >= _progScrollUntil) {
var preRect = chunkInfo.div.getBoundingClientRect();
var preRootRect = scroller.getBoundingClientRect();
oldChunkBottom = preRect.bottom - preRootRect.top + scroller.scrollTop;
if (oldChunkBottom <= scroller.scrollTop) needsCompensation = true;
}
var frag = document.createDocumentFragment();
for (var i = chunkInfo.rowStart; i < chunkInfo.rowEnd; i++) {
var rowData = virtAllRows[i];
if (!rowData) continue;
var wrap = createRow(rowData);
frag.appendChild(wrap);
var innerRow = wrap.querySelector ? wrap.querySelector('.sutra-row') : wrap;
cachedRows[i] = innerRow || wrap;
}
chunkInfo.div.appendChild(frag);
chunkInfo.div.style.minHeight = '';
chunkInfo.materialized = true;
if (anchorObserver) {
var newRows = chunkInfo.div.querySelectorAll('.sutra-row');
for (var k = 0; k < newRows.length; k++) anchorObserver.observe(newRows[k]);
}
if (needsCompensation && scroller) {
var newChunkRect = chunkInfo.div.getBoundingClientRect();
var newRootRect  = scroller.getBoundingClientRect();
var newChunkBottom = newChunkRect.bottom - newRootRect.top + scroller.scrollTop;
var delta = newChunkBottom - oldChunkBottom;
if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
}
}
function dematerializeChunk(chunkInfo) {
if (!chunkInfo || !chunkInfo.materialized) return;
if (anchorObserver) {
var oldRows = chunkInfo.div.querySelectorAll('.sutra-row');
for (var k = 0; k < oldRows.length; k++) anchorObserver.unobserve(oldRows[k]);
}
// LUÔN re-measure trước khi dematerialize. Nếu chỉ set một lần (như cũ), giá trị stale
// khi user đổi zoom/line-height/dark-mode/font sau khi chunk đã được dematerialize 1 lần
// → placeholder height sai → scroll position drift sau nhiều lần dematerialize.
var realH = chunkInfo.div.offsetHeight;
if (realH > 0) chunkInfo.measuredH = realH;
else if (!chunkInfo.measuredH) chunkInfo.measuredH = (chunkInfo.rowEnd - chunkInfo.rowStart) * 120;
// Compensate scroll: nếu chunk này nằm TRƯỚC viewport hiện tại, sau khi shrink/grow
// (do measuredH khác height thật) sẽ đẩy content phía dưới trượt lên/xuống.
// `overflow-anchor: none` (đặt trên #sutraGrid trong CSS) khiến browser KHÔNG tự bù.
// Mirror logic của materializeChunk — đo bottom trước/sau, adjust scrollTop.
var scroller = scrollEl;
var needsCompensation = false;
var oldChunkBottom = 0;
if (scroller && chunkInfo.div.parentNode === scroller && Date.now() >= _progScrollUntil) {
var preRect = chunkInfo.div.getBoundingClientRect();
var preRootRect = scroller.getBoundingClientRect();
oldChunkBottom = preRect.bottom - preRootRect.top + scroller.scrollTop;
if (oldChunkBottom <= scroller.scrollTop) needsCompensation = true;
}
while (chunkInfo.div.firstChild) chunkInfo.div.removeChild(chunkInfo.div.firstChild);
chunkInfo.div.style.minHeight = chunkInfo.measuredH + 'px';
chunkInfo.materialized = false;
for (var i = chunkInfo.rowStart; i < chunkInfo.rowEnd; i++) {
cachedRows[i] = null;
}
if (needsCompensation && scroller) {
var newChunkRect = chunkInfo.div.getBoundingClientRect();
var newRootRect  = scroller.getBoundingClientRect();
var newChunkBottom = newChunkRect.bottom - newRootRect.top + scroller.scrollTop;
var delta = newChunkBottom - oldChunkBottom;
if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
}
}
function teardownChunkObservers() {
if (virtMatObs) { virtMatObs.disconnect(); virtMatObs = null; }
if (virtDemObs) { virtDemObs.disconnect(); virtDemObs = null; }
}
function setupChunkObservers() {
teardownChunkObservers();
if (!scrollEl || !virtChunks.length) return;
virtMatObs = new IntersectionObserver(function (entries) {
for (var i = 0; i < entries.length; i++) {
if (entries[i].isIntersecting) {
var idx = parseInt(entries[i].target.getAttribute('data-chunk-idx'), 10);
if (Number.isFinite(idx) && virtChunks[idx]) materializeChunk(virtChunks[idx]);
}
}
// Top margin 200% (cao hơn 100% trước đây): khi user scroll lên (đặc biệt fling-scroll
// trên mobile), chunks phía trên cần materialize SỚM khi vẫn còn fully-above viewport
// để compensation logic trong materializeChunk (chỉ fire khi oldChunkBottom <= scrollTop)
// kịp adjust scrollTop trước khi chunk lọt vào viewport. Nếu chunk straddle viewport top
// lúc materialize, height thật ≠ EST_ROW_H placeholder → content shift, user mất vị trí
// đang đọc. Bottom giữ 100% — scroll xuống không bị shift (chunks below grow chỉ đẩy
// content phía dưới chúng, không ảnh hưởng row user đang đọc ở phía trên).
// Hysteresis với dematerialize observer (300%) vẫn dư 100% buffer.
}, { root: scrollEl, rootMargin: '200% 0px 100% 0px', threshold: 0 });
virtDemObs = new IntersectionObserver(function (entries) {
for (var i = 0; i < entries.length; i++) {
if (!entries[i].isIntersecting) {
var idx = parseInt(entries[i].target.getAttribute('data-chunk-idx'), 10);
if (Number.isFinite(idx) && virtChunks[idx]) dematerializeChunk(virtChunks[idx]);
}
}
}, { root: scrollEl, rootMargin: '300% 0px 300% 0px', threshold: 0 });
for (var k = 0; k < virtChunks.length; k++) {
virtMatObs.observe(virtChunks[k].div);
virtDemObs.observe(virtChunks[k].div);
}
}
function ensureRowRendered(rowIdx) {
for (var k = 0; k < virtChunks.length; k++) {
var c = virtChunks[k];
if (rowIdx >= c.rowStart && rowIdx < c.rowEnd) {
if (!c.materialized) materializeChunk(c);
return;
}
}
}
async function renderSutra(id) {
if (!id || !grid) return;
// Khi đổi sutta → drop cache mode của sutta cũ để tiết kiệm memory.
// (Mode swap chỉ có ý nghĩa trong cùng 1 sutta.)
if (currentSutraId && currentSutraId !== id) _dmInvalidateForSutta(currentSutraId);
resetTts(true, false);
if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
teardownChunkObservers();
virtChunks = [];
virtAllRows = [];
firstVisibleKey = null;
cachedRows = [];
var token = ++renderToken;
isRendering = true;
grid.setAttribute('aria-busy', 'true');
if (btnReadTts)  btnReadTts.disabled  = true;
if (btnPauseTts) btnPauseTts.disabled = true;
if (btnStopTts)  btnStopTts.disabled  = true;
var merged = null;
try { merged = await loadMerged(id); } catch(e) { merged = null; }
if (token !== renderToken) {
isRendering = false;
return;
}
currentSutraId = id;
syncTileToCurrentSutta();
highlightActiveInMenu();
updateNavButtons();
if (!merged || !merged.rows || !merged.rows.length) {
// Không lưu KEY_LAST khi fail — tránh reload kẹt loop vào id hỏng
// (mobile thường gặp khi pack timeout do SW cũ / cache dở dang).
if (storage.get(KEY_LAST) === id) storage.remove(KEY_LAST);
if (titleEl) titleEl.textContent = uiLang === 'en' ? 'Sutta data not found' : 'Không tìm thấy dữ liệu bài kinh';
if (subtitleEl) subtitleEl.textContent = (uiLang === 'en' ? 'ID: ' : 'Mã bài: ') + id;
grid.innerHTML = '<div style="max-width:520px;margin:48px auto;padding:24px;text-align:center;font-family:var(--serif-vi);color:var(--ink-3);font-style:italic;border:1px dashed var(--rule);border-radius:6px">'
+ (uiLang === 'en'
? 'No data for this sutta yet. Please choose another.'
: 'Bài kinh chưa có dữ liệu — vui lòng chọn bài khác.')
+ '</div>';
isRendering = false;
grid.setAttribute('aria-busy', 'false'); setTtsUiState('idle'); return;
}
storage.set(KEY_LAST, id);
var titleFromBilara    = (pickTextForUiLangSuffix(merged, id, ':0.2') || '').trim();
var subtitleFromBilara = (pickTextForUiLangSuffix(merged, id, ':0.1') || '').trim();
var meta = findMetaById(id) || {};
var titleFallback = uiLang === 'en'
? meta.titleEn || meta.titleVi || meta.titlePali || meta.title || id
: meta.titleVi || meta.titleEn || meta.titlePali || meta.title || id;
var rootLabelVi = meta.rootNikaya  ? (meta.rootNikaya.labelVi  || meta.rootNikaya.key)  : '';
var rootLabelEn = meta.rootNikaya  ? (meta.rootNikaya.labelEn  || meta.rootNikaya.key)  : '';
var parentLabelVi = meta.parentGroup ? (meta.parentGroup.labelVi || meta.parentGroup.key) : '';
var parentLabelEn = meta.parentGroup ? (meta.parentGroup.labelEn || meta.parentGroup.key) : '';
function extractShortLabel(label, lang) {
if (!label) return '';
var parts = label.split(/\s+-\s+/);
return lang === 'vi' ? (parts[1] || parts[0] || '').trim() : (parts[0] || label).trim();
}
var rootShort   = extractShortLabel(uiLang === 'en' ? rootLabelEn   : rootLabelVi,   uiLang);
var parentShort = extractShortLabel(uiLang === 'en' ? parentLabelEn : parentLabelVi, uiLang);
var rootKey = meta.rootNikaya ? meta.rootNikaya.key : '';
var titleOverride = null, titleMetaOverride = null;
var AN_ORDINALS_EN = ['', 'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes',
'Sevens', 'Eights', 'Nines', 'Tens', 'Elevens'];
if (rootKey === 'SN') {
titleOverride     = uiLang === 'en' ? (meta.titleEn || meta.titleVi) : (meta.titleVi || meta.titleEn);
titleMetaOverride = uiLang === 'en' ? (meta.titleVi || '') : (meta.titleEn || '');
} else if (rootKey === 'AN' && meta.code) {
var anM = String(meta.code).match(/AN\s*(\d+)/);
if (anM) {
var n = parseInt(anM[1], 10);
var an_vi = 'Nhóm ' + n + ' Pháp';
var an_en = 'Book of ' + (AN_ORDINALS_EN[n] || n);
titleOverride     = uiLang === 'en' ? an_en : an_vi;
titleMetaOverride = uiLang === 'en' ? an_vi : an_en;
}
}
var resolvedTitle = titleOverride || titleFromBilara || titleFallback;
if (titleEl) titleEl.textContent = resolvedTitle;
applyTitleBookmarkState();
var paliName = (meta.titlePali || subtitleFromBilara || '').trim();
isAN = (rootKey === 'AN');
isSN = (rootKey === 'SN');
fallbackTitle = (resolvedTitle || '').trim();
superLastSlotEl = null;
if (superTitleEl) {
var superParts = [];
if (rootShort) superParts.push(rootShort);
if (parentShort && parentShort !== rootShort && rootKey !== 'SN') {
superParts.push(parentShort);
}
var codeTxt = (meta.code || '').trim();
if (codeTxt) superParts.push(codeTxt);
if (isSN) {
// SN hierarchy: Nikāya · SN-code · Saṁyutta (static) · [Vagga dynamic, appears on scroll into a vagga]
if (fallbackTitle) superParts.push(fallbackTitle);
superTitleEl.textContent = '';
for (var spi = 0; spi < superParts.length; spi++) {
if (spi > 0) superTitleEl.appendChild(document.createTextNode(' · '));
var spSpan = document.createElement('span');
spSpan.textContent = superParts[spi];
superTitleEl.appendChild(spSpan);
}
var sepNode = document.createElement('span');
sepNode.className = 'super-sep';
sepNode.textContent = ' · ';
sepNode.style.display = 'none';
superTitleEl.appendChild(sepNode);
var dynSpan = document.createElement('span');
dynSpan.id = 'superLastSlot';
dynSpan.textContent = '';
superTitleEl.appendChild(dynSpan);
superLastSlotEl = dynSpan;
superLastSlotEl._sep = sepNode;
} else {
// AN / DN / MN: last slot static
var lastSlotText = isAN ? fallbackTitle : paliName;
if (lastSlotText) superParts.push(lastSlotText);
superTitleEl.textContent = superParts.join(' · ');
}
}
lastAppliedVaggaIdx = -2;
lastAppliedSuttaIdx = -2;
if (subtitleEl) subtitleEl.textContent = '';
var altName = titleMetaOverride || (uiLang === 'en' ? (meta.titleVi || '') : (meta.titleEn || ''));
fallbackTitleMeta = (altName || '').trim();
if (titleMetaEl) {
titleMetaEl.textContent = altName;
}
var normId = String(id).replace(/([A-Za-z]+)0*(\d)/g, '$1$2');
var mainPrefix1 = id + ':0.';
var mainPrefix2 = normId + ':0.';
var mainRows = [];
var sourceRows = [];
(merged.rows || []).forEach(function (r) {
var k = String(r.key || '');
if (k.startsWith(mainPrefix1) || k.startsWith(mainPrefix2)) return;
if (/:source$/i.test(k)) sourceRows.push(r);
else mainRows.push(r);
});
var rowsForViewRaw = mainRows.concat(sourceRows);
var singleLang = getSingleVisibleLang(); lastSingleLangMode = singleLang;
// Lấy từ cache: rowsForView + keyToRowIdx + markers đã tính sẵn
var viewData = getViewData(id, rowsForViewRaw, singleLang, isAN, isSN);
var rowsForView = viewData.rows;
grid.innerHTML = '';
cachedRows = [];
applyVisibility();
var CHUNK_SIZE = 50;
// Heuristic chiều cao placeholder. Over-estimate tốt hơn under-estimate
// (tránh scrollbar nhảy khi chunk materialize từ 120 → ~200 trong layout thật).
var EST_ROW_H = singleLang ? 130 : (card && card.classList.contains('stack') ? 220 : 180);
virtChunks = [];
virtAllRows = rowsForView;
keyToRowIdx = viewData.keyToRowIdx;
vaggaMarkers = viewData.vaggaMarkers;
suttaMarkers = viewData.suttaMarkers;
lastAppliedVaggaIdx = -2;
lastAppliedSuttaIdx = -2;
var placeFrag = document.createDocumentFragment();
for (var ci = 0; ci < rowsForView.length; ci += CHUNK_SIZE) {
var ce = Math.min(ci + CHUNK_SIZE, rowsForView.length);
var cdiv = document.createElement('div');
cdiv.className = 'row-chunk';
cdiv.setAttribute('data-chunk-idx', String(virtChunks.length));
cdiv.style.minHeight = ((ce - ci) * EST_ROW_H) + 'px';
virtChunks.push({ div: cdiv, rowStart: ci, rowEnd: ce, materialized: false, measuredH: 0 });
placeFrag.appendChild(cdiv);
}
grid.appendChild(placeFrag);
/* Eager materialize vài chunks quanh anchor NGAY trong tick đồng bộ này,
TRƯỚC khi browser paint → hết flash đen. Anchor restore ở RAF kế tiếp
sẽ scroll đúng vị trí vì chunk chứa anchor đã render sẵn. */
(function eagerAroundAnchor() {
try {
var anchorKey = getAnchorKeyFor(id);
var anchorIdx = (anchorKey && keyToRowIdx[anchorKey] != null) ? keyToRowIdx[anchorKey] : 0;
var anchorChunkIdx = Math.floor(anchorIdx / CHUNK_SIZE);
// CRITICAL: materialize TẤT CẢ chunks từ 0 → anchorChunkIdx (không chỉ ±1).
// Lý do: chunks ở giữa nếu còn placeholder (EST_ROW_H estimate ≠ real height)
// → getBoundingClientRect() của anchorChunk trả về vị trí SAI (placeholder shorter
// than real → rawY underestimated) → scrollTop set sai → restore landed wrong row.
// Sau khi chunks materialize sau đó (qua materialize observer), layout shift, user
// thấy nội dung KHÁC vị trí ban đầu, save listener fire ghi đè anchor key sai.
// Cost RAM: với DN16 (~50 rows×34 chunks) materialize hết = ~17K DOM nodes ~30MB,
// chấp nhận được. Dematerialize observer (300%) sẽ dọn chunks xa viewport sau đó.
var lo = 0;
var hi = Math.min(virtChunks.length - 1, anchorChunkIdx + 1);
for (var eci = lo; eci <= hi; eci++) materializeChunk(virtChunks[eci]);
// Sync pre-scroll: đưa viewport về vùng đã materialize TRƯỚC khi browser paint.
// Không có dòng này → frame paint đầu tiên ở scrollTop=0 nơi chunk 0 là placeholder rỗng,
// dark mode thấy body bg (#0b0c0e) → flash đen cho bài dài có anchor xa.
var scroller = getScrollRoot() || scrollEl;
// Skip eager pre-scroll khi page ngắn — không scrollable. Tránh set scrollTop về
// giá trị nhỏ rồi RAF correction phải revert về 0, gây flash.
var maxScrollY = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
if (anchorChunkIdx > 0 && scroller && virtChunks[anchorChunkIdx] && virtChunks[anchorChunkIdx].div && maxScrollY > 10) {
// `offsetTop` reference đến nearest positioned ancestor (.card có position:relative),
// KHÔNG phải scroller. Dùng getBoundingClientRect math để lấy đúng vị trí trong scroller,
// rồi clamp [0, maxScrollTop] để tránh over-scroll khi anchor chunk nằm cuối bài.
var chunkRect = virtChunks[anchorChunkIdx].div.getBoundingClientRect();
var rootRect  = scroller.getBoundingClientRect();
var rawY = (chunkRect.top - rootRect.top) + scroller.scrollTop;
var maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
var targetY = Math.max(0, Math.min(rawY, maxY));
scroller.scrollTop = targetY;
if (window.DEBUG_ANCHOR) {
console.log('[EAGER-FIX]', 'anchorKey=', anchorKey, 'anchorIdx=', anchorIdx,
'chunkIdx=', anchorChunkIdx, 'rawY=', rawY.toFixed(0),
'maxY=', maxY.toFixed(0), 'targetY=', targetY.toFixed(0),
'→ actual=', scroller.scrollTop);
}
}
} catch (e) { /* ignore */ }
})();
requestAnimationFrame(function () {
if (token !== renderToken) { isRendering = false; return; }
setupChunkObservers();
grid.setAttribute('aria-busy', 'false');
requestAnimationFrame(function () {
updateVisibleCols(); restoreScrollByAnchor(id);
setupAnchorObserver(); updateNavButtons();
// Snapshot mode hiện tại vào DOM_MODE_CACHE → lần sau toggle về mode này sẽ instant
try { _dmSaveCurrent(); } catch (_) {}
try { updateReadingProgress(); } catch (_) {}
setTimeout(function () {
isRendering = false;
setTtsUiState('idle');
}, 500);
});
scheduleNextPreload(id);
});
}

// ── tts-print.js ────────────────────────────────────────────────
function scheduleNextPreload(currentId) {
try {
var idx = SUTRA_ORDER.indexOf(currentId); if (idx === -1) return;
var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
if (conn && conn.saveData) return;
if (navigator.deviceMemory && navigator.deviceMemory < 2) return;
var nextId = SUTRA_ORDER[idx + 1];
var prevId = idx > 0 ? SUTRA_ORDER[idx - 1] : null;
var doPreload = function () {
if (nextId) loadMerged(nextId).catch(function () {});
if (prevId) loadMerged(prevId).catch(function () {});
};
if (!nextId && !prevId) return;
if ('requestIdleCallback' in window) requestIdleCallback(doPreload, { timeout: 2000 });
else setTimeout(doPreload, 800);
} catch(e){}
}
function openSutra(id) {
// Self-heal: nếu caller truyền segment prefix (vd "dn1") thay vì sutta file id ("dn01"),
// resolve qua SUTRA_INDEX. Bảo vệ khỏi LS bị pollute, hash, legacy bookmarks.
if (id) id = _resolveSegPrefixToSuttaId(id);
document.documentElement.classList.remove('is-welcome');
renderSutra(id);
}
(function wireBookmarkCurrent() {
var btn = $('btnBookmarkCurrent');
if (!btn) return;
btn.addEventListener('click', function (e) {
e.stopPropagation();
if (!currentSutraId) return;
var now = toggleBookmark(currentSutraId);
reflectBookmarkState(currentSutraId, now);
if (activeNikayaKey === 'BM') renderBookmarksList();
});
})();
function buildSuttaPrintHtml(id, merged) {
var meta = findMetaById(id) || {};
var rootKey = meta.rootNikaya ? meta.rootNikaya.key : '';
var skipDupTitle = (rootKey === 'MN' || rootKey === 'DN');
var cmtOnPli = !!(showCmtPli && showPali);
var cmtOnEng = !!(showCmtEng && showEng);
var cmtOnVie = !!(showCmtVie && showVie);
var cmtHeaders = uiLang === 'en'
? { pali: 'Aṭṭhakathā', eng: 'Commentary', vie: 'Vietnamese Cmt' }
: { pali: 'Aṭṭhakathā', eng: 'Commentary', vie: 'Chú giải' };
var title = (titleEl && titleEl.textContent) || (meta.titleVi || meta.titleEn || id);
var subtitle = (subtitleEl && subtitleEl.textContent) || '';
var supertitle = (superTitleEl && superTitleEl.textContent) || '';
var titleMeta = (titleMetaEl && titleMetaEl.textContent) || '';
var headers = uiLang === 'en'
? { pali: 'Pali', eng: 'English', vie: 'Vietnamese' }
: { pali: 'Pali', eng: 'English', vie: 'Tiếng Việt' };
function esc(s) {
return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
});
}
function shortKey(raw) {
if (!raw) return '';
if (raw.indexOf(':') !== -1) {
var parts = raw.split(':');
var prefix = parts[0].replace(/([a-zA-Z]+)(\d*)/, function (_, l, n) { return l.toUpperCase() + n; });
return parts[1] ? prefix + '.' + parts[1] : prefix;
}
return String(raw).toUpperCase();
}
var activeLangCount = (showPali ? 1 : 0) + (showEng ? 1 : 0) + (showVie ? 1 : 0);
var singleLang = activeLangCount === 1;
function tag(name) { return singleLang ? '' : '<span class="lang-tag">' + esc(name) + '</span>'; }
function rowHtml(r) {
var tp = (r.pali || '').trim();
var te = (r.eng || '').trim();
var tv = (r.vie || '').trim();
var keyRaw = String(r.key || '');
if (skipDupTitle && /:0\.[12]$/.test(keyRaw)) return '';
var isSectionNum = (tp.length <= 6 && te.length <= 6 && tv.length <= 6) &&
/^[IVXLCDM]+\.?$|^\d+\.?$/.test(tp || te || tv);
if (isSectionNum) return '';
var isSource = /:source$/i.test(keyRaw);
var isSubtitle = /:0\.[123]$/.test(keyRaw);
var cls = 'prow';
if (isSource) cls += ' prow-source';
if (isSubtitle) cls += ' prow-subtitle';
var inner = [];
if (showSegKey !== false) {
inner.push('<div class="prow-key">' + esc(shortKey(keyRaw)) + '</div>');
}
if (showPali && tp) inner.push('<div class="prow-pali">' + tag(headers.pali) + esc(tp) + '</div>');
if (showEng && te) inner.push('<div class="prow-eng">' + tag(headers.eng) + esc(te) + '</div>');
if (showVie && tv) inner.push('<div class="prow-vie">' + tag(headers.vie) + esc(tv) + '</div>');
if (!isSubtitle) {
var cPli = cmtOnPli ? resolveCommentLang(r.commentPli) : '';
var cEng = cmtOnEng ? resolveCommentLang(r.commentEn)  : '';
var cVie = cmtOnVie ? resolveCommentLang(r.commentVie) : '';
if (cPli) inner.push('<div class="prow-cmt prow-cmt-pli">' + tag(cmtHeaders.pali) + esc(cPli) + '</div>');
if (cEng) inner.push('<div class="prow-cmt prow-cmt-eng">' + tag(cmtHeaders.eng) + esc(cEng) + '</div>');
if (cVie) inner.push('<div class="prow-cmt prow-cmt-vie">' + tag(cmtHeaders.vie) + esc(cVie) + '</div>');
if (r._merged && Array.isArray(r._mergedComments)) {
for (var mi = 0; mi < r._mergedComments.length; mi++) {
var mc = r._mergedComments[mi];
var mcText = mc && typeof mc.text === 'string' ? mc.text.trim() : '';
if (!mcText) continue;
var mcLang = mc && mc.lang;
var inclMc = (mcLang === 'pali' && cmtOnPli) || (mcLang === 'eng' && cmtOnEng) ||
(mcLang === 'vie' && cmtOnVie) || (!mcLang && (cmtOnPli || cmtOnEng || cmtOnVie));
if (!inclMc) continue;
var mcCls = mcLang === 'pali' ? 'prow-cmt prow-cmt-pli' :
mcLang === 'eng'  ? 'prow-cmt prow-cmt-eng' :
mcLang === 'vie'  ? 'prow-cmt prow-cmt-vie' : 'prow-cmt';
var mcHdr = mcLang === 'pali' ? cmtHeaders.pali :
mcLang === 'eng'  ? cmtHeaders.eng  :
mcLang === 'vie'  ? cmtHeaders.vie  : cmtHeaders.vie;
inner.push('<div class="' + mcCls + '">' + tag(mcHdr) + esc(mcText) + '</div>');
}
}
}
if (!inner.length) return '';
return '<div class="' + cls + '">' + inner.join('') + '</div>';
}
var bodyRows = [], sourceRows = [];
merged.rows.forEach(function (r) {
if (/:source$/i.test(String(r.key || ''))) sourceRows.push(r);
else bodyRows.push(r);
});
var rowsHtml = bodyRows.map(rowHtml).join('') + sourceRows.map(rowHtml).join('');
var docTitle = esc((meta.code ? meta.code + ' · ' : '') + title);
var footerText = uiLang === 'en'
? 'Sutta Archive · Pāli & English: SuttaCentral / Bilara · ID: ' + esc(id)
: 'Sutta Archive · Pāli & Anh: SuttaCentral / Bilara · Mã bài: ' + esc(id);
return '<!DOCTYPE html><html lang="' + uiLang + '"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>' + docTitle + '</title>' +
'<style>' +
'@page { size: A4; margin: 0; }' +
'* { box-sizing: border-box; }' +
'html, body { margin: 0; padding: 0; }' +
'body { font-family: Cambria, "Noto Serif", Georgia, "Times New Roman", serif; color: #111; line-height: 1.55; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
'.sheet { width: 100%; border-collapse: collapse; }' +
'.sheet > thead > tr > td, .sheet > tbody > tr > td, .sheet > tfoot > tr > td { padding: 0 22mm; vertical-align: top; }' +
'.pad-top { height: 20mm; }' +
'.pad-bot { height: 22mm; }' +
'.phdr { text-align: center; border-bottom: 1px solid #999; padding-bottom: 12px; margin-bottom: 18px; }' +
'.phdr .supertitle { font-size: 9pt; color: #666; letter-spacing: 1.5px; text-transform: uppercase; font-family: Consolas, "Courier New", monospace; }' +
'.phdr h1 { font-size: 20pt; margin: 6px 0 4px; font-weight: 500; letter-spacing: -0.3px; }' +
'.phdr .subtitle { font-size: 11pt; color: #444; font-style: italic; }' +
'.phdr .meta { font-size: 9.5pt; color: #777; margin-top: 4px; }' +
'.prow { margin: 0 0 10px; page-break-inside: avoid; break-inside: avoid; }' +
'.prow-key { font-family: Consolas, "Courier New", monospace; font-size: 7.5pt; color: #999; margin-bottom: 2px; letter-spacing: 0.3px; }' +
'.prow-pali { font-style: italic; color: #333; margin-bottom: 2px; }' +
'.prow-eng { color: #222; margin-bottom: 2px; }' +
'.prow-vie { color: #111; }' +
'.lang-tag { display: inline-block; font-family: Consolas, "Courier New", monospace; font-size: 7pt; text-transform: uppercase; color: #aaa; margin-right: 6px; letter-spacing: 0.5px; vertical-align: 1px; }' +
'.prow-subtitle { text-align: center; font-size: 12pt; margin-bottom: 14px; }' +
'.prow-subtitle .prow-key, .prow-subtitle .lang-tag { display: none; }' +
'.prow-cmt { font-size: 9.5pt; color: #555; margin: 2px 0 2px 12px; padding-left: 6px; border-left: 2px solid #ddd; }' +
'.prow-cmt-pli { font-style: italic; }' +
'.prow-source { font-size: 9pt; color: #888; margin-top: 18px; padding-top: 10px; border-top: 1px dashed #ccc; }' +
'.pftr { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8pt; color: #888; text-align: center; }' +
'@media print { .prow { margin-bottom: 9px; } }' +
'</style></head><body>' +
'<table class="sheet">' +
'<thead><tr><td><div class="pad-top"></div></td></tr></thead>' +
'<tbody><tr><td>' +
'<header class="phdr">' +
(supertitle ? '<div class="supertitle">' + esc(supertitle) + '</div>' : '') +
'<h1>' + esc(title) + '</h1>' +
(subtitle && subtitle !== '—' ? '<div class="subtitle">' + esc(subtitle) + '</div>' : '') +
(titleMeta ? '<div class="meta">' + esc(titleMeta) + '</div>' : '') +
'</header>' +
'<main>' + rowsHtml + '</main>' +
'<footer class="pftr">' + footerText + '</footer>' +
'</td></tr></tbody>' +
'<tfoot><tr><td><div class="pad-bot"></div></td></tr></tfoot>' +
'</table>' +
'</body></html>';
}
function printCurrentSuttaPdf() {
if (!currentSutraId) return;
var id = currentSutraId;
var merged = MERGED_CACHE.get(id);
var ensure = merged ? Promise.resolve(merged) : loadMerged(id);
Promise.resolve(ensure).then(function (m) {
if (!m || !m.rows || !m.rows.length) return;
var html = buildSuttaPrintHtml(id, m);
var iframe = document.createElement('iframe');
iframe.setAttribute('aria-hidden', 'true');
iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
document.body.appendChild(iframe);
var printed = false;
var cleanedUp = false;
var cleanup = function () {
if (cleanedUp) return; cleanedUp = true;
if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
};
var doPrint = function () {
if (printed) return; printed = true;
try {
iframe.contentWindow.focus();
iframe.contentWindow.onafterprint = function () { setTimeout(cleanup, 1000); };
window.addEventListener('focus', function onReturn() {
window.removeEventListener('focus', onReturn);
setTimeout(cleanup, 1500);
}, { once: true });
iframe.contentWindow.print();
} catch (e) { console.warn(e); cleanup(); }
setTimeout(cleanup, 180000);
};
iframe.onload = function () { setTimeout(doPrint, 400); };
var doc = iframe.contentWindow.document;
doc.open(); doc.write(html); doc.close();
setTimeout(doPrint, 2000);
}).catch(function (e) { console.warn('[PDF] generation failed', e); });
}
var btnPrintPdf = $('btnPrintPdf');
if (btnPrintPdf) btnPrintPdf.onclick = function () {
if (!currentSutraId) return;
togglePanel(settingsPanel, false);
printCurrentSuttaPdf();
};
var btnPrev = $('btnPrev');
var btnNext = $('btnNext');
function updateNavButtons() {
var idx = SUTRA_ORDER.indexOf(currentSutraId);
var navTitle = $('navTitle');
if (!currentSutraId || !Array.isArray(SUTRA_ORDER) || !SUTRA_ORDER.length || idx === -1) {
if (btnPrev)  btnPrev.disabled  = true;
if (btnNext)  btnNext.disabled  = true;
if (navTitle) navTitle.textContent = '—';
return;
}
if (btnPrev) btnPrev.disabled = !(idx > 0);
if (btnNext) btnNext.disabled = !(idx < SUTRA_ORDER.length - 1);
if (navTitle) {
var meta  = findMetaById(currentSutraId);
var shortCode = extractGroupKey(meta && meta.code);
var title = uiLang === 'en'
? (meta && meta.titleEn) || (meta && meta.titleVi) || (meta && meta.titlePali) || currentSutraId
: (meta && meta.titleVi) || (meta && meta.titleEn) || (meta && meta.titlePali) || currentSutraId;
navTitle.textContent = shortCode ? (shortCode + ' · ' + title) : title;
navTitle.style.cursor = 'pointer';
navTitle.setAttribute('role', 'button');
navTitle.setAttribute('title', (meta && meta.code ? meta.code + ' · ' : '') + title);
}
}
function revealCurrentSuttaInMenu() {
if (!currentSutraId || !sutraMenuPanel || !sutraMenuList) return;
togglePanel(settingsPanel, false);
var nikOfCurrent = findNikayaOfSutta(currentSutraId);
if (nikOfCurrent && nikOfCurrent !== activeNikayaKey) {
setActiveNikaya(nikOfCurrent, true);
}
togglePanel(sutraMenuPanel, true);
setTimeout(function () {
var link = sutraMenuList.querySelector('.menu-sutta-link[data-id="' + safeCssEscape(currentSutraId) + '"]');
if (!link) return;
var node = link.parentElement;
while (node && node !== sutraMenuList) {
if (node.classList && node.classList.contains('menu-list') && node.classList.contains('collapsed')) {
node.classList.remove('collapsed');
var panelId = node.id;
if (panelId) {
var toggle = sutraMenuList.querySelector('.menu-toggle[data-target="' + panelId + '"]');
if (toggle) {
toggle.setAttribute('aria-expanded', 'true');
var chev = toggle.querySelector('.chevron');
if (chev) chev.textContent = '▾';
}
}
}
node = node.parentElement;
}
try { link.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { link.scrollIntoView(); }
}, 240);
}
var navTitleEl = $('navTitle');
if (navTitleEl) {
navTitleEl.setAttribute('tabindex', '0');
navTitleEl.addEventListener('click', function (e) {
e.stopPropagation();
if (currentSutraId) revealCurrentSuttaInMenu();
});
navTitleEl.addEventListener('keydown', function (e) {
if ((e.key === 'Enter' || e.key === ' ') && currentSutraId) {
e.preventDefault();
revealCurrentSuttaInMenu();
}
});
}
function _blurIfMouse(btn) {
try { if (!btn.matches(':focus-visible')) btn.blur(); } catch(_){}
}
if (btnPrev) btnPrev.onclick = function () {
var idx = SUTRA_ORDER.indexOf(currentSutraId);
if (idx > 0) openSutra(SUTRA_ORDER[idx - 1]);
_blurIfMouse(btnPrev);
};
if (btnNext) btnNext.onclick = function () {
var idx = SUTRA_ORDER.indexOf(currentSutraId);
if (idx !== -1 && idx < SUTRA_ORDER.length - 1) openSutra(SUTRA_ORDER[idx + 1]);
_blurIfMouse(btnNext);
};
var synthSupported = 'speechSynthesis' in window;
function setTtsUiState(state) {
if (!btnReadTts || !btnPauseTts || !btnStopTts) return;
if (!synthSupported || isRendering) {
btnReadTts.disabled = btnPauseTts.disabled = btnStopTts.disabled = true; return;
}
if (state === 'idle')    { btnReadTts.disabled=false; btnPauseTts.disabled=true;  btnStopTts.disabled=true; }
if (state === 'playing') { btnReadTts.disabled=true;  btnPauseTts.disabled=false; btnStopTts.disabled=false; }
if (state === 'paused')  { btnReadTts.disabled=false; btnPauseTts.disabled=true;  btnStopTts.disabled=false; }
}
function clearRowHighlight() {
if (!grid) return;
var reading = grid.querySelectorAll('.sutra-row.reading');
for (var k = 0; k < reading.length; k++) reading[k].classList.remove('reading');
}
function highlightRowAt(index) {
clearRowHighlight();
if (index < 0 || index >= virtAllRows.length) return;
ensureRowRendered(index);
var row = cachedRows[index];
if (!row) return;
row.classList.add('reading');
if (!scrollEl) return;
var rootRect = scrollEl.getBoundingClientRect();
var rowRect  = row.getBoundingClientRect();
var relativeTop = rowRect.top - rootRect.top + scrollEl.scrollTop;
var viewTop = scrollEl.scrollTop, viewBottom = viewTop + scrollEl.clientHeight;
if (relativeTop < viewTop || relativeTop + rowRect.height > viewBottom) {
scrollEl.scrollTo({ top: Math.max(0, relativeTop - 20), behavior: 'auto' });
}
}
var _ttsModulePromise = null;
var _ttsApi = null;
function loadScript(src) {
return new Promise(function (resolve, reject) {
var s = document.createElement('script');
s.src = src; s.async = true;
s.onload = function () { resolve(); };
s.onerror = function (e) { reject(e); };
document.head.appendChild(s);
});
}
function ensureTTSLoaded() {
if (_ttsApi) return Promise.resolve(_ttsApi);
if (!_ttsModulePromise) {
_ttsModulePromise = loadScript('tts.js').then(function () {
if (!window.TTSModule) throw new Error('TTSModule failed to load');
_ttsApi = window.TTSModule.init({
getVirtAllRows: function () { return virtAllRows; },
getCurrentSutraId: function () { return currentSutraId; },
getUiLang: function () { return uiLang; },
getIsRendering: function () { return isRendering; },
clearRowHighlight: clearRowHighlight,
highlightRowAt: highlightRowAt,
setTtsUiState: setTtsUiState,
storage: storage,
});
return _ttsApi;
});
}
return _ttsModulePromise;
}
function resetTts(clearHighlight, clearStorage) {
if (synthSupported && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch(e){} }
if (_ttsApi) { try { _ttsApi.reset(clearHighlight, clearStorage); return; } catch(e){} }
if (clearHighlight) clearRowHighlight();
if (clearStorage && currentSutraId) storage.remove('tts_state_' + currentSutraId);
setTtsUiState('idle');
}
if (btnReadTts) btnReadTts.onclick = async function () {
try { var api = await ensureTTSLoaded(); api.start(); } catch (e) { console.error('TTS load failed:', e); }
};
if (btnPauseTts) btnPauseTts.onclick = function () { if (_ttsApi) _ttsApi.pause(); };
if (btnStopTts)  btnStopTts.onclick  = function () { if (_ttsApi) _ttsApi.stop(); };
function initUiLang() {
renderUiLangFlag(); applyUiLanguageToSearchUi(); applyUiLanguageToSettingsPanel(); renderGuideDialog();
if (!btnUiLang) return;
btnUiLang.addEventListener('click', function (e) {
e.stopPropagation();
uiLang = uiLang === 'vi' ? 'en' : 'vi';
storage.set(LANG_STORAGE_KEY, uiLang); window.SUTRA_UI_LANG = uiLang;
renderUiLangFlag(); applyUiLanguageToSearchUi(); applyUiLanguageToSettingsPanel(); renderGuideDialog();
buildSutraMenuFromIndex(); highlightActiveInMenu(); updateNavButtons();
updateBookmarksCount(); applyTitleBookmarkState();
if (currentSutraId) renderSutra(currentSutraId); else renderWelcomeScreen();
});
}

// ── init.js ─────────────────────────────────────────────────────
function init() {
if (!grid || !titleEl || !subtitleEl || !card) console.warn('Sutta app: core DOM missing.');
initUiLang(); loadViewPrefs();
if (btnPali) { btnPali.classList.toggle('active', showPali); btnPali.setAttribute('aria-pressed', String(showPali)); }
if (btnEng)  { btnEng.classList.toggle('active',  showEng);  btnEng.setAttribute('aria-pressed',  String(showEng)); }
if (btnVie)  { btnVie.classList.toggle('active',  showVie);  btnVie.setAttribute('aria-pressed',  String(showVie)); }
if (btnLayout) { btnLayout.classList.toggle('active', card ? card.classList.contains('stack') : false); }
var _bsk = $('btnSegKey'); if (_bsk) { _bsk.classList.toggle('active', showSegKey); _bsk.setAttribute('aria-pressed', String(showSegKey)); }
var _bsh = $('btnSegHdr'); if (_bsh) { _bsh.classList.toggle('active', showColHdr); _bsh.setAttribute('aria-pressed', String(showColHdr)); }
syncCmtButtons();
var _bhp = $('btnHlPli'); if (_bhp) { _bhp.classList.toggle('active', hlPli); _bhp.setAttribute('aria-pressed', String(hlPli)); }
var _bhe = $('btnHlEng'); if (_bhe) { _bhe.classList.toggle('active', hlEng); _bhe.setAttribute('aria-pressed', String(hlEng)); }
var _bhv = $('btnHlVie'); if (_bhv) { _bhv.classList.toggle('active', hlVie); _bhv.setAttribute('aria-pressed', String(hlVie)); }
var _b3c = $('btn3Cols'); if (_b3c) { _b3c.classList.toggle('active', show3Cols); _b3c.setAttribute('aria-pressed', String(show3Cols)); }
loadBookmarks();
applyVisibility(); applySegKeyHdrVis(); loadZoom(); loadLineHeight(); buildSutraMenuFromIndex(); initDelegations();
updateBookmarksCount();
var startId = storage.get(KEY_LAST);
var _bootHash = _parseAnchorHash();
if (_bootHash && _bootHash.sutta) startId = _bootHash.sutta;
if (startId) openSutra(startId); else renderWelcomeScreen();
window.addEventListener('hashchange', function () {
var h = _parseAnchorHash();
if (!h) return;
if (h.sutta !== currentSutraId) openSutra(h.sutta);
else restoreScrollByAnchor(currentSutraId);
});
if (!synthSupported) {
[btnReadTts, btnPauseTts, btnStopTts].forEach(function (b) { if (b) b.disabled = true; });
} else {
setTtsUiState('idle');
}
updateMenuPanelTop();
initDebugPanel();
}
function initDebugPanel() {
var btnDebug = $('btnDebug');
var debugPanel = $('debugPanel');
var debugBody = $('debugBody');
var btnDebugClose = $('btnDebugClose');
if (!btnDebug || !debugPanel || !debugBody) return;
if (!DEBUG) {
btnDebug.style.visibility = 'hidden';
btnDebug.setAttribute('aria-hidden', 'true');
btnDebug.setAttribute('tabindex', '-1');
debugPanel.hidden = true;
return;
}
btnDebug.style.visibility = '';
var visible = false;
var timer = null;
var lastFrameT = performance.now();
var fps = 0;
(function tickFps() {
var now = performance.now();
var dt = now - lastFrameT;
lastFrameT = now;
if (dt > 0) fps = Math.round(1000 / dt);
requestAnimationFrame(tickFps);
})();
function fmtBytes(n) {
if (!Number.isFinite(n)) return '-';
if (n > 1024*1024) return (n / (1024*1024)).toFixed(1) + ' MB';
if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
return n + ' B';
}
function update() {
if (!visible) return;
var allDom = document.getElementsByTagName('*').length;
var wraps = grid ? grid.querySelectorAll('.sutra-row-wrap') : [];
var sc = grid;
var sh = sc ? sc.scrollHeight : 0;
var st = sc ? sc.scrollTop : 0;
var ch = sc ? sc.clientHeight : 0;
var scrollPct = sh > ch ? Math.round(st / (sh - ch) * 100) : 0;
var mem = (performance && performance.memory) ? performance.memory : null;
var lsKey = currentSutraId ? ('scroll_anchor_key_' + currentSutraId) : '';
var lsRaw = null;
try { lsRaw = lsKey ? localStorage.getItem(lsKey) : null; } catch(e) {}
var anchorKey = currentSutraId ? anchorGet(KEY_ANCHOR_K(currentSutraId)) : null;
var allAnchors = [];
try {
for (var lsi = 0; lsi < localStorage.length; lsi++) {
var k = localStorage.key(lsi);
if (k && k.indexOf('scroll_anchor_key_') === 0) {
allAnchors.push(k.replace('scroll_anchor_key_', '') + ' → ' + localStorage.getItem(k));
}
}
} catch(e) {}
var matChunks = 0, totalChunks = virtChunks ? virtChunks.length : 0;
if (virtChunks) {
for (var vc = 0; vc < virtChunks.length; vc++) {
if (virtChunks[vc].materialized) matChunks++;
}
}
var anchorIdx = -1;
if (anchorKey && virtAllRows) {
for (var ai = 0; ai < virtAllRows.length; ai++) {
if (String(virtAllRows[ai].key || '') === anchorKey) { anchorIdx = ai; break; }
}
}
var lines = [
'--- OLD VERSION (appold.js) ---',
'Sutta: ' + (currentSutraId || '-'),
'Langs: ' + (showPali?'P':'') + (showEng?'E':'') + (showVie?'V':''),
'',
'── DOM ──',
'Total elements:   ' + allDom,
'Row wraps:        ' + wraps.length,
'',
'── Virtual scroll ──',
'Total chunks:     ' + totalChunks,
'Materialized:     ' + matChunks + ' / ' + totalChunks,
'virtAllRows len:  ' + (virtAllRows ? virtAllRows.length : 0),
'',
'── Anchor ──',
'localStorage key: ' + (lsKey || '-'),
'RAW value:        ' + (lsRaw === null ? '(null)' : '"' + lsRaw + '"'),
'via storage.get:  ' + (anchorKey === null ? '(null)' : '"' + anchorKey + '"'),
'Match raw?        ' + (lsRaw === anchorKey ? '✓ yes' : '✗ DIFFERENT!'),
'Current top key:  ' + (firstVisibleKey || '-'),
'Saved idx:        ' + (anchorIdx >= 0 ? anchorIdx : 'not-found in virtAllRows'),
'Match chunk:      ' + (anchorIdx >= 0 ? Math.floor(anchorIdx / 50) : '-'),
'',
'── ALL anchors in storage ──',
].concat(allAnchors.length ? allAnchors : ['(none)']).concat([
'',
'── Scroll ──',
'scrollTop:        ' + st + ' px',
'scrollHeight:     ' + sh + ' px',
'clientHeight:     ' + ch + ' px',
'Progress:         ' + scrollPct + '%',
'FPS:              ' + fps,
'',
'── Cache ──',
'Merged suttas:    ' + MERGED_CACHE.size,
'Loaded packs:     ' + LOADED_PACKS.size,
'',
'── TTS ──',
'Module loaded:    ' + (_ttsApi ? 'yes' : 'no'),
]);
if (mem) {
lines.push('');
lines.push('── Memory (JS heap) ──');
lines.push('used:   ' + fmtBytes(mem.usedJSHeapSize));
lines.push('total:  ' + fmtBytes(mem.totalJSHeapSize));
lines.push('limit:  ' + fmtBytes(mem.jsHeapSizeLimit));
}
debugBody.textContent = lines.join('\n');
}
function show() {
visible = true;
debugPanel.hidden = false;
debugPanel.setAttribute('aria-hidden', 'false');
update();
if (timer) clearInterval(timer);
timer = setInterval(update, 500);
}
function hide() {
visible = false;
debugPanel.hidden = true;
debugPanel.setAttribute('aria-hidden', 'true');
if (timer) { clearInterval(timer); timer = null; }
}
btnDebug.addEventListener('click', function (e) {
e.stopPropagation();
if (visible) hide(); else show();
});
if (btnDebugClose) btnDebugClose.addEventListener('click', hide);
var btnClearStorage = $('btnClearStorage');
if (btnClearStorage) btnClearStorage.addEventListener('click', function (e) {
e.stopPropagation();
var count = 0;
try { count = localStorage.length; } catch(_) {}
var msg = 'Xóa TOÀN BỘ ' + count + ' items trong localStorage?\n' +
'(anchor, settings, last sutta, cached theme…)\n\n' +
'Trang sẽ reload về trạng thái mặc định.';
if (!confirm(msg)) return;
try { localStorage.clear(); } catch(_) {}
location.replace(location.pathname + location.search);
});
}
init();
(function () {
var btn = document.getElementById('btnDarkMode');
if (!btn) return;
var STORAGE_KEY = 'sutra-dark-mode';
var html = document.documentElement;
var saved = null;
try { saved = localStorage.getItem(STORAGE_KEY); } catch(e){}
if (saved === 'dark') {
html.setAttribute('data-theme', 'dark');
btn.textContent = '☀️'; btn.title = 'Chế độ sáng';
}
if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
html.setAttribute('data-theme', 'dark');
btn.textContent = '☀️'; btn.title = 'Chế độ sáng';
try { localStorage.setItem(STORAGE_KEY, 'dark'); } catch(e){}
}
btn.addEventListener('click', function () {
var isDark = html.getAttribute('data-theme') === 'dark';
if (isDark) {
html.removeAttribute('data-theme');
btn.textContent = '🌙'; btn.title = 'Chế độ tối';
try { localStorage.setItem(STORAGE_KEY, 'light'); } catch(e){}
} else {
html.setAttribute('data-theme', 'dark');
btn.textContent = '☀️'; btn.title = 'Chế độ sáng';
try { localStorage.setItem(STORAGE_KEY, 'dark'); } catch(e){}
}
});
})();
/* ============================================================
   Touch device detection — activate html.is-touch class.
   Block CSS rules `html.is-touch .bar-pill:hover...` (lines 162-174 styles.css)
   trước đây dead code vì class không bao giờ set. Giờ kích hoạt lớp bảo vệ
   thứ 2 chống sticky :hover/:focus sau tap trên Chrome Android, iOS Safari.
   Match (hover:none) thay vì 'ontouchstart' vì laptop có touchscreen + chuột
   sẽ report (hover:hover) → giữ hover effect cho user dùng chuột chính.
   ============================================================ */
(function () {
try {
// Dùng (pointer: coarse) thay (hover: none) vì Chrome Android nhiều máy
// report (hover: hover)=true do hỗ trợ stylus → (hover: none) không match
// → is-touch class không được set → CSS protection vô dụng.
var mql = window.matchMedia('(pointer: coarse)');
var apply = function (m) {
var isTouch = !!m.matches || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
document.documentElement.classList.toggle('is-touch', isTouch);
};
apply(mql);
if (mql.addEventListener) mql.addEventListener('change', apply);
else if (mql.addListener) mql.addListener(apply);
} catch(e) {}
})();
// Fix lỗi Sticky Hover / Sticky Focus trên Mobile.
// Layer JS bổ sung cho CSS @media (hover:hover) wrapping — sau click 200ms
// programmatically blur element → browser release :focus state → hết dính.
document.addEventListener('click', function(e) {
// 1. Nhận diện thiết bị có cảm ứng (Mobile/Tablet)
var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (!isTouchDevice) return;
// 2. Bắt các phần tử có tính tương tác (Button, thẻ A, các tile...)
var clickableTarget = e.target.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], .menu-sutta-link, .nikaya-tile, .pill, .sutra-col-copy, .sutra-seg-share');
if (clickableTarget) {
// 3. Delay 200ms để hiệu ứng nhấp nháy (active) kịp diễn ra cho mượt mắt, sau đó ép gỡ focus
setTimeout(function() {
try {
clickableTarget.blur();
} catch(err) {}
}, 200);
}
}, { passive: true });
/* ============================================================
   Nuclear sticky-hover fix: trên touch device, xoá luôn mọi `:hover`
   rule khỏi stylesheet runtime. CSS @media (hover:hover) wrapping chỉ
   gate được 35/116 :hover rules — 80+ rule "naked" còn lại vẫn fire
   trên touch gây sticky. Xoá thẳng = đảm bảo 100% không còn rule
   nào response sticky :hover từ browser.

   QUAN TRỌNG: detect bằng (pointer: coarse) HOẶC touch API thay vì
   (hover: none). Lý do: Chrome Android nhiều máy report (hover: hover)
   match true (do hỗ trợ stylus/foldable) → (hover: none) không match →
   strip không chạy → bug. (pointer: coarse) đáng tin hơn cho touch device.
   :focus-visible / :focus-within giữ nguyên (cần cho keyboard nav).
   ============================================================ */
(function () {
function isTouchPrimary() {
// Detect TOUCH-CAPABLE device. User's Chrome Android có thể report (hover:hover)=true
// (do stylus support hoặc Android version mới) → KHÔNG dùng được (hover:none) làm gate.
// Dùng (pointer:coarse) — phản ánh chính xác primary input mode.
// Trade-off: hybrid device (iPad + Magic Keyboard) có thể bị strip oan, nhưng đó là
// minority case. Touch users là majority và sticky bug nghiêm trọng hơn.
return window.matchMedia('(pointer: coarse)').matches
    || (('ontouchstart' in window) && navigator.maxTouchPoints > 0);
}
function stripHoverRules() {
if (!isTouchPrimary()) return;
var REGEX = /:hover\b|:focus(?!-)/;
function walk(parentRule, rules) {
if (!rules) return;
// Skip @media (hover: hover) blocks — rules trong đó chủ ý chỉ apply cho mouse.
// Nếu user kết nối Bluetooth mouse giữa session, browser update (hover:hover) match
// → rule trong block này hoạt động bình thường. Xoá đi sẽ mất hover desktop forever.
if (parentRule && parentRule.conditionText &&
    /\(hover\s*:\s*hover\)/i.test(parentRule.conditionText)) {
return;
}
for (var i = rules.length - 1; i >= 0; i--) {
var r = rules[i];
if (r.cssRules && r.cssRules.length) walk(r, r.cssRules);
if (r.selectorText && REGEX.test(r.selectorText)) {
try { (parentRule || r.parentStyleSheet).deleteRule(i); } catch(e) {}
}
}
}
var sheets = document.styleSheets;
for (var s = 0; s < sheets.length; s++) {
try { walk(null, sheets[s].cssRules); } catch(e) { /* cross-origin */ }
}
}
// Chạy 3 lần để đảm bảo: ngay (nếu DOM đã ready), sau DOMContentLoaded,
// và sau window.load (cho trường hợp stylesheet load chậm / async).
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', stripHoverRules);
} else {
stripHoverRules();
}
window.addEventListener('load', stripHoverRules);
})();

})();
