// --- ユーザー設定 (Script Propertiesに設定) ---
// NOTION_API_KEY: Notionインテグレーションのシークレットキー
// DATABASE_ID_HUKURO: 袋マスターDBのID
// DATABASE_ID_HAKO: 箱マスターDBのID
// FOLDER_ID_PHOTOS: 写真保存用Google DriveフォルダID
// Force Scope Refresh


function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "GAS is running correctly. Access permission is valid."
  })).setMimeType(ContentService.MimeType.JSON);
}

// 【重要】初回はこの関数を選択して「実行」し、Google Driveへのアクセス権限を承認してください
function authorizeScript() {
  const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID_PHOTOS');
  console.log(`Current Folder ID: ${folderId}`);
  
  // 権限を強制的にトリガーするためのダミー書き込み処理
  // もしここで「承認が必要です」が出たら、必ず許可してください
  const folder = DriveApp.getFolderById(folderId);
  const tempFile = folder.createFile("auth_test.txt", "This is a permission test file.");
  console.log("File created successfully: " + tempFile.getUrl());
  tempFile.setTrashed(true); // すぐにゴミ箱へ
  
  console.log("Drive full access authorized. You can now deploy.");
}

// Notion File Upload API の存在確認用テスト
function testNotionUploadEndpoint() {
  const url = 'https://api.notion.com/v1/file_uploads';
  const payload = {
    file: {
      name: "test_upload_check.jpg",
      type: "image/jpeg"
    }
  };
  const options = {
    method: 'post',
    headers: getNotionHeaders(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // エラーレスポンスも確認したい
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    console.log(`Status Code: ${res.getResponseCode()}`);
    console.log(`Response: ${res.getContentText()}`);
  } catch (e) {
    console.error(e);
  }
}

// Step 2 検証用: ハードコードされた値でNotionの「写真」プロパティを更新する
function testUpdateNotionPhotoProperty() {
  const targetHakoId = "2026/02/11 12:50:34.044";
  const targetImageName = "TEST_UPLOAD_1770968503152.jpg";

  console.log(`Testing Notion Update... HakoID: ${targetHakoId}, Image: ${targetImageName}`);

  try {
    // 1. 画像URLの取得
    const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID_PHOTOS');
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByName(targetImageName);
    
    if (!files.hasNext()) {
      throw new Error(`Image file not found in Drive: ${targetImageName}`);
    }
    const file = files.next();
    // 念のため公開設定を再適用
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // Notionに直接アップロード ("Notion as Master")
    // 画像のBlobを取得するだけなので、標準のDriveAppでOK
    const imageBlob = file.getBlob(); 
    console.log(`Image Blob acquired: ${imageBlob.getName()} (${imageBlob.getBytes().length} bytes)`);

    // 2. Notionページの特定
    const dbId = PropertiesService.getScriptProperties().getProperty('DATABASE_ID_HAKO');
    const page = findOrCreatePage(dbId, '箱ID', targetHakoId, '箱名', 'Test Hako Box');
    console.log(`Notion Page Found: ${page.id} (${page.url})`);

    // 3. アップロード＆更新実行
    const res = performNotionUpload(page.id, imageBlob);
    console.log("Process Result:", res);


  } catch (e) {
    console.error("Test Failed:", e.message);
    if (e.stack) console.error(e.stack);
  }
}

function doPost(e) {
  try {
    // ログ出力: デバッグ用
    console.log("Request received");

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No postData received");
    }

    let requestBody;
    try {
      requestBody = JSON.parse(e.postData.contents);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      throw new Error("Invalid JSON body");
    }

    const { mode, id, hakoPageId, image } = requestBody;
    console.log(`Mode: ${mode}, ID: ${id}`); // ログ確認用

    let result;

    switch (mode) {
      case 'UPLOAD_ONLY': // Step 1: 画像アップロード単体テスト用
        if (!image) throw new Error('No image data provided');
        const imageUrl = saveImageToDrive(image, `TEST_UPLOAD`);
        result = { message: 'Image uploaded successfully', imageUrl: imageUrl };
        break;
      case 'HUKURO_SCAN':
        result = processHukuro(id);
        break;
      case 'HAKO_SCAN':
        result = processHako(id);
        break;
      case 'SHIMAU_STEP1_HAKO':
        result = processShimauStep1(id);
        break;
      case 'SHIMAU_STEP2_HUKURO':
        result = processShimauStep2(id, hakoPageId);
        break;
      default:
        throw new Error(`Invalid mode: ${mode}`);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error("Error in doPost:", err); // エラーログ
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message, stack: err.stack }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --- 画像処理 ---
function saveImageToDrive(base64Data, fileNamePrefix) {
  try {
    const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID_PHOTOS');
    if (!folderId) throw new Error('FOLDER_ID_PHOTOS is not set.');
    
    // data:image/jpeg;base64,..... を除去してデコード
    const data = base64Data.split(',')[1] || base64Data; // ヘッダがない場合も考慮
    const decoded = Utilities.base64Decode(data);
    const blob = Utilities.newBlob(decoded, 'image/jpeg', `${fileNamePrefix}_${new Date().getTime()}.jpg`);
    
    // フォルダ取得 (なければルート)
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      // フォルダIDが無効な場合はエラーにするか、一時的にルートに保存するか。今回はエラー詳細を出す
      throw new Error(`Invalid FOLDER_ID_PHOTOS: ${e.message}`);
    }

    const file = folder.createFile(blob);
    
    // 公開設定 (リンクを知っている人全員が閲覧可)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // Notion等の外部サービスでサムネイル表示させるには、Drive API (Advanced Service) から取得できる
    // thumbnailLink が最も確実です (DriveAppでは取得不可)
    // ※この機能を使うにはGASエディタで「Drive API」サービスを追加する必要があります
    const driveFile = Drive.Files.get(file.getId(), { fields: "thumbnailLink, webContentLink" });
    
    // thumbnailLinkは小さいことがあるため、サイズ指定を置き換えて大きな画像を取得できるようにするハック
    // (通常は s220 などを s1000 に置換)
    const thumbnailLink = driveFile.thumbnailLink.replace(/=s\d+$/, "=s1000");

    console.log(`Thumbnail URL acquired: ${thumbnailLink}`);
    return thumbnailLink;
  } catch (e) {
    console.error('Failed to save image to Drive:', e);
    throw new Error(`Image save failed: ${e.message}`);
  }
}

// --- Notion API: 写真プロパティ更新（＆カバー画像設定） ---
// --- Notion API: 写真プロパティ更新（＆カバー画像設定） ---
// 【改修版】Google DriveではなくNotionに直接画像をアップロードする
function performNotionUpload(pageId, imageBlob) {
  try {
    // Step 1: Uploadセッションの作成
    const initUrl = 'https://api.notion.com/v1/file_uploads';
    const initPayload = {
      file: {
        name: imageBlob.getName() || "uploaded_image.jpg",
        type: imageBlob.getContentType() || "image/jpeg"
      }
    };
    const initOptions = {
      method: 'post',
      headers: getNotionHeaders(),
      payload: JSON.stringify(initPayload)
    };
    const initRes = UrlFetchApp.fetch(initUrl, initOptions);
    const initData = JSON.parse(initRes.getContentText());
    
    const uploadUrl = initData.upload_url;
    const fileId = initData.id;
    console.log(`Upload Session Created: ${fileId}`);

    // Step 2: 画像データの送信
    // GASのUrlFetchAppはpayloadにBlobを渡すと自動的にマルチパート/form-dataになるが、
    // Notionのこのエンドポイントがバイナリ直接かマルチパートかを判別する必要あり。
    // 一般的なアップロードAPIの慣例として、fileキーで渡すことを試みる。
    const uploadPayload = {
      file: imageBlob
    };
    const uploadOptions = {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY'),
        'Notion-Version': '2022-06-28'
        // Content-Typeは指定しない (GASが境界を設定するため)
      },
      payload: uploadPayload
    };
    
    const uploadRes = UrlFetchApp.fetch(uploadUrl, uploadOptions);
    console.log(`Image content uploaded: ${uploadRes.getResponseCode()}`);

    // Step 3: ページへの紐付け (プロパティ更新)
    updatePageWithUploadedFile(pageId, fileId);
    
    return "Upload & Attach Success";

  } catch (e) {
    console.error("Notion Upload Error:", e);
    throw e;
  }
}


function updatePageWithUploadedFile(pageId, fileUploadId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  
  const payload = {
    // 1. カバー画像はスマホの表示領域を圧迫するため設定しない
    // cover: { ... },
    
    // 2. 写真プロパティの更新
    properties: {
      '写真': { 
        files: [
          {
            type: "file_upload",
            file_upload: {
              id: fileUploadId
            },
            name: "Uploaded Image"
          }
        ]
      }
    }
  };
  
  const options = {
    method: 'patch',
    headers: getNotionHeaders(),
    payload: JSON.stringify(payload)
  };
  
  const res = UrlFetchApp.fetch(url, options);
  console.log("Page property updated with file_upload");
  return JSON.parse(res.getContentText());
}



// --- メイン処理 ---
function processHukuro(id) {
  const page = findOrCreatePage(getDbId('HUKURO'), '袋ID', id, '商品名', '新規登録パーツ');
  return { 
    message: `袋「${page.properties['商品名'].rich_text[0].plain_text}」を開きます`,
    notionUrl: page.url.replace("https://", "notion://") // Notionアプリで開く
  };
}

function processHako(id) {
  const page = findOrCreatePage(getDbId('HAKO'), '箱ID', id, '箱名', '新しい箱');
  return { 
    message: `箱「${page.properties['箱名'].rich_text[0].plain_text}」を開きます`,
    notionUrl: page.url.replace("https://", "notion://")
  };
}

function processShimauStep1(id) {
  const page = findOrCreatePage(getDbId('HAKO'), '箱ID', id, '箱名', '新しい箱');
  return { 
    message: '箱を選択しました。次に袋をスキャンしてください。',
    pageId: page.id,
    name: page.properties['箱名'].rich_text[0].plain_text
  };
}

function processShimauStep2(hukuroId, hakoPageId) {
  if (!hakoPageId) throw new Error('箱が選択されていません');
  
  const hukuroPage = findOrCreatePage(getDbId('HUKURO'), '袋ID', hukuroId, '商品名', '新規登録パーツ');
  updateHukuroLocation(hukuroPage.id, hakoPageId);
  
  // 更新後の箱の情報を取得して返す
  const hakoPage = getPageById(hakoPageId);

  return { 
    message: '紐付け完了！箱のページを開きます。',
    notionUrl: hakoPage.url.replace("https://", "notion://")
  };
}

// --- Notion API ラッパー関数 ---
function getNotionHeaders() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  return {
    'Authorization': 'Bearer ' + apiKey,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

function getDbId(type) {
  const propKey = `DATABASE_ID_${type}`;
  return PropertiesService.getScriptProperties().getProperty(propKey);
}

function findOrCreatePage(databaseId, pkColumn, uid, defaultNameColumn, defaultNameValue) {
  // 1. 検索
  const queryUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const queryPayload = {
    filter: {
      property: pkColumn,
      title: { equals: uid }
    }
  };
  const queryOptions = {
    method: 'post',
    headers: getNotionHeaders(),
    payload: JSON.stringify(queryPayload)
  };
  const queryRes = UrlFetchApp.fetch(queryUrl, queryOptions);
  const queryResult = JSON.parse(queryRes.getContentText());

  if (queryResult.results.length > 0) {
    return queryResult.results[0];
  }

  // 2. なければ作成
  const createUrl = 'https://api.notion.com/v1/pages';
  const createPayload = {
    parent: { database_id: databaseId },
    properties: {
      [pkColumn]: { title: [{ text: { content: uid } }] },
      [defaultNameColumn]: { rich_text: [{ text: { content: defaultNameValue } }] }
    }
  };
   const createOptions = {
    method: 'post',
    headers: getNotionHeaders(),
    payload: JSON.stringify(createPayload)
  };
  const createRes = UrlFetchApp.fetch(createUrl, createOptions);
  return JSON.parse(createRes.getContentText());
}

function updateHukuroLocation(hukuroPageId, hakoPageId) {
  const url = `https://api.notion.com/v1/pages/${hukuroPageId}`;
  const payload = {
    properties: {
      '現在の箱': { relation: [{ id: hakoPageId }] }
    }
  };
  const options = {
    method: 'patch',
    headers: getNotionHeaders(),
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}

function getPageById(pageId) {
    const url = `https://api.notion.com/v1/pages/${pageId}`;
    const options = {
        method: 'get',
        headers: getNotionHeaders()
    };
    const res = UrlFetchApp.fetch(url, options);
    return JSON.parse(res.getContentText());
}
