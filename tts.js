/* Sutta Archive — TTS module (lazy-loaded)
   Exposes window.TTSModule.init(deps) -> { start, pause, stop, reset }
   Called on first user interaction with read/pause/stop buttons. */
(function () {
'use strict';
var synthSupported = 'speechSynthesis' in window;
var synth = synthSupported ? window.speechSynthesis : null;
var cachedVoices = [];
var voicesListenerBound = false;

function bindVoicesListener() {
if (voicesListenerBound || !synth) return;
voicesListenerBound = true;
try { cachedVoices = synth.getVoices() || []; } catch (e) {}
synth.addEventListener('voiceschanged', function () {
try { cachedVoices = synth.getVoices() || []; } catch (e) {}
});
}

function ensureVoicesLoaded(timeout) {
timeout = timeout || 1200;
return new Promise(function (resolve) {
if (!synth) return resolve([]);
try {
var v = synth.getVoices();
if (v && v.length) { cachedVoices = v; return resolve(v); }
} catch (e) {}
var onChange = function () {
try {
var v2 = synth.getVoices();
if (v2 && v2.length) {
synth.removeEventListener('voiceschanged', onChange);
cachedVoices = v2; resolve(v2);
}
} catch (e) {}
};
synth.addEventListener('voiceschanged', onChange);
setTimeout(function () {
try { synth.removeEventListener('voiceschanged', onChange); } catch (e) {}
try { cachedVoices = synth.getVoices() || []; } catch (e) {}
resolve(cachedVoices);
}, timeout);
});
}

function pickVoice(langPrefix) {
var lp = (langPrefix || '').toLowerCase();
var list = cachedVoices.filter(function (v) { return v.lang && v.lang.toLowerCase().startsWith(lp); });
return list.find(function (v) { return /google|microsoft/i.test(v.name || ''); }) || list[0] || null;
}

window.TTSModule = {
supported: synthSupported,
init: function (deps) {
bindVoicesListener();
var ttsState = { activeLang: null, index: 0, isPlaying: false, isPaused: false, currentUtter: null };

function saveTtsState() {
var id = deps.getCurrentSutraId();
if (!id || !ttsState.activeLang) return;
deps.storage.set('tts_state_' + id,
JSON.stringify({ lang: ttsState.activeLang, index: ttsState.index }));
}

function reset(clearHighlight, clearStorage) {
if (synthSupported && synth) { try { synth.cancel(); } catch (e) {} }
ttsState.isPlaying = ttsState.isPaused = false;
ttsState.currentUtter = null; ttsState.index = 0; ttsState.activeLang = null;
if (clearHighlight) deps.clearRowHighlight();
var id = deps.getCurrentSutraId();
if (clearStorage && id) deps.storage.remove('tts_state_' + id);
deps.setTtsUiState('idle');
}

function speakNextRow() {
if (!synthSupported || !synth || !ttsState.activeLang) return;
var rows = deps.getVirtAllRows();
if (ttsState.index >= rows.length) return reset(true, true);
var rowData = rows[ttsState.index];
var raw = ttsState.activeLang === 'vi' ? (rowData && rowData.vie) : (rowData && rowData.eng);
var text = (raw || '').trim();
if (!text) { ttsState.index++; return speakNextRow(); }
deps.highlightRowAt(ttsState.index); saveTtsState();
var utter = new SpeechSynthesisUtterance(text);
if (ttsState.activeLang === 'vi') {
utter.lang = 'vi-VN';
var v = pickVoice('vi'); if (v) utter.voice = v;
utter.rate = 0.98; utter.pitch = 0.95;
} else {
utter.lang = 'en-US';
var v2 = pickVoice('en'); if (v2) utter.voice = v2;
}
utter.onend = function () {
ttsState.currentUtter = null;
if (!ttsState.activeLang || ttsState.isPaused || !ttsState.isPlaying) return;
ttsState.index++; speakNextRow();
};
utter.onerror = function (e) {
ttsState.currentUtter = null;
if (e.error === 'canceled' || ttsState.isPaused) return;
reset(true, false);
};
ttsState.currentUtter = utter;
ttsState.isPlaying = true; ttsState.isPaused = false;
deps.setTtsUiState('playing');
try { synth.speak(utter); } catch (e) { reset(true, false); }
}

async function start() {
var uiLang = deps.getUiLang();
if (deps.getIsRendering()) {
alert(uiLang === 'en' ? 'Please wait for the text to finish loading.' : 'Vui lòng chờ tải xong nội dung rồi hãy bấm đọc.');
return;
}
if (!synthSupported) {
alert(uiLang === 'en' ? 'Your browser does not support TTS.' : 'Trình duyệt không hỗ trợ đọc TTS.');
return;
}
var targetLang = uiLang === 'en' ? 'en' : 'vi';
if (ttsState.activeLang === targetLang && ttsState.isPlaying) return;
if (ttsState.activeLang === targetLang && ttsState.isPaused) {
ttsState.isPaused = false; ttsState.isPlaying = true;
deps.setTtsUiState('playing'); speakNextRow(); return;
}
reset(true, false);
ttsState.activeLang = targetLang;
await ensureVoicesLoaded();
var id = deps.getCurrentSutraId();
if (id) {
try {
var raw = deps.storage.get('tts_state_' + id);
if (raw) {
var st = JSON.parse(raw);
if (st && st.lang === targetLang && typeof st.index === 'number') ttsState.index = st.index;
}
} catch (e) {}
}
if (!Number.isInteger(ttsState.index) || ttsState.index < 0) ttsState.index = 0;
speakNextRow();
}

function pause() {
if (!synthSupported || !synth) return;
if (!ttsState.activeLang || !ttsState.isPlaying || !ttsState.currentUtter) return;
ttsState.isPaused = true; ttsState.isPlaying = false;
try { synth.cancel(); } catch (e) {}
ttsState.currentUtter = null;
saveTtsState();
deps.clearRowHighlight();
deps.setTtsUiState('paused');
}

function stop() {
if (!synthSupported || !synth) return;
reset(true, true);
}

return { start: start, pause: pause, stop: stop, reset: reset };
}
};
})();
