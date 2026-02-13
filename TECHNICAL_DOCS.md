# PlamoScannerPWA 技術仕様書

## 1. システム概要

本システムは、プラスチックモデルの「袋」と「箱」をQRコードで管理し、Notionデータベースと連携させるPWA（Progressive Web App）です。
ユーザーはスマホのカメラでQRコードをスキャンするだけで、該当するNotionページを開いたり、袋を箱に「しまう（紐付ける）」処理を行うことができます。

### アーキテクチャ図

```mermaid
graph TD
    User[ユーザー] -->|アクセス| PWA[Firebase Hosting (PWA)]
    User -->|1. カメラ許可 & スキャン| PWA
    PWA -->|2. QRコード読取 (ID)| PWA_JS[app.js]
    PWA_JS -->|3. POST (ID, Mode)| GAS[Google Apps Script]
    
    subgraph "Backend Logic (GAS)"
        GAS -->|4. API Call| NotionAPI[Notion API]
        NotionAPI -->|5. SELECT / INSERT / UPDATE| NotionDB[(Notion Database)]
        NotionDB -->|6. 結果返却 (Page URL / ID)| NotionAPI
        NotionAPI -->|7. JSON| GAS
    end
    
    GAS -->|8. Response (notion:// URL)| PWA_JS
    PWA_JS -->|9. Redirect| NotionApp[Notionアプリ]
    NotionApp -->|10. 該当ページ表示| User
```

## 2. デプロイメントフロー

GitHubの `main` ブランチへのプッシュをトリガーとして、GitHub Actionsが自動的にFirebase Hostingへデプロイを行います。

### デプロイの流れ

```mermaid
sequenceDiagram
    participant Dev as 開発者
    participant GH as GitHub Repository
    participant Action as GitHub Actions
    participant Secret as GitHub Secrets
    participant Firebase as Firebase Hosting

    Dev->>GH: git push origin main
    GH->>Action: ワークフロー起動 (firebase-hosting-merge.yml)
    Action->>Action: ソースコードのチェックアウト
    Action->>Secret: GAS_WEB_APP_URL 取得
    Action->>Action: app.js内のURL文字列を置換 (sedコマンド)
    Note over Action: REPLACE_ME_GAS_URL → https://script.google.com/...
    Action->>Secret: FIREBASE_SERVICE_ACCOUNT 取得
    Action->>Firebase: デプロイ (Hosting API)
    Firebase-->>Dev: 公開完了通知
```

### 必要なAPI認可設定

デプロイを自動化するために、以下のGoogle Cloud APIが有効化されています（`firebase init` 時に設定）。

| API名 | 用途 |
| :--- | :--- |
| **Firebase Hosting API** | GitHub Actionsから静的ファイル（html, js, css等）をアップロード・公開するために使用。 |
| **Cloud Resource Manager API** | デプロイ用のサービスアカウントの権限管理を自動化するために初期設定時に使用。 |
| **Firebase Management API** | Firebaseプロジェクトの構成情報の取得・管理に使用。 |

## 3. アプリケーションロジック詳細

### 3.1. フロントエンド (app.js)

ユーザーインターフェースとQRスキャンを担当します。
操作モード (`currentMode`) に基づき、スキャン後の挙動を決定します。

*   **ライブラリ**: `html5-qrcode` を使用してブラウザ上でQRコードを解析。
*   **通信**: `fetch` APIを使用し、GASのWebアプリURLに対してPOSTリクエストを送信。
    *   セキュリティのため、GASのURLはソースコードに直接記述せず、GitHub Secrets (`GAS_WEB_APP_URL`) からデプロイ時に埋め込んでいます。
*   **アプリ連携**: レスポンスに `notionUrl` が含まれる場合、`window.location.href` にセットしてNotionアプリを起動します。

### 3.2. バックエンド (GAS: Code.gs)

Notion APIとの通信仲介ロジックを担当します。

#### クライアントからのリクエスト
```json
{
  "mode": "HUKURO_SCAN", // 動作モード
  "id": "QR_CODE_DATA",  // スキャンされたID
  "hakoPageId": "..."    // (任意) 紐付け先の箱PageID
}
```

#### 処理ロジック
1.  **袋スキャン / 箱スキャン (`processHukuro`, `processHako`)**
    *   指定されたIDでNotionデータベースを検索 (`query`)。
    *   存在すればそのページ情報を取得。
    *   存在しなければ新規ページを作成 (`create`)。
    *   ページのURL (`https://...`) を `notion://...` に変換して返却。

2.  **しまう処理 (Step 1 & 2)**
    *   **Step 1**: 箱をスキャン。箱ページを特定し、その `pageId` と名前をフロントエンドに一時保存させる。
    *   **Step 2**: 袋をスキャン。Step 1の箱 `pageId` を受け取り、袋ページのプロパティ「現在の箱」を更新 (`patch`) して箱と紐付ける。
    *   完了後、箱のページを開くURLを返却。

## 4. ユーザー操作フロー (User usage flow)

### 4.1. 処理シーケンス (Sequence Diagram)

ユーザーが袋をスキャンし、最終的にNotionアプリでその詳細画面を開くまでのシーケンスです。

```mermaid
sequenceDiagram
    autonumber
    participant Man as 人間操作(User)
    participant Browser as ブラウザ(PWA)
    participant GAS as GAS(Backend)
    participant NotionAPI as Notion API
    participant NotionApp as Notionアプリ

    Note over Man, Browser: 1. アプリ起動 & スキャン開始
    Man->>Browser: ページアクセス(firebase hosting)
    Browser-->>Man: 画面表示
    Man->>Browser: 「袋スキャン」ボタン押下
    Browser-->>Man: カメラ許可リクエスト
    Man->>Browser: 許可
    Man->>Browser: QRコード読み取り(袋ID)

    Note over Browser, NotionAPI: 2. データの照会・登録
    Browser->>GAS: POST /exec (mode: HUKURO, id: XXX)
    GAS->>NotionAPI: 検索 (Query Database)
    alt データあり
        NotionAPI-->>GAS: ページ情報返却
    else データなし
        GAS->>NotionAPI: 新規作成 (Create Page)
        NotionAPI-->>GAS: 作成後のページ情報返却
    end
    
    GAS-->>Browser: JSON { notionUrl: "notion://..." }

    Note over Browser, NotionApp: 3. アプリ連携
    Browser->>Browser: window.location.href = notionUrl
    Browser-->>Man: 「Notionで開きますか？」(OSによる)
    Man->>Browser: 開く(許可)
    Browser->>NotionApp: Deep Link起動
    NotionApp-->>Man: 該当データの詳細画面表示
```

### 4.2. システム内部フロー (参考)

アプリ内部での具体的な処理分岐（袋スキャンの例）です。

```mermaid
flowchart TD
    Start((開始)) --> Launch[アプリ起動]
    Launch --> SelectMode{モード選択}

    %% --- 袋スキャン ---
    SelectMode -->|袋をスキャン| ModeHukuro[袋スキャンモード]
    ModeHukuro --> CamPerm1[ユーザー: カメラ許可]
    CamPerm1 --> Scan1[/QRコード読み取り/]
    Scan1 --> Request1[PWA: GASへID送信 POST]
    
    Request1 --> GAS_Start[GAS: 処理開始]
    GAS_Start --> Notion_Query[GAS: Notion APIへ問い合わせ]
    Notion_Query --> Notion_DB[(Notion DB)]
    Notion_DB --> Notion_Res[Notion API: ページ情報返却]
    Notion_Res --> GAS_Res[GAS: notion://スキームのURL生成]
    GAS_Res --> Response1[PWA: URL受信]
    
    Response1 --> OpenURL[PWA: URL起動 window.location]
    OpenURL --> UserPerm[ユーザー: アプリ起動許可]
    UserPerm --> NotionApp[Notionアプリ起動]
    NotionApp --> ShowPage[該当データの表示]
    ShowPage --> End((終了))
```

## 5. 環境設定・シークレット

### GitHub Secrets (Actions用)
| シークレット名 | 内容 |
| :--- | :--- |
| `GAS_WEB_APP_URL` | デプロイされたGASウェブアプリのURL。`app.js` への埋め込みに使用。 |
| `FIREBASE_SERVICE_ACCOUNT_...` | Firebaseへのデプロイ権限を持つサービスアカウントキー。 |

### GAS Script Properties (バックエンド用)
GASの「プロジェクトの設定」>「スクリプトプロパティ」で設定します。

| プロパティ名 | 内容 |
| :--- | :--- |
| `NOTION_API_KEY` | Notion Integration Token (secret_...) |
| `DATABASE_ID_HUKURO` | 袋データベースのID (32文字) |
| `DATABASE_ID_HAKO` | 箱データベースのID (32文字) |

---
*Document generated by Antigravity Assistant*
