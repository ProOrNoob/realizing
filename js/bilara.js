/* ================================================================
   bilara.js — Module [2/8]
   Tải dữ liệu kinh từ file pack (pli/en/vi), cache LRU 20 bài.
   ─────────────────────────────────────────────────────────────────
   Exports: SA.loadMerged(id), SA.MERGED_CACHE, SA.LOADED_PACKS
   Depends: utils.js
   Data format: sutta/<lang>/<id>.js → ghi vào window.BILARA[id]
   ================================================================ */
(function () {
'use strict';
var SA = window.SA;

var LOADED_PACKS = new Set();
var PACK_PROMISES = new Map();
var PACK_LOAD_TIMEOUT_MS = 15000;

function loadPackIfNeeded(pack) {
	if (!pack) return Promise.resolve();
	if (LOADED_PACKS.has(pack)) return Promise.resolve();
	if (PACK_PROMISES.has(pack)) return PACK_PROMISES.get(pack);
	var p = new Promise(function (res, rej) {
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
			s.onload = function () { if (settled) return; settled = true; LOADED_PACKS.add(pack); cleanup(); res(); };
			s.onerror = function (e) { if (settled) return; settled = true; cleanup(); rej(e || new Error('load fail: ' + pack)); };
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
	? new Intl.Collator('en', { numeric: true }) : null;

function sortBilaraKeys(keys) {
	if (_BILARA_COLLATOR) return keys.sort(_BILARA_COLLATOR.compare);
	return keys.sort(function (x, y) { return x.localeCompare(y, 'en', { numeric: true }); });
}

function getCommentPack(lang, id) {
	if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
	return BILARA_BASE_DIR + '/comment/' + id + '_' + lang;
}

function shouldLoadCommentPack(lang, id) {
	var idx = window.COMMENT_INDEX;
	if (!idx || typeof idx !== 'object') return true;
	var entry = idx[id];
	if (!entry) return false;
	if (Array.isArray(entry)) return entry.indexOf(lang) !== -1;
	return !!entry;
}

SA.loadMerged = async function loadMerged(id) {
	if (!id) return null;
	if (MERGED_CACHE.has(id)) return MERGED_CACHE.get(id);
	if (MERGED_PROMISES.has(id)) return MERGED_PROMISES.get(id);
	var p = (async function () {
		var tasks = [
			loadPackIfNeeded(getBilaraPack('pli', id)),
			loadPackIfNeeded(getBilaraPack('en', id)),
			loadPackIfNeeded(getBilaraPack('vi', id))
		];
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
				key: k, pali: paliMap[k]||'', eng: engMap[k]||'', vie: vieMap[k]||'',
				commentPli: cmtPli[k] || '', commentEn: cmtEn[k] || '',
				commentVie: cmtVi[k] || '', comment: cmtLegacy[k] || ''
			};
		});
		var merged = {
			paliMap: paliMap, engMap: engMap, vieMap: vieMap,
			commentPliMap: cmtPli, commentEnMap: cmtEn, commentVieMap: cmtVi,
			commentMap: cmtLegacy, keys: keys, rows: rows
		};
		MERGED_CACHE.set(id, merged);
		touchCache(id);
		MERGED_PROMISES.delete(id);
		return merged;
	})().catch(function (e) { MERGED_PROMISES.delete(id); throw e; });
	MERGED_PROMISES.set(id, p);
	return p;
};

SA.MERGED_CACHE = MERGED_CACHE;
SA.LOADED_PACKS = LOADED_PACKS;
})();
