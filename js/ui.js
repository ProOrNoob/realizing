(function () {
'use strict';
var SA = window.SA;
var $ = SA.$;
var storage = SA.storage;
var escapeHtml = SA.escapeHtml;
var escapeAttr = SA.escapeAttr;
var safeDomId = SA.safeDomId;
var debounce = SA.debounce;
var safeCssEscape = SA.safeCssEscape;
var s = SA.state;
var d = SA.dom;

var FLAG_VI = '<span class="lang-letters">VN</span>';
var FLAG_EN = '<span class="lang-letters">EN</span>';

function renderUiLangFlag() {
	if (!d.btnUiLang) return;
	d.btnUiLang.innerHTML = s.uiLang === 'en' ? FLAG_EN : FLAG_VI;
	d.btnUiLang.setAttribute('aria-label', s.uiLang === 'en'
		? 'Interface: English — click to switch to Vietnamese'
		: 'Giao diện: Tiếng Việt — bấm để chuyển sang English');
}
function applyUiLanguageToSearchUi() {
	if (!d.searchInput) return;
	d.searchInput.placeholder = s.uiLang === 'en' ? 'Search sutta...' : 'Tìm bài kinh...';
}
function applyUiLanguageToSettingsPanel() {
	var isEn = s.uiLang === 'en';
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
	if (d.btnLayout) d.btnLayout.innerHTML = isEn
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
	if (d.btnGuide)     d.btnGuide.setAttribute('aria-label',     isEn ? 'User guide'       : 'Hướng dẫn sử dụng');
	if (d.btnSutraMenu) d.btnSutraMenu.setAttribute('aria-label', isEn ? 'Sutta Index'      : 'Danh mục bài kinh');
	if (d.btnSettings)  d.btnSettings.setAttribute('aria-label',  isEn ? 'Display settings'  : 'Cài đặt hiển thị');
	if (d.btnBackTop)   d.btnBackTop.setAttribute('aria-label',   isEn ? 'Back to top'       : 'Lên đầu trang');
	if (d.btnPauseTts)  d.btnPauseTts.setAttribute('aria-label',
		isEn ? 'Pause (current sentence will restart)' : 'Tạm dừng (câu hiện tại sẽ đọc lại từ đầu)');
	var sideLabel = document.querySelector('#sidebar-btn .sidebar-label');
	if (sideLabel) sideLabel.textContent = isEn ? 'Library' : 'Thư viện';
	setText('btnSettingsLabel', isEn ? 'Settings' : 'Cài đặt');
	setText('btnGuideLabel',    isEn ? 'Guide'    : 'Hướng dẫn');
}

function renderGuideDialog() {
	if (!d.guideOverlay) return;
	var dlg = d.guideOverlay.querySelector('.guide-dialog');
	if (!dlg) return;
	var isEn = s.uiLang === 'en';
	var viHtml =
	'<h2>Hướng dẫn sử dụng</h2>' +
	'<h3>📖 Thư viện bài kinh</h3><ul><li>Bấm <strong>Thư viện</strong> ở giữa footer để mở danh sách kinh. Hoặc nhập vào <strong>Tìm kiếm</strong> để tìm bài kinh.</li></ul>' +
	'<h3>⭐ Đánh dấu (Bookmark)</h3><ul><li>Bấm <strong>☆</strong> cạnh tiêu đề bài đang đọc (góc trên-trái) để lưu / bỏ lưu bài kinh yêu thích.</li><li>Tile <strong>★ Đã lưu</strong> hiện số bài yêu thích đã lưu.</li></ul>' +
	'<h3>📜 Đọc kinh</h3><ul><li>Nút <strong>‹ TRƯỚC / SAU ›</strong>: dùng chuyển bài kinh.</li><li><strong>⬆</strong>: về đầu bài kinh.</li><li>Thanh tiến độ đọc dọc bên trái + badge <code>%</code> góc dưới-phải: cho biết đã đọc tới đâu. Tắt/bật trong Cài đặt (nút <code>▮ %</code>).</li></ul>' +
	'<h3>🔗 Chia sẻ & Sao chép</h3><ul><li><strong>🔗 Share đầu bài</strong> (góc trên-phải): chia sẻ link bài kinh.</li><li><strong>🔗 Share đoạn</strong> (icon nhỏ cạnh mã đoạn): chia sẻ link đến đúng đoạn đó.</li><li><strong>📋 Copy</strong> cạnh label <code>PĀLI</code> / <code>ENGLISH</code> / <code>VIỆT</code>: sao chép văn bản của cột đó cho đoạn hiện tại.</li></ul>' +
	'<h3>⚙ Cài đặt</h3><ul><li><strong>Giao diện</strong>: <strong>🌙/☀</strong> tối/sáng · <strong>VN/EN</strong> ngôn ngữ giao diện · <strong>🖨</strong> in / lưu PDF bài kinh hiện tại. Lưu ý: bài kinh dài (hàng ngàn đoạn) có thể mất vài giây đến vài chục giây để chuẩn bị — vui lòng đợi.</li><li><strong>Ngôn ngữ</strong>: bật/tắt cột <code>PĀLI</code> · <code>ENGLISH</code> · <code>VIỆT</code>.</li><li><strong>Bố cục</strong>: <code>☰ Xếp dọc</code> — stack 3 cột · <code># Segment</code> — ẩn/hiện mã đoạn · <code>▦ Label</code> — ẩn/hiện nhãn cột.</li><li><strong>Cỡ chữ</strong>: slider 80–160% (chỉ áp cho nội dung). <strong>Giãn dòng</strong>: 1.3–2.6.</li><li><strong>↺ A</strong> / <strong>↺ ☰</strong>: reset cỡ chữ / giãn dòng về mặc định.</li><li><strong>▮ %</strong>: bật/tắt thanh tiến độ đọc (dọc bên trái + badge phần trăm).</li><li><strong>🐞</strong>: debug.</li></ul>' +
	'<h3>🔊 Đọc to (TTS)</h3><ul><li><strong>▶ Play</strong>: đọc kinh theo ngôn ngữ giao diện (Việt hoặc Anh). Pāli chưa hỗ trợ.</li><li><strong>⏸ Pause</strong>: giới hạn trình duyệt — khi tiếp tục sẽ đọc lại câu hiện tại từ đầu.</li><li><strong>⏹ Stop</strong>: dừng hẳn, lần sau Play đọc từ đầu bài.</li><li><em>*Một số thiết bị không hỗ trợ sẽ không đọc được.</em></li></ul>' +
	'<h3>ℹ Nguồn</h3><p>Văn bản Pāli + bản dịch tiếng Anh Bhikkhu Sujato từ <a href="https://suttacentral.net/" target="_blank" rel="noopener">SuttaCentral</a> (dự án Bilara). Bản dịch tiếng Việt biên tập từ nhiều nguồn, có thể còn sai sót — vui lòng đối chiếu bản Pāli và tiếng Anh.</p><p>Góp ý, báo lỗi: <a href="mailto:tuanctvn199@gmail.com">tuanctvn199@gmail.com</a></p><p><a href="about.html" target="_blank" rel="noopener">Giới thiệu &amp; Điều khoản</a></p><button id="btnCloseGuide" type="button">Đóng</button>';
	var enHtml =
	'<h2>User Guide</h2>' +
	'<h3>📖 Sutta Library</h3><ul><li>Tap <strong>Library</strong> in the footer center to open the sutta list. Or use <strong>Search</strong> to find a sutta.</li></ul>' +
	'<h3>⭐ Bookmarks</h3><ul><li>Tap <strong>☆</strong> next to the current sutta title (top-left) to save / unsave a favorite sutta.</li><li>The <strong>★ Saved</strong> tile shows the count of saved suttas.</li></ul>' +
	'<h3>📜 Reading</h3><ul><li><strong>‹ PREV / NEXT ›</strong> buttons: navigate between suttas.</li><li><strong>⬆</strong>: jump to the top of the sutta.</li><li>Reading progress bar (left edge) + <code>%</code> badge (bottom-right): shows how far you have read. Toggle in Settings (<code>▮ %</code>).</li></ul>' +
	'<h3>🔗 Share & Copy</h3><ul><li><strong>🔗 Title share</strong> (top-right): share link to the sutta.</li><li><strong>🔗 Segment share</strong> (small icon next to segment ID): share link to that exact segment.</li><li><strong>📋 Copy</strong> next to <code>PĀLI</code> / <code>ENGLISH</code> / <code>VIỆT</code> labels: copy the text of that column for the current segment.</li></ul>' +
	'<h3>⚙ Settings</h3><ul><li><strong>Interface</strong>: <strong>🌙/☀</strong> dark/light · <strong>VN/EN</strong> interface language · <strong>🖨</strong> print / save current sutta to PDF. Note: long suttas (thousands of segments) may take a few seconds to tens of seconds to prepare — please wait.</li><li><strong>Languages</strong>: toggle <code>PĀLI</code> · <code>ENGLISH</code> · <code>VIỆT</code> columns.</li><li><strong>Layout</strong>: <code>☰ Stack</code> — stack 3 columns · <code># Segment</code> — show/hide segment IDs · <code>▦ Label</code> — show/hide column headers.</li><li><strong>Font size</strong>: slider 80–160% (body text only). <strong>Line height</strong>: 1.3–2.6.</li><li><strong>↺ A</strong> / <strong>↺ ☰</strong>: reset font size / line height.</li><li><strong>▮ %</strong>: toggle reading progress bar.</li><li><strong>🐞</strong>: debug.</li></ul>' +
	'<h3>🔊 Text-to-Speech (TTS)</h3><ul><li><strong>▶ Play</strong>: reads in UI language (VI or EN). Pāli not supported.</li><li><strong>⏸ Pause</strong>: browser limitation — resume restarts the current sentence.</li><li><strong>⏹ Stop</strong>: stops entirely; next Play starts from the beginning.</li><li><em>*Some devices may not support TTS and won\'t read.</em></li></ul>' +
	'<h3>ℹ Sources</h3><p>Pāli text and Bhikkhu Sujato English translations from <a href="https://suttacentral.net/" target="_blank" rel="noopener">SuttaCentral</a> (Bilara project). Vietnamese translations compiled from multiple sources — please cross-reference with Pāli and English originals.</p><p>Feedback / bug reports: <a href="mailto:tuanctvn199@gmail.com">tuanctvn199@gmail.com</a></p><p><a href="about.html" target="_blank" rel="noopener">About &amp; Terms</a></p><button id="btnCloseGuide" type="button">Close</button>';
	dlg.innerHTML = isEn ? enHtml : viHtml;
	var btnClose = $('btnCloseGuide');
	if (btnClose) btnClose.onclick = closeGuide;
}

function openGuide() {
	if (!d.guideOverlay) return;
	renderGuideDialog();
	d.guideOverlay.classList.add('show');
	d.guideOverlay.setAttribute('aria-hidden', 'false');
	var dialog = d.guideOverlay.querySelector('.guide-dialog');
	if (dialog) dialog.scrollTop = 0;
	setTimeout(function () { var b = $('btnCloseGuide'); if (b) b.focus({ preventScroll: true }); }, 50);
}
function closeGuide() {
	if (!d.guideOverlay) return;
	d.guideOverlay.classList.remove('show');
	d.guideOverlay.setAttribute('aria-hidden', 'true');
	if (d.btnGuide) d.btnGuide.focus();
}

var resizeObserver = new ResizeObserver(function (entries) {
	for (var i = 0; i < entries.length; i++) {
		requestAnimationFrame(function () {
			if (d.sutraMenuPanel) {
				d.sutraMenuPanel.style.top = entries[0].contentRect.height + 'px';
			}
		});
	}
});

function updateMenuPanelTop() {
	if (!d.card) return;
	var topNote = d.card.querySelector('.top-note');
	if (topNote) {
		resizeObserver.disconnect();
		resizeObserver.observe(topNote);
	} else if (d.sutraMenuPanel) {
		d.sutraMenuPanel.style.top = '0px';
	}
}

function togglePanel(panel, force) {
	if (!panel) return;
	var isOpen = typeof force === 'boolean' ? force : !panel.classList.contains('open');
	if (!isOpen && panel.contains(document.activeElement)) {
		try {
			var triggerBtn = (panel === d.settingsPanel) ? d.btnSettings
			              : (panel === d.sutraMenuPanel) ? d.btnSutraMenu
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
		if (panel === d.settingsPanel && d.btnSettings) {
			d.btnSettings.setAttribute('aria-expanded', String(isOpen));
			d.btnSettings.classList.toggle('active', isOpen);
			if (!isOpen) _clearStickyHover(d.btnSettings);
			document.body.classList.toggle('settings-open', isOpen);
		}
		if (panel === d.sutraMenuPanel && d.btnSutraMenu) {
			d.btnSutraMenu.setAttribute('aria-expanded', String(isOpen));
			d.btnSutraMenu.classList.toggle('is-open', isOpen);
			if (!isOpen) _clearStickyHover(d.btnSutraMenu);
		}
	}
}
function _clearStickyHover(btn) {
	if (!btn) return;
	try { btn.blur(); } catch(_){}
	btn.classList.add('no-hover');
	setTimeout(function () { btn.classList.remove('no-hover'); }, 280);
}
function positionSettingsPanel() {
	if (!d.settingsPanel || !d.btnSettings) return;
	var r = d.btnSettings.getBoundingClientRect();
	var footer = document.querySelector('.status');
	var footerH = footer ? footer.offsetHeight : (window.innerHeight - r.top);
	d.settingsPanel.style.left   = r.left + 'px';
	d.settingsPanel.style.bottom = (footerH + 8) + 'px';
	d.settingsPanel.style.top    = 'auto';
	d.settingsPanel.style.right  = 'auto';
}
function closePanels() {
	togglePanel(d.settingsPanel, false);
	togglePanel(d.sutraMenuPanel, false);
}

SA.togglePanel = togglePanel;
SA.closePanels = closePanels;
SA.openGuide = openGuide;
SA.closeGuide = closeGuide;
SA.renderUiLangFlag = renderUiLangFlag;
SA.applyUiLanguageToSearchUi = applyUiLanguageToSearchUi;
SA.applyUiLanguageToSettingsPanel = applyUiLanguageToSettingsPanel;
SA.renderGuideDialog = renderGuideDialog;
SA.updateMenuPanelTop = updateMenuPanelTop;
SA.positionSettingsPanel = positionSettingsPanel;

// Wire up panel buttons
if (d.btnSutraMenu) {
	d.btnSutraMenu.onclick = function (e) {
		e.stopPropagation();
		var willOpen = !d.sutraMenuPanel.classList.contains('open');
		togglePanel(d.settingsPanel, false);
		togglePanel(d.sutraMenuPanel, willOpen);
		if (willOpen && d.sutraMenuList && d.sutraMenuList.children.length === 0) {
			var nikKey = s.activeNikayaKey || (window.SUTRA_INDEX && window.SUTRA_INDEX[0] && window.SUTRA_INDEX[0].key);
			if (nikKey) {
				if (!window.SUTRA_INDEX || !window.SUTRA_INDEX.length) return;
				if (!s.FLAT_SUTTAS.length) SA.buildSutraMenuFromIndex();
				else SA.setActiveNikaya(nikKey, false);
			}
		}
	};
}
var menuCloseBtn = $('menuCloseBtn');
if (menuCloseBtn) {
	menuCloseBtn.onclick = function (e) {
		e.stopPropagation();
		togglePanel(d.sutraMenuPanel, false);
	};
}
if (d.btnSettings) {
	d.btnSettings.onclick = function (e) {
		e.stopPropagation();
		var willOpen = !d.settingsPanel.classList.contains('open');
		if (willOpen) {
			togglePanel(d.sutraMenuPanel, false);
			positionSettingsPanel();
		}
		togglePanel(d.settingsPanel, willOpen);
		SA._blurIfMouse(d.btnSettings);
	};
}
var btnSettingsClose = $('btnSettingsClose');
if (btnSettingsClose) {
	btnSettingsClose.onclick = function (e) {
		e.stopPropagation();
		togglePanel(d.settingsPanel, false);
	};
}
if (d.btnGuide && d.guideOverlay) {
	d.btnGuide.onclick = function (e) {
		e.stopPropagation();
		openGuide();
	};
}
var dedTextEl = $('dedicationText');
if (dedTextEl) {
	dedTextEl.classList.add('ded-clickable');
	dedTextEl.setAttribute('title', s.uiLang === 'en' ? 'Double-click to return to home' : 'Nháy đôi để về trang chủ');
	dedTextEl.addEventListener('dblclick', function (e) {
		e.preventDefault();
		try { storage.remove(SA.KEY_LAST); } catch(_) {}
		location.replace(location.pathname + location.search);
	});
}
if (d.guideOverlay) {
	d.guideOverlay.addEventListener('click', function (e) {
		if (e.target === d.guideOverlay) closeGuide();
	});
}
document.addEventListener('click', function (e) {
	var t = e.target;
	if (d.sutraMenuPanel && d.sutraMenuPanel.contains(t)) return;
	if (d.settingsPanel && d.settingsPanel.contains(t)) return;
	if (d.btnSutraMenu && d.btnSutraMenu.contains(t)) return;
	if (d.guideOverlay && d.guideOverlay.contains(t)) return;
	closePanels();
});
document.addEventListener('keydown', function (e) {
	if (e.key === 'Escape') {
		if (d.guideOverlay && d.guideOverlay.classList.contains('show')) return closeGuide();
		closePanels();
	}
});

function applySegKeyHdrVis() {
	if (!d.grid) return;
	d.grid.classList.toggle('hide-seg-key', !s.showSegKey);
	d.grid.classList.toggle('hide-col-header', !s.showColHdr);
	d.grid.classList.toggle('hide-cmt-pli', !s.showCmtPli);
	d.grid.classList.toggle('hide-cmt-eng', !s.showCmtEng);
	d.grid.classList.toggle('hide-cmt-vie', !s.showCmtVie);
	d.grid.classList.toggle('hl-pli', !!s.hlPli);
	d.grid.classList.toggle('hl-eng', !!s.hlEng);
	d.grid.classList.toggle('hl-vie', !!s.hlVie);
	if (d.card) d.card.classList.toggle('grid-3cols', !!s.show3Cols);
}
SA.applySegKeyHdrVis = applySegKeyHdrVis;

var mql = window.matchMedia('(max-width: 500px)');
function updateVisibleCols() {
	var isNarrow = mql.matches;
	var isStack = d.card ? d.card.classList.contains('stack') : false;
	var count = (s.showPali ? 1 : 0) + (s.showEng ? 1 : 0) + (s.showVie ? 1 : 0);
	count = Math.max(1, count);
	requestAnimationFrame(function () {
		document.documentElement.style.setProperty('--visible-cols', isNarrow || isStack ? '1' : String(count));
	});
}
mql.addEventListener('change', updateVisibleCols);
SA.updateVisibleCols = updateVisibleCols;

function applyVisibility() {
	if (!d.grid) return;
	d.grid.classList.toggle('hide-pali', !s.showPali);
	d.grid.classList.toggle('hide-eng',  !s.showEng);
	d.grid.classList.toggle('hide-vie',  !s.showVie);
	updateVisibleCols();
}
SA.applyVisibility = applyVisibility;

window.addEventListener('resize', function () { updateVisibleCols(); updateMenuPanelTop(); });

var _langDepsBackup = { pli: null, eng: null, vie: null };
function _applyHlBtnUi(lang) {
	var on = lang === 'pli' ? s.hlPli : lang === 'eng' ? s.hlEng : s.hlVie;
	var id = lang === 'pli' ? 'btnHlPli' : lang === 'eng' ? 'btnHlEng' : 'btnHlVie';
	var b = $(id);
	if (b) { b.classList.toggle('active', !!on); b.setAttribute('aria-pressed', String(!!on)); }
}
function syncCmtButtons() {
	var pairs = [['btnCmtPli', s.showCmtPli], ['btnCmtEng', s.showCmtEng], ['btnCmtVie', s.showCmtVie]];
	for (var i = 0; i < pairs.length; i++) {
		var b = $(pairs[i][0]); if (!b) continue;
		b.classList.toggle('active', pairs[i][1]);
		b.setAttribute('aria-pressed', String(pairs[i][1]));
	}
	var m = $('btnCmtMaster');
	if (m) {
		var any = s.showCmtPli || s.showCmtEng || s.showCmtVie;
		m.classList.toggle('active', any);
		m.setAttribute('aria-pressed', String(any));
	}
}
SA.syncCmtButtons = syncCmtButtons;

function _syncDepsOnLangHide(lang) {
	if (lang === 'pli') { _langDepsBackup.pli = { hl: s.hlPli, cmt: s.showCmtPli }; s.hlPli = false; s.showCmtPli = false; }
	else if (lang === 'eng') { _langDepsBackup.eng = { hl: s.hlEng, cmt: s.showCmtEng }; s.hlEng = false; s.showCmtEng = false; }
	else if (lang === 'vie') { _langDepsBackup.vie = { hl: s.hlVie, cmt: s.showCmtVie }; s.hlVie = false; s.showCmtVie = false; }
	_applyHlBtnUi(lang); syncCmtButtons(); applySegKeyHdrVis();
}
function _syncDepsOnLangShow(lang) {
	var bak = _langDepsBackup[lang];
	if (!bak) return;
	if (lang === 'pli')      { s.hlPli = !!bak.hl; s.showCmtPli = !!bak.cmt; }
	else if (lang === 'eng') { s.hlEng = !!bak.hl; s.showCmtEng = !!bak.cmt; }
	else if (lang === 'vie') { s.hlVie = !!bak.hl; s.showCmtVie = !!bak.cmt; }
	_langDepsBackup[lang] = null;
	_applyHlBtnUi(lang); syncCmtButtons(); applySegKeyHdrVis();
}

function preserveTopAndSave(action) {
	var topKey = SA.computeTopVisibleKey();
	if (SA._saveAnchorDebounced && SA._saveAnchorDebounced.cancel) SA._saveAnchorDebounced.cancel();
	if (topKey && s.currentSutraId) {
		s._progScrollUntil = Date.now() + 1500;
		s.firstVisibleKey = topKey;
		SA.anchorSet(SA.KEY_ANCHOR_K(s.currentSutraId), topKey);
	}
	action();
	if (!topKey || !s.currentSutraId) return;
	requestAnimationFrame(function () {
		var scrollRoot = SA.getScrollRoot();
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
			s._progScrollUntil = Date.now() + 1500;
			scrollRoot.scrollTop = targetY;
		}
		if (SA._saveAnchorDebounced && SA._saveAnchorDebounced.cancel) SA._saveAnchorDebounced.cancel();
	});
}
SA.preserveTopAndSave = preserveTopAndSave;

if (d.btnPali) d.btnPali.onclick = function () {
	if (s.showPali && (s.showEng || s.showVie)) {}
	else if (!s.showPali) {}
	else return;
	preserveTopAndSave(function () {
		s.showPali = !s.showPali;
		d.btnPali.classList.toggle('active', s.showPali);
		d.btnPali.setAttribute('aria-pressed', String(s.showPali));
		if (!s.showPali) _syncDepsOnLangHide('pli'); else _syncDepsOnLangShow('pli');
		applyVisibility(); SA.saveViewPrefs(); SA.maybeRerenderIfModeChanged();
	});
};
if (d.btnEng) d.btnEng.onclick = function () {
	if (s.showEng && (s.showPali || s.showVie)) {}
	else if (!s.showEng) {}
	else return;
	preserveTopAndSave(function () {
		s.showEng = !s.showEng;
		d.btnEng.classList.toggle('active', s.showEng);
		d.btnEng.setAttribute('aria-pressed', String(s.showEng));
		if (!s.showEng) _syncDepsOnLangHide('eng'); else _syncDepsOnLangShow('eng');
		applyVisibility(); SA.saveViewPrefs(); SA.maybeRerenderIfModeChanged();
	});
};
if (d.btnVie) d.btnVie.onclick = function () {
	if (s.showVie && (s.showPali || s.showEng)) {}
	else if (!s.showVie) {}
	else return;
	preserveTopAndSave(function () {
		s.showVie = !s.showVie;
		d.btnVie.classList.toggle('active', s.showVie);
		d.btnVie.setAttribute('aria-pressed', String(s.showVie));
		if (!s.showVie) _syncDepsOnLangHide('vie'); else _syncDepsOnLangShow('vie');
		applyVisibility(); SA.saveViewPrefs(); SA.maybeRerenderIfModeChanged();
	});
};
if (d.btnLayout) d.btnLayout.onclick = function () {
	preserveTopAndSave(function () {
		if (d.card) d.card.classList.toggle('stack');
		var isStack = d.card ? d.card.classList.contains('stack') : false;
		d.btnLayout.classList.toggle('active', isStack);
		d.btnLayout.setAttribute('aria-pressed', String(isStack));
		if (isStack && s.show3Cols) {
			s.show3Cols = false;
			if (d.card) d.card.classList.remove('grid-3cols');
			var _b3c = $('btn3Cols');
			if (_b3c) { _b3c.classList.remove('active'); _b3c.setAttribute('aria-pressed', 'false'); }
		}
		updateVisibleCols(); SA.saveViewPrefs();
	});
};
var btnSegKey = $('btnSegKey');
if (btnSegKey) btnSegKey.onclick = function () {
	preserveTopAndSave(function () {
		s.showSegKey = !s.showSegKey;
		btnSegKey.classList.toggle('active', s.showSegKey);
		btnSegKey.setAttribute('aria-pressed', String(s.showSegKey));
		applySegKeyHdrVis(); SA.saveViewPrefs();
	});
};
var btnSegHdr = $('btnSegHdr');
if (btnSegHdr) btnSegHdr.onclick = function () {
	preserveTopAndSave(function () {
		s.showColHdr = !s.showColHdr;
		btnSegHdr.classList.toggle('active', s.showColHdr);
		btnSegHdr.setAttribute('aria-pressed', String(s.showColHdr));
		applySegKeyHdrVis(); SA.saveViewPrefs();
	});
};
function wireLangCmt(btnId, setter) {
	var btn = $(btnId); if (!btn) return;
	btn.onclick = function () {
		preserveTopAndSave(function () { setter(); syncCmtButtons(); applySegKeyHdrVis(); SA.saveViewPrefs(); });
	};
}
wireLangCmt('btnCmtPli', function(){ s.showCmtPli = !s.showCmtPli; });
wireLangCmt('btnCmtEng', function(){ s.showCmtEng = !s.showCmtEng; });
wireLangCmt('btnCmtVie', function(){ s.showCmtVie = !s.showCmtVie; });
var btnCmtMaster = $('btnCmtMaster');
if (btnCmtMaster) btnCmtMaster.onclick = function () {
	preserveTopAndSave(function () {
		var target = !(s.showCmtPli || s.showCmtEng || s.showCmtVie);
		s.showCmtPli = target; s.showCmtEng = target; s.showCmtVie = target;
		syncCmtButtons(); applySegKeyHdrVis(); SA.saveViewPrefs();
	});
};
function wireHlToggle(btnId, setter) {
	var btn = $(btnId); if (!btn) return;
	btn.onclick = function () {
		preserveTopAndSave(function () {
			setter(); applySegKeyHdrVis();
			var active = (btnId === 'btnHlPli') ? s.hlPli : (btnId === 'btnHlEng') ? s.hlEng : s.hlVie;
			btn.classList.toggle('active', active);
			btn.setAttribute('aria-pressed', String(active));
			SA.saveViewPrefs();
		});
	};
}
wireHlToggle('btnHlPli', function(){ s.hlPli = !s.hlPli; });
wireHlToggle('btnHlEng', function(){ s.hlEng = !s.hlEng; });
wireHlToggle('btnHlVie', function(){ s.hlVie = !s.hlVie; });
var btn3Cols = $('btn3Cols');
if (btn3Cols) btn3Cols.onclick = function () {
	preserveTopAndSave(function () {
		s.show3Cols = !s.show3Cols;
		btn3Cols.classList.toggle('active', s.show3Cols);
		btn3Cols.setAttribute('aria-pressed', String(s.show3Cols));
		if (d.card) d.card.classList.toggle('grid-3cols', s.show3Cols);
		if (s.show3Cols && d.card && d.card.classList.contains('stack')) {
			d.card.classList.remove('stack');
			if (d.btnLayout) { d.btnLayout.classList.remove('active'); d.btnLayout.setAttribute('aria-pressed', 'false'); }
		}
		updateVisibleCols(); SA.saveViewPrefs();
	});
};

function applyWideLayout(on) {
	s.isWide = !!on;
	document.documentElement.classList.toggle('layout-wide', s.isWide);
	if (d.btnFullWidth) {
		d.btnFullWidth.classList.toggle('active', s.isWide);
		d.btnFullWidth.setAttribute('aria-pressed', String(s.isWide));
	}
}
if (d.btnFullWidth) {
	applyWideLayout(s.isWide);
	d.btnFullWidth.addEventListener('click', function () {
		applyWideLayout(!s.isWide);
		storage.set(SA.WIDE_STORAGE_KEY, s.isWide ? '1' : '0');
	});
}

// Zoom
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
	var sv = storage.get(ZOOM_STORAGE_KEY);
	if (sv) { var v = parseFloat(sv); if (!Number.isNaN(v)) zoomLevel = clampZoom(v); }
	applyZoom();
}
function loadLineHeight() {
	var sv = storage.get(LH_STORAGE_KEY);
	if (sv) { var v = parseFloat(sv); if (!Number.isNaN(v)) lineHeightLevel = clampLh(v); }
	applyLineHeight();
}
function saveZoom()       { storage.set(ZOOM_STORAGE_KEY, String(zoomLevel)); }
function saveLineHeight() { storage.set(LH_STORAGE_KEY, String(lineHeightLevel)); }
SA.loadZoom = loadZoom;
SA.loadLineHeight = loadLineHeight;

if (sliderZoom) sliderZoom.addEventListener('input', function () {
	zoomLevel = clampZoom(parseInt(sliderZoom.value, 10) / 100); applyZoom(); saveZoom();
});
if (sliderLineHeight) sliderLineHeight.addEventListener('input', function () {
	lineHeightLevel = clampLh(parseInt(sliderLineHeight.value, 10) / 100); applyLineHeight(); saveLineHeight();
});
if (btnZoomReset) btnZoomReset.onclick = function () { zoomLevel = 1; applyZoom(); saveZoom(); };
if (btnLhReset)   btnLhReset.onclick   = function () { lineHeightLevel = 1.85; applyLineHeight(); saveLineHeight(); };

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
	var isOn = saved !== '0';
	apply(isOn);
	btn.addEventListener('click', function () {
		isOn = !isOn;
		apply(isOn);
		try { storage.set(KEY, isOn ? '1' : '0'); } catch(_){}
		if (isOn) try { SA.updateReadingProgress(); } catch(_){}
	});
})();
})();
