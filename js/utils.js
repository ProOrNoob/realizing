(function () {
'use strict';
var SA = window.SA = window.SA || {};

try { if (history.scrollRestoration) history.scrollRestoration = 'manual'; } catch(_) {}

SA.DEBUG = true;
SA.$ = function (id) { return document.getElementById(id); };

SA.escapeHtml = function (str) {
	if (str === undefined || str === null) return '';
	return String(str)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

SA.escapeAttr = function (val) {
	if (val === undefined || val === null) return '';
	return String(val)
		.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
		.replace(/</g, '&lt;').replace(/`/g, '&#96;').replace(/>/g, '&gt;');
};

SA.safeDomId = function (base) { return String(base).replace(/[^a-z0-9_-]/gi, '-'); };

SA.debounce = function (fn, wait) {
	if (wait === undefined) wait = 200;
	var t;
	var debounced = function () {
		var args = arguments;
		clearTimeout(t);
		t = setTimeout(function () { fn.apply(null, args); }, wait);
	};
	debounced.cancel = function () { clearTimeout(t); t = null; };
	return debounced;
};

SA.throttle = function (fn, wait) {
	if (wait === undefined) wait = 120;
	var last = 0;
	return function () {
		var now = Date.now();
		if (now - last >= wait) { last = now; fn.apply(null, arguments); }
	};
};

SA.storage = {
	get: function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
	set: function (key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
	remove: function (key) { try { localStorage.removeItem(key); } catch (e) {} }
};

SA.safeCssEscape = function (str) {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(str);
	}
	return String(str).replace(/([^\w-])/g, '\\$1');
};
})();
