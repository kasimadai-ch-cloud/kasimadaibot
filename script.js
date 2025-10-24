// ===== DOM =====
const MODE_BAR = document.getElementById('modeBar');
const APP_TITLE = document.getElementById('appTitle');
const CHATLOG = document.getElementById('chatlog');
const FORM = document.getElementById('chatForm');
const INPUT = document.getElementById('userInput');
const RESULT_SELECT = document.getElementById('resultCount');
const RECAREA = document.getElementById('recArea');
const MORE_BTN = document.getElementById('moreBtn');
const RESULTS_ANCHOR = document.getElementById('resultsAnchor');

// ===== 状態 =====
let MANIFEST = null;
let MODE_KEY = null, MODE_LABEL = '', FAQ_FILE = '';
let FAQS = [];
let RESULT_LIMIT_BASE = 1, RESULT_LIMIT_CURRENT = 1;
const PAGE_STEP = 5;
let LAST_QUERY = null, LAST_MATCHES = null;
let RECOMMENDED = null;
let UI_TEXTS = null;

// ===== ユーティリティ =====
const HTML_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, ch => HTML_ENT[ch]); }
function addUser(text){ const el=document.createElement('div'); el.className='msg user'; el.innerHTML=`<div class="b">U</div><div class="bubble">${escapeHtml(text)}</div>`; CHATLOG.appendChild(el); CHATLOG.scrollTop=CHATLOG.scrollHeight; }
function addBot(html){
  const el = document.createElement('div');
  el.className = 'msg bot';
  el.innerHTML = `<div class="b">B</div><div class="bubble">${html}</div>`;
  CHATLOG.appendChild(el);
  CHATLOG.scrollTop = CHATLOG.scrollHeight;
}
// いま開いている他の Q&A カードを閉じる（except は閉じない）
function closeOtherQA(except){
  CHATLOG.querySelectorAll('details.qa-item[open]').forEach(d=>{
    if (d !== except) d.open = false;
  });
}



// ==== Q&A（質問リスト + 折りたたみ回答） ====
let LAST_QA_ANS = null; // 直近カードの回答DOM（「もっと見る」で上書き）

function addQAItem(question, answerHtml){
  const el = document.createElement('details');
  el.className = 'qa-item';
  el.open = true; // 新規は開いた状態
  el.innerHTML = `
    <summary class="qa-summary">
      <span class="badge">Q</span>
      <span class="qtext">${escapeHtml(question)}</span>
    </summary>
    <div class="qa-answer">${answerHtml}</div>
  `;

  // 既存の開いているカードを先に閉じる
  closeOtherQA(null);

  CHATLOG.appendChild(el);

  // このカードが開かれたとき、他を自動で閉じる（クリックでの開閉にも対応）
  el.addEventListener('toggle', ()=>{
    if (el.open) closeOtherQA(el);
  });

  LAST_QA_ANS = el.querySelector('.qa-answer');
  if (LAST_QA_ANS) bindCopyButtons(LAST_QA_ANS);

  // 見やすくスクロール（任意）
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function summarize(html, max=120){
  const text = stripHtml(html).trim();
  return text.length>max ? text.slice(0,max) + '…' : text;
}
// summary内に: <span class="small text-gray-500">【要約】{summarize(answerHtml)}</span>


function updateLastAnswer(html){
  if (!LAST_QA_ANS) return;
  LAST_QA_ANS.innerHTML = html;
  bindCopyButtons(LAST_QA_ANS);
}

function removePrevQA(){
  // 直近の「回答（answer）」だけ消す（案内文などは残す）
  const lastAnswer = [...CHATLOG.querySelectorAll('.msg.bot[data-role="answer"]')].pop();
  if (lastAnswer) lastAnswer.remove();

  // 直近のユーザ質問も消す（QとAを1セットで消す）
  const lastUser = [...CHATLOG.querySelectorAll('.msg.user')].pop();
  if (lastUser) lastUser.remove();
}


// 回答専用（識別用 data-role="answer" を付与）
function addBotAnswer(html){
  const el = document.createElement('div');
  el.className = 'msg bot';
  el.dataset.role = 'answer';
  el.innerHTML = `<div class="b">B</div><div class="bubble">${html}</div>`;
  CHATLOG.appendChild(el);
  CHATLOG.scrollTop = CHATLOG.scrollHeight;
}
// ===== データロード =====
async function loadManifest(){ const res=await fetch('./data/manifest.json',{cache:'no-store'}); MANIFEST=await res.json(); }
async function loadRecommended(){ try{ const res=await fetch('./data/recommended.json',{cache:'no-store'}); RECOMMENDED=await res.json(); }catch(e){ RECOMMENDED=null; } }
async function loadUiTexts(){ try{ const res=await fetch('./data/ui_texts.json',{cache:'no-store'}); UI_TEXTS=await res.json(); }catch(e){ UI_TEXTS=null; } }
async function loadFaqFile(file){ const res=await fetch(`./${file}`,{cache:'no-store'}); FAQS=await res.json(); }


// 安全に要素を取得
function getResultSelect(){
  return document.getElementById('resultCount') || null;
}

// セレクトから数値を読む（なければ現在値を返す）
function readResultLimit(){
  const sel = getResultSelect();
  if(!sel) return Math.max(1, parseInt(RESULT_LIMIT_CURRENT, 10) || 1);
  return Math.max(1, parseInt(sel.value, 10) || 1);
}


// 共通：現在値を正規化して反映
// 現在値へ反映
function syncResultLimit(){
  RESULT_LIMIT_CURRENT = readResultLimit();
}

// ===== モード =====
function buildModeButtons(){
  MODE_BAR.innerHTML='';
  (MANIFEST.faqs||[]).forEach(f=>{
    const btn=document.createElement('button');
    btn.className='mode-btn'; btn.dataset.key=f.key; btn.dataset.file=f.file; btn.textContent=f.label;
    btn.onclick=()=>setMode(f.key,f.label,f.file);
    MODE_BAR.appendChild(btn);
  });
}
function highlightActiveMode(){ [...MODE_BAR.querySelectorAll('.mode-btn')].forEach(b=>b.classList.toggle('active', b.dataset.key===MODE_KEY)); }

async function setMode(key,label,file){
  MODE_KEY=key; MODE_LABEL=label||key; FAQ_FILE=file;
  highlightActiveMode();
  RESULT_LIMIT_CURRENT=RESULT_LIMIT_BASE; LAST_QUERY=null; LAST_MATCHES=null; CHATLOG.innerHTML='';
  await loadFaqFile(FAQ_FILE);
  addBot(`「${escapeHtml(MODE_LABEL)}」のFAQを読み込みました。質問をどうぞ。`);
  updatePlaceholder(); renderRecommended(); updateMoreBtnState();
}

// ===== プレースホルダー =====
function updatePlaceholder(){
  let hint="例：質問を入力";
  if(UI_TEXTS && UI_TEXTS.placeholders){ hint=UI_TEXTS.placeholders[MODE_KEY]||UI_TEXTS.placeholders[MODE_LABEL]||UI_TEXTS.placeholders['default']||hint; }
  const text=`質問を入力してください（${hint}）`;
  INPUT.placeholder=text; INPUT.setAttribute("aria-label",text);
}

// ===== おすすめ =====
function renderRecommended(){
  if(!RECAREA) return;
  let recs = [];
  if(Array.isArray(RECOMMENDED)){ recs=RECOMMENDED; }
  else if(RECOMMENDED && typeof RECOMMENDED==='object'){ recs=RECOMMENDED[MODE_KEY]||RECOMMENDED['default']||[]; }
  if(!recs.length){ RECAREA.innerHTML=''; return; }
  let html=`<div class="rec-label"><span class="badge">おすすめ</span> よくある質問</div>`;
  html += recs.map(q=>`<button class="rec-btn" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  RECAREA.innerHTML=html;
  RECAREA.querySelectorAll('.rec-btn').forEach(btn=>btn.addEventListener('click',e=>{ const q=e.currentTarget.getAttribute('data-q'); INPUT.value=q; INPUT.form.requestSubmit(); }));
}

// クエリからハイライト用の正規表現を作成（N-gram/英数を統合）
function buildHighlightRegex(query){
  const qnorm = normalizeJa(query);
  const terms = Array.from(new Set([
    ...(cjkNgrams(qnorm, 2)),                          // CJK 2-gram
    ...((qnorm.toLowerCase().match(/[A-Za-z0-9%]+/g)) || []) // 英数
  ])).filter(t => t.length >= 2).sort((a,b)=>b.length-a.length);
  if(!terms.length) return null;
  const esc = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(terms.map(esc).join('|'), 'g');
}
function highlight(text, re){
  if(!re) return escapeHtml(String(text||''));
  return escapeHtml(String(text||'')).replace(re, m=>`<mark>${m}</mark>`);
}



// ===== 検索（改良版：日本語N-gram＋丁寧表現の除去） =====
let stopwords = new Set(['は','が','を','に','の','と','へ','で','も','や','から','まで','より','です','ます','する','した','ある','いる','こと','それ','これ','あれ','ため','よう','ので','など','？','。','、','!','！','？']);

// 丁寧表現・冗長語などを削る
// ← 既存 normalizeJa を丸ごと置き換え
function normalizeJa(s){
  return (s||'')
    // よくある聞き方の定型句を削る
    .replace(/について教えてください|についてお願いします|についてお願いいたします|について/gu,'')
    .replace(/教えてください|教えて|ください|頂けますか|いただけますか|お願いします|お願い/gu,'')
    .replace(/とは|って/gu,'')
    // 記号類をスペースに
    .replace(/[？?！!。、「」、・…　\s]+/gu,' ')
    .trim();
}


// CJK連続部分を N-gram に分割
// CJK: 漢字(拡張A含む/FW互換) + ひらがな + カタカナ + 長音記号
const CJK_SEQ = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u30FC]+/g;

function cjkNgrams(s, n=2){
  const grams = [];
  const seqs = (s||'').match(CJK_SEQ) || [];
  for(const seq of seqs){
    if(seq.length <= n){ grams.push(seq); continue; }
    for(let i=0;i<=seq.length-n;i++) grams.push(seq.slice(i,i+n));
  }
  return grams;
}

// 英数語 + CJK N-gram 併用のトークナイズ
function tokenize(s){
  s = normalizeJa(s);
  const ascii = (s.toLowerCase().match(/[A-Za-z0-9%]+/g) || []);
  const cjk2  = cjkNgrams(s, 2);     // 広く拾う
  // 必要なら cjk3 を併用（精度↑/再現率↓）：const cjk3 = cjkNgrams(s, 3);
  return [...ascii, ...cjk2 /*, ...cjk3*/].filter(w=>w && !stopwords.has(w));
}

// CJK 2-gram を導入したので、語の一部一致でもしっかりヒットします。
// 取りこぼしがある場合は cjkNgrams(s,3) を併用（コメント解除）すると精度が上がります（広がりは少し下がります）。
// マッチが広すぎると感じたら、fields.includes(t) の加点（今は +2）を +1 に下げてください。

function stripHtml(html){
  return String(html||'').replace(/<[^>]+>/g, ' ');
}

// スコアリング：部分一致フレンドリー
function score(qt, item){
  // 検索対象：質問 + タグ + 回答テキスト + 回答HTML(タグ除去)
  const aText   = (item.a || '');
  const aHtmlTx = stripHtml(item.a_html || '');
  const fieldsRaw = (
    (item.q || '') + ' ' +
    (item.tags || []).join(' ') + ' ' +
    aText + ' ' + aHtmlTx
  ).toLowerCase();
  const fields = normalizeJa(fieldsRaw);

  let s = 0;

  // ① N-gram/語の「含む？」で加点
  for(const t of qt){
    if (fields.includes(t)) s += 2;
  }

  // ② 質問文そのものへの一致も加点（意図の近さ）
  const qnorm = normalizeJa((item.q||'').toLowerCase());
  for(const t of qt){
    if (qnorm.includes(t)) s += 1;
  }

  // ③ タグ完全一致は最優先
  const tagSet = new Set((item.tags||[]).map(t=>normalizeJa(String(t).toLowerCase())));
  for(const t of qt){
    if (tagSet.has(t)) s += 5;
  }

// ④ フレーズ一致を強化（クエリ4文字以上なら+3）
const qWhole = normalizeJa(String(LAST_QUERY||'').toLowerCase());
if (qWhole && qWhole.length >= 4 && fields.includes(qWhole)) s += 3;

// ① の含有加点は据え置き(+2)、②質問文一致(+1)も据え置きでOK
  return s;
}


function bestMatches(query, topk=200){
  LAST_QUERY = query; // 保険スコアで利用
  const q = tokenize(query);
  const scored = FAQS.map((it,idx)=>({ idx, s: score(q, it) }));
  scored.sort((a,b)=>b.s-a.s);
  let filtered = scored.filter(x=>x.s>0);

  // 0件ならフォールバック：クエリ内のCJK連続語（2文字以上）をそのまま含む項目を拾う
  if (filtered.length === 0){
    // クエリから CJK 連続語を抽出（2文字以上）
    const qNorm = normalizeJa(query);
    const qSeqs = (qNorm.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u30FC]+/g) || [])
      .flatMap(seq => seq.length >= 2 ? [seq] : []);
    if (qSeqs.length){
      const adds = [];
      for (let idx=0; idx<FAQS.length; idx++){
        const it = FAQS[idx];
        const target = normalizeJa(((it.q||'') + ' ' + (it.tags||[]).join(' ')));
        const hit = qSeqs.some(seq => target.includes(seq));
        if (hit) adds.push({ idx, s: 1 }); // 弱スコアでも拾う
      }
      if (adds.length){
        // 既存スコアと重複しないように統一（ここでは adds のみでOK）
        adds.sort((a,b)=>b.s-a.s);
        filtered = adds;
      }
    }
  }

  filtered = filtered.slice(0, topk);
  return filtered.map(x => ({ ...FAQS[x.idx], _score: x.s }));
}



// ===== クリップボード（HTTPでも動くフォールバック付き） =====
async function copyToClipboard(text, btn) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) { const old = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(()=>btn.textContent=old, 1200); }
      return true;
    } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      if (btn) { const old = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(()=>btn.textContent=old, 1200); }
      return true;
    }
  } catch {}
  if (window.clipboardData && window.clipboardData.setData) {
    try {
      window.clipboardData.setData('Text', text);
      if (btn) { const old = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(()=>btn.textContent=old, 1200); }
      return true;
    } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position='fixed'; ta.style.top='10px'; ta.style.left='10px'; ta.style.width='1px'; ta.style.height='1px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    alert('お使いの環境では自動コピーが許可されていません。\n選択されていますので、Ctrl+C（⌘+C）でコピーしてください。');
  } catch {
    alert('コピーに失敗しました：' + text);
  }
  return false;
}
function bindCopyButtons(scope = document) {
  scope.querySelectorAll('button[data-copy]').forEach(btn=>{
    btn.onclick = async ()=>{
      const val = decodeURIComponent(btn.getAttribute('data-copy')||'');
      await copyToClipboard(val, btn);
    };
  });
}

// ===== URL処理 =====
function encodeHttpUrl(u){
  try{ return encodeURI(u); }catch{ return u; }
}
function renderUrlPart(item){
  if (!item || !item.url) return '';
  const raw = item.url.trim();
  if(/^https?:\/\//i.test(raw)){
    const safe = encodeHttpUrl(raw);
    return `<div style="margin-top:6px;">
      <a href="${escapeHtml(safe)}" target="_blank" rel="noopener" class="badge">資料を開く</a>
      <span class="small" style="margin-left:8px;">${escapeHtml(raw)}</span>
    </div>`;
  } else if(/^\\\\/.test(raw) || /^file:\/\//i.test(raw)){
    const enc = encodeURIComponent(raw);
    return `<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button type="button" class="rec-btn" data-copy="${enc}">パスをコピー</button>
      <span class="small">${escapeHtml(raw)}</span>
    </div>`;
  } else {
    const enc = encodeURIComponent(raw);
    return `<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button type="button" class="rec-btn" data-copy="${enc}">パスをコピー</button>
      <span class="small">${escapeHtml(raw)}</span>
    </div>`;
  }
}

// ===== 表示 =====
function renderAnswer(item){
  // 画像
  if(item && item.type==='image' && Array.isArray(item.images) && item.images.length){
    const figs = item.images.map(img=>{
      const alt=escapeHtml(img.alt||''); const cap=img.caption?`<figcaption class="small">${escapeHtml(img.caption)}</figcaption>`:'';
      return `<figure><img src="${escapeHtml(img.src)}" alt="${alt}" />${cap}</figure>`;
    }).join('');
    return figs + renderUrlPart(item);
  }
  // HTML
  if(item && item.type==='html' && item.a_html){
    return item.a_html + renderUrlPart(item);
  }
  // テキスト（★改行対応：\n → <br>）
  const raw = item && item.a ? item.a : '';
  const H = buildHighlightRegex(LAST_QUERY||'');
  const withBr = highlight(raw, H).replace(/\n/g, '<br>');
  return `<div><strong>回答：</strong>${withBr}</div>` + renderUrlPart(item);
}

// 直近の bot メッセージを差し替える（なければ追加）
function replaceBot(html){
  const bots = CHATLOG.querySelectorAll('.msg.bot');
  if (bots.length) bots[bots.length - 1].remove();
  addBot(html);
}


// レンダ：ここでも最後に保険で正規化しておくと安心
// レンダ前にも一応正規化（保険）
// 置き換え：renderResultsList → buildResultsHtml（HTML文字列を返す）
function buildResultsHtml(query, matches){
  RESULT_LIMIT_CURRENT = Math.max(1, parseInt(RESULT_LIMIT_CURRENT, 10) || 1);

  const total = matches.length;
  const shown = matches.slice(0, RESULT_LIMIT_CURRENT);

  let html = `<div class="small">「${escapeHtml(query)}」の検索結果：${shown.length}件表示（全${total}件）。表示件数：${RESULT_LIMIT_CURRENT}</div>`;
  html += shown.map((m,i)=>{
    const H = buildHighlightRegex(LAST_QUERY||'');
    const head = `<div class="small badge">#${i+1}</div> <strong>${highlight(m.q, H)}</strong>`;
    const body = renderAnswer(m);
    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">${head}</div>
      <div>${body}</div>
    </div>`;
  }).join('');

  return html;
}




// 「もっと見る」など、他でも安全に
function onClickMore(){
  const sel = getResultSelect();
  const cur = readResultLimit();
  if(sel){
    sel.value = String(cur + 5); // UIも更新
  }
  RESULT_LIMIT_CURRENT = cur + 5;
  renderResultsList(LAST_QUERY, LAST_MATCHES);
}


// ボタン活性/非活性判定なども数値で
function updateMoreBtnState(){
  const limit = readResultLimit();
  const total = (LAST_MATCHES?.length) || 0;
  const disabled = limit >= total;
  if (MORE_BTN) MORE_BTN.disabled = disabled;
}

// セレクトの初期値を LIMIT に反映（任意）
if (RESULT_SELECT) {
  RESULT_LIMIT_BASE = Math.max(1, parseInt(RESULT_SELECT.value || '1', 10) || 1);
  RESULT_LIMIT_CURRENT = RESULT_LIMIT_BASE;
}


// ===== イベント =====
if (RESULT_SELECT) RESULT_SELECT.addEventListener('change', ()=>{
    RESULT_LIMIT_BASE = Math.max(1, parseInt(RESULT_SELECT.value || '1', 10) || 1);
    RESULT_LIMIT_CURRENT = RESULT_LIMIT_BASE;
    if (LAST_MATCHES && LAST_MATCHES.length && LAST_QUERY != null) {
      const html = buildResultsHtml(LAST_QUERY, LAST_MATCHES);
      updateLastAnswer(html);   // ← 最後のカードの回答だけ更新
      updateMoreBtnState();
    }
  });
if (MORE_BTN) MORE_BTN.addEventListener('click', ()=>{
  if(!LAST_MATCHES) return;
   const sel = getResultSelect();
   const cur = readResultLimit();
   if (sel) sel.value = String(cur + PAGE_STEP);
   RESULT_LIMIT_CURRENT = cur + PAGE_STEP;
   const html = buildResultsHtml(LAST_QUERY, LAST_MATCHES);
   updateLastAnswer(html);
   updateMoreBtnState();
});
if (FORM) FORM.addEventListener('submit', (e)=>{
  e.preventDefault();
  const text=INPUT.value.trim(); if(!text) return;
  removePrevQA();          // ← 追加（先に前のQ&Aを消す）
  INPUT.value='';
  RESULT_LIMIT_CURRENT=RESULT_LIMIT_BASE;
  const matches=bestMatches(text,200); LAST_QUERY=text; LAST_MATCHES=matches;
  let answerHtml;
  if (matches.length === 0){
    answerHtml = `該当する回答が見つかりませんでした。<div class="small">キーワードを変えてお試しください（例：「開始時間」「場所」「提出期限」）。</div>`;
  } else {
    answerHtml = buildResultsHtml(text, matches);
  }
  addQAItem(text, answerHtml);   // ← Q&Aカードを追加
  updateMoreBtnState();
});

// ===== 初期化 =====
(async ()=>{
  await loadManifest(); await loadRecommended(); await loadUiTexts();
  buildModeButtons();
  const first=(MANIFEST.faqs||[])[0];
  if(!first){ addBot('manifest.json の faqs が空です。管理者に連絡してください。'); return; }
  await setMode(first.key, first.label, first.file);
})();
