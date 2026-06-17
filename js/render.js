/* ================================================================
   render.js — Module [6/8]
   Virtual scroll engine: chia rows thành chunks ~50 dòng,
   materialize/dematerialize bằng IntersectionObserver.
   renderSutra() là pipeline chính: load data → build chunks →
   eager materialize quanh anchor → restore scroll.
   ─────────────────────────────────────────────────────────────────
   Exports: SA.findMetaById, SA.renderSutra, SA.renderWelcomeScreen,
            SA.setupChunkObservers, SA.teardownChunkObservers,
            SA.ensureRowRendered, SA.buildSuttaPrintHtml,
            SA.resolveCommentLang
   Depends: utils.js, bilara.js, state.js, ui.js, anchor.js
   Runtime calls (defined in later modules, resolved at call time):
     SA.resetTts, SA.setTtsUiState, SA.syncTileToCurrentSutta,
     SA.highlightActiveInMenu, SA.updateNavButtons,
     SA.applyTitleBookmarkState, SA.scheduleNextPreload
   ================================================================ */
(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;
var escapeHtml = SA.escapeHtml;
var escapeAttr = SA.escapeAttr;
var s = SA.state;
var d = SA.dom;

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
SA.findMetaById = findMetaById;

function getColHeaders() {
	return s.uiLang === 'en'
		? { pali: 'Pali', eng: 'English', vie: 'Vietnamese' }
		: { pali: 'Pali', eng: 'English', vie: 'Tiếng Việt' };
}

function resolveCommentLang(v) {
	if (!v) return '';
	if (typeof v === 'string') return v.trim();
	return '';
}
SA.resolveCommentLang = resolveCommentLang;

function resolveCommentText(cmt) {
	if (!cmt) return '';
	if (typeof cmt === 'string') return cmt.trim();
	if (typeof cmt === 'object') {
		var pref = s.uiLang === 'en' ? ['en','vi','pli'] : ['vi','en','pli'];
		for (var i = 0; i < pref.length; i++) {
			var v = cmt[pref[i]];
			if (typeof v === 'string' && v.trim()) return v.trim();
		}
	}
	return '';
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
		shareBtn.setAttribute('aria-label', s.uiLang === 'en' ? 'Share / copy link to this segment' : 'Chia sẻ / sao chép link đoạn này');
		shareBtn.title = s.uiLang === 'en' ? 'Share / copy link' : 'Chia sẻ / sao chép link';
		shareBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="10" r="2.4"/><circle cx="15" cy="5" r="2.4"/><circle cx="15" cy="15" r="2.4"/><path d="M7.2 8.9l5.6-3.4M7.2 11.1l5.6 3.4"/></svg>';
		segWrap.appendChild(shareBtn);
		wrap.appendChild(segWrap);
	}
	var row = document.createElement('div');
	row.className = 'sutra-row'; row.setAttribute('data-key', keyRaw);
	var headers = getColHeaders();
	var cPli = resolveCommentLang(r.commentPli);
	var cEng = resolveCommentLang(r.commentEn);
	var cVie = resolveCommentLang(r.commentVie);
	function ensureCmtHeader(col) {
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
		copyBtn.setAttribute('aria-label', s.uiLang === 'en' ? 'Copy this paragraph' : 'Sao chép đoạn này');
		copyBtn.title = s.uiLang === 'en' ? 'Copy' : 'Sao chép';
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
	if (r._merged && Array.isArray(r._mergedComments) && r._mergedComments.length) {
		var targetCol = r.pali ? pcol : (r.eng ? ecol : (r.vie ? vcol : null));
		if (targetCol) {
			ensureCmtHeader(targetCol);
			for (var mi = 0; mi < r._mergedComments.length; mi++) {
				var mc = r._mergedComments[mi];
				var cBlk = document.createElement('div');
				cBlk.className = 'sutra-col-comment sutra-col-comment-merged';
				var icon2 = document.createElement('span');
				icon2.className = 'sutra-col-comment-icon'; icon2.setAttribute('aria-hidden', 'true');
				icon2.textContent = '💬';
				var txt2 = document.createElement('span');
				txt2.className = 'sutra-col-comment-text'; txt2.textContent = mc.text;
				cBlk.appendChild(icon2); cBlk.appendChild(txt2);
				targetCol.appendChild(cBlk);
			}
		}
	}
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

function materializeChunk(chunkInfo) {
	if (!chunkInfo || chunkInfo.materialized) return;
	var scroller = d.scrollEl;
	var needsCompensation = false;
	var oldChunkBottom = 0;
	if (scroller && chunkInfo.div.parentNode === scroller && Date.now() >= s._progScrollUntil) {
		var preRect = chunkInfo.div.getBoundingClientRect();
		var preRootRect = scroller.getBoundingClientRect();
		oldChunkBottom = preRect.bottom - preRootRect.top + scroller.scrollTop;
		if (oldChunkBottom <= scroller.scrollTop) needsCompensation = true;
	}
	var frag = document.createDocumentFragment();
	for (var i = chunkInfo.rowStart; i < chunkInfo.rowEnd; i++) {
		var rowData = s.virtAllRows[i];
		if (!rowData) continue;
		var wrap = createRow(rowData);
		frag.appendChild(wrap);
		var innerRow = wrap.querySelector ? wrap.querySelector('.sutra-row') : wrap;
		s.cachedRows[i] = innerRow || wrap;
	}
	chunkInfo.div.appendChild(frag);
	chunkInfo.div.style.minHeight = '';
	chunkInfo.materialized = true;
	if (s.anchorObserver) {
		var newRows = chunkInfo.div.querySelectorAll('.sutra-row');
		for (var k = 0; k < newRows.length; k++) s.anchorObserver.observe(newRows[k]);
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
	if (s.anchorObserver) {
		var oldRows = chunkInfo.div.querySelectorAll('.sutra-row');
		for (var k = 0; k < oldRows.length; k++) s.anchorObserver.unobserve(oldRows[k]);
	}
	var realH = chunkInfo.div.offsetHeight;
	if (realH > 0) chunkInfo.measuredH = realH;
	else if (!chunkInfo.measuredH) chunkInfo.measuredH = (chunkInfo.rowEnd - chunkInfo.rowStart) * 120;
	var scroller = d.scrollEl;
	var needsCompensation = false;
	var oldChunkBottom = 0;
	if (scroller && chunkInfo.div.parentNode === scroller && Date.now() >= s._progScrollUntil) {
		var preRect = chunkInfo.div.getBoundingClientRect();
		var preRootRect = scroller.getBoundingClientRect();
		oldChunkBottom = preRect.bottom - preRootRect.top + scroller.scrollTop;
		if (oldChunkBottom <= scroller.scrollTop) needsCompensation = true;
	}
	while (chunkInfo.div.firstChild) chunkInfo.div.removeChild(chunkInfo.div.firstChild);
	chunkInfo.div.style.minHeight = chunkInfo.measuredH + 'px';
	chunkInfo.materialized = false;
	for (var i = chunkInfo.rowStart; i < chunkInfo.rowEnd; i++) s.cachedRows[i] = null;
	if (needsCompensation && scroller) {
		var newChunkRect = chunkInfo.div.getBoundingClientRect();
		var newRootRect  = scroller.getBoundingClientRect();
		var newChunkBottom = newChunkRect.bottom - newRootRect.top + scroller.scrollTop;
		var delta = newChunkBottom - oldChunkBottom;
		if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
	}
}

function teardownChunkObservers() {
	if (s.virtMatObs) { s.virtMatObs.disconnect(); s.virtMatObs = null; }
	if (s.virtDemObs) { s.virtDemObs.disconnect(); s.virtDemObs = null; }
}
SA.teardownChunkObservers = teardownChunkObservers;

function setupChunkObservers() {
	teardownChunkObservers();
	if (!d.scrollEl || !s.virtChunks.length) return;
	s.virtMatObs = new IntersectionObserver(function (entries) {
		for (var i = 0; i < entries.length; i++) {
			if (entries[i].isIntersecting) {
				var idx = parseInt(entries[i].target.getAttribute('data-chunk-idx'), 10);
				if (Number.isFinite(idx) && s.virtChunks[idx]) materializeChunk(s.virtChunks[idx]);
			}
		}
	}, { root: d.scrollEl, rootMargin: '200% 0px 100% 0px', threshold: 0 });
	s.virtDemObs = new IntersectionObserver(function (entries) {
		for (var i = 0; i < entries.length; i++) {
			if (!entries[i].isIntersecting) {
				var idx = parseInt(entries[i].target.getAttribute('data-chunk-idx'), 10);
				if (Number.isFinite(idx) && s.virtChunks[idx]) dematerializeChunk(s.virtChunks[idx]);
			}
		}
	}, { root: d.scrollEl, rootMargin: '300% 0px 300% 0px', threshold: 0 });
	for (var k = 0; k < s.virtChunks.length; k++) {
		s.virtMatObs.observe(s.virtChunks[k].div);
		s.virtDemObs.observe(s.virtChunks[k].div);
	}
}
SA.setupChunkObservers = setupChunkObservers;

function _findChunkForRow(rowIdx) {
	for (var k = 0; k < s.virtChunks.length; k++) {
		if (rowIdx >= s.virtChunks[k].rowStart && rowIdx < s.virtChunks[k].rowEnd) return k;
	}
	return 0;
}

function _progressiveFill(anchorChunkIdx, renderToken) {
	var above = anchorChunkIdx - 2;
	var below = anchorChunkIdx + 2;
	var RANGE = 8;
	var minChunk = Math.max(0, anchorChunkIdx - RANGE);
	var maxChunk = Math.min(s.virtChunks.length - 1, anchorChunkIdx + RANGE);
	var queue = [];
	while (above >= minChunk || below <= maxChunk) {
		if (above >= minChunk) queue.push(above--);
		if (below <= maxChunk) queue.push(below++);
	}
	var idx = 0;
	function fillNext() {
		if (renderToken !== s.renderToken) return;
		if (idx >= queue.length) return;
		var ci = queue[idx++];
		if (s.virtChunks[ci] && !s.virtChunks[ci].materialized) {
			materializeChunk(s.virtChunks[ci]);
		}
		if (idx < queue.length) {
			if (typeof requestIdleCallback === 'function') {
				requestIdleCallback(fillNext, { timeout: 200 });
			} else {
				setTimeout(fillNext, 50);
			}
		}
	}
	fillNext();
}

function ensureRowRendered(rowIdx) {
	for (var k = 0; k < s.virtChunks.length; k++) {
		var c = s.virtChunks[k];
		if (rowIdx >= c.rowStart && rowIdx < c.rowEnd) {
			if (!c.materialized) materializeChunk(c);
			return;
		}
	}
}
SA.ensureRowRendered = ensureRowRendered;

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
	if (s.uiLang === 'en') return getByExactOrSuffix(merged.engMap, exactKey, suffix)
		|| getByExactOrSuffix(merged.vieMap, exactKey, suffix)
		|| getByExactOrSuffix(merged.paliMap, exactKey, suffix) || '';
	return getByExactOrSuffix(merged.vieMap, exactKey, suffix)
		|| getByExactOrSuffix(merged.engMap, exactKey, suffix)
		|| getByExactOrSuffix(merged.paliMap, exactKey, suffix) || '';
}

function renderWelcomeScreen() {
	if (!d.grid || s.currentSutraId) return;
	var isEn = s.uiLang === 'en';
	if (d.superTitleEl) d.superTitleEl.textContent = '';
	if (d.titleMetaEl)  d.titleMetaEl.textContent  = '';
	if (d.titleEl)      d.titleEl.textContent      = '';
	if (d.subtitleEl)   d.subtitleEl.textContent   = '';
	document.documentElement.classList.add('is-welcome');
	SA.applyTitleBookmarkState();
	var heroSub = isEn
		? 'Reverently saluting the Blessed One, the Worthy One, the Perfectly Self-Awakened.<br>A library of canonical suttas for practitioners and scholars.'
		: 'Cung kính đảnh lễ Đức Thế Tôn, bậc A-la-hán, Chánh Đẳng Giác.<br>Một thư viện kinh điển dành cho người tu học và nghiên cứu Phật pháp.';
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
	var mandalaSvg = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" aria-hidden="true"><g class="welcome-ring r1"><circle cx="60" cy="60" r="54" stroke-width=".7" opacity=".55"/><circle cx="60" cy="60" r="54" stroke-width=".7" stroke-dasharray="1 6" opacity=".8"/></g><g class="welcome-ring r2"><circle cx="60" cy="60" r="42" stroke-width=".6" stroke-dasharray="2 4" opacity=".6"/></g><g class="welcome-core" stroke-width=".9"><g opacity=".95"><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(45 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(90 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(135 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(180 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(225 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(270 60 60)"/><path d="M60 30 C 70 42, 70 52, 60 60 C 50 52, 50 42, 60 30 Z" transform="rotate(315 60 60)"/></g><circle cx="60" cy="60" r="4" fill="currentColor" stroke="none"/></g><g class="welcome-petals">' + petalDots + '</g></svg>';
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
		return '<article class="welcome-verse"><p class="welcome-verse-pali">' + escapeHtml(v.pali) + '</p><p class="welcome-verse-tr">' + escapeHtml(v.tr) + '</p><p class="welcome-verse-source">' + escapeHtml(v.src) + '</p></article>';
	}).join('');
	var virtues = [
		{ pali: 'Arahaṃ', tr: isEn ? 'The Worthy One' : 'Ứng Cúng' },
		{ pali: 'Sammāsambuddho', tr: isEn ? 'The Self-Awakened' : 'Chánh Biến Tri' },
		{ pali: 'Vijjā­caraṇa­sampanno', tr: isEn ? 'Knowledge & Conduct' : 'Minh Hạnh Túc' },
		{ pali: 'Sugato', tr: isEn ? 'The Well-Gone' : 'Thiện Thệ' },
		{ pali: 'Lokavidū', tr: isEn ? 'Knower of the World' : 'Thế Gian Giải' },
		{ pali: 'Anuttaro­purisa­damma­sārathi', tr: isEn ? 'Supreme Trainer' : 'Điều Ngự Trượng Phu' },
		{ pali: 'Satthā­deva­manussānaṃ', tr: isEn ? 'Teacher of Gods & Humans' : 'Thiên Nhân Sư' },
		{ pali: 'Buddho', tr: isEn ? 'The Awakened' : 'Phật' },
		{ pali: 'Bhagavā', tr: isEn ? 'The Blessed One' : 'Thế Tôn' }
	];
	var virtuesHtml = '<ol class="welcome-virtues" aria-label="' + (isEn ? 'Nine Virtues of the Buddha' : 'Cửu Đức Phật') + '">' +
		virtues.map(function (v, i) {
			return '<li class="wv-item" style="--idx:' + i + ';--angle:' + (i * 40) + 'deg"><span class="wv-pali">' + escapeHtml(v.pali) + '</span><span class="wv-tr">' + escapeHtml(v.tr) + '</span></li>';
		}).join('') + '</ol>';
	var iconLib  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2 3v10M5 3v10M8 3v10M12 4l3 9M11 13h5"/></svg>';
	var iconHelp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.4-.9 2-1.6 2.4-.7.4-1.1.7-1.1 1.6v.4"/><path d="M12 16.2h.01"/></svg>';
	var helperRows = isEn
		? [{action:'guide', text: '<em>Help</em> — view the guide', icon: iconHelp},
		   {action:'library', text: '<em>Library</em> — browse suttas', icon: iconLib}]
		: [{action:'guide', text: '<em>Trợ giúp</em> — xem hướng dẫn', icon: iconHelp},
		   {action:'library', text: '<em>Thư viện</em> — chọn bài kinh', icon: iconLib}];
	var helperHtml = helperRows.map(function (r) {
		return '<button type="button" class="welcome-help-row" data-action="' + r.action + '"><span class="welcome-help-text">' + r.text + '</span><span class="welcome-help-key">' + r.icon + '</span></button>';
	}).join('');
	d.grid.innerHTML =
		'<div class="welcome-screen"><div class="welcome-mandala">' + mandalaSvg + virtuesHtml + '</div>' +
		'<h1 class="welcome-hero-title" data-action="library" tabindex="0" role="button" aria-label="' + (isEn ? 'Open library' : 'Mở thư viện') + '" title="' + (isEn ? 'Open library' : 'Mở thư viện') + '">' + (isEn ? 'The <em>Sutta</em><br>Nikāya' : 'Tạng <em>Kinh</em><br>Nikāya') + '</h1>' +
		'<p class="welcome-hero-sub">' + heroSub + '</p>' +
		'<div class="welcome-hero-langs" role="tablist" aria-label="' + (isEn ? 'Interface language' : 'Ngôn ngữ giao diện') + '">' +
		'<button type="button" class="welcome-lang-btn' + (s.uiLang === 'vi' ? ' active' : '') + '" data-ui-lang="vi" role="tab" aria-selected="' + (s.uiLang === 'vi' ? 'true' : 'false') + '">Việt</button>' +
		'<span class="dot" aria-hidden="true"></span>' +
		'<button type="button" class="welcome-lang-btn' + (s.uiLang === 'en' ? ' active' : '') + '" data-ui-lang="en" role="tab" aria-selected="' + (s.uiLang === 'en' ? 'true' : 'false') + '">English</button>' +
		'</div><section class="welcome-verses">' + versesHtml + '</section><div class="welcome-helper">' + helperHtml + '</div></div>';
	d.grid.querySelectorAll('.welcome-help-row[data-action], .welcome-hero-title[data-action]').forEach(function (el) {
		el.addEventListener('click', function (e) {
			e.stopPropagation();
			var action = el.getAttribute('data-action');
			if (action === 'library' && d.btnSutraMenu) d.btnSutraMenu.click();
			else if (action === 'guide' && d.btnGuide) d.btnGuide.click();
		});
	});
	var heroTitleEl = d.grid.querySelector('.welcome-hero-title[data-action]');
	if (heroTitleEl) heroTitleEl.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heroTitleEl.click(); }
	});
	d.grid.querySelectorAll('.welcome-lang-btn[data-ui-lang]').forEach(function (el) {
		el.addEventListener('click', function (e) {
			e.stopPropagation();
			var chosen = el.getAttribute('data-ui-lang');
			if (chosen === s.uiLang) return;
			if (d.btnUiLang) d.btnUiLang.click();
		});
	});
}
SA.renderWelcomeScreen = renderWelcomeScreen;

SA.renderSutra = async function renderSutra(id) {
	if (!id || !d.grid) return;
	if (s.currentSutraId && s.currentSutraId !== id) SA._dmInvalidateForSutta(s.currentSutraId);
	SA.resetTts(true, false);
	if (s.anchorObserver) { s.anchorObserver.disconnect(); s.anchorObserver = null; }
	teardownChunkObservers();
	s.virtChunks = [];
	s.virtAllRows = [];
	s.firstVisibleKey = null;
	s.cachedRows = [];
	var token = ++s.renderToken;
	s.isRendering = true;
	d.grid.setAttribute('aria-busy', 'true');
	if (d.btnReadTts)  d.btnReadTts.disabled  = true;
	if (d.btnPauseTts) d.btnPauseTts.disabled = true;
	if (d.btnStopTts)  d.btnStopTts.disabled  = true;
	var merged = null;
	try { merged = await SA.loadMerged(id); } catch(e) { merged = null; }
	if (token !== s.renderToken) { s.isRendering = false; return; }
	s.currentSutraId = id;
	SA.syncTileToCurrentSutta();
	SA.highlightActiveInMenu();
	SA.updateNavButtons();
	if (!merged || !merged.rows || !merged.rows.length) {
		if (storage.get(SA.KEY_LAST) === id) storage.remove(SA.KEY_LAST);
		if (d.titleEl) d.titleEl.textContent = s.uiLang === 'en' ? 'Sutta data not found' : 'Không tìm thấy dữ liệu bài kinh';
		if (d.subtitleEl) d.subtitleEl.textContent = (s.uiLang === 'en' ? 'ID: ' : 'Mã bài: ') + id;
		d.grid.innerHTML = '<div style="max-width:520px;margin:48px auto;padding:24px;text-align:center;font-family:var(--serif-vi);color:var(--ink-3);font-style:italic;border:1px dashed var(--rule);border-radius:6px">'
			+ (s.uiLang === 'en' ? 'No data for this sutta yet. Please choose another.' : 'Bài kinh chưa có dữ liệu — vui lòng chọn bài khác.') + '</div>';
		s.isRendering = false;
		d.grid.setAttribute('aria-busy', 'false'); SA.setTtsUiState('idle'); return;
	}
	storage.set(SA.KEY_LAST, id);
	var titleFromBilara    = (pickTextForUiLangSuffix(merged, id, ':0.2') || '').trim();
	var subtitleFromBilara = (pickTextForUiLangSuffix(merged, id, ':0.1') || '').trim();
	var meta = findMetaById(id) || {};
	var titleFallback = s.uiLang === 'en'
		? meta.titleEn || meta.titleVi || meta.titlePali || meta.title || id
		: meta.titleVi || meta.titleEn || meta.titlePali || meta.title || id;
	var rootLabelVi = meta.rootNikaya ? (meta.rootNikaya.labelVi || meta.rootNikaya.key) : '';
	var rootLabelEn = meta.rootNikaya ? (meta.rootNikaya.labelEn || meta.rootNikaya.key) : '';
	var parentLabelVi = meta.parentGroup ? (meta.parentGroup.labelVi || meta.parentGroup.key) : '';
	var parentLabelEn = meta.parentGroup ? (meta.parentGroup.labelEn || meta.parentGroup.key) : '';
	function extractShortLabel(label, lang) {
		if (!label) return '';
		var parts = label.split(/\s+-\s+/);
		return lang === 'vi' ? (parts[1] || parts[0] || '').trim() : (parts[0] || label).trim();
	}
	var rootShort   = extractShortLabel(s.uiLang === 'en' ? rootLabelEn : rootLabelVi, s.uiLang);
	var parentShort = extractShortLabel(s.uiLang === 'en' ? parentLabelEn : parentLabelVi, s.uiLang);
	var rootKey = meta.rootNikaya ? meta.rootNikaya.key : '';
	var titleOverride = null, titleMetaOverride = null;
	var AN_ORDINALS_EN = ['', 'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Elevens'];
	if (rootKey === 'SN') {
		titleOverride = s.uiLang === 'en' ? (meta.titleEn || meta.titleVi) : (meta.titleVi || meta.titleEn);
		titleMetaOverride = s.uiLang === 'en' ? (meta.titleVi || '') : (meta.titleEn || '');
	} else if (rootKey === 'AN' && meta.code) {
		var anM = String(meta.code).match(/AN\s*(\d+)/);
		if (anM) {
			var n = parseInt(anM[1], 10);
			titleOverride = s.uiLang === 'en' ? 'Book of ' + (AN_ORDINALS_EN[n] || n) : 'Nhóm ' + n + ' Pháp';
			titleMetaOverride = s.uiLang === 'en' ? 'Nhóm ' + n + ' Pháp' : 'Book of ' + (AN_ORDINALS_EN[n] || n);
		}
	}
	var resolvedTitle = titleOverride || titleFromBilara || titleFallback;
	if (d.titleEl) d.titleEl.textContent = resolvedTitle;
	SA.applyTitleBookmarkState();
	var paliName = (meta.titlePali || subtitleFromBilara || '').trim();
	s.isAN = (rootKey === 'AN');
	s.isSN = (rootKey === 'SN');
	s.fallbackTitle = (resolvedTitle || '').trim();
	s.superLastSlotEl = null;
	if (d.superTitleEl) {
		var superParts = [];
		if (rootShort) superParts.push(rootShort);
		if (parentShort && parentShort !== rootShort && rootKey !== 'SN') superParts.push(parentShort);
		var codeTxt = (meta.code || '').trim();
		if (codeTxt) superParts.push(codeTxt);
		if (s.isSN) {
			if (s.fallbackTitle) superParts.push(s.fallbackTitle);
			d.superTitleEl.textContent = '';
			for (var spi = 0; spi < superParts.length; spi++) {
				if (spi > 0) d.superTitleEl.appendChild(document.createTextNode(' · '));
				var spSpan = document.createElement('span');
				spSpan.textContent = superParts[spi];
				d.superTitleEl.appendChild(spSpan);
			}
			var sepNode = document.createElement('span');
			sepNode.className = 'super-sep'; sepNode.textContent = ' · '; sepNode.style.display = 'none';
			d.superTitleEl.appendChild(sepNode);
			var dynSpan = document.createElement('span');
			dynSpan.id = 'superLastSlot'; dynSpan.textContent = '';
			d.superTitleEl.appendChild(dynSpan);
			s.superLastSlotEl = dynSpan;
			s.superLastSlotEl._sep = sepNode;
		} else {
			var lastSlotText = s.isAN ? s.fallbackTitle : paliName;
			if (lastSlotText) superParts.push(lastSlotText);
			d.superTitleEl.textContent = superParts.join(' · ');
		}
	}
	s.lastAppliedVaggaIdx = -2;
	s.lastAppliedSuttaIdx = -2;
	if (d.subtitleEl) d.subtitleEl.textContent = '';
	var altName = titleMetaOverride || (s.uiLang === 'en' ? (meta.titleVi || '') : (meta.titleEn || ''));
	s.fallbackTitleMeta = (altName || '').trim();
	if (d.titleMetaEl) d.titleMetaEl.textContent = altName;
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
	var singleLang = SA.getSingleVisibleLang(); s.lastSingleLangMode = singleLang;
	var viewData = SA.getViewData(id, rowsForViewRaw, singleLang, s.isAN, s.isSN);
	var rowsForView = viewData.rows;
	d.grid.innerHTML = '';
	s.cachedRows = [];
	s._progScrollUntil = Date.now() + 5000;
	SA.applyVisibility();
	var CHUNK_SIZE = 50;
	var EST_ROW_H = singleLang ? 130 : (d.card && d.card.classList.contains('stack') ? 220 : 180);
	s.virtChunks = [];
	s.virtAllRows = rowsForView;
	s.keyToRowIdx = viewData.keyToRowIdx;
	s.vaggaMarkers = viewData.vaggaMarkers;
	s.suttaMarkers = viewData.suttaMarkers;
	s.lastAppliedVaggaIdx = -2;
	s.lastAppliedSuttaIdx = -2;
	var placeFrag = document.createDocumentFragment();
	for (var ci = 0; ci < rowsForView.length; ci += CHUNK_SIZE) {
		var ce = Math.min(ci + CHUNK_SIZE, rowsForView.length);
		var cdiv = document.createElement('div');
		cdiv.className = 'row-chunk';
		cdiv.setAttribute('data-chunk-idx', String(s.virtChunks.length));
		cdiv.style.minHeight = ((ce - ci) * EST_ROW_H) + 'px';
		s.virtChunks.push({ div: cdiv, rowStart: ci, rowEnd: ce, materialized: false, measuredH: 0 });
		placeFrag.appendChild(cdiv);
	}
	d.grid.appendChild(placeFrag);
	// Eager materialize around anchor — with instant scroll fix
	(function eagerAroundAnchor() {
		try {
			var anchorKey = SA.getAnchorKeyFor(id);
			var scroller = SA.getScrollRoot() || d.scrollEl;
			if (!anchorKey) {
				if (scroller && scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'instant' });
				materializeChunk(s.virtChunks[0]);
				return;
			}
			var anchorIdx = (s.keyToRowIdx[anchorKey] != null) ? s.keyToRowIdx[anchorKey] : 0;
			var anchorChunkIdx = Math.floor(anchorIdx / CHUNK_SIZE);
			var lo = Math.max(0, anchorChunkIdx - 1);
			var hi = Math.min(s.virtChunks.length - 1, anchorChunkIdx + 1);
			for (var eci = lo; eci <= hi; eci++) materializeChunk(s.virtChunks[eci]);
			var maxScrollY = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
			if (anchorChunkIdx > 0 && scroller && s.virtChunks[anchorChunkIdx] && s.virtChunks[anchorChunkIdx].div && maxScrollY > 10) {
				var chunkRect = s.virtChunks[anchorChunkIdx].div.getBoundingClientRect();
				var rootRect  = scroller.getBoundingClientRect();
				var rawY = (chunkRect.top - rootRect.top) + scroller.scrollTop;
				var maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				var targetY = Math.max(0, Math.min(rawY, maxY));
				scroller.scrollTo({ top: targetY, behavior: 'instant' });
			}
		} catch (e) {}
	})();
	requestAnimationFrame(function () {
		if (token !== s.renderToken) { s.isRendering = false; return; }
		setupChunkObservers();
		d.grid.setAttribute('aria-busy', 'false');
		requestAnimationFrame(function () {
			SA.updateVisibleCols();
			if (!SA.restoreScrollByAnchor(id)) {
				var _sr = SA.getScrollRoot();
				if (_sr && _sr.scrollTop > 0) _sr.scrollTo({ top: 0, behavior: 'instant' });
			}
			SA.setupAnchorObserver(); SA.updateNavButtons();
			try { SA._dmSaveCurrent(); } catch (_) {}
			try { SA.updateReadingProgress(); } catch (_) {}
			setTimeout(function () {
				s._progScrollUntil = 0;
				s.isRendering = false;
				SA.setTtsUiState('idle');
				if (token === s.renderToken && s.virtChunks.length > 3) {
					var aKey = SA.getAnchorKeyFor(id);
					var aIdx = aKey && s.keyToRowIdx[aKey] != null ? s.keyToRowIdx[aKey] : 0;
					_progressiveFill(_findChunkForRow(aIdx), token);
				}
			}, 500);
		});
		SA.scheduleNextPreload(id);
	});
};

SA.buildSuttaPrintHtml = function (id, merged) {
	var meta = findMetaById(id) || {};
	var rootKey = meta.rootNikaya ? meta.rootNikaya.key : '';
	var skipDupTitle = (rootKey === 'MN' || rootKey === 'DN');
	var cmtOnPli = !!(s.showCmtPli && s.showPali);
	var cmtOnEng = !!(s.showCmtEng && s.showEng);
	var cmtOnVie = !!(s.showCmtVie && s.showVie);
	var cmtHeaders = s.uiLang === 'en'
		? { pali: 'Aṭṭhakathā', eng: 'Commentary', vie: 'Vietnamese Cmt' }
		: { pali: 'Aṭṭhakathā', eng: 'Commentary', vie: 'Chú giải' };
	var title = (d.titleEl && d.titleEl.textContent) || (meta.titleVi || meta.titleEn || id);
	var subtitle = (d.subtitleEl && d.subtitleEl.textContent) || '';
	var supertitle = (d.superTitleEl && d.superTitleEl.textContent) || '';
	var titleMeta = (d.titleMetaEl && d.titleMetaEl.textContent) || '';
	var headers = s.uiLang === 'en'
		? { pali: 'Pali', eng: 'English', vie: 'Vietnamese' }
		: { pali: 'Pali', eng: 'English', vie: 'Tiếng Việt' };
	function esc(sv) { return String(sv == null ? '' : sv).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
	function shortKey(raw) {
		if (!raw) return '';
		if (raw.indexOf(':') !== -1) { var parts = raw.split(':'); var prefix = parts[0].replace(/([a-zA-Z]+)(\d*)/, function (_, l, n) { return l.toUpperCase() + n; }); return parts[1] ? prefix + '.' + parts[1] : prefix; }
		return String(raw).toUpperCase();
	}
	var activeLangCount = (s.showPali ? 1 : 0) + (s.showEng ? 1 : 0) + (s.showVie ? 1 : 0);
	var singleLang = activeLangCount === 1;
	function tag(name) { return singleLang ? '' : '<span class="lang-tag">' + esc(name) + '</span>'; }
	function rowHtml(r) {
		var tp = (r.pali || '').trim(), te = (r.eng || '').trim(), tv = (r.vie || '').trim();
		var keyRaw = String(r.key || '');
		if (skipDupTitle && /:0\.[12]$/.test(keyRaw)) return '';
		var isSectionNum = (tp.length <= 6 && te.length <= 6 && tv.length <= 6) && /^[IVXLCDM]+\.?$|^\d+\.?$/.test(tp || te || tv);
		if (isSectionNum) return '';
		var isSource = /:source$/i.test(keyRaw);
		var isSubtitle = /:0\.[123]$/.test(keyRaw);
		var cls = 'prow';
		if (isSource) cls += ' prow-source';
		if (isSubtitle) cls += ' prow-subtitle';
		var inner = [];
		if (s.showSegKey !== false) inner.push('<div class="prow-key">' + esc(shortKey(keyRaw)) + '</div>');
		if (s.showPali && tp) inner.push('<div class="prow-pali">' + tag(headers.pali) + esc(tp) + '</div>');
		if (s.showEng && te) inner.push('<div class="prow-eng">' + tag(headers.eng) + esc(te) + '</div>');
		if (s.showVie && tv) inner.push('<div class="prow-vie">' + tag(headers.vie) + esc(tv) + '</div>');
		if (!isSubtitle) {
			var cP = cmtOnPli ? resolveCommentLang(r.commentPli) : '';
			var cE = cmtOnEng ? resolveCommentLang(r.commentEn) : '';
			var cV = cmtOnVie ? resolveCommentLang(r.commentVie) : '';
			if (cP) inner.push('<div class="prow-cmt prow-cmt-pli">' + tag(cmtHeaders.pali) + esc(cP) + '</div>');
			if (cE) inner.push('<div class="prow-cmt prow-cmt-eng">' + tag(cmtHeaders.eng) + esc(cE) + '</div>');
			if (cV) inner.push('<div class="prow-cmt prow-cmt-vie">' + tag(cmtHeaders.vie) + esc(cV) + '</div>');
			if (r._merged && Array.isArray(r._mergedComments)) {
				for (var mi = 0; mi < r._mergedComments.length; mi++) {
					var mc = r._mergedComments[mi];
					var mcText = mc && typeof mc.text === 'string' ? mc.text.trim() : '';
					if (!mcText) continue;
					var mcLang = mc && mc.lang;
					var inclMc = (mcLang === 'pali' && cmtOnPli) || (mcLang === 'eng' && cmtOnEng) || (mcLang === 'vie' && cmtOnVie) || (!mcLang && (cmtOnPli || cmtOnEng || cmtOnVie));
					if (!inclMc) continue;
					var mcCls = mcLang === 'pali' ? 'prow-cmt prow-cmt-pli' : mcLang === 'eng' ? 'prow-cmt prow-cmt-eng' : mcLang === 'vie' ? 'prow-cmt prow-cmt-vie' : 'prow-cmt';
					var mcHdr = mcLang === 'pali' ? cmtHeaders.pali : mcLang === 'eng' ? cmtHeaders.eng : mcLang === 'vie' ? cmtHeaders.vie : cmtHeaders.vie;
					inner.push('<div class="' + mcCls + '">' + tag(mcHdr) + esc(mcText) + '</div>');
				}
			}
		}
		if (!inner.length) return '';
		return '<div class="' + cls + '">' + inner.join('') + '</div>';
	}
	var bodyRows = [], srcRows = [];
	merged.rows.forEach(function (r) { if (/:source$/i.test(String(r.key || ''))) srcRows.push(r); else bodyRows.push(r); });
	var rowsHtml = bodyRows.map(rowHtml).join('') + srcRows.map(rowHtml).join('');
	var docTitle = esc((meta.code ? meta.code + ' · ' : '') + title);
	var footerText = s.uiLang === 'en'
		? 'Sutta Archive · Pāli & English: SuttaCentral / Bilara · ID: ' + esc(id)
		: 'Sutta Archive · Pāli & Anh: SuttaCentral / Bilara · Mã bài: ' + esc(id);
	return '<!DOCTYPE html><html lang="' + s.uiLang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + docTitle + '</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Cambria,"Noto Serif",Georgia,"Times New Roman",serif;color:#111;line-height:1.55;font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{width:100%;border-collapse:collapse}.sheet>thead>tr>td,.sheet>tbody>tr>td,.sheet>tfoot>tr>td{padding:0 22mm;vertical-align:top}.pad-top{height:20mm}.pad-bot{height:22mm}.phdr{text-align:center;border-bottom:1px solid #999;padding-bottom:12px;margin-bottom:18px}.phdr .supertitle{font-size:9pt;color:#666;letter-spacing:1.5px;text-transform:uppercase;font-family:Consolas,"Courier New",monospace}.phdr h1{font-size:20pt;margin:6px 0 4px;font-weight:500;letter-spacing:-0.3px}.phdr .subtitle{font-size:11pt;color:#444;font-style:italic}.phdr .meta{font-size:9.5pt;color:#777;margin-top:4px}.prow{margin:0 0 10px;page-break-inside:avoid;break-inside:avoid}.prow-key{font-family:Consolas,"Courier New",monospace;font-size:7.5pt;color:#999;margin-bottom:2px;letter-spacing:0.3px}.prow-pali{font-style:italic;color:#333;margin-bottom:2px}.prow-eng{color:#222;margin-bottom:2px}.prow-vie{color:#111}.lang-tag{display:inline-block;font-family:Consolas,"Courier New",monospace;font-size:7pt;text-transform:uppercase;color:#aaa;margin-right:6px;letter-spacing:0.5px;vertical-align:1px}.prow-subtitle{text-align:center;font-size:12pt;margin-bottom:14px}.prow-subtitle .prow-key,.prow-subtitle .lang-tag{display:none}.prow-cmt{font-size:9.5pt;color:#555;margin:2px 0 2px 12px;padding-left:6px;border-left:2px solid #ddd}.prow-cmt-pli{font-style:italic}.prow-source{font-size:9pt;color:#888;margin-top:18px;padding-top:10px;border-top:1px dashed #ccc}.pftr{margin-top:22px;padding-top:10px;border-top:1px solid #ddd;font-size:8pt;color:#888;text-align:center}@media print{.prow{margin-bottom:9px}}</style></head><body><table class="sheet"><thead><tr><td><div class="pad-top"></div></td></tr></thead><tbody><tr><td><header class="phdr">' +
		(supertitle ? '<div class="supertitle">' + esc(supertitle) + '</div>' : '') +
		'<h1>' + esc(title) + '</h1>' +
		(subtitle && subtitle !== '—' ? '<div class="subtitle">' + esc(subtitle) + '</div>' : '') +
		(titleMeta ? '<div class="meta">' + esc(titleMeta) + '</div>' : '') +
		'</header><main>' + rowsHtml + '</main><footer class="pftr">' + footerText + '</footer></td></tr></tbody><tfoot><tr><td><div class="pad-bot"></div></td></tr></tfoot></table></body></html>';
};
})();
