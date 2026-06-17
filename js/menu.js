/* ================================================================
   menu.js — Module [7/8]
   Menu thư viện (TOC tree), tìm kiếm bài kinh, bookmark UI,
   share/copy link (segment + title), toast notification,
   event delegation cho grid (copy cột, share segment) và menu
   (mở bài kinh, toggle nhóm, bookmark star).
   ─────────────────────────────────────────────────────────────────
   Exports: SA.buildSutraMenuFromIndex, SA.highlightActiveInMenu,
            SA.syncTileToCurrentSutta, SA.findNikayaOfSutta,
            SA.initDelegations, SA.applyTitleBookmarkState,
            SA.updateBookmarksCount, SA.reflectBookmarkState,
            SA.revealCurrentSuttaInMenu, SA.renderBookmarksList,
            SA.extractGroupKey, SA._showToast
   Depends: utils.js, state.js, ui.js, render.js (SA.findMetaById)
   Runtime calls: SA.openSutra (from js/tts.js)
   ================================================================ */
(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;
var escapeHtml = SA.escapeHtml;
var escapeAttr = SA.escapeAttr;
var safeDomId = SA.safeDomId;
var safeCssEscape = SA.safeCssEscape;
var debounce = SA.debounce;
var s = SA.state;
var d = SA.dom;

var sutraMenuPanel = d.sutraMenuPanel;
var sutraMenuList  = d.sutraMenuList;
var searchInput    = d.searchInput;
var searchResultsEl = d.searchResultsEl;

var activeNikayaKey = null;
var KEY_ACTIVE_NIKAYA = 'active_nikaya_tile';

function buildSuttaLinkHtml(meta) {
	var codePrefix = meta.code ? meta.code + ' – ' : '';
	var viLabel = meta.titleVi || '', enLabel = meta.titleEn || '', paliLabel = meta.titlePali || '';
	var mainText, subText;
	if (s.uiLang === 'en') {
		mainText = codePrefix + (enLabel || viLabel || paliLabel || meta.id);
		subText  = paliLabel || viLabel || '';
	} else {
		mainText = codePrefix + (viLabel || enLabel || paliLabel || meta.id);
		subText  = paliLabel || enLabel || '';
	}
	var marked = SA.isBookmarked(meta.id);
	var bl = SA.bookmarkLabels();
	var starTitle = marked ? bl.on : bl.off;
	var starHtml =
		'<button type="button" class="menu-bookmark-btn' + (marked ? ' is-on' : '') + '" ' +
		'data-id="' + escapeAttr(meta.id) + '" aria-pressed="' + (marked ? 'true' : 'false') + '" ' +
		'aria-label="' + escapeAttr(starTitle) + '" title="' + escapeAttr(starTitle) + '">' +
		'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<path d="M10 2.3l2.39 4.84 5.34.78-3.86 3.77.91 5.31L10 14.49l-4.78 2.51.91-5.31L2.27 7.92l5.34-.78z"/>' +
		'</svg></button>';
	return '<a href="#" class="menu-sutta-link" role="treeitem" data-id="' + escapeAttr(meta.id) + '" aria-label="' + escapeAttr(mainText) + '">' +
		'<div class="sutra-label">' +
		'<div class="sutra-label-main">' + escapeHtml(mainText) + '</div>' +
		(subText ? '<div class="sutra-label-sub">' + escapeHtml(subText) + '</div>' : '') +
		'</div>' + starHtml + '</a>';
}

function extractGroupKey(code) {
	var m = String(code || '').match(/^([A-Za-z]+\s*\d+)\s*[–\-]/);
	return m ? m[1].trim() : String(code || '').trim();
}
SA.extractGroupKey = extractGroupKey;

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
			var label = s.uiLang === 'en'
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
	s.SUTRA_ORDER = order;
}

function renderNikayaList(nikKey) {
	if (!sutraMenuList) return;
	var index = window.SUTRA_INDEX || [];
	var nik = null;
	for (var i = 0; i < index.length; i++) {
		if (index[i].key === nikKey) { nik = index[i]; break; }
	}
	if (!nik) { sutraMenuList.innerHTML = ''; return; }
	var secId = safeDomId('sec-' + nik.key);
	sutraMenuList.innerHTML = buildMenuChildren(nik.children || [], secId);
	SA.highlightActiveInMenu();
}

function setActiveNikaya(nikKey, persist) {
	activeNikayaKey = nikKey;
	s.activeNikayaKey = nikKey;
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
	var order = s.SUTRA_ORDER && s.SUTRA_ORDER.length ? s.SUTRA_ORDER : Array.from(SA.BOOKMARKS);
	var ids = order.filter(function (id) { return SA.BOOKMARKS.has(id); });
	if (!ids.length) {
		var bl = SA.bookmarkLabels();
		sutraMenuList.innerHTML = '<li class="menu-empty" style="padding:18px 22px;color:var(--ink-light);font-style:italic;list-style:none">' + escapeHtml(bl.empty) + '</li>';
		return;
	}
	var html = '';
	for (var i = 0; i < ids.length; i++) {
		var meta = SA.findMetaById(ids[i]);
		if (meta) html += buildSuttaLinkHtml(meta);
	}
	sutraMenuList.innerHTML = html;
	SA.highlightActiveInMenu();
}

function updateBookmarksCount() {
	var el = $('bookmarksCount');
	if (!el) return;
	var n = SA.BOOKMARKS.size;
	el.textContent = n ? String(n) : '';
	el.classList.toggle('is-empty', n === 0);
}
SA.updateBookmarksCount = updateBookmarksCount;

function reflectBookmarkState(id, on) {
	var bl = SA.bookmarkLabels();
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
	if (id === s.currentSutraId) SA.applyTitleBookmarkState();
	updateBookmarksCount();
}
SA.reflectBookmarkState = reflectBookmarkState;

function applyTitleBookmarkState() {
	var btn = $('btnBookmarkCurrent');
	if (!btn) return;
	if (!s.currentSutraId) { btn.hidden = true; return; }
	btn.hidden = false;
	var on = SA.isBookmarked(s.currentSutraId);
	var bl = SA.bookmarkLabels();
	var label = on ? bl.on : bl.off;
	btn.classList.toggle('is-on', on);
	btn.setAttribute('aria-pressed', on ? 'true' : 'false');
	btn.setAttribute('aria-label', label);
	btn.setAttribute('title', label);
	applyShareBtnVisibility();
}
SA.applyTitleBookmarkState = applyTitleBookmarkState;

function applyShareBtnVisibility() {
	var b = $('btnShareCurrent');
	if (!b) return;
	b.hidden = !s.currentSutraId;
}

function _buildTitleShareUrl() {
	if (!s.currentSutraId) return location.href;
	return location.origin + location.pathname + '#' + s.currentSutraId;
}

function _getShareTitle() {
	var t = ($('title') || {}).textContent || '';
	t = t.trim();
	return t && t !== 'Chưa chọn bài' ? t : 'Sutta Archive';
}

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
	t.classList.remove('show');
	// eslint-disable-next-line no-unused-expressions
	t.offsetWidth;
	clearTimeout(_showToast._tm);
	clearTimeout(_showToast._tm2);
	requestAnimationFrame(function () { t.classList.add('show'); });
	_showToast._tm = setTimeout(function () { t.classList.remove('show'); }, 1800);
}
SA._showToast = _showToast;

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
	var en = s.uiLang === 'en';
	if (action === 'native' && typeof navigator.share === 'function') {
		try { await navigator.share({ title: title, url: url }); } catch (_) {}
		_closeShareMenu(); return;
	}
	if (action === 'copy') {
		var msg = en ? 'Link copied' : 'Đã sao chép link';
		try { await navigator.clipboard.writeText(url); _showToast(msg); }
		catch (_) {
			var ta = document.createElement('textarea');
			ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
			document.body.appendChild(ta); ta.select();
			try { document.execCommand('copy'); _showToast(msg); } catch (__) {}
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
SA.findNikayaOfSutta = findNikayaOfSutta;

function applyTileLabels() {
	var tiles = document.querySelectorAll('.nikaya-tile .tile-label');
	for (var i = 0; i < tiles.length; i++) {
		var el = tiles[i];
		el.textContent = s.uiLang === 'en' ? (el.getAttribute('data-en') || '') : (el.getAttribute('data-vi') || '');
	}
}

function normStr(str) {
	return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function populateFlatSuttas() {
	s.FLAT_SUTTAS = [];
	var index = window.SUTRA_INDEX || [];
	function walk(children) {
		if (!children || !children.length) return;
		for (var i = 0; i < children.length; i++) {
			var ch = children[i];
			if (ch.type === 'sutta' && ch.id) {
				var codePrefix = ch.code ? ch.code + ' – ' : '';
				var viLabel = ch.titleVi || '', enLabel = ch.titleEn || '', paliLabel = ch.titlePali || '';
				var mainText = s.uiLang === 'en'
					? codePrefix + (enLabel || viLabel || paliLabel || ch.id)
					: codePrefix + (viLabel || enLabel || paliLabel || ch.id);
				var subText = s.uiLang === 'en' ? (paliLabel || viLabel || '') : (paliLabel || enLabel || '');
				s.FLAT_SUTTAS.push({
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
			var msg = s.uiLang === 'en' ? 'No sutta index found. Make sure toc.js is loaded.' : 'Chưa có mục lục. Hãy đảm bảo file toc.js đã được tải.';
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
	if (s.currentSutraId) initial = findNikayaOfSutta(s.currentSutraId);
	if (!initial) initial = storage.get(KEY_ACTIVE_NIKAYA);
	if (!initial && index[0]) initial = index[0].key;
	setActiveNikaya(initial, false);
}
SA.buildSutraMenuFromIndex = buildSutraMenuFromIndex;

function highlightActiveInMenu() {
	if (!sutraMenuList) return;
	sutraMenuList.querySelectorAll('.menu-sutta-link').forEach(function (a) {
		var isActive = a.getAttribute('data-id') === s.currentSutraId;
		a.classList.toggle('active', isActive);
		a.setAttribute('aria-current', isActive ? 'page' : 'false');
	});
}
SA.highlightActiveInMenu = highlightActiveInMenu;

function syncTileToCurrentSutta() {
	if (!s.currentSutraId) return;
	var nik = findNikayaOfSutta(s.currentSutraId);
	if (nik && nik !== activeNikayaKey) setActiveNikaya(nik, true);
}
SA.syncTileToCurrentSutta = syncTileToCurrentSutta;

function renderSearchResults(matches, q) {
	if (!searchResultsEl) return;
	if (!q) { searchResultsEl.innerHTML = ''; return; }
	if (!matches.length) {
		var msg = s.uiLang === 'en' ? 'No matching sutta found.' : 'Không tìm thấy kinh phù hợp.';
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
	var matches = s.FLAT_SUTTAS.filter(function (x) { return x.flat.includes(q); }).slice(0, 80);
	renderSearchResults(matches, query);
}

if (searchInput) searchInput.addEventListener('input', debounce(function (e) { applySearch(e.target.value); }, 180));

function _buildShareUrl(keyRaw) {
	return location.origin + location.pathname + '#' + keyRaw;
}

function shareSegment(keyRaw) {
	if (!keyRaw) return;
	var url = _buildShareUrl(keyRaw);
	var titleText = (document.getElementById('title') || {}).textContent || 'Sutta Archive';
	if (navigator.share) {
		navigator.share({ title: titleText, url: url }).catch(function () {});
		return;
	}
	var done = function () { _showToast(s.uiLang === 'en' ? 'Link copied' : 'Đã sao chép link'); };
	var fail = function () { _showToast(s.uiLang === 'en' ? 'Copy failed' : 'Sao chép thất bại'); };
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
		ta.setAttribute('readonly', '');
		ta.setAttribute('aria-hidden', 'true');
		ta.style.position = 'fixed'; ta.style.left = '-9999px';
		ta.style.fontSize = '16px';
		document.body.appendChild(ta);
		ta.select();
		var ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch (e) { return false; }
}

function initDelegations() {
	var grid = d.grid;
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
				var done = function () { _showToast(s.uiLang === 'en' ? 'Text copied' : 'Đã sao chép'); };
				var fail = function () { _showToast(s.uiLang === 'en' ? 'Copy failed' : 'Sao chép thất bại'); };
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
					var now = SA.toggleBookmark(sid);
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
					SA.openSutra(id);
					SA.closePanels();
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
					SA.openSutra(id);
					SA.closePanels();
					if (searchInput) searchInput.value = '';
					searchResultsEl.innerHTML = '';
				}
			}
		});
		searchResultsEl._del = true;
	}
}
SA.initDelegations = initDelegations;
SA.renderBookmarksList = renderBookmarksList;

function revealCurrentSuttaInMenu() {
	if (!s.currentSutraId || !sutraMenuPanel || !sutraMenuList) return;
	SA.togglePanel(d.settingsPanel, false);
	var nikOfCurrent = findNikayaOfSutta(s.currentSutraId);
	if (nikOfCurrent && nikOfCurrent !== activeNikayaKey) setActiveNikaya(nikOfCurrent, true);
	SA.togglePanel(sutraMenuPanel, true);
	setTimeout(function () {
		var link = sutraMenuList.querySelector('.menu-sutta-link[data-id="' + safeCssEscape(s.currentSutraId) + '"]');
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
SA.revealCurrentSuttaInMenu = revealCurrentSuttaInMenu;
})();
