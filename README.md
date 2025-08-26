# 学校Q&Aチャットボット（ゼロコスト／静的サイト）

生成AI・有料APIなしで動く、ルールベースのQ&Aボットのスターターです。  
**GitHub Pages / Netlify / Cloudflare Pages** などの無料ホスティングでそのまま公開できます。

## 使い方
1. `data/*.json` を編集して質問と回答を追加します（CSV→JSON変換もOK）。
2. ローカルで `index.html` を開いて動作確認します。
3. リポジトリに push して GitHub Pages を有効化すると公開できます。

### JSONフォーマット
```json
[
  { "q": "質問文", "a": "回答文", "tags": ["キーワード1", "キーワード2"] }
]
```

### モード（データ切替）
- 文化祭: `data/faq_culture.json`
- 進路:   `data/faq_career.json`
- 学校生活: `data/faq_school.json`

上部のボタンで JSON の読み込み先が切り替わります。

## 探索ロジック（簡易）
- ユーザー入力と FAQ（`q`と`tags`）の**単語の重なり**でスコア化し、上位を候補提示。
- 生成AIは使用しません。オフラインでも動作します。

## 公開手順（GitHub Pages）
1. GitHubで新規リポジトリを作成し、本フォルダ内のファイルをアップロード。
2. Settings → Pages → Deploy from a branch → `main` / `/ (root)` を選択。
3. 数分後に公開URLが発行されます。

## カスタマイズ案
- UI配色・ロゴを学校仕様に変更（`styles.css`）。
- `data/`以下を**学年別・行事別**に細分化。
- 検索を高度化（同義語辞書、ふりがな対応、否定表現の扱いなど）。
- PWA対応（`manifest.json` と Service Worker 追加）でオフライン利用。

---

© 学校向け教育用テンプレート（CC0）
