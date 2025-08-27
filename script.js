// Zero-cost Q&A bot (no external AI/APIs).
// Modes: culture (文化祭), career (進路), school (学校生活)
// Features: show top-N list, user-selectable count, "recommended from JSON", "more (+5)", auto-scroll to results.

const CHATLOG = document.getElementById('chatlog');
const FORM = document.getElementById('chatForm');
const INPUT = document.getElementById('userInput');
const MODE_BTNS = [...document.querySelectorAll('.mode-btn')];
const RESULT_SELECT = document.getElementById('resultCount');
const RECAREA = document.getElementById('recArea');
const MORE_BTN = document.getElementById('moreBtn');
const RESULTS_ANCHOR = document.getElementById('resultsAnchor');

let MODE = 'culture';
let FAQS = [];                    // loaded from /data/faq_*.json
let RECOMMENDED = {};             // loaded from /data/recommended.json
let RESULT_LIMIT_BASE = 5;        // セレクタで決まる基準値
let RESULT_LIMIT_CURRENT = 5;     // 現在の表示件数（もっと見るで増える）
const PAGE_STEP = 5;              // もっと見るの増加件数
let LAST_QUERY = null, LAST_MATCHES = null;
let stopwords = new Set(['は','が','を','に','の','と','へ','で','も','や','から','まで','より','です','ます','する','した','ある','いる','こと','それ','これ','あれ','ため','よう','ので','など','？','。','、','!','！','？']);

function modeLabel(m) {
  return m === 'culture' ? '文化祭モード' : m === 'career' ? '進路モード' : '学校生活モード';
}

async function loadModeData(m) {
  const map = {
    culture: './data/faq_culture.json',
    career:  './data/faq_career.json',
    school:  './data/faq_school.json'
  };
  try {
    const res = await fetch(map[m], {cache:'no-store'});
    FAQS = await res.json();
  } catch (e) {
    console.error(e);
    FAQS = [];
  }
}

async function loadRecommended() {
  try {
    const res = await fetch('./data/recommended.json', {cache:'no-store'});
    RECOMMENDED = await res.json();
  } catch (e) {
    console.warn('recommended.json が読み込めませんでした（任意ファイル）', e);
    RECOMMENDED = {};
  }
}

function setMode(m) {
  MODE = m;
  MODE_BTNS.forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  // 基準件数に戻す
  RESULT_LIMIT_CURRENT = RESULT_LIMIT_BASE;
  LAST_QUERY = null; LAST_MATCHES = null;
  CHATLOG.innerHTML = '';
  loadModeData(m).then(() => {
    addBot(`「${modeLabel(m)}」のFAQを読み込みました。質問をどうぞ。`);
    renderRecommended(); // モード切替時におすすめを更新
    updateMoreBtnState();
  });
}

function renderRecommended() {
  const recs = (RECOMMENDED && RECOMMENDED[MODE]) ? RECOMMENDED[MODE] : [];
  if (!RECAREA) return;
  if (!recs.length) { RECAREA.innerHTML = ''; return; }
  let html = `<div class="rec-label"><span class="badge">おすすめ</span> よくある質問</div>`;
  html += recs.map(q => `<button class="rec-btn" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  RECAREA.innerHTML = html;
  RECAREA.querySelectorAll('.rec-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const q = e.currentTarget.getAttribute('data-q');
      INPUT.value = q;
      INPUT.form.requestSubmit();
    });
  });
}

function addUser(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = `<div class="b">U</div><div class="bubble">${escapeHtml(text)}</div>`;
  CHATLOG.appendChild(el);
  CHATLOG.scrollTop = CHATLOG.scrollHeight;
}

function addBot(html) {
  const el = document.createElement('div');
  el.className = 'msg bot';
  el.innerHTML = `<div class="b">B</div><div class="bubble">${html}</div>`;
  CHATLOG.appendChild(el);
  CHATLOG.scrollTop = CHATLOG.scrollHeight;
}

function renderAnswer(item) {
  if (item && item.type === 'image' && Array.isArray(item.images) && item.images.length) {
    const figs = item.images.map(img => {
      const alt = escapeHtml(img.alt || '');
      const cap = img.caption ? `<figcaption class="small">${escapeHtml(img.caption)}</figcaption>` : '';
      return `<figure><img src="${escapeHtml(img.src)}" alt="${alt}" style="max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px" />${cap}</figure>`;
    }).join('');
    return figs;
  }
  if (item && item.type === 'html' && item.a_html) {
    return item.a_html; // ※自校作成の安全なHTMLのみ
  }
  return `<div><strong>回答：</strong>${escapeHtml(item && item.a ? item.a : '')}</div>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}ぁ-んァ-ヾ一-龯]/gu, ' ')
    .split(/\s+/)
    .filter(w => w && !stopwords.has(w));
}

function score(queryTokens, item) {
  const qset = new Set(queryTokens);
  let s = 0;
  let fields = (item.q + ' ' + (item.tags || []).join(' ')).toLowerCase();
  const toks = tokenize(fields);
  for (const t of toks) if (qset.has(t)) s += 1;
  const tagSet = new Set((item.tags || []).map(t=>t.toLowerCase()));
  for (const qt of qset) if (tagSet.has(qt)) s += 2;
  return s;
}

function bestMatches(query, topk=200) {
  const q = tokenize(query);
  const scored = FAQS.map((item, idx) => ({idx, s: score(q, item)}));
  scored.sort((a,b) => b.s - a.s);
  const filtered = scored.filter(x => x.s > 0).slice(0, topk);
  return filtered.map(x => ({...FAQS[x.idx], _score: x.s}));
}

function renderResultsList(query, matches) {
  // 直前の結果表示は“ひとつのメッセージ”で更新するため、末尾に追加でOK
  const total = matches.length;
  const shown = matches.slice(0, RESULT_LIMIT_CURRENT);

  let html = `<div class="small">「${escapeHtml(query)}」の検索結果：${shown.length}件表示（全${total}件）。表示件数：${RESULT_LIMIT_CURRENT}</div>`;
  html += shown.map((m, i) => {
    const head = `<div class="small badge">#${i+1}</div> <strong>${escapeHtml(m.q)}</strong>`;
    const body = renderAnswer(m);
    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">${head}</div>
      <div>${body}</div>
    </div>`;
  }).join('');

  addBot(html);
  // 自動スクロール（結果の先頭へ）
  if (RESULTS_ANCHOR && typeof RESULTS_ANCHOR.scrollIntoView === 'function') {
    RESULTS_ANCHOR.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  updateMoreBtnState();
}

function updateMoreBtnState() {
  if (!MORE_BTN) return;
  const hasMore = LAST_MATCHES && LAST_MATCHES.length > RESULT_LIMIT_CURRENT;
  MORE_BTN.disabled = !hasMore;
}

// ---- Events ----
if (RESULT_SELECT) {
  RESULT_SELECT.addEventListener('change', () => {
    RESULT_LIMIT_BASE = parseInt(RESULT_SELECT.value || '5', 10);
    RESULT_LIMIT_CURRENT = RESULT_LIMIT_BASE;
    // 直前の検索結果があれば再描画
    if (LAST_MATCHES && LAST_MATCHES.length && LAST_QUERY != null) {
      renderResultsList(LAST_QUERY, LAST_MATCHES);
    }
  });
}

if (MORE_BTN) {
  MORE_BTN.addEventListener('click', () => {
    if (!LAST_MATCHES) return;
    RESULT_LIMIT_CURRENT += PAGE_STEP;
    renderResultsList(LAST_QUERY, LAST_MATCHES);
  });
}

FORM.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = INPUT.value.trim();
  if (!text) return;
  addUser(text);
  INPUT.value = '';

  // 新規検索のたびにカウンタリセット
  RESULT_LIMIT_CURRENT = RESULT_LIMIT_BASE;

  const matches = bestMatches(text, 200);
  LAST_QUERY = text;
  LAST_MATCHES = matches;

  if (matches.length === 0) {
    addBot(`該当する回答が見つかりませんでした。<div class="suggestion small">キーワードを変えてお試しください。例：「開始時間」「場所」「提出期限」など。</div>`);
    updateMoreBtnState();
    return;
  }

  renderResultsList(text, matches);
});

// Init
(async () => {
  await loadRecommended();
  MODE_BTNS.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode('culture');        // 初期モード
  renderRecommended();       // 初期おすすめ（recommended.jsonが無くても空で表示）
})();
