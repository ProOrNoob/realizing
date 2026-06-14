(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;

var card        = $('card');
var titleEl      = $('title');
var subtitleEl   = $('subtitle');
var superTitleEl = $('supertitle');
var titleMetaEl  = $('titleMeta');
var readerArea   = $('readerArea');
var scrollEl     = readerArea || null;
var grid        = $('sutraGrid');
if (!scrollEl) scrollEl = grid;
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

SA.dom = {
	card: card, titleEl: titleEl, subtitleEl: subtitleEl, superTitleEl: superTitleEl,
	titleMetaEl: titleMetaEl, readerArea: readerArea, scrollEl: scrollEl, grid: grid,
	btnSutraMenu: btnSutraMenu, btnSettings: btnSettings, btnGuide: btnGuide,
	btnBackTop: btnBackTop, btnUiLang: btnUiLang,
	settingsPanel: settingsPanel, sutraMenuPanel: sutraMenuPanel,
	sutraMenuList: sutraMenuList, guideOverlay: guideOverlay,
	searchInput: searchInput, searchResultsEl: searchResultsEl,
	btnPali: btnPali, btnEng: btnEng, btnVie: btnVie, btnLayout: btnLayout,
	btnReadTts: btnReadTts, btnPauseTts: btnPauseTts, btnStopTts: btnStopTts,
	btnFullWidth: btnFullWidth
};

var LANG_STORAGE_KEY = 'sutra_ui_lang';
var uiLang = storage.get(LANG_STORAGE_KEY) === 'vi' ? 'vi' : 'en';
window.SUTRA_UI_LANG = uiLang;

SA.state = {
	currentSutraId: null,
	SUTRA_ORDER: [],
	FLAT_SUTTAS: [],
	showPali: true, showEng: true, showVie: true,
	isRendering: false,
	renderToken: 0,
	lastSingleLangMode: null,
	cachedRows: [],
	virtChunks: [],
	virtAllRows: [],
	virtMatObs: null,
	virtDemObs: null,
	keyToRowIdx: Object.create(null),
	vaggaMarkers: [],
	suttaMarkers: [],
	isAN: false,
	isSN: false,
	fallbackTitle: '',
	fallbackTitleMeta: '',
	superLastSlotEl: null,
	lastAppliedVaggaIdx: -2,
	lastAppliedSuttaIdx: -2,
	anchorObserver: null,
	firstVisibleKey: null,
	activeNikayaKey: null,
	showSegKey: true,
	showColHdr: true,
	showCmtPli: true,
	showCmtEng: true,
	showCmtVie: true,
	hlPli: true,
	hlEng: false,
	hlVie: false,
	show3Cols: false,
	paragraphBreak: true,
	PARAGRAPH_BREAK_LEN: 5,
	suppressBackTop: false,
	_progScrollUntil: 0,
	DEBUG: true,
	LANG_STORAGE_KEY: LANG_STORAGE_KEY,
	get uiLang() { return uiLang; },
	set uiLang(v) { uiLang = v; window.SUTRA_UI_LANG = v; }
};

SA.LANG_STORAGE_KEY = LANG_STORAGE_KEY;
SA.KEY_LAST     = 'lastSutraId';
SA.KEY_VIEW     = 'sutra_view_prefs';
SA.KEY_ANCHOR_K = function (id) { return 'scroll_anchor_key_' + id; };
SA.KEY_ACTIVE_NIKAYA = 'active_nikaya_tile';

var _ssOk = (function(){ try{ sessionStorage.setItem('__t','1'); sessionStorage.removeItem('__t'); return true; } catch(_){ return false; } })();

SA.anchorSet = function (key, val) {
	storage.set(key, val);
	if (_ssOk) { try { sessionStorage.setItem(key, val); } catch(_){} }
};

SA.anchorGet = function (key) {
	if (_ssOk) {
		try { var v = sessionStorage.getItem(key); if (v) return v; } catch(_){}
	}
	return storage.get(key);
};

SA.anchorRemove = function (key) {
	storage.remove(key);
	if (_ssOk) { try { sessionStorage.removeItem(key); } catch(_){} }
};

var _SEG_PREFIX_MAP = null;
SA._resolveSegPrefixToSuttaId = function (prefix) {
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
};

SA._parseAnchorHash = function () {
	var h = String(location.hash || '').replace(/^#/, '');
	if (!h) return null;
	var m = h.match(/^([A-Za-z0-9._-]+)(?::.+)?$/);
	if (!m) return null;
	var rawPrefix = m[1].toLowerCase();
	var suttaId = SA._resolveSegPrefixToSuttaId(rawPrefix);
	return { sutta: suttaId, key: h };
};

SA._writeAnchorHash = function (key) {
	if (!key) return;
	try { history.replaceState(null, '', '#' + key); } catch (e) {}
};

SA._clearAnchorHash = function () {
	try {
		if (location.hash) history.replaceState(null, '', location.pathname + location.search);
	} catch (e) {}
};

SA.getAnchorKeyFor = function (id) {
	var h = SA._parseAnchorHash();
	if (h && h.sutta === id && h.key) return h.key;
	return SA.anchorGet(SA.KEY_ANCHOR_K(id));
};

var WIDE_STORAGE_KEY = 'sutra_layout_wide';
SA.state.isWide = storage.get(WIDE_STORAGE_KEY) === '1';
SA.WIDE_STORAGE_KEY = WIDE_STORAGE_KEY;

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
	} catch (e) {}
}
function saveBookmarks() { storage.set(KEY_BOOKMARKS, JSON.stringify(Array.from(BOOKMARKS))); }

SA.loadBookmarks = loadBookmarks;
SA.isBookmarked = function (id) { return !!id && BOOKMARKS.has(id); };
SA.setBookmark = function (id, on) {
	if (!id) return false;
	if (on) BOOKMARKS.add(id); else BOOKMARKS.delete(id);
	saveBookmarks();
	return BOOKMARKS.has(id);
};
SA.toggleBookmark = function (id) { return SA.setBookmark(id, !SA.isBookmarked(id)); };
SA.bookmarkLabels = function () {
	return SA.state.uiLang === 'en'
		? { on: 'Remove bookmark', off: 'Add bookmark', empty: 'No bookmarks yet. Tap ☆ next to any sutta to save it.' }
		: { on: 'Bỏ đánh dấu', off: 'Lưu bài kinh', empty: 'Chưa có bài kinh nào được lưu. Bấm ☆ cạnh tên bài kinh để lưu.' };
};
SA.BOOKMARKS = BOOKMARKS;

SA.getSingleVisibleLang = function () {
	var s = SA.state;
	var count = (s.showPali?1:0) + (s.showEng?1:0) + (s.showVie?1:0);
	if (count !== 1) return null;
	if (s.showPali) return 'pali';
	if (s.showEng) return 'eng';
	if (s.showVie) return 'vie';
	return null;
};

function isNumberedHeadingLine(text) { return /^\d+\.\s*/.test((text||'').trim()); }
SA.isNumberedHeadingLine = isNumberedHeadingLine;

SA.mergeRowsToParagraphRows = function (rows, lang) {
	var s = SA.state;
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
		if (/:0\.1$/.test(key)) continue;
		if (isNumberedHeadingLine(t)) {
			flush();
			var rr = { key: key, pali:'', eng:'', vie:'', _merged: true, _isHeading: true };
			if (lang==='pali') rr.pali=t;
			if (lang==='eng') rr.eng=t;
			if (lang==='vie') rr.vie=t;
			if (cmtText) rr._mergedComments = [{ segKey: key, text: cmtText }];
			out.push(rr); continue;
		}
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
		if (s.paragraphBreak && bufSegCount >= s.PARAGRAPH_BREAK_LEN) flush();
	}
	flush(); return out;
};

var VIEW_CACHE = new Map();
var VIEW_CACHE_MAX = 30;

SA.buildViewData = function (rowsRaw, lang, isAN, isSN) {
	var rows = lang ? SA.mergeRowsToParagraphRows(rowsRaw, lang) : rowsRaw;
	var keyIdx = Object.create(null);
	var vagga = [];
	var sutta = [];
	var rawByKey = Object.create(null);
	for (var j = 0; j < rowsRaw.length; j++) {
		rawByKey[String(rowsRaw[j].key || '')] = rowsRaw[j];
	}
	for (var i = 0; i < rows.length; i++) {
		var k = String(rows[i].key || '');
		keyIdx[k] = i;
		if ((isAN || isSN) && /:0\.2$/.test(k)) {
			var rv = rawByKey[k] || rows[i];
			vagga.push({ rowIdx: i, titleVi: (rv.vie || '').trim(), titleEn: (rv.eng || '').trim(), titlePali: (rv.pali || '').trim() });
		}
		if (isSN && /:0\.3$/.test(k)) {
			var rs = rawByKey[k] || rows[i];
			sutta.push({ rowIdx: i, titleVi: (rs.vie || '').trim(), titleEn: (rs.eng || '').trim(), titlePali: (rs.pali || '').trim() });
		}
	}
	return { rows: rows, keyToRowIdx: keyIdx, vaggaMarkers: vagga, suttaMarkers: sutta };
};

SA.getViewData = function (id, rowsRaw, lang, isAN, isSN) {
	var cacheKey = id + '|' + (lang || 'multi');
	if (VIEW_CACHE.has(cacheKey)) {
		var cached = VIEW_CACHE.get(cacheKey);
		VIEW_CACHE.delete(cacheKey);
		VIEW_CACHE.set(cacheKey, cached);
		return cached;
	}
	var v = SA.buildViewData(rowsRaw, lang, isAN, isSN);
	VIEW_CACHE.set(cacheKey, v);
	while (VIEW_CACHE.size > VIEW_CACHE_MAX) {
		var firstKey = VIEW_CACHE.keys().next().value;
		VIEW_CACHE.delete(firstKey);
	}
	return v;
};

SA.saveViewPrefs = function () {
	var s = SA.state;
	var d = SA.dom;
	storage.set(SA.KEY_VIEW, JSON.stringify({
		showPali: s.showPali, showEng: s.showEng, showVie: s.showVie,
		stack: d.card ? d.card.classList.contains('stack') : false,
		showSegKey: s.showSegKey, showColHdr: s.showColHdr,
		showCmtPli: s.showCmtPli, showCmtEng: s.showCmtEng, showCmtVie: s.showCmtVie,
		hlPli: s.hlPli, hlEng: s.hlEng, hlVie: s.hlVie,
		show3Cols: s.show3Cols
	}));
};

SA.loadViewPrefs = function () {
	try {
		var raw = storage.get(SA.KEY_VIEW);
		if (!raw) return;
		var v = JSON.parse(raw);
		var s = SA.state;
		var d = SA.dom;
		if (typeof v.showPali === 'boolean') s.showPali = v.showPali;
		if (typeof v.showEng  === 'boolean') s.showEng  = v.showEng;
		if (typeof v.showVie  === 'boolean') s.showVie  = v.showVie;
		if (d.card && typeof v.stack === 'boolean') d.card.classList.toggle('stack', v.stack);
		if (typeof v.showSegKey === 'boolean') s.showSegKey = v.showSegKey;
		if (typeof v.showColHdr === 'boolean') s.showColHdr = v.showColHdr;
		if (typeof v.showCmtPli === 'boolean') s.showCmtPli = v.showCmtPli;
		if (typeof v.showCmtEng === 'boolean') s.showCmtEng = v.showCmtEng;
		if (typeof v.showCmtVie === 'boolean') s.showCmtVie = v.showCmtVie;
		if (typeof v.hlPli === 'boolean') s.hlPli = v.hlPli;
		if (typeof v.hlEng === 'boolean') s.hlEng = v.hlEng;
		if (typeof v.hlVie === 'boolean') s.hlVie = v.hlVie;
		if (typeof v.show3Cols === 'boolean') s.show3Cols = v.show3Cols;
	} catch(e){}
};

var DOM_MODE_CACHE = new Map();
var DOM_MODE_CACHE_MAX = (function () {
	var mem = navigator.deviceMemory;
	if (mem && mem < 2) return 2;
	if (mem && mem < 4) return 3;
	return 6;
})();

function _dmCacheKey(id, mode) { return id + '|' + (mode || 'multi'); }

function _dmSnapshotCurrent() {
	var s = SA.state;
	var d = SA.dom;
	if (!s.currentSutraId || !s.virtChunks || !s.virtChunks.length) return null;
	return {
		chunks: s.virtChunks.slice(),
		rows: s.virtAllRows,
		cachedRows: s.cachedRows.slice(),
		keyToRowIdx: s.keyToRowIdx,
		vaggaMarkers: s.vaggaMarkers,
		suttaMarkers: s.suttaMarkers,
		isAN: s.isAN, isSN: s.isSN,
		fallbackTitle: s.fallbackTitle,
		scrollTop: d.grid ? d.grid.scrollTop : 0,
		scrollKey: s.firstVisibleKey
	};
}

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

SA._dmSaveCurrent = function () {
	var s = SA.state;
	if (!s.currentSutraId) return;
	var mode = s.lastSingleLangMode || 'multi';
	var snap = _dmSnapshotCurrent();
	if (!snap) return;
	var k = _dmCacheKey(s.currentSutraId, mode);
	DOM_MODE_CACHE.delete(k); DOM_MODE_CACHE.set(k, snap);
	while (DOM_MODE_CACHE.size > DOM_MODE_CACHE_MAX) {
		var oldestKey = DOM_MODE_CACHE.keys().next().value;
		var evicted = DOM_MODE_CACHE.get(oldestKey);
		_dmReleaseSnap(evicted);
		DOM_MODE_CACHE.delete(oldestKey);
	}
};

SA._dmInvalidateForSutta = function (id) {
	if (!id) return;
	var keys = [];
	DOM_MODE_CACHE.forEach(function (_v, k) { if (k.indexOf(id + '|') === 0) keys.push(k); });
	keys.forEach(function (k) { _dmReleaseSnap(DOM_MODE_CACHE.get(k)); DOM_MODE_CACHE.delete(k); });
};

SA._dmTryRestore = function (targetMode) {
	var s = SA.state;
	var d = SA.dom;
	if (!s.currentSutraId || !d.grid) return false;
	var k = _dmCacheKey(s.currentSutraId, targetMode);
	var snap = DOM_MODE_CACHE.get(k);
	if (!snap) return false;
	SA._dmSaveCurrent();
	DOM_MODE_CACHE.delete(k); DOM_MODE_CACHE.set(k, snap);
	if (s.anchorObserver) { s.anchorObserver.disconnect(); s.anchorObserver = null; }
	SA.teardownChunkObservers();
	while (d.grid.firstChild) d.grid.removeChild(d.grid.firstChild);
	s.virtChunks = snap.chunks;
	s.virtAllRows = snap.rows;
	s.cachedRows = snap.cachedRows;
	s.keyToRowIdx = snap.keyToRowIdx;
	s.vaggaMarkers = snap.vaggaMarkers;
	s.suttaMarkers = snap.suttaMarkers;
	s.isAN = snap.isAN; s.isSN = snap.isSN;
	s.fallbackTitle = snap.fallbackTitle;
	s.lastAppliedVaggaIdx = -2; s.lastAppliedSuttaIdx = -2;
	var frag = document.createDocumentFragment();
	for (var i = 0; i < snap.chunks.length; i++) frag.appendChild(snap.chunks[i].div);
	d.grid.appendChild(frag);
	SA.applyVisibility();
	SA.setupChunkObservers();
	SA.setupAnchorObserver();
	if (typeof snap.scrollTop === 'number') d.grid.scrollTop = snap.scrollTop;
	s.firstVisibleKey = snap.scrollKey || null;
	s.lastSingleLangMode = targetMode;
	return true;
};

var _modeRerenderTimer = null;
SA.maybeRerenderIfModeChanged = function () {
	var s = SA.state;
	var mode = SA.getSingleVisibleLang();
	if (mode === s.lastSingleLangMode) return;
	clearTimeout(_modeRerenderTimer);
	_modeRerenderTimer = setTimeout(function () {
		_modeRerenderTimer = null;
		var modeNow = SA.getSingleVisibleLang();
		if (modeNow === s.lastSingleLangMode) return;
		if (SA._dmTryRestore(modeNow)) return;
		if (s.currentSutraId) SA.renderSutra(s.currentSutraId);
	}, 180);
};
})();
