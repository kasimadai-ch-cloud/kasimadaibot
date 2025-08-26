// Zero-cost Q&A bot (no external AI/APIs).
// Modes: culture (文化祭), career (進路), school (学校生活)
// Answer is selected by simple scoring: keyword overlap + tag boost.
const CHATLOG = document.getElementById('chatlog');
const FORM = document.getElementById('chatForm');
const INPUT = document.getElementById('userInput');
const MODE_BTNS = [...document.querySelectorAll('.mode-btn')];

let MODE = 'culture';
let FAQS = []; // loaded JSON
let stopwords = new Set(['は','が','を','に','の','と','へ','で','も','や','から','まで','より','です','ます','する','した','ある','いる','こと','それ','これ','あれ','ため','よう','ので','など','？','。','、','!','！','？']);

function setMode(m) {
  MODE = m;
  MODE_BTNS.forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  loadModeData(m).then(() => {
    addBot(`「${modeLabel(m)}」のFAQを読み込みました。質問をどうぞ。`);
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
    const res = await fetch(map[m]);
    FAQS = await res.json();
  } catch (e) {
    console.error(e);
    FAQS = [];
  }
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
  // tag boost if tag appears exactly
  const tagSet = new Set((item.tags || []).map(t=>t.toLowerCase()));
  for (const qt of qset) if (tagSet.has(qt)) s += 2;
  return s;
}

function bestMatches(query, topk=3) {
  const q = tokenize(query);
  const scored = FAQS.map((item, idx) => ({idx, s: score(q, item)}));
  scored.sort((a,b) => b.s - a.s);
  const filtered = scored.filter(x => x.s > 0).slice(0, topk);
  return filtered.map(x => ({...FAQS[x.idx], _score: x.s}));
}

FORM.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = INPUT.value.trim();
  if (!text) return;
  addUser(text);
  INPUT.value = '';

  const matches = bestMatches(text, 3);
  if (matches.length === 0) {
    addBot(`該当する回答が見つかりませんでした。<div class="suggestion small">キーワードを変えてお試しください。例：「開始時間」「場所」「提出期限」など。</div>`);
    return;
  }

  const top = matches[0];
  let html = `<div><strong>回答：</strong>${escapeHtml(top.a)}</div>`;
  if (matches.length > 1) {
    html += `<div class="suggestion">もしかして：` +
      matches.map(m => `<a href="#" data-q="${escapeHtml(m.q)}">${escapeHtml(m.q)}</a>`).join(' / ') +
      `</div>`;
  }
  addBot(html);

  // click suggestions to auto-fill question
  const links = CHATLOG.querySelectorAll('.suggestion a');
  links.forEach(a => a.addEventListener('click', (ev)=>{
    ev.preventDefault();
    const q = ev.target.getAttribute('data-q');
    INPUT.value = q;
    INPUT.form.requestSubmit();
  }));
});

// Init
MODE_BTNS.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode('culture');
