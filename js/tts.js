/* ================================================================
   tts.js — Module [8/8] — Entry point
   Chứa init(): khởi tạo toàn bộ app, wire event listeners.
   TTS (lazy-load module tts.js ở root), print PDF, nav buttons
   (prev/next), dark mode toggle, touch device detection,
   nuclear sticky-hover fix cho mobile.
   ─────────────────────────────────────────────────────────────────
   Exports: SA.openSutra, SA.resetTts, SA.setTtsUiState,
            SA.updateNavButtons, SA.scheduleNextPreload
   Depends: tất cả các module trước (utils → menu)
   ─────────────────────────────────────────────────────────────────
   init() flow:
     initUiLang → loadViewPrefs → sync button states →
     loadBookmarks → applyVisibility → buildSutraMenuFromIndex →
     initDelegations → openSutra(lastId) hoặc renderWelcomeScreen
   ================================================================ */
(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;
var s = SA.state;
var d = SA.dom;

function scheduleNextPreload(currentId) {
	try {
		var idx = s.SUTRA_ORDER.indexOf(currentId); if (idx === -1) return;
		var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		if (conn && conn.saveData) return;
		if (navigator.deviceMemory && navigator.deviceMemory < 2) return;
		var nextId = s.SUTRA_ORDER[idx + 1];
		var prevId = idx > 0 ? s.SUTRA_ORDER[idx - 1] : null;
		var doPreload = function () {
			if (nextId) SA.loadMerged(nextId).catch(function () {});
			if (prevId) SA.loadMerged(prevId).catch(function () {});
		};
		if (!nextId && !prevId) return;
		if ('requestIdleCallback' in window) requestIdleCallback(doPreload, { timeout: 2000 });
		else setTimeout(doPreload, 800);
	} catch(e){}
}
SA.scheduleNextPreload = scheduleNextPreload;

function openSutra(id) {
	if (id) id = SA._resolveSegPrefixToSuttaId(id);
	document.documentElement.classList.remove('is-welcome');
	SA.renderSutra(id);
}
SA.openSutra = openSutra;

(function wireBookmarkCurrent() {
	var btn = $('btnBookmarkCurrent');
	if (!btn) return;
	btn.addEventListener('click', function (e) {
		e.stopPropagation();
		if (!s.currentSutraId) return;
		var now = SA.toggleBookmark(s.currentSutraId);
		SA.reflectBookmarkState(s.currentSutraId, now);
		if (s.activeNikayaKey === 'BM') SA.renderBookmarksList();
	});
})();

function printCurrentSuttaPdf() {
	if (!s.currentSutraId) return;
	var id = s.currentSutraId;
	var merged = SA.MERGED_CACHE.get(id);
	var ensure = merged ? Promise.resolve(merged) : SA.loadMerged(id);
	Promise.resolve(ensure).then(function (m) {
		if (!m || !m.rows || !m.rows.length) return;
		var html = SA.buildSuttaPrintHtml(id, m);
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
	if (!s.currentSutraId) return;
	SA.togglePanel(d.settingsPanel, false);
	printCurrentSuttaPdf();
};

var btnPrev = $('btnPrev');
var btnNext = $('btnNext');

function updateNavButtons() {
	var idx = s.SUTRA_ORDER.indexOf(s.currentSutraId);
	var navTitle = $('navTitle');
	if (!s.currentSutraId || !Array.isArray(s.SUTRA_ORDER) || !s.SUTRA_ORDER.length || idx === -1) {
		if (btnPrev)  btnPrev.disabled  = true;
		if (btnNext)  btnNext.disabled  = true;
		if (navTitle) navTitle.textContent = '—';
		return;
	}
	if (btnPrev) btnPrev.disabled = !(idx > 0);
	if (btnNext) btnNext.disabled = !(idx < s.SUTRA_ORDER.length - 1);
	if (navTitle) {
		var meta  = SA.findMetaById(s.currentSutraId);
		var shortCode = SA.extractGroupKey(meta && meta.code);
		var title = s.uiLang === 'en'
			? (meta && meta.titleEn) || (meta && meta.titleVi) || (meta && meta.titlePali) || s.currentSutraId
			: (meta && meta.titleVi) || (meta && meta.titleEn) || (meta && meta.titlePali) || s.currentSutraId;
		navTitle.textContent = shortCode ? (shortCode + ' · ' + title) : title;
		navTitle.style.cursor = 'pointer';
		navTitle.setAttribute('role', 'button');
		navTitle.setAttribute('title', (meta && meta.code ? meta.code + ' · ' : '') + title);
	}
}
SA.updateNavButtons = updateNavButtons;

var navTitleEl = $('navTitle');
if (navTitleEl) {
	navTitleEl.setAttribute('tabindex', '0');
	navTitleEl.addEventListener('click', function (e) {
		e.stopPropagation();
		if (s.currentSutraId) SA.revealCurrentSuttaInMenu();
	});
	navTitleEl.addEventListener('keydown', function (e) {
		if ((e.key === 'Enter' || e.key === ' ') && s.currentSutraId) {
			e.preventDefault();
			SA.revealCurrentSuttaInMenu();
		}
	});
}

function _blurIfMouse(btn) {
	try { if (!btn.matches(':focus-visible')) btn.blur(); } catch(_){}
}

if (btnPrev) btnPrev.onclick = function () {
	var idx = s.SUTRA_ORDER.indexOf(s.currentSutraId);
	if (idx > 0) openSutra(s.SUTRA_ORDER[idx - 1]);
	_blurIfMouse(btnPrev);
};
if (btnNext) btnNext.onclick = function () {
	var idx = s.SUTRA_ORDER.indexOf(s.currentSutraId);
	if (idx !== -1 && idx < s.SUTRA_ORDER.length - 1) openSutra(s.SUTRA_ORDER[idx + 1]);
	_blurIfMouse(btnNext);
};

var synthSupported = 'speechSynthesis' in window;

function setTtsUiState(state) {
	var btnReadTts  = d.btnReadTts;
	var btnPauseTts = d.btnPauseTts;
	var btnStopTts  = d.btnStopTts;
	if (!btnReadTts || !btnPauseTts || !btnStopTts) return;
	if (!synthSupported || s.isRendering) {
		btnReadTts.disabled = btnPauseTts.disabled = btnStopTts.disabled = true; return;
	}
	if (state === 'idle')    { btnReadTts.disabled=false; btnPauseTts.disabled=true;  btnStopTts.disabled=true; }
	if (state === 'playing') { btnReadTts.disabled=true;  btnPauseTts.disabled=false; btnStopTts.disabled=false; }
	if (state === 'paused')  { btnReadTts.disabled=false; btnPauseTts.disabled=true;  btnStopTts.disabled=false; }
}
SA.setTtsUiState = setTtsUiState;

function clearRowHighlight() {
	if (!d.grid) return;
	var reading = d.grid.querySelectorAll('.sutra-row.reading');
	for (var k = 0; k < reading.length; k++) reading[k].classList.remove('reading');
}

function highlightRowAt(index) {
	clearRowHighlight();
	if (index < 0 || index >= s.virtAllRows.length) return;
	SA.ensureRowRendered(index);
	var row = s.cachedRows[index];
	if (!row) return;
	row.classList.add('reading');
	if (!d.scrollEl) return;
	var rootRect = d.scrollEl.getBoundingClientRect();
	var rowRect  = row.getBoundingClientRect();
	var relativeTop = rowRect.top - rootRect.top + d.scrollEl.scrollTop;
	var viewTop = d.scrollEl.scrollTop, viewBottom = viewTop + d.scrollEl.clientHeight;
	if (relativeTop < viewTop || relativeTop + rowRect.height > viewBottom) {
		d.scrollEl.scrollTo({ top: Math.max(0, relativeTop - 20), behavior: 'auto' });
	}
}

var _ttsModulePromise = null;
var _ttsApi = null;

function loadScript(src) {
	return new Promise(function (resolve, reject) {
		var sc = document.createElement('script');
		sc.src = src; sc.async = true;
		sc.onload = function () { resolve(); };
		sc.onerror = function (e) { reject(e); };
		document.head.appendChild(sc);
	});
}

function ensureTTSLoaded() {
	if (_ttsApi) return Promise.resolve(_ttsApi);
	if (!_ttsModulePromise) {
		_ttsModulePromise = loadScript('tts.js').then(function () {
			if (!window.TTSModule) throw new Error('TTSModule failed to load');
			_ttsApi = window.TTSModule.init({
				getVirtAllRows: function () { return s.virtAllRows; },
				getCurrentSutraId: function () { return s.currentSutraId; },
				getUiLang: function () { return s.uiLang; },
				getIsRendering: function () { return s.isRendering; },
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
	if (clearStorage && s.currentSutraId) storage.remove('tts_state_' + s.currentSutraId);
	setTtsUiState('idle');
}
SA.resetTts = resetTts;

if (d.btnReadTts) d.btnReadTts.onclick = async function () {
	try { var api = await ensureTTSLoaded(); api.start(); } catch (e) { console.error('TTS load failed:', e); }
};
if (d.btnPauseTts) d.btnPauseTts.onclick = function () { if (_ttsApi) _ttsApi.pause(); };
if (d.btnStopTts)  d.btnStopTts.onclick  = function () { if (_ttsApi) _ttsApi.stop(); };

function initUiLang() {
	SA.renderUiLangFlag(); SA.applyUiLanguageToSearchUi(); SA.applyUiLanguageToSettingsPanel(); SA.renderGuideDialog();
	var btnUiLang = d.btnUiLang;
	if (!btnUiLang) return;
	btnUiLang.addEventListener('click', function (e) {
		e.stopPropagation();
		s.uiLang = s.uiLang === 'vi' ? 'en' : 'vi';
		storage.set(s.LANG_STORAGE_KEY, s.uiLang); window.SUTRA_UI_LANG = s.uiLang;
		SA.renderUiLangFlag(); SA.applyUiLanguageToSearchUi(); SA.applyUiLanguageToSettingsPanel(); SA.renderGuideDialog();
		SA.buildSutraMenuFromIndex(); SA.highlightActiveInMenu(); updateNavButtons();
		SA.updateBookmarksCount(); SA.applyTitleBookmarkState();
		if (s.currentSutraId) SA.renderSutra(s.currentSutraId); else SA.renderWelcomeScreen();
	});
}

function init() {
	if (!d.grid || !d.titleEl || !d.subtitleEl || !d.card) console.warn('Sutta app: core DOM missing.');
	initUiLang(); SA.loadViewPrefs();
	if (d.btnPali) { d.btnPali.classList.toggle('active', s.showPali); d.btnPali.setAttribute('aria-pressed', String(s.showPali)); }
	if (d.btnEng)  { d.btnEng.classList.toggle('active',  s.showEng);  d.btnEng.setAttribute('aria-pressed',  String(s.showEng)); }
	if (d.btnVie)  { d.btnVie.classList.toggle('active',  s.showVie);  d.btnVie.setAttribute('aria-pressed',  String(s.showVie)); }
	if (d.btnLayout) { d.btnLayout.classList.toggle('active', d.card ? d.card.classList.contains('stack') : false); }
	var _bsk = $('btnSegKey'); if (_bsk) { _bsk.classList.toggle('active', s.showSegKey); _bsk.setAttribute('aria-pressed', String(s.showSegKey)); }
	var _bsh = $('btnSegHdr'); if (_bsh) { _bsh.classList.toggle('active', s.showColHdr); _bsh.setAttribute('aria-pressed', String(s.showColHdr)); }
	SA.syncCmtButtons();
	var _bhp = $('btnHlPli'); if (_bhp) { _bhp.classList.toggle('active', s.hlPli); _bhp.setAttribute('aria-pressed', String(s.hlPli)); }
	var _bhe = $('btnHlEng'); if (_bhe) { _bhe.classList.toggle('active', s.hlEng); _bhe.setAttribute('aria-pressed', String(s.hlEng)); }
	var _bhv = $('btnHlVie'); if (_bhv) { _bhv.classList.toggle('active', s.hlVie); _bhv.setAttribute('aria-pressed', String(s.hlVie)); }
	var _b3c = $('btn3Cols'); if (_b3c) { _b3c.classList.toggle('active', s.show3Cols); _b3c.setAttribute('aria-pressed', String(s.show3Cols)); }
	SA.loadBookmarks();
	SA.applyVisibility(); SA.applySegKeyHdrVis(); SA.loadZoom(); SA.loadLineHeight(); SA.buildSutraMenuFromIndex(); SA.initDelegations();
	SA.updateBookmarksCount();
	var startId = storage.get(SA.KEY_LAST);
	var _bootHash = SA._parseAnchorHash();
	if (_bootHash && _bootHash.sutta) startId = _bootHash.sutta;
	if (startId) openSutra(startId); else SA.renderWelcomeScreen();
	window.addEventListener('hashchange', function () {
		var h = SA._parseAnchorHash();
		if (!h) return;
		if (h.sutta !== s.currentSutraId) openSutra(h.sutta);
		else SA.restoreScrollByAnchor(s.currentSutraId);
	});
	if (!synthSupported) {
		[d.btnReadTts, d.btnPauseTts, d.btnStopTts].forEach(function (b) { if (b) b.disabled = true; });
	} else {
		setTtsUiState('idle');
	}
	SA.updateMenuPanelTop();
	initDebugPanel();
}

function initDebugPanel() {
	var btnDebug = $('btnDebug');
	var debugPanel = $('debugPanel');
	var debugBody = $('debugBody');
	var btnDebugClose = $('btnDebugClose');
	if (!btnDebug || !debugPanel || !debugBody) return;
	if (!s.DEBUG) {
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
		var wraps = d.grid ? d.grid.querySelectorAll('.sutra-row-wrap') : [];
		var sc = d.grid;
		var sh = sc ? sc.scrollHeight : 0;
		var st = sc ? sc.scrollTop : 0;
		var ch = sc ? sc.clientHeight : 0;
		var scrollPct = sh > ch ? Math.round(st / (sh - ch) * 100) : 0;
		var mem = (performance && performance.memory) ? performance.memory : null;
		var lsKey = s.currentSutraId ? ('scroll_anchor_key_' + s.currentSutraId) : '';
		var lsRaw = null;
		try { lsRaw = lsKey ? localStorage.getItem(lsKey) : null; } catch(e) {}
		var anchorKey = s.currentSutraId ? SA.anchorGet(SA.KEY_ANCHOR_K(s.currentSutraId)) : null;
		var allAnchors = [];
		try {
			for (var lsi = 0; lsi < localStorage.length; lsi++) {
				var k = localStorage.key(lsi);
				if (k && k.indexOf('scroll_anchor_key_') === 0) {
					allAnchors.push(k.replace('scroll_anchor_key_', '') + ' → ' + localStorage.getItem(k));
				}
			}
		} catch(e) {}
		var matChunks = 0, totalChunks = s.virtChunks ? s.virtChunks.length : 0;
		if (s.virtChunks) {
			for (var vc = 0; vc < s.virtChunks.length; vc++) {
				if (s.virtChunks[vc].materialized) matChunks++;
			}
		}
		var anchorIdx = -1;
		if (anchorKey && s.virtAllRows) {
			for (var ai = 0; ai < s.virtAllRows.length; ai++) {
				if (String(s.virtAllRows[ai].key || '') === anchorKey) { anchorIdx = ai; break; }
			}
		}
		var lines = [
			'--- MODULAR VERSION ---',
			'Sutta: ' + (s.currentSutraId || '-'),
			'Langs: ' + (s.showPali?'P':'') + (s.showEng?'E':'') + (s.showVie?'V':''),
			'',
			'── DOM ──',
			'Total elements:   ' + allDom,
			'Row wraps:        ' + wraps.length,
			'',
			'── Virtual scroll ──',
			'Total chunks:     ' + totalChunks,
			'Materialized:     ' + matChunks + ' / ' + totalChunks,
			'virtAllRows len:  ' + (s.virtAllRows ? s.virtAllRows.length : 0),
			'',
			'── Anchor ──',
			'localStorage key: ' + (lsKey || '-'),
			'RAW value:        ' + (lsRaw === null ? '(null)' : '"' + lsRaw + '"'),
			'via storage.get:  ' + (anchorKey === null ? '(null)' : '"' + anchorKey + '"'),
			'Match raw?        ' + (lsRaw === anchorKey ? '✓ yes' : '✗ DIFFERENT!'),
			'Current top key:  ' + (s.firstVisibleKey || '-'),
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
			'Merged suttas:    ' + SA.MERGED_CACHE.size,
			'Loaded packs:     ' + SA.LOADED_PACKS.size,
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

// Dark mode toggle
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

// Touch device detection
(function () {
	try {
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

// Sticky hover/focus fix for mobile
document.addEventListener('click', function(e) {
	var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
	if (!isTouchDevice) return;
	var clickableTarget = e.target.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], .menu-sutta-link, .nikaya-tile, .pill, .sutra-col-copy, .sutra-seg-share');
	if (clickableTarget) {
		setTimeout(function() {
			try { clickableTarget.blur(); } catch(err) {}
		}, 200);
	}
}, { passive: true });

// Nuclear sticky-hover fix: strip :hover rules on touch devices
(function () {
	function isTouchPrimary() {
		return window.matchMedia('(pointer: coarse)').matches
			|| (('ontouchstart' in window) && navigator.maxTouchPoints > 0);
	}
	function stripHoverRules() {
		if (!isTouchPrimary()) return;
		var REGEX = /:hover\b|:focus(?!-)/;
		function walk(parentRule, rules) {
			if (!rules) return;
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
		for (var si = 0; si < sheets.length; si++) {
			try { walk(null, sheets[si].cssRules); } catch(e) {}
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', stripHoverRules);
	} else {
		stripHoverRules();
	}
	window.addEventListener('load', stripHoverRules);
})();

})();
