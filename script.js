// Zero-cost Q&A bot (no external AI/APIs).
// Modes: culture (文化祭), career (進路), school (学校生活)
// This version: show top-N results list, user-selectable count, and "recommended questions" buttons.

const CHATLOG = document.getElementById('chatlog');
const FORM = document.getElementById('chatForm');
const INPUT = document.getElementById('userInput');
const MODE_BTNS = [...document.querySelectorAll('.mode-btn')];
const RESULT_SELECT = document.getElementById('resultCount');
const RECAREA = document.getElementById('recArea');

let MODE = 'culture';
let FAQS = []; // loaded JSON
let RESULT_LIMIT = 5; // 初期表示件数
let LAST_QUERY = null, LAST_MATCHES = null;

// おすすめ質問（人気3件）をモード別にハードコード（必要に応じて編集 or admin側で管理）
const RECOMMENDED = {
  culture: [
    "文化祭は何時から何時まで？",
    "模擬店の販売場所はどこ？",
    "ステージ発表のタイムテーブルは？"
  ],
  career: [
    "総合型選抜（AO）のエントリー締切は？",
    "就職希望の場合の履歴書はどこでもらえる？",
    "検定合格の証明書はいつ発行？"
  ],
  school: [
    "遅刻の連絡方法は？",
    "体調不良時の対応は？",
    "図書室の開館時間は？"
  ]
};

let stopwords = new Set(['は','が','を','に','の','と','へ','で','も','や','から','まで','より','です','ます','する','した','ある','いる','こと','それ','これ','あれ','ため','よう','ので','など','？','。','、','!','！','？']);

function setMode(m) {
  MODE = m;
  MODE_BTNS.forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  loadModeData(m).then(() => {
    addBot(`「${modeLabel(m)}」のFAQを読み込みました。質問をどうぞ。`);
    renderRecommended(); // モード切替時におすすめを更新
  });
}

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

function renderRecommended() {
  // おすすめ3件のボタン群を表示（クリックで検索実行）
  const recs = RECOMMENDED[MODE] || [];
  if (!RECAREA) return;
  if (!recs.length) {
    RECAREA.innerHTML = '';
    return;
  }
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

// Simple score: overlap + tag match boost
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

function bestMatches(query, topk=50) {
  const q = tokenize(query);
  const scored = FAQS.map((item, idx) => ({idx, s: score(q, item)}));
  scored.sort((a,b) => b.s - a.s);
  const filtered = scored.filter(x => x.s > 0).slice(0, topk);
  return filtered.map(x => ({...FAQS[x.idx], _score: x.s}));
}

function renderResultsList(query, matches) {
  const total = matches.length;
  const shown = matches.slice(0, RESULT_LIMIT);
  let html = `<div class="small">「${escapeHtml(query)}」の検索結果：${shown.length}件表示（全${total}件）。表示件数：${RESULT_LIMIT}</div>`;
  html += shown.map((m, i) => {
    const head = `<div class="small badge">#${i+1}</div> <strong>${escapeHtml(m.q)}</strong>`;
    const body = renderAnswer(m);
    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">${head}</div>
      <div>${body}</div>
    </div>`;
  }).join('');
  addBot(html);
}

// ---- Events ----
if (RESULT_SELECT) {
  RESULT_SELECT.addEventListener('change', () => {
    RESULT_LIMIT = parseInt(RESULT_SELECT.value || '5', 10);
    // 直前の検索結果があれば再描画
    if (LAST_MATCHES && LAST_MATCHES.length && LAST_QUERY != null) {
      renderResultsList(LAST_QUERY, LAST_MATCHES);
    }
  });
}

FORM.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = INPUT.value.trim();
  if (!text) return;
  addUser(text);
  INPUT.value = '';

  const matches = bestMatches(text, 50);
  LAST_QUERY = text;
  LAST_MATCHES = matches;

  if (matches.length === 0) {
    addBot(`該当する回答が見つかりませんでした。<div class="suggestion small">キーワードを変えてお試しください。例：「開始時間」「場所」「提出期限」など。</div>`);
    return;
  }

  renderResultsList(text, matches);
});

// Init
MODE_BTNS.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode('culture'); // 初期モード
renderRecommended(); // 初期おすすめ
