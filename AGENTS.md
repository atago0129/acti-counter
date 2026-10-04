# AGENTS.md

AI コーディングエージェント向けの作業ルールです。プロジェクトの概要は [README.md](README.md)、仕様と実装方針は [docs/implementation-guide.md](docs/implementation-guide.md) を参照してください。

## プロジェクト概要

アクティアイランド（`https://acti-island.com/typing` 配下）のタイピング結果を日次でカウントし、ストップウォッチの履歴を保存する Manifest V3 の Chrome 拡張機能です。ビルド工程はなく、リポジトリのルートをそのまま「パッケージ化されていない拡張機能」として読み込みます。

- `manifest.json`: 拡張機能の定義とバージョン
- `content/content-script.js`: 対象ページに注入するパネル UI と結果画面の検知
- `background/service-worker.js`: カウント・履歴・ストップウォッチ状態の管理
- `popup/`: ツールバーのポップアップ
- `docs/implementation-guide.md`: 仕様と実装方針

## コードの探索

- コードの探索には Serena（MCP）を使う。シンボルの一覧は `get_symbols_overview`、定義は `find_symbol`、参照箇所は `find_referencing_symbols` で調べ、ファイル全体の読み込みや grep は Serena で足りない場合に限る。
- 作業を始める前に Serena の `initial_instructions` を確認する。

## バージョン管理

- 拡張機能に変更を加えたら、`manifest.json` の `version` をセマンティックバージョニングに従って上げる。バージョンはパネル下部に表示され、反映状態の確認に使われる。
  - MAJOR: 保存データとの互換性がなくなる変更など、既存の利用を壊す変更
  - MINOR: 機能の追加や、対象範囲・権限の拡大など、後方互換性のある変更
  - PATCH: 後方互換性のある不具合修正
- 1.0.0 未満の間も、機能追加は MINOR、不具合修正は PATCH を上げる。
- バージョンは 1 つの PR につき 1 回だけ上げる。同じ PR 内で修正を追加した場合は、PR 全体の変更内容に見合う段階になっているかを確認する。
- ドキュメントや AI 向け設定ファイルだけの変更では上げない。

## 実装時の注意

- 対象サイトは SPA のため、ページを読み込み直さずに画面が切り替わる前提で実装する。結果画面の見出しは CSS Modules のハッシュ付きクラス名を使うため、ハッシュ部分に依存しない。
- 仕様や挙動を変えたら `docs/implementation-guide.md` も更新する。
- コードのコメントやドキュメントは日本語で書き、周囲のコードの書き方に合わせる。
- `sample/` は動作確認用に保存した対象サイトの HTML で、Git の追跡対象外とする。
