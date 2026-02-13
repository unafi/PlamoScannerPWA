// --- ユーザー設定 (Script Propertiesに設定) ---
// NOTION_API_KEY: Notionインテグレーションのシークレットキー
// DATABASE_ID_HUKURO: 袋マスターDBのID
// DATABASE_ID_HAKO: 箱マスターDBのID
// FOLDER_ID_PHOTOS: 写真保存用Google DriveフォルダID

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "GAS is running correctly. Access permission is valid."
  })).setMimeType(ContentService.MimeType.JSON);
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
    
    // 直リンク用のURLを取得
    return file.getDownloadUrl();
  } catch (e) {
    console.error('Failed to save image to Drive:', e);
    throw new Error(`Image save failed: ${e.message}`);
  }
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
