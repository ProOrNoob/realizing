(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;
var throttle = SA.throttle;
var debounce = SA.debounce;
var safeCssEscape = SA.safeCssEscape;
var s = SA.state;
var d = SA.dom;

function getScrollRoot() { return d.readerArea || d.grid; }
SA.getScrollRoot = getScrollRoot;

function findActiveMarkerIdx(markers, curIdx) {
	var idx = -1;
	for (var v = 0; v < markers.length; v++) {
		if (markers[v].rowIdx <= curIdx) idx = v;
		else break;
	}
	return idx;
}
function pickPrimaryByLang(marker) {
	return s.uiLang === 'en'
		? (marker.titleEn || marker.titlePali || marker.titleVi || '').trim()
		: (marker.titleVi || marker.titleEn || marker.titlePali || '').trim();
}
function pickAltByLang(marker) {
	return s.uiLang === 'en'
		? (marker.titleVi || marker.titlePali || '').trim()
		: (marker.titleEn || marker.titlePali || '').trim();
}

function updateDynamicTitles() {
	if (!s.isAN && !s.isSN) return;
	var curIdx = s.firstVisibleKey ? (s.keyToRowIdx[s.firstVisibleKey]) : undefined;
	if (curIdx === undefined) curIdx = -1;
	if (s.isAN) {
		var anIdx = findActiveMarkerIdx(s.vaggaMarkers, curIdx);
		if (anIdx !== s.lastAppliedSuttaIdx) {
			if (anIdx < 0) {
				if (d.titleEl) d.titleEl.textContent = s.fallbackTitle;
				if (d.titleMetaEl) d.titleMetaEl.textContent = s.fallbackTitleMeta;
			} else {
				var vmA = s.vaggaMarkers[anIdx];
				if (d.titleEl) d.titleEl.textContent = pickPrimaryByLang(vmA) || s.fallbackTitle;
				if (d.titleMetaEl) d.titleMetaEl.textContent = pickAltByLang(vmA) || s.fallbackTitleMeta;
			}
			s.lastAppliedSuttaIdx = anIdx;
		}
		return;
	}
	var vIdx = findActiveMarkerIdx(s.vaggaMarkers, curIdx);
	if (vIdx !== s.lastAppliedVaggaIdx && s.superLastSlotEl) {
		var vaggaText = vIdx < 0 ? '' : (pickPrimaryByLang(s.vaggaMarkers[vIdx]) || '');
		s.superLastSlotEl.textContent = vaggaText;
		if (s.superLastSlotEl._sep) s.superLastSlotEl._sep.style.display = vaggaText ? '' : 'none';
		s.lastAppliedVaggaIdx = vIdx;
	}
	var sIdx = findActiveMarkerIdx(s.suttaMarkers, curIdx);
	if (sIdx !== s.lastAppliedSuttaIdx) {
		if (sIdx < 0) {
			if (d.titleEl) d.titleEl.textContent = s.fallbackTitle;
			if (d.titleMetaEl) d.titleMetaEl.textContent = s.fallbackTitleMeta;
		} else {
			var sm = s.suttaMarkers[sIdx];
			if (d.titleEl) d.titleEl.textContent = pickPrimaryByLang(sm) || s.fallbackTitle;
			if (d.titleMetaEl) d.titleMetaEl.textContent = pickAltByLang(sm) || s.fallbackTitleMeta;
		}
		s.lastAppliedSuttaIdx = sIdx;
	}
}

function setupAnchorObserver() {
	if (s.anchorObserver) { s.anchorObserver.disconnect(); s.anchorObserver = null; }
	var scrollRoot = getScrollRoot();
	if (!scrollRoot) return;
	var _ioRescan = throttle(function () {
		var k = computeTopVisibleKey();
		if (k) s.firstVisibleKey = k;
		updateDynamicTitles();
	}, 80);
	s.anchorObserver = new IntersectionObserver(_ioRescan, { root: scrollRoot, rootMargin: '0px 0px -80% 0px', threshold: 0 });
	scrollRoot.querySelectorAll('.sutra-row').forEach(function (r) { s.anchorObserver.observe(r); });
}
SA.setupAnchorObserver = setupAnchorObserver;

function computeTopVisibleKey() {
	var scrollRoot = getScrollRoot();
	if (!scrollRoot) return null;
	var rootRect = scrollRoot.getBoundingClientRect();
	var topBoundary = rootRect.top;
	var rows = scrollRoot.querySelectorAll('.sutra-row[data-key]');
	for (var i = 0; i < rows.length; i++) {
		var rect = rows[i].getBoundingClientRect();
		if (rect.top >= topBoundary) return rows[i].getAttribute('data-key') || null;
	}
	for (var j = 0; j < rows.length; j++) {
		var rect2 = rows[j].getBoundingClientRect();
		if (rect2.bottom > topBoundary) return rows[j].getAttribute('data-key') || null;
	}
	return null;
}
SA.computeTopVisibleKey = computeTopVisibleKey;

var _retrySaveTimer = 0;
function _scheduleRetrySave(after) {
	if (_retrySaveTimer) clearTimeout(_retrySaveTimer);
	_retrySaveTimer = setTimeout(function () {
		_retrySaveTimer = 0;
		saveScrollAnchorNow();
	}, Math.max(50, after));
}

function saveScrollAnchorNow() {
	if (!s.currentSutraId) return;
	var now = Date.now();
	if (now < s._progScrollUntil) {
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — programmatic scroll window, retry in', s._progScrollUntil - now);
		_scheduleRetrySave(s._progScrollUntil - now + 50);
		return;
	}
	if (s.isRendering) {
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — isRendering=true, retry in 150');
		_scheduleRetrySave(150);
		return;
	}
	var scrollRoot = getScrollRoot();
	if (!scrollRoot || scrollRoot.scrollTop === 0) {
		SA.anchorRemove(SA.KEY_ANCHOR_K(s.currentSutraId));
		SA._clearAnchorHash();
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] cleared (scrollTop=0) for', s.currentSutraId);
		return;
	}
	var topKey = s.firstVisibleKey || computeTopVisibleKey();
	if (!topKey) {
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE] skip — no top key computable');
		return;
	}
	s.firstVisibleKey = topKey;
	SA.anchorSet(SA.KEY_ANCHOR_K(s.currentSutraId), topKey);
	SA._writeAnchorHash(topKey);
	if (window.DEBUG_ANCHOR) console.log('[ANCHOR SAVE]', s.currentSutraId, '→', topKey, 'scrollTop=' + scrollRoot.scrollTop);
}

// BUG FIX: anchor restore with instant scroll, correct key for scope fallback, extended suppression
function restoreScrollByAnchor(id) {
	var scrollRoot = getScrollRoot();
	if (!scrollRoot) return false;
	try {
		var key = SA.getAnchorKeyFor(id);
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] id=' + id + ' key=' + key);
		if (!key) return false;
		var foundIdx = -1;
		var foundKey = key;
		for (var j = 0; j < s.virtAllRows.length; j++) {
			if (String(s.virtAllRows[j].key || '') === key) { foundIdx = j; break; }
		}
		if (foundIdx < 0) {
			var savedScopeMatch = String(key).match(/^(.+):(\d+)/);
			if (savedScopeMatch) {
				var savedScope = savedScopeMatch[1] + ':' + savedScopeMatch[2];
				for (var sk = 0; sk < s.virtAllRows.length; sk++) {
					var curKey = String(s.virtAllRows[sk].key || '');
					var m = curKey.match(/^(.+):(\d+)/);
					if (m && (m[1] + ':' + m[2]) === savedScope) {
						foundIdx = sk;
						foundKey = curKey; // FIX: use the actual found key, not original
						if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] fallback matched scope "' + savedScope + '" at idx=' + sk + ' key=' + curKey);
						break;
					}
				}
			}
		}
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] foundIdx=' + foundIdx + ' in virtAllRows.length=' + s.virtAllRows.length);
		if (foundIdx < 0) return false;
		SA.ensureRowRendered(foundIdx);
		// FIX: use foundKey (actual row's key) for DOM query, not original key
		var safeKey = safeCssEscape(foundKey);
		var row = scrollRoot.querySelector('.sutra-row[data-key="' + safeKey + '"]');
		if (window.DEBUG_ANCHOR) console.log('[ANCHOR RESTORE] DOM row found:', !!row);
		if (!row) return false;
		var scrollTarget = row.closest('.sutra-row-wrap') || row;
		// FIX: extend suppression window from 700ms to 1200ms
		s._progScrollUntil = Date.now() + 1200;
		function scrollToSegmentTop(label) {
			var rootRect = scrollRoot.getBoundingClientRect();
			var tgtRect  = scrollTarget.getBoundingClientRect();
			var y = tgtRect.top - rootRect.top + scrollRoot.scrollTop;
			var max = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
			y = Math.max(0, Math.min(y, max));
			var oldTop = scrollRoot.scrollTop;
			// FIX: use instant scroll instead of assignment (which triggers smooth animation)
			if (Math.abs(y - oldTop) > 1) {
				scrollRoot.scrollTo({ top: y, behavior: 'instant' });
			}
			if (window.DEBUG_ANCHOR) {
				console.log('[ANCHOR RESTORE ' + label + '] tgt.top=' + tgtRect.top.toFixed(0) +
					' root.top=' + rootRect.top.toFixed(0) +
					' relTop=' + (tgtRect.top - rootRect.top).toFixed(0) +
					' targetY=' + y.toFixed(0) + ' oldScrollTop=' + oldTop + ' → newScrollTop=' + scrollRoot.scrollTop);
			}
		}
		scrollToSegmentTop('initial');
		SA.toggleBackTop(scrollRoot.scrollTop > 0);
		requestAnimationFrame(function () { requestAnimationFrame(function () {
			scrollToSegmentTop('rAF-correction');
			setTimeout(function () { scrollToSegmentTop('timeout-correction'); }, 100);
			setTimeout(function () { scrollToSegmentTop('settle-correction'); }, 500);
		}); });
		return true;
	} catch(e) {
		if (window.DEBUG_ANCHOR) console.error('[ANCHOR RESTORE] error:', e);
		return false;
	}
}
SA.restoreScrollByAnchor = restoreScrollByAnchor;

window.addEventListener('pagehide', function (e) {
	s.firstVisibleKey = null;
	saveScrollAnchorNow();
	if (!e.persisted) {
		if (s.anchorObserver) { s.anchorObserver.disconnect(); s.anchorObserver = null; }
		SA.teardownChunkObservers();
	}
});
window.addEventListener('pageshow', function (e) {
	if (!e.persisted || !s.currentSutraId) return;
	if (!s.anchorObserver) setupAnchorObserver();
	try { SA.setupChunkObservers(); } catch(_) {}
});
document.addEventListener('visibilitychange', function () {
	if (document.visibilityState === 'hidden') {
		s.firstVisibleKey = null;
		var prevProg = s._progScrollUntil;
		s._progScrollUntil = 0;
		try { saveScrollAnchorNow(); } finally { s._progScrollUntil = prevProg; }
	}
});

var _backTopPendingState = null;
var _backTopRAF = 0;
function toggleBackTop(show) {
	if (!d.btnBackTop) return;
	_backTopPendingState = !!show;
	if (_backTopRAF) return;
	_backTopRAF = requestAnimationFrame(function () {
		_backTopRAF = 0;
		var sv = _backTopPendingState;
		_backTopPendingState = null;
		if (sv === null) return;
		d.btnBackTop.classList.toggle('visible', sv);
		if (sv) {
			d.btnBackTop.style.removeProperty('display');
		} else {
			d.btnBackTop.style.setProperty('display', 'none', 'important');
			try { d.btnBackTop.blur(); } catch(_) {}
		}
	});
}
SA.toggleBackTop = toggleBackTop;

var _saveAnchorThrottled = throttle(saveScrollAnchorNow, 250);
var _saveAnchorDebounced = debounce(saveScrollAnchorNow, 200);
SA._saveAnchorDebounced = _saveAnchorDebounced;
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
		Array.prototype.forEach.call(existing, function (dt) { dt.remove(); });
		for (var i = 0; i < 5; i++) {
			var dt = document.createElement('span');
			dt.className = 'rp-dot';
			dt.dataset.idx = String(i);
			wrap.appendChild(dt);
		}
	}
	return { bar: bar, dots: wrap.querySelectorAll('.rp-dot') };
}

function updateReadingProgress() {
	var wrap = document.getElementById('readingProgress');
	var pctEl = document.getElementById('readingProgressPct');
	if (!wrap || !d.scrollEl) return;
	var max = d.scrollEl.scrollHeight - d.scrollEl.clientHeight;
	if (max <= 10 || !s.currentSutraId) { wrap.classList.remove('visible'); return; }
	var gridRect = d.scrollEl.getBoundingClientRect();
	wrap.style.top = gridRect.top + 'px';
	wrap.style.bottom = Math.max(0, window.innerHeight - gridRect.bottom) + 'px';
	var pct = Math.min(1, Math.max(0, d.scrollEl.scrollTop / max));
	var wrapH = gridRect.height;
	var BAR_HEIGHT = 48, DOT_SIZE = 4;
	var DOT_SPACING_INIT = (BAR_HEIGHT - DOT_SIZE) / 4;
	var leadStart = 8 + (BAR_HEIGHT - DOT_SIZE);
	var range = Math.max(0, wrapH - 16 - leadStart);
	var leadY = leadStart + pct * range;
	var els = _ensureProgressElements(wrap);
	var bar = els.bar, dots = els.dots;
	var BAR_FULL_END = 0.05, BAR_FADE_END = 0.08;
	var BALL_START_PCT = 0.025, BALL_FULL_AT = 0.04, BALL_PHASE_TRIGGER = 0.05;
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
		if (!fw) { op = dotAppearOp; }
		else if (pct < fw[0]) { op = dotAppearOp; }
		else if (pct >= fw[1]) { op = 0; }
		else { op = dotAppearOp * (1 - (pct - fw[0]) / (fw[1] - fw[0])); }
		dot.style.opacity = Math.max(0, Math.min(1, op)).toFixed(2);
	}
	if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
	wrap.classList.add('visible');
	wrap.classList.remove('idle');
	clearTimeout(_progressIdleTimer);
	_progressIdleTimer = setTimeout(function () { wrap.classList.add('idle'); }, 1500);
}
SA.updateReadingProgress = updateReadingProgress;

var _readingProgressThrottled = throttle(updateReadingProgress, 80);
if (d.scrollEl) d.scrollEl.addEventListener('scroll', function () {
	if (!s.suppressBackTop) _backTopThrottled(d.scrollEl.scrollTop > 0);
	_saveAnchorThrottled();
	_saveAnchorDebounced();
	_readingProgressThrottled();
}, { passive: true });
window.addEventListener('resize', updateReadingProgress);

if (d.btnBackTop && d.scrollEl) d.btnBackTop.onclick = function () {
	s.suppressBackTop = true;
	toggleBackTop(false);
	s._progScrollUntil = Date.now() + 2000;
	d.scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
	var doneCalled = false;
	var done = function () {
		if (doneCalled) return;
		doneCalled = true;
		s.suppressBackTop = false;
		s._progScrollUntil = 0;
		toggleBackTop(false);
		if (s.currentSutraId) SA.anchorRemove(SA.KEY_ANCHOR_K(s.currentSutraId));
	};
	setTimeout(done, 2000);
	if ('onscrollend' in d.scrollEl) {
		d.scrollEl.addEventListener('scrollend', done, { once: true });
	} else {
		var prev = -1;
		var poll = function () {
			if (doneCalled) return;
			var st = d.scrollEl.scrollTop;
			if (st === 0 && st === prev) { done(); return; }
			prev = st;
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	}
};
})();
