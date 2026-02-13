// Service Workerの登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    let selectedHakoInfo = null; // { id: '...', name: '...' }
    let isScanning = false;
    let lockScan = false;

    // --- DOM要素 ---
    const hukuroScanBtn = document.getElementById('hukuro-scan-btn');
    const hakoScanBtn = document.getElementById('hako-scan-btn');
    const shimauBtn = document.getElementById('shimau-btn');
    const statusMessageEl = document.getElementById('status-message');
    const scannedIdEl = document.getElementById('scanned-id-display');
    const scannerContainer = document.getElementById('scanner-container');
    const scannerMessage = document.getElementById('scanner-message');
    const qrReaderEl = document.getElementById('qr-reader');
    const scannerOverlay = document.getElementById('scanner-overlay');

    // --- QRスキャナインスタンス ---
    const html5QrCode = new Html5Qrcode("qr-reader");

    // --- UI更新 ---
    const updateUI = () => {
        // ボタンのアクティブ状態
        hukuroScanBtn.classList.toggle('active', currentMode === 'HUKURO_SCAN');
        hakoScanBtn.classList.toggle('active', currentMode === 'HAKO_SCAN');
        shimauBtn.classList.toggle('active', currentMode.startsWith('SHIMAU_'));

        // ステータスメッセージ
        switch (currentMode) {
            case 'HUKURO_SCAN':
                statusMessageEl.textContent = '袋をスキャンしてください';
                break;
            case 'HAKO_SCAN':
                statusMessageEl.textContent = '箱をスキャンしてください';
                break;
            case 'SHIMAU_STEP1_HAKO':
                statusMessageEl.textContent = '【1/2】箱をスキャンしてください';
                break;
            case 'SHIMAU_STEP2_HUKURO':
                statusMessageEl.textContent = `箱\"${selectedHakoInfo?.name || ''}\"選択中。
                【2/2】袋をスキャンしてください。`;
                break;
        }
    };

    // UIを初期状態（スキャン前）に戻す関数
    function resetUI() {
        currentMode = '';
        hukuroScanBtn.classList.remove('active');
        hakoScanBtn.classList.remove('active');
        shimauBtn.classList.remove('active');
        statusMessageEl.textContent = 'ボタンを押してスキャンを開始してください';

        // 画像キャプチャ状態のリセット
        capturedImageBlob = null;
        capturedPreview.classList.add('hidden');
        previewImg.src = "";
    }

    // --- スキャナ制御 ---
    const startScanner = async () => {
        if (isScanning) return;
        scannerMessage.classList.add('hidden');
        qrReaderEl.classList.remove('hidden');
        cameraControls.classList.remove('hidden'); // カメラUI表示

        try {
            await html5QrCode.start(
                { facingMode: "environment" }, //背面カメラ
                {
                    fps: 10,
                    qrbox: (viewfinderWidth, viewfinderHeight) => {
                        const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.7;
                        return { width: size, height: size };
                    }
                },
                onScanSuccess,
                onScanFailure
            );
            isScanning = true;
        } catch (err) {
            console.error("QR Scanner failed to start.", err);
            scannerMessage.textContent = 'カメラスキャンを開始できません';
            scannerMessage.classList.remove('hidden');
            cameraControls.classList.add('hidden');
        }
    };

    const stopScanner = () => {
        if (!isScanning) return;
        try {
            html5QrCode.stop();
            isScanning = false;
            qrReaderEl.classList.add('hidden');
            scannerMessage.textContent = 'ボタンを押してスキャン開始';
            scannerMessage.classList.remove('hidden');
            cameraControls.classList.add('hidden'); // カメラUI非表示
        } catch (err) {
            console.error("QR Scanner failed to stop.", err);
        }
    };

    // --- イベントリスナー ---
    hukuroScanBtn.addEventListener('click', () => {
        currentMode = 'HUKURO_SCAN';
        selectedHakoInfo = null;
        updateUI();
        startScanner();
    });

    hakoScanBtn.addEventListener('click', () => {
        currentMode = 'HAKO_SCAN';
        selectedHakoInfo = null;
        updateUI();
        startScanner();
    });

    shimauBtn.addEventListener('click', () => {
        currentMode = 'SHIMAU_STEP1_HAKO';
        selectedHakoInfo = null;
        updateUI();
        startScanner();
    });


    // --- スキャンコールバック ---
    const onScanSuccess = (decodedText, decodedResult) => {
        if (lockScan) return;
        lockScan = true;

        console.log(`Code matched = ${decodedText}`, decodedResult);
        scannedIdEl.textContent = `ID: ${decodedText}`;
        playBeep(); // ビープ音を鳴らす

        // フラッシュエフェクト
        scannerOverlay.classList.remove('hidden');
        scannerOverlay.classList.add('flash');
        setTimeout(() => {
            scannerOverlay.classList.remove('flash');
            scannerOverlay.classList.add('hidden');
        }, 150);

        // スキャナを停止
        stopScanner();

        // バックエンドに処理を依頼
        processScannedId(decodedText);

        setTimeout(() => { lockScan = false; }, 1000); // 連続スキャン防止
    };

    const onScanFailure = (error) => {
        // スキャン失敗時は特に何もしない
    };

    // ビープ音を鳴らす関数 (Web Audio API)
    const playBeep = () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'square'; // 'sine' (正弦波) だと優しすぎるので 'square' (矩形波) か 'sawtooth' (ノコギリ波) で電子音っぽく
            osc.frequency.value = 1200; // 周波数 (Hz) - 高めの音

            // 音量制御 (フェードアウトしてプチッというノイズを防ぐ)
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);

            osc.start();
            osc.stop(ctx.currentTime + 0.1); // 0.1秒だけ鳴らす
        } catch (e) {
            console.error('Beep error:', e);
        }
    };

    // --- 撮影機能 ---
    const shutterBtn = document.getElementById('shutter-btn');
    const cancelBtn = document.getElementById('cancel-btn'); // 追加
    const cameraControls = document.getElementById('camera-controls');
    const capturedPreview = document.getElementById('captured-preview');
    const previewImg = document.getElementById('preview-img');
    // uploadTestBtnは削除済み

    let capturedImageBlob = null; // Base64 string

    // 撮影ボタン
    shutterBtn.addEventListener('click', () => {
        // html5-qrcodeのビデオ要素を取得
        let videoEl = document.querySelector('#qr-reader video');
        if (!videoEl) {
            videoEl = document.getElementById('html5-qrcode-video');
        }

        if (!videoEl) {
            console.error('Video element not found.');
            return;
        }

        // 正方形にクロップするための計算
        // 短い方の辺に合わせて正方形サイズを決定
        const size = Math.min(videoEl.videoWidth, videoEl.videoHeight);
        const startX = (videoEl.videoWidth - size) / 2;
        const startY = (videoEl.videoHeight - size) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        // サイズが0の場合はまだロードされていない
        if (canvas.width === 0 || canvas.height === 0) {
            return;
        }

        const ctx = canvas.getContext('2d');
        // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        ctx.drawImage(videoEl, startX, startY, size, size, 0, 0, size, size);

        capturedImageBlob = canvas.toDataURL('image/jpeg', 0.8);
        previewImg.src = capturedImageBlob;
        capturedPreview.classList.remove('hidden');

        // ボタンのフィードバック
        const originalText = shutterBtn.innerHTML;
        shutterBtn.textContent = '保存しました！';
        setTimeout(() => { shutterBtn.innerHTML = originalText; }, 1000);
    });

    // 中止ボタン
    cancelBtn.addEventListener('click', () => {
        stopScanner();
        resetUI();
    });

    // --- バックエンド連携 ---
    const processScannedId = async (id) => {
        statusMessageEl.textContent = '処理中...';

        const requestBody = {
            mode: currentMode,
            id: id,
            hakoPageId: selectedHakoInfo?.pageId || null,
            image: capturedImageBlob // 撮影データがあれば送信
        };

        try {
            const response = await fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                mode: 'cors', // CORS対応
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8', // GASでリダイレクトする場合
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            statusMessageEl.textContent = result.message || '完了';

            // 次のステップへ
            if (currentMode === 'SHIMAU_STEP1_HAKO') {
                // 箱にしまうモードの場合、ステップ1(箱スキャン)なら画像をクリアして次へ
                currentMode = 'SHIMAU_STEP2_HUKURO';
                selectedHakoInfo = { pageId: result.pageId, name: result.name };

                // 画像はリセットするが、スキャナは止めずに次の案内へ (ただしstartScanner呼ぶと再起動かかるのでUI更新のみ)
                capturedImageBlob = null;
                capturedPreview.classList.add('hidden');

                updateUI();
                startScanner();
            } else {
                // Notionアプリを開く
                if (result.notionUrl) {
                    window.location.href = result.notionUrl;
                }
                // 完了後、デフォルトモードに戻る
                resetUI();
            }

        } catch (err) {
            console.error('Failed to process ID:', err);
            statusMessageEl.textContent = `エラー: ${err.message}`;
        }
    };

    // 初期UI設定
    // resetUIに画像クリア処理を追加するため、元のresetUI関数をオーバーライド的に修正する必要がありますが
    // ここでは replace_file_content の範囲外にある resetUI 定義自体を修正するのがベストです。
    // 今回は範囲指定が広範囲なので、下記修正を適用します。

});
