import { DOM, AppState, historyStack, redoStack, MAX_HISTORY, ctx, overlayCtx, uiCtx, ZOOM_MIN, ZOOM_MAX } from './core/state.js';
import MathWorker from './workers/math.worker.js?worker&inline';
import DecodeWorker from './workers/decode.worker.js?worker&inline';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
    


    /* ============================================================================
       模組二：主執行緒邏輯 (Main Thread Logic)
       ============================================================================ */


    

    
    // ============================================================================
    // 主執行緒專用 1D 降維分水嶺引擎 (供魔術棒 Magic Wand 等高互動 UI 呼叫)
    // ============================================================================
    function createEmptyBlobMain(width, height) {
        return { 
            area: 0, sumX: 0, sumY: 0, 
            minX: width, maxX: 0, minY: height, maxY: 0, 
            pixelIndices: [], isTouchingLock: false 
        };
    }

    function apply1DWatershedMain(blob, imgWidth, imgHeight, pixelArray) {
        let h = blob.maxY - blob.minY + 1;
        if (h < 15) return [blob]; // 高度小於 15px 的波段通常沒有空間沾黏，直接跳過切割

        let profile = new Float32Array(h);
        for (let i = 0; i < blob.pixelIndices.length; i++) {
            let idx = blob.pixelIndices[i];
            let y = Math.floor(idx / imgWidth);
            profile[y - blob.minY] += pixelArray[idx]; // 使用傳入的線性 pixelArray
        }

        let smoothed = new Float32Array(h);
        let kernel = [0.05, 0.25, 0.40, 0.25, 0.05]; // Gaussian Smoothing Kernel
        
        for (let i = 0; i < h; i++) {
            let sum = 0, weightSum = 0;
            for (let k = -2; k <= 2; k++) {
                let idx = i + k;
                if (idx >= 0 && idx < h) {
                    sum += profile[idx] * kernel[k + 2];
                    weightSum += kernel[k + 2];
                }
            }
            smoothed[i] = sum / weightSum;
        }

        let peaks = [];
        for (let i = 2; i < h - 2; i++) {
            if (smoothed[i] > smoothed[i-1] && smoothed[i] > smoothed[i+1]) {
                peaks.push({ y: i, val: smoothed[i] });
            }
        }

        if (peaks.length < 2) return [blob]; 

        let splitLines = [];
        for (let p = 0; p < peaks.length - 1; p++) {
            let p1 = peaks[p];
            let p2 = peaks[p+1];
            let minVal = Infinity;
            let valleyY = -1;
            
            for (let i = p1.y + 1; i < p2.y; i++) {
                if (smoothed[i] < minVal) { 
                    minVal = smoothed[i]; 
                    valleyY = i; 
                }
            }
            
            let lowerPeak = Math.min(p1.val, p2.val);
            if (lowerPeak > 0 && (lowerPeak - minVal) / lowerPeak > 0.05) { 
                splitLines.push(valleyY + blob.minY); 
            }
        }

        if (splitLines.length === 0) return [blob];

        splitLines.sort((a, b) => a - b);
        splitLines.push(Infinity); 

        let subBlobArray = Array.from({length: splitLines.length}, () => createEmptyBlobMain(imgWidth, imgHeight));

        for (let i = 0; i < blob.pixelIndices.length; i++) {
            let idx = blob.pixelIndices[i];
            let y = Math.floor(idx / imgWidth);
            let x = idx % imgWidth;
            let intensity = pixelArray[idx]; // 使用傳入的線性 pixelArray

            let sIdx = 0;
            while (y > splitLines[sIdx]) { sIdx++; }

            let sb = subBlobArray[sIdx];
            sb.area += intensity;
            sb.sumX += x * intensity;
            sb.sumY += y * intensity;
            
            if (x < sb.minX) sb.minX = x; 
            if (x > sb.maxX) sb.maxX = x;
            if (y < sb.minY) sb.minY = y; 
            if (y > sb.maxY) sb.maxY = y;
            
            sb.pixelIndices.push(idx);
        }

        // ============================================================================
        // 🎯 降維再審查：強度對稱裁切引擎 (Intensity-Symmetric Trimming)
        // 解決 Watershed 切開後，朝背景端過度蔓延的不對稱「拖尾」問題
        // ============================================================================
        let finalSubBlobs = [];
        
        for (let sb of subBlobArray) {
            if (sb.pixelIndices.length < 10) continue;

            let sbH = sb.maxY - sb.minY + 1;
            let sbProfile = new Float32Array(sbH);
            
            // 1. 重建該獨立子區塊的 1D Y軸投影
            for (let i = 0; i < sb.pixelIndices.length; i++) {
                let idx = sb.pixelIndices[i];
                let y = Math.floor(idx / imgWidth);
                sbProfile[y - sb.minY] += pixelArray[idx]; // 使用線性強度
            }

            // 2. 尋找此波段的真實波峰 (Peak)
            let peakY = sb.minY;
            let peakVal = -1;
            for (let i = 0; i < sbH; i++) {
                if (sbProfile[i] > peakVal) {
                    peakVal = sbProfile[i];
                    peakY = sb.minY + i;
                }
            }

            // 3. 抓取上下邊界強度，定義「對稱閾值」
            // (Watershed 切割線的強度會遠高於外側背景，我們取兩者最大值作為嚴格的停止線)
            let topIntensity = sbProfile[0]; 
            let bottomIntensity = sbProfile[sbH - 1]; 
            
            // 乘上 0.95 作為緩衝，防止因微小數位雜訊導致過度裁切
            let symThreshold = Math.max(topIntensity, bottomIntensity) * 0.95;

            // 4. 從波峰向外探索，直到強度低於對稱閾值，找出真正的完美對稱邊界
            let newMinY = peakY;
            while (newMinY > sb.minY && sbProfile[newMinY - sb.minY - 1] >= symThreshold) {
                newMinY--;
            }
            
            let newMaxY = peakY;
            while (newMaxY < sb.maxY && sbProfile[newMaxY - sb.minY + 1] >= symThreshold) {
                newMaxY++;
            }

            // 5. 重新過濾並組裝最終的對稱 Blob
            let trimmedBlob = createEmptyBlobMain(imgWidth, imgHeight);
            for (let i = 0; i < sb.pixelIndices.length; i++) {
                let idx = sb.pixelIndices[i];
                let y = Math.floor(idx / imgWidth);
                
                // ✂️ 裁切核心：只有落在新對稱邊界內的像素才予以保留
                if (y >= newMinY && y <= newMaxY) {
                    let x = idx % imgWidth;
                    let intensity = pixelArray[idx];

                    trimmedBlob.area += intensity;
                    trimmedBlob.sumX += x * intensity;
                    trimmedBlob.sumY += y * intensity;
                    
                    if (x < trimmedBlob.minX) trimmedBlob.minX = x; 
                    if (x > trimmedBlob.maxX) trimmedBlob.maxX = x;
                    if (y < trimmedBlob.minY) trimmedBlob.minY = y; 
                    if (y > trimmedBlob.maxY) trimmedBlob.maxY = y;
                    
                    trimmedBlob.pixelIndices.push(idx);
                }
            }

            if (trimmedBlob.pixelIndices.length >= 10) { 
                trimmedBlob.centerX = Math.round(trimmedBlob.sumX / trimmedBlob.area);
                trimmedBlob.centerY = Math.round(trimmedBlob.sumY / trimmedBlob.area);
                finalSubBlobs.push(trimmedBlob);
            }
        }

        return finalSubBlobs.length > 0 ? finalSubBlobs : [blob];
    }

    // --- 絕對溯源性：檔案位元組級 SHA-256 引擎 ---
    // 直接讀取上傳檔案的二進位陣列，生成密碼學防偽指紋
    async function generateFileHash(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const arrayBuffer = event.target.result;
                    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    // 回傳前 16 碼作為專案識別綁定即可兼顧安全與可讀性
                    resolve(`AQ-FILE-${hashHex.substring(0, 16).toUpperCase()}`);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsArrayBuffer(file);
        });
    }

    // --- 稽核軌跡寫入引擎 (Audit Trail Logger) ---
    function logAudit(action, details) {
        const timestamp = new Date().toISOString();
        const record = `[${timestamp}] [${action}] ${details}`;
        AppState.data.auditTrail.push(record);
    }

    // --- 身份認證事件綁定 ---
    DOM.operatorInput.addEventListener('change', (e) => {
        AppState.sys.operator = e.target.value.trim();
        logAudit("IDENTITY", `Operator configured as: "${AppState.sys.operator}"`);
    });
    DOM.expIdInput.addEventListener('change', (e) => {
        AppState.sys.experimentId = e.target.value.trim();
        logAudit("IDENTITY", `Experiment ID configured as: "${AppState.sys.experimentId}"`);
    });

    let lastInteractedBandId = null;
    let currentPlotState = { active: false, type: null, x: null, y: null };
    
    // 繪圖與畫布高亮互動狀態
    let flashingBandId = null;
    let flashingTimer = null;
    let flashingInterval = null;
    let isFlashVisible = false;

    // 觸發畫布上的目標框進行 1.5 秒的霓虹閃爍
    function triggerCanvasFlash(bandId) {
        // 1. 中斷舊的計時器，確保可以隨時被新的點擊瞬間打斷
        if (flashingInterval) clearInterval(flashingInterval);
        if (flashingTimer) clearTimeout(flashingTimer);
        
        // 2. 更新閃爍目標
        flashingBandId = bandId;
        isFlashVisible = true;
        
        // 3. 啟動高頻重繪 (傳入 true：只閃動畫，絕對不破壞表格 DOM)
        flashingInterval = setInterval(() => {
            isFlashVisible = !isFlashVisible;
            renderCompositeState(true); 
        }, 150); 
        
        // 4. 1.5 秒後自動終止並回歸原狀
        flashingTimer = setTimeout(() => {
            clearInterval(flashingInterval);
            flashingBandId = null;
            isFlashVisible = false;
            renderCompositeState(true); 
        }, 1500);
        
        // 5. 點擊瞬間的第一幀
        renderCompositeState(true); 
    }

    let isDrawingROI = false; 
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isMouseDown = false;
    let tempRoiAngle = 0; 
    let isMagicWandMode = false;

// 預設抓取游標 (Grab Hand)
const CURSOR_GRAB = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M6 18V11.5c0-1.1.9-2 2-2s2 .9 2 2V4.5c0-1.1.9-2 2-2s2 .9 2 2V2.5c0-1.1.9-2 2-2s2 .9 2 2V4.5c0-1.1.9-2 2-2s2 .9 2 2V7.5c0-1.1.9-2 2-2s2 .9 2 2V18c0 4.4-3.6 8-8 8h-4c-4.4 0-8-3.6-8-8Z' fill='%23fff' stroke='%23000' stroke-width='2' stroke-linejoin='round'/><path d='M10 11.5V14M14 4.5V13M18 4.5V14M22 7.5V15' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'/></svg>") 16 16, grab`;

// 高精度十字準星 + 魔術棒 Emoji 游標 (Precision Magic Wand)
const CURSOR_WAND = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><line x1='12' y1='0' x2='12' y2='24' stroke='black' stroke-width='4'/><line x1='0' y1='12' x2='24' y2='12' stroke='black' stroke-width='4'/><line x1='12' y1='2' x2='12' y2='22' stroke='white' stroke-width='2'/><line x1='2' y1='12' x2='22' y2='12' stroke='white' stroke-width='2'/><text x='15' y='27' font-size='16'>🪄</text></svg>") 12 12, crosshair`;

DOM.magicWandBtn.addEventListener('click', () => {
    isMagicWandMode = !isMagicWandMode;
    if (isMagicWandMode) {
        DOM.modeBanner.innerText = "🪄 魔術棒模式：點擊微弱白影進行局部對數抓取 (再次點擊取消)"; 
        DOM.modeBanner.style.backgroundColor = "#fff3cd"; 
        DOM.modeBanner.style.color = "#856404";
        DOM.magicWandBtn.style.boxShadow = "0 0 8px rgba(253, 126, 20, 0.8)";
        DOM.overlayCanvas.style.cursor = CURSOR_WAND;
    } else {
        DOM.modeBanner.innerText = "當前模式：全圖檢視 / 參數微調"; 
        DOM.modeBanner.style = "";
        DOM.magicWandBtn.style.boxShadow = "none";
        DOM.overlayCanvas.style.cursor = ""; // ✅ 清空行內樣式，把控制權還給 CSS (:active)
    }
});

// 在 Observer 中同步解鎖魔術棒按鈕
const observer = new MutationObserver(() => {
    DOM.lockAllBtn.disabled = !AppState.sys.hasStartedAnalysis;
    DOM.unlockAllBtn.disabled = !AppState.sys.hasStartedAnalysis;
    DOM.autoHdrBtn.disabled = !AppState.sys.hasStartedAnalysis;
});
observer.observe(DOM.analyzeBtn, { attributes: true, attributeFilter: ['disabled'] });

    
    /* --- 啟動雙引擎 Web Workers --- */
    let decodeWorker = null; // 解碼 Worker 將採動態生成與銷毀機制

    const worker = new MathWorker(); // Math Worker 長駐於背景


    
    function captureState() {

         // 【OOM 記憶體解放：極限結構共享 (Structural Sharing)】
         let sharedLockedBlobs = AppState.data.lockedBlobs.map(b => ({
             ...b,
             lockedParams: { ...b.lockedParams },
             pixelIndices: b.pixelIndices // 直接傳遞 Reference
         }));

         return {
               savedData: AppState.data.saved,
               roi: { ...AppState.roi.current }, 
               roiCount: AppState.roi.count,
               hasStartedAnalysis: AppState.sys.hasStartedAnalysis,
               lockedBlobs: sharedLockedBlobs, 
               ui: {
                   angle: DOM.angleInput.value,
                   smileL: DOM.smileInputL.value, 
                   smileR: DOM.smileInputR.value,
                   isLinked: isSmileLinked,
                   radius: DOM.rbRadiusInput.value,
                   isAutoBg: DOM.autoBgToggle.checked,
                   corePct: physicalToLogical(physCore),
                   boundaryPct: physicalToLogical(physBoundary),
                   curvePower: currentCurvePower,
                   area: DOM.minAreaInput.value
               }
         };
    }
    
    function saveState() {
        historyStack.push(captureState());
        if (historyStack.length > MAX_HISTORY) {
            historyStack.shift(); 
        }
        redoStack.length = 0; 
    }

    function restoreState(state) {
        // 1. 恢復資料層狀態
        AppState.data.saved = state.savedData;
        AppState.roi.current = { ...state.roi };
        AppState.roi.count = state.roiCount;
        AppState.sys.hasStartedAnalysis = state.hasStartedAnalysis;

        // 2. 恢復 UI 參數
        DOM.angleInput.value = state.ui.angle;
        // 向下相容處理：若無 smileL，則回退抓取舊版 smile
        DOM.smileInputL.value = state.ui.smileL !== undefined ? state.ui.smileL : (state.ui.smile || 0); 
        DOM.smileInputR.value = state.ui.smileR !== undefined ? state.ui.smileR : (state.ui.smile || 0); 
        isSmileLinked = state.ui.isLinked !== undefined ? state.ui.isLinked : true;
        
        DOM.linkSmileBtn.innerText = isSmileLinked ? '🔗 Linked' : '🔓 Unlinked';
        DOM.linkSmileBtn.style.background = isSmileLinked ? 'var(--primary)' : 'var(--text-muted)';
        updateSmilePreview();
        DOM.rbRadiusInput.value = state.ui.radius;
        DOM.autoBgToggle.checked = state.ui.isAutoBg;
        DOM.minAreaInput.value = state.ui.area;
        
        currentCurvePower = state.ui.curvePower || 2.5;
        document.getElementById('curvePowerSlider').value = currentCurvePower;
        document.getElementById('curvePowerLabel').innerText = `${currentCurvePower.toFixed(1)}x`;
        physCore = logicalToPhysical(state.ui.corePct || 15);
        physBoundary = logicalToPhysical(state.ui.boundaryPct || 2);
        
        updateSliderUI();
        syncDisplays();

        // 3. 恢復 Blob 與運算狀態
        AppState.data.lockedBlobs = state.lockedBlobs.map(b => ({
             ...b,
             lockedParams: { ...b.lockedParams },
             pixelIndices: b.pixelIndices 
        }));
        
        AppState.data.workerBlobs = [];
        AppState.data.finalLanes = [];

        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
        let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
        let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;

        // 恢復 ROI UI 文字狀態
        if (AppState.roi.current.w > 0) {
               DOM.roiStatus.innerText = `鎖定區域: (${AppState.roi.current.x}, ${AppState.roi.current.y}) [${AppState.roi.current.w}x${AppState.roi.current.h}]`;
               DOM.roiStatus.style.color = 'var(--success)';
        } else {
              DOM.roiStatus.innerText = '目前狀態: 分析全圖';
              DOM.roiStatus.style.color = 'var(--text-muted)';
        }

        // 4. 恢復畫布底圖
        clearUiLayer();
        if (AppState.img.basePreview) { 
            ctx.putImageData(AppState.img.basePreview, 0, 0); 
        }
        drawPersistentROI();

        if (rw > 0 && rh > 0) {
             AppState.data.masterLockMap = new Uint8Array(rw * rh);
        }

        // 5. 直接渲染畫面並判斷 Worker 是否需要重新初始化
        if (!AppState.sys.hasStartedAnalysis) {
            renderCompositeState(); 
            generateTable(); 
            setStatus('就緒。可框選或直接分析', false);
        } else {
            renderCompositeState(); 
            
            // 判斷回復的歷史狀態是否跨越了不同的 ROI
            let workerNeedsInit = !AppState.roi.workerSynced || 
                                  (AppState.roi.workerSynced.x !== AppState.roi.current.x || 
                                   AppState.roi.workerSynced.y !== AppState.roi.current.y || 
                                   AppState.roi.workerSynced.w !== AppState.roi.current.w || 
                                   AppState.roi.workerSynced.h !== AppState.roi.current.h);

            if (workerNeedsInit) {
                AppState.roi.workerSynced = JSON.parse(JSON.stringify(AppState.roi.current));
                clearTimeout(window.initWorkerTimeout); 
                setStatus('↩ 切換 ROI，重新初始化運算核心...', true);

                window.initWorkerTimeout = setTimeout(() => {
                    AppState.data.masterLockMap = new Uint8Array(rw * rh);
                    worker.postMessage({ type: 'INIT', roi: { rx, ry, rw, rh } }); 
                }, 50);
            } else {
                syncLockMapToWorker(); 
                requestCalculation(); 
                setStatus('↩ 重新計算中...', true);
            }
        }
    }

    function undoAction() {
        if (historyStack.length === 0) { 
            setStatus('沒有可撤銷的操作', false); 
            return; 
        }
        redoStack.push(captureState());
        let previousState = historyStack.pop();
        restoreState(previousState);
        setStatus('↩ 撤銷上一步操作中', false);
    }

    function redoAction() {
        if (redoStack.length === 0) { 
            setStatus('沒有可重做的操作', false); 
            return; 
        }
        historyStack.push(captureState()); 
        let nextState = redoStack.pop();
        restoreState(nextState);
        setStatus('↪ 重新計算中', false);
    }

    /* ============================================================================
       基礎 UI 與視圖控制 (View Controllers)
       ============================================================================ */
    function setStatus(text, isProcessing) { 
        DOM.statusBadge.innerText = text; 
        DOM.statusBadge.className = isProcessing ? 'badge processing' : 'badge badge-green'; 
    }
    
    function syncDisplays() { 
        DOM.angleVal.innerText = DOM.angleInput.value + '°'; 
        DOM.rbVal.innerText = DOM.rbRadiusInput.value + ' px'; 
        DOM.areaVal.innerText = DOM.minAreaInput.value + ' px'; 
    }

    function setupCanvasDimensions(w, h) {
        DOM.imgCanvas.width = w; 
        DOM.imgCanvas.height = h;
        DOM.overlayCanvas.width = w; 
        DOM.overlayCanvas.height = h;
        DOM.uiCanvas.width = w; 
        DOM.uiCanvas.height = h;
        DOM.canvasStack.style.width = w + 'px'; 
        DOM.canvasStack.style.height = h + 'px';
        
        if (w > 0) { 
            AppState.sys.zoom = 1.0; 
            DOM.zoomBadge.style.display = 'inline-block'; 
            applyZoomEngine(AppState.sys.zoom); 
        } else { 
            DOM.zoomBadge.style.display = 'none'; 
        }
    }

    function applyZoomEngine(zoomLevel) {
        DOM.canvasStack.style.transform = `scale(${zoomLevel})`;
        DOM.scrollSpacer.style.width = (AppState.img.width * zoomLevel) + 'px';
        DOM.scrollSpacer.style.height = (AppState.img.height * zoomLevel) + 'px';
        DOM.zoomBadge.innerText = 'Zoom: ' + Math.round(zoomLevel * 100) + '%';
    }

    DOM.canvasSection.addEventListener('wheel', function(e) {
        if (!AppState.img.width) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); 
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9; 
            const oldZoom = AppState.sys.zoom;
            let nextZoom = oldZoom * zoomFactor;
            nextZoom = Math.max(ZOOM_MIN, Math.min(nextZoom, ZOOM_MAX)); 
            
            if (nextZoom === oldZoom) return;

            const rect = DOM.scrollSpacer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left; 
            const mouseY = e.clientY - rect.top;
            
            AppState.sys.zoom = nextZoom; 
            applyZoomEngine(AppState.sys.zoom);
            
            const ratio = AppState.sys.zoom / oldZoom;
            DOM.canvasSection.scrollLeft += (mouseX * ratio - mouseX); 
            DOM.canvasSection.scrollTop += (mouseY * ratio - mouseY);
        }
    }, { passive: false });

    function adjustSmartUI() {
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width; 
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
        DOM.rbRadiusInput.max = Math.floor(Math.min(rw, rh) / 2);
        syncDisplays();
    }

    function deleteSavedRow(index) {
        if (index < 0 || index >= AppState.data.saved.length) return; 
        
        const targetRoiName = AppState.data.saved[index].roiLabel; 
        const targetLaneName = AppState.data.saved[index].laneIdx;
        
        if (!confirm(`確定要將 [${targetRoiName}] 的 Lane ${targetLaneName} 數據從總表中刪除嗎？`)) {
            return;
        }
        
        saveState();

        // 【Immutable 刪除】
        AppState.data.saved = AppState.data.saved.filter((_, i) => i !== index);

        const uniqueSavedRois = [...new Set(AppState.data.saved.map(item => item.roiLabel))];
        DOM.savedCounter.innerText = `Archived: ${uniqueSavedRois.length} Block`;
        
        renderCompositeState();
        generateTable(); 
        setStatus(`已刪除 ${targetRoiName} - L${targetLaneName} 的單筆紀錄`, false);
        logAudit("DELETE", `Removed saved record for ${targetRoiName} - Lane ${targetLaneName}`);
    }

    function resetSystem() {
        if(!confirm('確定要清除所有分析與【已儲存的總表資料】嗎？\n(原始影像將會保留)')) {
            return;
        }
        
        if (AppState.img.basePreview) {
            ctx.putImageData(AppState.img.basePreview, 0, 0);
        }
        overlayCtx.clearRect(0, 0, AppState.img.width, AppState.img.height); 
        uiCtx.clearRect(0, 0, AppState.img.width, AppState.img.height);
        
        AppState.roi.current = { x: 0, y: 0, w: 0, h: 0 }; 
        AppState.roi.count = 0; 
        AppState.data.lockedBlobs = []; 
        AppState.data.masterLockMap = null; 
        AppState.data.finalLanes = []; 
        AppState.sys.hasStartedAnalysis = false;
        isDrawingROI = false; 
        isPanning = false; 
        AppState.data.saved = []; 
        DOM.savedCounter.innerText = `Archived: 0 Block`;
        AppState.sys.pingPongBuffer = null; 
        AppState.sys.renderPingPongBuffer = null; 
        AppState.sys.isWorkerBusy = false; 
        AppState.sys.pendingJob = false;
        
        // 幾何與背景參數重置
        DOM.angleInput.value = 0; 
        DOM.smileInput.value = 0;
        if (DOM.smileVal) DOM.smileVal.innerText = '0';
        DOM.rbRadiusInput.value = 50; 
        DOM.minAreaInput.value = 500;
        
        // 閾值與非線性對比 (Hysteresis & Linearity) 參數重置
        currentCurvePower = 2.5;
        document.getElementById('curvePowerSlider').value = 2.5;
        document.getElementById('curvePowerLabel').innerText = '2.5x';
        physCore = logicalToPhysical(15.0);
        physBoundary = logicalToPhysical(2.0);
        updateSliderUI(); // 同步重繪 HDR 雙向滑桿與 Tooltip

        adjustSmartUI(); 
        
        DOM.roiStatus.innerText = '目前狀態: 分析全圖'; 
        DOM.roiStatus.style.color = 'var(--text-muted)';
        DOM.modeBanner.innerText = "當前模式：全圖檢視 / 參數微調"; 
        DOM.modeBanner.className = "mode-banner";
        DOM.drawRoiBtn.innerHTML = "<span title='SHIFT+C'>✂️ Clipping</span>"; 
        DOM.uiCanvas.style.pointerEvents = 'none';
        
        DOM.exportBtn.disabled = true; 
        DOM.saveBtn.disabled = true; 
        DOM.importSessionBtn.disabled = true; 
        DOM.exportSessionBtn.disabled = true; 
        DOM.exportPdfBtn.disabled = true;
        DOM.magicWandBtn.disabled = true; // ✅ 系統重置，鎖定魔術棒
        isMagicWandMode = false;          // 確保重置時強制退出魔術棒狀態
        
        generateTable(); 
        setStatus('系統已徹底重置', false);
        logAudit("SYSTEM", "User explicitly reset the entire session data.");
    }
    DOM.resetBtn.addEventListener('click', resetSystem);

    /* ============================================================================
       檔案上傳與非同步解析佇列 (Async Multi-File Queue Parser)
       支援多檔堆疊 (Multi-File Stacking) 與單檔多圖層 (Multiplex IFD)
       ============================================================================ */
    DOM.fileInput.addEventListener('change', async function(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setStatus('準備處理影像...', true);
        
        // 【跨影像堆疊邏輯】詢問是否保留現有數據與通道
        let keepData = false;
        if (AppState.data.saved.length > 0 || (AppState.img.channels && AppState.img.channels.length > 0)) {
            keepData = confirm(`偵測到目前已有定量數據或影像通道。\n\n點擊「確定(OK)」：保留數據，將新上傳的 ${files.length} 個影像作為『新通道 (Channels)』疊加進入專案。\n點擊「取消(Cancel)」：清除所有舊數據，開啟全新專案。`);
        }

        // 清理 UI 與狀態
        if (!keepData) {
            AppState.roi.count = 0;
            AppState.data.saved = [];
            DOM.savedCounter.innerText = `Archived: 0 Block`;
            AppState.img.channels = []; // 徹底清空通道堆疊
        } else if (!AppState.img.channels) {
            AppState.img.channels = []; // 防呆初始化
        }

        AppState.data.lockedBlobs = [];
        AppState.data.masterLockMap = null;
        AppState.data.finalLanes = [];
        AppState.sys.hasStartedAnalysis = false;
        
        overlayCtx.clearRect(0, 0, AppState.img.width, AppState.img.height);
        drawPersistentROI();

        DOM.drawRoiBtn.disabled = true;
        DOM.analyzeBtn.disabled = true;
        DOM.exportBtn.disabled = true;
        DOM.saveBtn.disabled = true;
        DOM.exportSessionBtn.disabled = true;
        DOM.resetBtn.disabled = false;
        DOM.exportImgBtn.disabled = true;

        // 定義一個解析單一檔案的 Promise 包裝函數
        const parseSingleFile = async (file) => {
            const fingerprint = await generateFileHash(file);
            const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');

            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                
                if (isTiff) {
                    reader.onload = function(event) {
                        if (decodeWorker) { decodeWorker.terminate(); decodeWorker = null; }
                        
                        
                        // 動態生成瞬態 Decode Worker
                        decodeWorker = new DecodeWorker();


                        decodeWorker.onmessage = function(e) {
                            const msg = e.data;
                            if (msg.type === 'TIFF_PARSED_MULTIPLEX') {
                                // 將 Worker 回傳的資料加上該檔案專屬的溯源 Metadata
                                const parsedChannels = msg.channels.map(ch => ({
                                    fileName: file.name,
                                    fingerprint: fingerprint,
                                    width: ch.width,
                                    height: ch.height,
                                    bitDepth: ch.bitDepth,
                                    maxVal: ch.globalImageMax,
                                    mathPipelineCache: new Float32Array(ch.mathDataPipeline),
                                    basePreview: new ImageData(new Uint8ClampedArray(ch.renderPixels), ch.width, ch.height)
                                }));
                                
                                decodeWorker.terminate(); 
                                decodeWorker = null;
                                resolve(parsedChannels); // 解析成功，回傳通道陣列
                            } else if (msg.type === 'TIFF_ERROR') {
                                decodeWorker.terminate(); 
                                decodeWorker = null;
                                reject(new Error(msg.error));
                            }
                        };
                        decodeWorker.postMessage({ type: 'PARSE_TIFF', buffer: event.target.result }, [event.target.result]);
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    // 非 TIFF 影像 (JPEG/PNG) 透過 Offscreen Canvas 解析，不干擾主畫面
                    reader.onload = function(event) {
                        const img = new Image();
                        img.onload = function() {
                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = img.width; tempCanvas.height = img.height;
                            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                            tempCtx.drawImage(img, 0, 0);
                            
                            const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
                            const raw8Bit = imgData.data;

                            // 產生灰階浮點數學矩陣 (反相，背景為黑，訊號為白)
                            let mathPipelineCache = new Float32Array(img.width * img.height);
                            for (let i = 0; i < img.width * img.height; i++) {
                                let rgbaIndex = i * 4;
                                let r = raw8Bit[rgbaIndex];
                                let g = raw8Bit[rgbaIndex+1];
                                let b = raw8Bit[rgbaIndex+2];
                                mathPipelineCache[i] = 255 - ((r + g + b) / 3);
                            }

                            resolve([{
                                fileName: file.name,
                                fingerprint: fingerprint,
                                width: img.width,
                                height: img.height,
                                bitDepth: 8,
                                maxVal: 255,
                                mathPipelineCache: mathPipelineCache,
                                basePreview: imgData
                            }]);
                        };
                        img.onerror = () => reject(new Error("影像載入失敗或損毀"));
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            });
        };

        // 【非同步解析佇列】依序處理所有上傳的檔案
        try {
            for (let i = 0; i < files.length; i++) {
                setStatus(`解析與建構拓撲中 (${i+1}/${files.length}): ${files[i].name}...`, true);
                const newChannels = await parseSingleFile(files[i]);
                // 將每個檔案解析出的一個或多個通道推入全域堆疊中
                AppState.img.channels.push(...newChannels);
            }

            // 判斷是否為多通道影像並更新 UI 下拉選單
            if (AppState.img.channels.length > 1) {
                DOM.channelControl.style.display = 'block';
                DOM.channelSelect.innerHTML = '';
                AppState.img.channels.forEach((ch, idx) => {
                    let opt = document.createElement('option');
                    opt.value = idx;
                    // 在選單中直接顯示獨立的檔名與位元深度，超級直覺！
                    let shortName = ch.fileName.length > 18 ? ch.fileName.substring(0, 18) + '...' : ch.fileName;
                    opt.innerText = `[CH${idx + 1}] ${shortName} (${ch.bitDepth}-bit)`;
                    DOM.channelSelect.appendChild(opt);
                });
            } else {
                DOM.channelControl.style.display = 'none';
            }

            // 決定載入完畢後要跳轉到哪一個通道
            // 如果是保留資料 (keepData) 的堆疊模式，切換到「剛剛新增的第一張圖層」最符合直覺
            let targetIdx = keepData ? (AppState.img.channels.length - files.length) : 0;
            DOM.channelSelect.value = targetIdx;
            
            // 觸發切換核心
            switchChannel(targetIdx);

        } catch (error) {
            console.error(error);
            alert("檔案堆疊解析失敗: " + error.message);
            setStatus('解析失敗', false);
        }
        
        // 【防呆重置】清除 input file 以允許使用者重複選擇並堆疊同一個檔案
        DOM.fileInput.value = '';
    });

    // --- Multiplex & Multi-File 跨通道切換核心邏輯 ---
    function switchChannel(idx) {
        AppState.img.currentChannelIdx = idx;
        const ch = AppState.img.channels[idx];

        // 【多檔溯源防護】切換通道時，同步切換該通道所屬的檔名與數位指紋
        AppState.img.fileName = ch.fileName || AppState.img.fileName;
        AppState.img.fingerprint = ch.fingerprint || AppState.img.fingerprint;

        AppState.img.width = ch.width;
        AppState.img.height = ch.height;
        setupCanvasDimensions(ch.width, ch.height);

        AppState.img.bitDepth = ch.bitDepth;
        
        let formatStr = ch.bitDepth + '-bit';
        // 若為多通道，動態改變 Badge 顏色與文字
        if (AppState.img.channels.length > 1) {
            DOM.bitDepthBadge.innerText = `CH${idx + 1} (${formatStr})`;
            // 通道 1 藍色，通道 2 紅色，通道 3 綠色... 增加識別度
            const colors = ['badge-blue', 'badge-red', 'badge-green', 'badge-dark'];
            DOM.bitDepthBadge.className = `badge ${colors[idx % colors.length]}`;
        } else {
            DOM.bitDepthBadge.innerText = `TIFF ${formatStr}`;
            DOM.bitDepthBadge.className = 'badge badge-blue';
        }

        AppState.img.maxVal = ch.maxVal;
        AppState.img.basePreview = ch.basePreview;
        
        // 賦予當前選定的數學矩陣
        AppState.img.rawTiff = { mathPipelineCache: ch.mathPipelineCache };

        // 渲染基礎預覽圖
        ctx.putImageData(ch.basePreview, 0, 0);
        
        // 將新圖層矩陣派發給 Math Worker 準備計算
        postLoadSetup();
    }

    // 綁定通道選擇下拉選單事件
    DOM.channelSelect.addEventListener('change', (e) => {
        const targetIdx = parseInt(e.target.value);
        
        // 【防呆設計】切換通道前，檢查是否有尚未「Save Block」的懸空資料
        if (AppState.sys.hasStartedAnalysis && AppState.data.lockedBlobs.length > 0) {
            if(!confirm("⚠️ 系統偵測到畫面上有尚未儲存 (Save Block) 的鎖定波段！\n切換通道將會清空當前的運算畫面（已歸檔至總表的數據不受影響）。\n\n確定要強制切換通道嗎？")) {
                e.target.value = AppState.img.currentChannelIdx; // 復原選單狀態
                return;
            }
        // 【強制終止所有畫布高亮與閃爍計時器】
        if (flashingInterval) clearInterval(flashingInterval);
        if (flashingTimer) clearTimeout(flashingTimer);
        flashingBandId = null;
        isFlashVisible = false;
        lastInteractedBandId = null;
        
        // 【強制關閉可能開啟的光譜圖 (Profile Plot Modal)】
        DOM.plotModal.classList.remove('active');
        currentPlotState.active = false;
        }

        // 清空當前圖層的運算狀態（確保畫布乾淨），但不清空 ROI
        AppState.data.lockedBlobs = [];
        AppState.data.masterLockMap = null;
        AppState.data.finalLanes = [];
        AppState.sys.hasStartedAnalysis = false;
        AppState.data.workerBlobs = [];
        
        overlayCtx.clearRect(0, 0, AppState.img.width, AppState.img.height);
        drawPersistentROI(); // ✅ 關鍵：保留實體 ROI 框線！這使得同座標擷取成為可能
        
        DOM.saveBtn.disabled = true;
        DOM.exportBtn.disabled = true;
        
        switchChannel(targetIdx);
        setStatus(`已切換至 Channel ${targetIdx + 1}，請點擊分析`, false);
        logAudit("MULTIPLEX", `Switched active analysis layer to Channel ${targetIdx + 1}`);
    });

    function postLoadSetup() { 
        let fullMathArray = new Float32Array(AppState.img.width * AppState.img.height);
        
        if (AppState.img.rawTiff && AppState.img.rawTiff.mathPipelineCache) {
            fullMathArray.set(AppState.img.rawTiff.mathPipelineCache);
        } else if (AppState.img.raw8Bit) {
            for (let i = 0; i < AppState.img.width * AppState.img.height; i++) {
                let rgbaIndex = i * 4;
                let r = AppState.img.raw8Bit[rgbaIndex];
                let g = AppState.img.raw8Bit[rgbaIndex+1];
                let b = AppState.img.raw8Bit[rgbaIndex+2];
                fullMathArray[i] = 255 - ((r + g + b) / 3);
            }
        }
        
        // 傳送給 Worker (Zero-Copy)
        worker.postMessage({ 
            type: 'LOAD_FULL_IMAGE', 
            pixels: fullMathArray.buffer, 
            globalWidth: AppState.img.width 
        }, [fullMathArray.buffer]);

        DOM.drawRoiBtn.disabled = false; 
        DOM.analyzeBtn.disabled = false; 
        DOM.exportImgBtn.disabled = false; 
        DOM.importSessionBtn.disabled = false; 
        
        adjustSmartUI(); 
        setStatus('就緒。可框選或直接分析', false); 
        
        // 寫入第一筆稽核軌跡
        logAudit("SYSTEM", `Image Loaded: ${AppState.img.fileName} | Hash: ${AppState.img.fingerprint}`);
    }

    worker.onmessage = function(e) {
        const msg = e.data;

        if (msg.type === 'INIT_DONE') {
            AppState.roi.localMax = msg.currentRoiMax > 0 ? msg.currentRoiMax : AppState.img.maxVal; 
            let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
            let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
            
            AppState.sys.pingPongBuffer = new ArrayBuffer(rw * rh * 4); 
            AppState.sys.renderPingPongBuffer = new ArrayBuffer(rw * rh * 4); 
            
            syncLockMapToWorker(); 
            triggerWorker();
        } else if (msg.type === 'SYNC_RADIUS') {
            DOM.rbRadiusInput.value = msg.radius;
            DOM.rbVal.innerText = msg.radius + ' px (Auto)';
        } else if (msg.type === 'RESULT') {
            if (!AppState.sys.hasStartedAnalysis) return; 

            // 【雙離合器預先攔截 (Double-Clutch Interception)】
            if (AppState.sys.needsAutoBoundary && msg.autoBoundaryVal && AppState.roi.localMax > 0) {
                let dynamicPct = (msg.autoBoundaryVal / AppState.roi.localMax) * 100;
                dynamicPct = Math.max(0.1, Math.min(15.0, dynamicPct)); 
                
                physBoundary = logicalToPhysical(dynamicPct);
                physCore = logicalToPhysical(Math.min(100, dynamicPct + 12)); 
                
                updateSliderUI();
                AppState.sys.needsAutoBoundary = false; 
                
                AppState.sys.pingPongBuffer = msg.displayPixels.buffer; 
                AppState.sys.renderPingPongBuffer = msg.renderPixels;
                AppState.sys.isWorkerBusy = false;
                
                requestCalculation();
                return; 
            }

            // 【交集對最小面積比 (IoM) 堆疊過濾器】
            AppState.data.workerBlobs = [];
            for (let i = 0; i < msg.blobs.length; i++) {
                let b = msg.blobs[i];
                let isGhost = false;
                let bArea = (b.maxX - b.minX) * (b.maxY - b.minY);

                for (let j = 0; j < AppState.data.lockedBlobs.length; j++) {
                    let lb = AppState.data.lockedBlobs[j];
                    let lbArea = (lb.maxX - lb.minX) * (lb.maxY - lb.minY);
                    
                    let intersectW = Math.max(0, Math.min(b.maxX, lb.maxX) - Math.max(b.minX, lb.minX));
                    let intersectH = Math.max(0, Math.min(b.maxY, lb.maxY) - Math.max(b.minY, lb.minY));
                    
                    if (intersectW > 0 && intersectH > 0) {
                        let intersectArea = intersectW * intersectH;
                        let iom = intersectArea / Math.min(bArea, lbArea);
                        
                        let dx = Math.abs(b.centerX - lb.centerX);
                        let dy = Math.abs(b.centerY - lb.centerY);
                        
                        if (iom > 0.1 || (iom > 0.1 && dx < 15 && dy < 10)) {
                            isGhost = true; 
                            break;
                        }
                    }
                }
                if (!isGhost) {
                    AppState.data.workerBlobs.push(b);
                }
            }
            
            let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
            let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
            let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
            let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;

            let renderImageData = new ImageData(new Uint8ClampedArray(msg.renderPixels), rw, rh);
            ctx.putImageData(renderImageData, rx, ry); 

            renderCompositeState(); 
            AppState.sys.pingPongBuffer = msg.displayPixels.buffer; 
            AppState.sys.renderPingPongBuffer = msg.renderPixels;
            AppState.sys.isWorkerBusy = false;

            // 【光譜圖即時重繪引擎】
            if (currentPlotState.active && currentPlotState.type === 'current') {
                const allBlobs = [...AppState.data.lockedBlobs, ...AppState.data.workerBlobs];
                let closestBlob = null;
                let minDistance = 25; 
                
                allBlobs.forEach(b => {
                    let dist = Math.hypot(b.centerX - currentPlotState.x, b.centerY - currentPlotState.y);
                    if (dist < minDistance) { 
                        minDistance = dist; 
                        closestBlob = b; 
                    }
                });

                if (closestBlob) {
                    currentPlotState.x = closestBlob.centerX;
                    currentPlotState.y = closestBlob.centerY;
                    
                    let totalWidth = 0; 
                    allBlobs.forEach(b => { totalWidth += (b.maxX - b.minX); });
                    let dynamicLaneTolerance = Math.max((totalWidth / allBlobs.length) * 0.6, 5); 
                    const blobsInSameLane = allBlobs.filter(b => Math.abs(b.centerX - closestBlob.centerX) < dynamicLaneTolerance);
                    
                    drawProfilePlot(closestBlob, blobsInSameLane);
                } else {
                    DOM.plotModal.classList.remove('active');
                    currentPlotState.active = false;
                }
            }
            
            if (AppState.sys.pendingJob) { 
                AppState.sys.pendingJob = false; 
                triggerWorker(); 
            } else { 
                setStatus('計算完成。點擊 Band 即可「鎖定🔒」', false); 
                
                // 【狀態鎖防護】在 Auto HDR 等全域鎖定期間，禁止 Worker 擅自解開 UI 按鈕
                if (!AppState.sys.isLocked) {
                    DOM.exportBtn.disabled = false; 
                    DOM.exportPdfBtn.disabled = false;
                    DOM.saveBtn.disabled = false;
                    DOM.lockAllBtn.disabled = false;
                    DOM.autoHdrBtn.disabled = false; 
                    DOM.magicWandBtn.disabled = false; // ✅ 運算完成，解鎖魔術棒
                    DOM.unlockAllBtn.disabled = (AppState.data.lockedBlobs.length === 0);
                }

                // 【Zero-Latency 事件驅動 Hook】精準攔截 Worker 運算完成的瞬間
                if (typeof window.autoHdrResolveHook === 'function') {
                    window.autoHdrResolveHook([...AppState.data.workerBlobs]);
                    window.autoHdrResolveHook = null; // 觸發後立刻銷毀，確保單向生命週期
                }
            }
        }
    };

    function triggerWorker() {
        if (!AppState.sys.pingPongBuffer) return;
        
        AppState.sys.isWorkerBusy = true; 
        DOM.saveBtn.disabled = true; 
        setStatus('動態運算中...', true);

        worker.postMessage({ 
            type: 'PROCESS', 
            returnedBuffer: AppState.sys.pingPongBuffer, 
            returnedRenderBuffer: AppState.sys.renderPingPongBuffer,
            angle: parseFloat(DOM.angleInput.value), 
            smileFactorL: parseFloat(DOM.smileInputL.value) || 0,
            smileFactorR: parseFloat(DOM.smileInputR.value) || 0,
            radius: parseInt(DOM.rbRadiusInput.value, 10), 
            isAutoBg: DOM.autoBgToggle.checked, 
            coreThreshold: getCoreThreshold(), 
            boundaryThreshold: getBoundaryThreshold(), 
            minArea: parseInt(DOM.minAreaInput.value, 10),
            globalImageMax: AppState.img.maxVal // 直接傳遞影像最大值供對數運算使用
        }, [AppState.sys.pingPongBuffer, AppState.sys.renderPingPongBuffer]);
        
        AppState.sys.pingPongBuffer = null; 
        AppState.sys.renderPingPongBuffer = null;
    }

    function syncLockMapToWorker() {
        if (AppState.data.masterLockMap) {
            AppState.data.masterLockMap.fill(0); 
            AppState.data.lockedBlobs.forEach(blob => { 
                blob.pixelIndices.forEach(idx => { 
                    AppState.data.masterLockMap[idx] = 1; 
                }); 
            }); 
            worker.postMessage({ 
                type: 'UPDATE_LOCK_MAP', 
                lockMap: AppState.data.masterLockMap 
            });
        }
    }

    /* ============================================================================
       畫布圖層與幾何預覽渲染 (Canvas Rendering)
       ============================================================================ */
    function clearUiLayer() { 
        uiCtx.clearRect(0, 0, AppState.img.width, AppState.img.height); 
    }

    function drawPersistentROI() {
        if (isDrawingROI) return; 

        if (AppState.roi.current.w > 0) {
            uiCtx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
            uiCtx.fillRect(0, 0, AppState.img.width, AppState.img.height);

            // 當「開始分析」後，影像由 Worker 處理並以轉正狀態回傳顯示
            // 因此 UI 的 Active ROI 框也必須切換為「轉正模式」方便對齊
            const isUprightMode = AppState.sys.hasStartedAnalysis;
            const primaryColor = isUprightMode ? 'rgba(13, 202, 240, 0.9)' : 'rgba(40, 167, 69, 0.8)'; // 轉正時使用青藍色以區別狀態
            const labelText = isUprightMode ? 'Active ROI (♻︎)' : 'Active ROI';
            const labelWidth = isUprightMode ? 110 : 85;

            if (AppState.roi.current.origW) {
                const cx = AppState.roi.current.x + AppState.roi.current.w / 2;
                const cy = AppState.roi.current.y + AppState.roi.current.h / 2;
                const w = AppState.roi.current.origW;
                const h = AppState.roi.current.origH;

                uiCtx.save();
                uiCtx.translate(cx, cy);
                
                // 尚未分析且有初始傾角時，繪製傾斜的框；否則繪製零角度的轉正框
                if (!isUprightMode && AppState.roi.current.origAngle !== 0) {
                    uiCtx.rotate(AppState.roi.current.origAngle * Math.PI / 180);
                }

                uiCtx.clearRect(-w / 2, -h / 2, w, h);
                uiCtx.setLineDash([6, 4]); 
                uiCtx.lineWidth = 3; 
                uiCtx.strokeStyle = primaryColor; 
                uiCtx.strokeRect(-w / 2, -h / 2, w, h);
                
                uiCtx.fillStyle = primaryColor; 
                uiCtx.fillRect(-w / 2, -h / 2 - 25, labelWidth, 25);
                uiCtx.fillStyle = '#fff'; 
                uiCtx.font = 'bold 14px Arial'; 
                uiCtx.fillText(labelText, -w / 2 + 8, -h / 2 - 8);
                
                uiCtx.restore();
            } else {
                uiCtx.clearRect(AppState.roi.current.x, AppState.roi.current.y, AppState.roi.current.w, AppState.roi.current.h);
                uiCtx.setLineDash([6, 4]); 
                uiCtx.lineWidth = 3; 
                uiCtx.strokeStyle = primaryColor; 
                uiCtx.strokeRect(AppState.roi.current.x, AppState.roi.current.y, AppState.roi.current.w, AppState.roi.current.h);
                
                uiCtx.fillStyle = primaryColor; 
                uiCtx.fillRect(AppState.roi.current.x, AppState.roi.current.y - 25, labelWidth, 25);
                uiCtx.fillStyle = '#fff'; 
                uiCtx.font = 'bold 14px Arial'; 
                uiCtx.fillText(labelText, AppState.roi.current.x + 8, AppState.roi.current.y - 8);
            }
        }
    }

    function drawRotationPreview(angle, smileFactorL, smileFactorR) {
        clearUiLayer(); 
        drawPersistentROI(); 
        
        if (angle === 0 && smileFactorL === 0 && smileFactorR === 0) return; 
        
        const rad = angle * Math.PI / 180; 
        const invRad = -angle * Math.PI / 180; 
        let cx, cy, w, h;
        
        if (AppState.roi.current.w > 0) { 
            cx = AppState.roi.current.x + AppState.roi.current.w / 2; 
            cy = AppState.roi.current.y + AppState.roi.current.h / 2; 
            w = AppState.roi.current.origW || AppState.roi.current.w; 
            h = AppState.roi.current.origH || AppState.roi.current.h;
        } else if (AppState.img.width > 0) { 
            cx = AppState.img.width / 2; 
            cy = AppState.img.height / 2; 
            w = AppState.img.width; 
            h = AppState.img.height; 
        } else { 
            return; 
        }

        uiCtx.save(); 
        uiCtx.translate(cx, cy); 
        uiCtx.rotate(rad);        
        uiCtx.strokeStyle = 'rgba(255, 193, 7, 1)'; 
        uiCtx.lineWidth = 2; 
        uiCtx.setLineDash([8, 6]); 
        uiCtx.strokeRect(-w / 2, -h / 2, w, h); 
        uiCtx.restore(); 

        uiCtx.save(); 
        uiCtx.translate(cx, cy); 
        uiCtx.rotate(invRad); 
        uiCtx.strokeStyle = 'rgba(13, 202, 240, 1)'; 
        uiCtx.lineWidth = 2; 
        uiCtx.setLineDash([4, 4]); 
        uiCtx.beginPath(); 
        uiCtx.moveTo(-w / 2, 0); 
        uiCtx.lineTo(w / 2, 0); 
        uiCtx.moveTo(0, -h / 2); 
        uiCtx.lineTo(0, h / 2); 
        uiCtx.stroke();
        
        uiCtx.strokeStyle = 'rgba(13, 202, 240, 1)'; 
        uiCtx.lineWidth = 1; 
        uiCtx.setLineDash([2, 4]); 
        uiCtx.beginPath();
        
        const subdivisionsX = Math.max(1, Math.round(w / 100)); 
        const Sx = w / subdivisionsX;
        const subdivisionsY = Math.max(1, Math.round(h / 100)); 
        const Sy = h / subdivisionsY;
        
        for (let i = 1; i < subdivisionsX; i++) { 
            let x = -w / 2 + i * Sx; 
            let currentSmile = x < 0 ? smileFactorL : smileFactorR;
            let shift = -currentSmile * Math.pow(x / (w / 2), 2);
            if (Math.abs(x) > 1) { 
                uiCtx.moveTo(x, -h / 2 + shift); 
                uiCtx.lineTo(x, h / 2 + shift); 
            } 
        }
        
        for (let j = 1; j < subdivisionsY; j++) { 
            let y = -h / 2 + j * Sy; 
            if (Math.abs(y) > 1) { 
                // 改用高密度 Polyline 逼近分段拋物線
                let step = Math.max(1, w / 40);
                let startY = y - smileFactorL;
                uiCtx.moveTo(-w / 2, startY);
                for(let px = -w/2; px <= w/2; px += step) {
                    let k = px < 0 ? (smileFactorL / Math.pow(w/2, 2)) : (smileFactorR / Math.pow(w/2, 2));
                    uiCtx.lineTo(px, y - k * px * px);
                }
                uiCtx.lineTo(w / 2, y - smileFactorR);
            } 
        }
        
        uiCtx.stroke(); 
        uiCtx.fillStyle = 'rgba(13, 202, 240, 1)'; 
        uiCtx.beginPath(); 
        uiCtx.arc(0, 0, 3, 0, Math.PI * 2); 
        uiCtx.fill();
        uiCtx.font = 'bold 13px Arial'; 
        uiCtx.fillText('← Align', 10, -10); 
        uiCtx.restore(); 
    }

    /* ============================================================================
       ROI 圈選互動與滾輪旋轉 (Interactive ROI Drawing & Rotation)
       ============================================================================ */
    DOM.drawRoiBtn.addEventListener('click', () => {
        isDrawingROI = !isDrawingROI;
        if (isDrawingROI) {
            DOM.modeBanner.innerText = "🖍️ 裁切模式：拖曳畫框 (滑鼠滾輪可同步旋轉)"; 
            DOM.modeBanner.className = "mode-banner active-crop";
            DOM.drawRoiBtn.innerHTML = "<span title='SHIFT+C'>❌ Cancel</span>"; 
            DOM.uiCanvas.style.pointerEvents = 'auto'; 
            uiCtx.clearRect(0, 0, AppState.img.width, AppState.img.height);
        } else {
            DOM.modeBanner.innerText = "當前模式：全圖檢視 / 參數微調"; 
            DOM.modeBanner.className = "mode-banner";
            DOM.drawRoiBtn.innerHTML = "<span title='SHIFT+C'>✂️ Clipping</span>"; 
            DOM.uiCanvas.style.pointerEvents = 'none'; 
            drawPersistentROI();
        }
    });

    function getMousePos(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        return { 
            x: Math.round((evt.clientX - rect.left) * (canvas.width / rect.width)), 
            y: Math.round((evt.clientY - rect.top) * (canvas.height / rect.height)) 
        };
    }

    DOM.uiCanvas.addEventListener('pointerdown', (e) => { 
        if (!isDrawingROI || AppState.sys.isLocked) return; 
        
        DOM.uiCanvas.setPointerCapture(e.pointerId); 
        const pos = getMousePos(DOM.uiCanvas, e); 
        startX = pos.x; 
        startY = pos.y; 
        isMouseDown = true; 
        tempRoiAngle = 0; 
    });

    DOM.uiCanvas.addEventListener('wheel', (e) => {
        if (!isDrawingROI || !isMouseDown) return;
        e.preventDefault(); 
        
        tempRoiAngle += (e.deltaY > 0 ? 0.5 : -0.5);
        tempRoiAngle = Math.max(-15, Math.min(15, tempRoiAngle)); 
        
        DOM.uiCanvas.dispatchEvent(new PointerEvent('pointermove', { 
            clientX: e.clientX, 
            clientY: e.clientY, 
            pointerId: 1 
        }));
    }, { passive: false });

    DOM.uiCanvas.addEventListener('pointermove', (e) => {
        if (!isDrawingROI || !isMouseDown) return;
        const pos = getMousePos(DOM.uiCanvas, e); 
        
        if (e.clientX !== undefined) { 
            currentX = pos.x; 
            currentY = pos.y; 
        }

        uiCtx.clearRect(0, 0, AppState.img.width, AppState.img.height); 
        uiCtx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
        uiCtx.fillRect(0, 0, AppState.img.width, AppState.img.height);

        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);
        const cx = Math.min(startX, currentX) + w / 2;
        const cy = Math.min(startY, currentY) + h / 2;

        uiCtx.save();
        uiCtx.translate(cx, cy);
        uiCtx.rotate(tempRoiAngle * Math.PI / 180);
        
        uiCtx.clearRect(-w / 2, -h / 2, w, h); 
        uiCtx.setLineDash([5, 5]); 
        uiCtx.lineWidth = 2; 
        uiCtx.strokeStyle = '#ffc107'; 
        uiCtx.strokeRect(-w / 2, -h / 2, w, h);

        uiCtx.beginPath();
        uiCtx.lineWidth = 1;
        uiCtx.strokeStyle = 'rgba(255, 193, 7, 0.45)'; 
        uiCtx.setLineDash([3, 3]); 

        const subdivisionsX = Math.max(1, Math.round(w / 80)); 
        const Sx = w / subdivisionsX;
        const subdivisionsY = Math.max(1, Math.round(h / 80)); 
        const Sy = h / subdivisionsY;

        for (let i = 1; i < subdivisionsX; i++) {
            let x = -w / 2 + i * Sx;
            uiCtx.moveTo(x, -h / 2);
            uiCtx.lineTo(x, h / 2);
        }
        for (let j = 1; j < subdivisionsY; j++) {
            let y = -h / 2 + j * Sy;
            uiCtx.moveTo(-w / 2, y);
            uiCtx.lineTo(w / 2, y);
        }
        uiCtx.stroke();
        
        if (tempRoiAngle !== 0) {
            uiCtx.fillStyle = '#ffc107';
            uiCtx.font = 'bold 14px Arial';
            uiCtx.fillText(`${tempRoiAngle.toFixed(1)}°`, -w / 2, -h / 2 - 8);
        }
        uiCtx.restore();
    });
    
    function endROIDrawing(e) {
        if (!isDrawingROI || !isMouseDown) return; 
        isMouseDown = false; 
        DOM.uiCanvas.releasePointerCapture(e.pointerId);
        
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);
        
        if (w < 50 || h < 50) { 
            uiCtx.clearRect(0, 0, AppState.img.width, AppState.img.height); 
            alert("框選過小，請重試。"); 
            tempRoiAngle = 0; 
            drawPersistentROI(); 
            return; 
        }
        
        saveState();

        const cx = Math.min(startX, currentX) + w / 2;
        const cy = Math.min(startY, currentY) + h / 2;
        const rad = tempRoiAngle * Math.PI / 180;
        
        const aabbW = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)) + 80;
        const aabbH = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)) + 120;
        const aabbX = Math.round(cx - aabbW / 2);
        const aabbY = Math.round(cy - aabbH / 2);

        AppState.roi.current = { 
            x: aabbX, y: aabbY, 
            w: Math.round(aabbW), h: Math.round(aabbH),
            origW: w, origH: h, origAngle: tempRoiAngle 
        }; 
        
        AppState.roi.count++; 
        DOM.roiStatus.innerText = `鎖定區域: (${aabbX}, ${aabbY}) [${Math.round(aabbW)}x${Math.round(aabbH)}]`; 
        DOM.roiStatus.style.color = 'var(--success)';
        DOM.drawRoiBtn.click(); 
        
        AppState.data.lockedBlobs = []; 
        AppState.data.masterLockMap = null; 
        AppState.data.finalLanes = []; 
        AppState.sys.hasStartedAnalysis = false; 
        AppState.data.workerBlobs = [];
        
        DOM.angleInput.value = -tempRoiAngle; 
        // 繪製新框時，將輪廓變形參數歸零 (支援 L/R 雙參數)
        DOM.smileInputL.value = 0; 
        DOM.smileInputR.value = 0; 
        if (DOM.smileValL) DOM.smileValL.innerText = 'L: 0';
        if (DOM.smileValR) DOM.smileValR.innerText = 'R: 0';
        syncDisplays(); 
        
        overlayCtx.clearRect(0, 0, AppState.img.width, AppState.img.height); 
        if (AppState.img.basePreview) {
            ctx.putImageData(AppState.img.basePreview, 0, 0);
        }
        
        tempRoiAngle = 0; 
        DOM.saveBtn.disabled = true; 
        DOM.magicWandBtn.disabled = true; // ✅ 重新框選尚未分析，鎖定魔術棒
        generateTable(); 
    }
    DOM.uiCanvas.addEventListener('pointerup', endROIDrawing); 
    DOM.uiCanvas.addEventListener('pointercancel', endROIDrawing);

    DOM.analyzeBtn.addEventListener('click', function() {
        if (!AppState.img.rawTiff && !AppState.img.raw8Bit) return;
        
        AppState.sys.hasStartedAnalysis = true; 
        
        // 【UI 狀態同步】分析開始，準備接受轉正影像，立刻觸發 UI 外框一同轉正
        clearUiLayer();
        drawPersistentROI();

        setStatus('擷取子矩陣...', true); 
        AppState.data.lockedBlobs = []; 
        AppState.sys.needsAutoBoundary = true; 
        AppState.roi.workerSynced = JSON.parse(JSON.stringify(AppState.roi.current));

        let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
        let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;

        setTimeout(() => {
            AppState.data.masterLockMap = new Uint8Array(rw * rh); 
            worker.postMessage({ type: 'INIT', roi: { rx, ry, rw, rh } }); 
        }, 50);
    });

    /* ============================================================================
       疊加層互動控制 (Overlay Canvas Interaction)
       包含雙指縮放、拖曳、點擊波段鎖定
       ============================================================================ */
    let isPanning = false; 
    let panStartX = 0;
    let panStartY = 0; 
    let scrollStartLeft = 0;
    let scrollStartTop = 0; 
    let dragDistance = 0; 
    let activePointers = []; 
    let lastPinchDist = -1;

    DOM.overlayCanvas.addEventListener('pointerdown', function(e) {
        if (isDrawingROI || AppState.img.width === 0 || AppState.sys.isLocked) return; 
        
        DOM.overlayCanvas.setPointerCapture(e.pointerId); 
        activePointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY });

        if (activePointers.length === 1) {
            isPanning = true; 
            dragDistance = 0; 
            panStartX = e.clientX; 
            panStartY = e.clientY;
            scrollStartLeft = DOM.canvasSection.scrollLeft; 
            scrollStartTop = DOM.canvasSection.scrollTop;
        } else if (activePointers.length === 2) {
            isPanning = false; 
            dragDistance = 100; 
            lastPinchDist = Math.hypot(activePointers[0].x - activePointers[1].x, activePointers[0].y - activePointers[1].y);
        }
    });

    DOM.overlayCanvas.addEventListener('pointermove', function(e) {
        const index = activePointers.findIndex(p => p.id === e.pointerId);
        if (index !== -1) { 
            activePointers[index].x = e.clientX; 
            activePointers[index].y = e.clientY; 
        }

        if (isPanning && activePointers.length === 1) {
            const dx = e.clientX - panStartX;
            const dy = e.clientY - panStartY; 
            dragDistance += Math.abs(dx) + Math.abs(dy);
            
            DOM.canvasSection.scrollLeft = scrollStartLeft - dx; 
            DOM.canvasSection.scrollTop = scrollStartTop - dy;
        } else if (activePointers.length === 2 && lastPinchDist > 0) {
            const currentDist = Math.hypot(activePointers[0].x - activePointers[1].x, activePointers[0].y - activePointers[1].y);
            const zoomFactor = currentDist / lastPinchDist; 
            const oldZoom = AppState.sys.zoom;
            let nextZoom = oldZoom * zoomFactor; 
            
            nextZoom = Math.max(ZOOM_MIN, Math.min(nextZoom, ZOOM_MAX)); 

            if (nextZoom !== oldZoom) {
                const clientMidX = (activePointers[0].x + activePointers[1].x) / 2; 
                const clientMidY = (activePointers[0].y + activePointers[1].y) / 2;
                const rect = DOM.scrollSpacer.getBoundingClientRect();
                const mouseX = clientMidX - rect.left; 
                const mouseY = clientMidY - rect.top;

                AppState.sys.zoom = nextZoom; 
                applyZoomEngine(AppState.sys.zoom);
                
                const ratio = AppState.sys.zoom / oldZoom;
                DOM.canvasSection.scrollLeft += (mouseX * ratio - mouseX); 
                DOM.canvasSection.scrollTop += (mouseY * ratio - mouseY);
            }
            lastPinchDist = currentDist; 
        }
    });

    function removePointer(e) {
        activePointers = activePointers.filter(p => p.id !== e.pointerId);
        if (activePointers.length < 2) lastPinchDist = -1;
        
        if (activePointers.length === 1) {
            panStartX = activePointers[0].x; 
            panStartY = activePointers[0].y; 
            scrollStartLeft = DOM.canvasSection.scrollLeft; 
            scrollStartTop = DOM.canvasSection.scrollTop; 
            isPanning = true; 
        } else if (activePointers.length === 0) { 
            isPanning = false; 
        }
    }

    DOM.overlayCanvas.addEventListener('pointerleave', removePointer);
    DOM.overlayCanvas.addEventListener('pointercancel', function(e) { 
        removePointer(e); 
        DOM.overlayCanvas.releasePointerCapture(e.pointerId); 
    });

    DOM.overlayCanvas.addEventListener('pointerup', function(e) {
        const currentActivePointers = activePointers.length; 
        removePointer(e); 
        DOM.overlayCanvas.releasePointerCapture(e.pointerId);
        
        if (currentActivePointers > 1 || dragDistance > 10 || !AppState.sys.hasStartedAnalysis || !AppState.data.masterLockMap) return; 

        const pos = getMousePos(DOM.overlayCanvas, e);
        let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
        let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
        
        let localX = pos.x - rx;
        let localY = pos.y - ry;

        if (localX < 0 || localX >= rw || localY < 0 || localY >= rh) return;
        let localIndex = localY * rw + localX;
        
        // ============================================================================
        // 🪄 魔術棒攔截器：啟動局部 Log 空間拓撲與寬度 QC
        // ============================================================================
        if (isMagicWandMode || e.ctrlKey) {
            e.preventDefault();
            
            // 1. 動態寬度 QC 基準萃取 (Smart Reference Width)
            let refBlobs = AppState.data.lockedBlobs.length > 0 ? AppState.data.lockedBlobs : AppState.data.workerBlobs;
            if (refBlobs.length === 0) {
                alert('⚠️ 系統尚未建立拓撲！請先執行「▶ 動態運算與分析」以建立物理寬度基準。');
                return;
            }
            let widths = refBlobs.map(b => b.maxX - b.minX).sort((a,b) => a - b);
            let refW = widths[Math.floor(widths.length / 2)];
            
            // 🎯 新增：同泳道 (Same Lane) 幾何邊界對齊 (Vertical Clamping)
            // 將使用者的點擊位置，與畫面上現存的波段進行 X 軸垂直比對
            let laneMinX = localX - Math.floor(refW / 2);
            let laneMaxX = localX + Math.floor(refW / 2);
            let closestDist = Infinity;

            for (let b of refBlobs) {
                let dist = Math.abs(b.centerX - localX);
                // 如果現存波段的質心與點擊點在 X 軸上距離小於框寬的 60%，判定為同一個 Lane
                if (dist < refW * 0.6 && dist < closestDist) {
                    closestDist = dist;
                    laneMinX = b.minX;
                    laneMaxX = b.maxX;
                }
            }
            // 防禦陣列越界
            laneMinX = Math.max(0, laneMinX);
            laneMaxX = Math.min(rw - 1, laneMaxX);
            
            // 2. 建立局部觀察窗 (Local Viewport)
            // X 軸已被 laneMinX/MaxX 鎖死，Y 軸保留上下探索空間找連體嬰
            let pixels = new Float32Array(AppState.sys.pingPongBuffer); 
            let winHeight = Math.max(40, Math.round(refW * 2.5)); 
            let minY = Math.max(0, localY - Math.floor(winHeight/2));
            let maxY = Math.min(rh - 1, localY + Math.floor(winHeight/2));

            // 3. 種子核心極值探測 (Seed-Centric Peak Detection)
            let localMaxLog = 0;
            let getLog = (idx) => Math.log1p(pixels[idx]);
            
            // 尋峰範圍同時受到 5x5 核心與泳道物理邊界的雙重限制
            for(let y = Math.max(0, localY - 2); y <= Math.min(rh - 1, localY + 2); y++) {
                for(let x = Math.max(laneMinX, localX - 2); x <= Math.min(laneMaxX, localX + 2); x++) {
                    let valLog = getLog(y * rw + x);
                    if(valLog > localMaxLog) localMaxLog = valLog;
                }
            }
            
            if (localMaxLog < 0.1) {
                setStatus('❌ 魔術棒落空：該點無明顯訊號特徵', false);
                return;
            }

            // 4. 對數驅動水流蔓延 (Log-Driven BFS - Restricted by Lane Width)
            let logThreshold = localMaxLog * 0.55; 
            let visitedLocal = new Uint8Array(rw * rh);
            let queue = [localIndex];
            visitedLocal[localIndex] = 1;

            let wandBlob = { area: 0, sumX: 0, sumY: 0, minX: rw, maxX: 0, minY: rh, maxY: 0, pixelIndices: [] };
            const dirs = [-rw-1, -rw, -rw+1, -1, 1, rw-1, rw, rw+1];
            let head = 0;

            while(head < queue.length) {
                let curr = queue[head++];
                let cx = curr % rw;
                let cy = Math.floor(curr / rw);

                let linearIntensity = pixels[curr];
                wandBlob.area += linearIntensity; 
                wandBlob.sumX += cx * linearIntensity;
                wandBlob.sumY += cy * linearIntensity;
                if(cx < wandBlob.minX) wandBlob.minX = cx;
                if(cx > wandBlob.maxX) wandBlob.maxX = cx;
                if(cy < wandBlob.minY) wandBlob.minY = cy;
                if(cy > wandBlob.maxY) wandBlob.maxY = cy;
                wandBlob.pixelIndices.push(curr);

                for(let d of dirs) {
                    let next = curr + d;
                    let nx = next % rw;
                    let ny = Math.floor(next / rw);

                    // 🎯 核心防護：水流絕對不允許漫出 `laneMinX` 到 `laneMaxX` 之外
                    if (nx >= laneMinX && nx <= laneMaxX && ny >= minY && ny <= maxY && visitedLocal[next] === 0) {
                        if (AppState.data.masterLockMap && AppState.data.masterLockMap[next] === 1) continue; 
                        
                        if (getLog(next) >= logThreshold) {
                            visitedLocal[next] = 1;
                            queue.push(next);
                        }
                    }
                }
            }

            // 4.5 降維切割：整合 1D Watershed 處理微弱連體嬰
            // 計算母體質心供 Watershed 內部判定使用
            wandBlob.centerX = Math.round(wandBlob.sumX / wandBlob.area);
            wandBlob.centerY = Math.round(wandBlob.sumY / wandBlob.area);
            
            // ✅ 將 BFS 抓到的母體餵給【主執行緒專用】的 1D 分水嶺演算法，並傳入 pixels 矩陣
            let processedBlobs = apply1DWatershedMain(wandBlob, rw, rh, pixels);

            // 🎯 【意圖鎖定過濾器 (Intent Retention)】：
            // 如果發生了連體嬰切割，只保留包含「使用者最初點擊座標 (localIndex)」的核心框，丟棄其餘被牽連的旁觀者波段。
            if (processedBlobs.length > 1) {
                processedBlobs = processedBlobs.filter(pb => pb.pixelIndices.includes(localIndex));
            }

            // 5. 終極 QC 與陣列整合 (支援多波段切割後獨立審查)
            let capturedCount = 0;
            saveState(); // 進入迴圈前先備份一次時光機

            for (let pb of processedBlobs) {
                let wWand = pb.maxX - pb.minX;
                let hWand = pb.maxY - pb.minY;
                let pixelCount = pb.pixelIndices.length;
                let boundingBoxArea = wWand * hWand;
                let solidity = boundingBoxArea > 0 ? (pixelCount / boundingBoxArea) : 0;

                // 寬度需介於基準寬度的 0.4 倍到 1.6 倍之間，且實心度正常
                if (wWand >= Math.max(5, refW * 0.4) && wWand <= (refW * 1.6) && solidity > 0.05 && pixelCount > 8) {
                    
                    pb.centerX = Math.round(pb.sumX / pb.area);
                    pb.centerY = Math.round(pb.sumY / pb.area);
                    pb.lockedParams = { 
                        angle: DOM.angleInput.value, 
                        smileFactorL: DOM.smileInputL.value || 0,
                        smileFactorR: DOM.smileInputR.value || 0,
                        bgRadius: DOM.rbRadiusInput.value, 
                        coreThreshold: getCoreThreshold(), 
                        boundaryThreshold: getBoundaryThreshold(), 
                        minArea: DOM.minAreaInput.value,
                        method: "Magic Wand"
                    };
                    
                    // 衝突清除：移除 workerBlobs 中重疊的紅框
                    AppState.data.workerBlobs = AppState.data.workerBlobs.filter(wb => {
                        let interX = Math.max(0, Math.min(wb.maxX, pb.maxX) - Math.max(wb.minX, pb.minX));
                        let interY = Math.max(0, Math.min(wb.maxY, pb.maxY) - Math.max(wb.minY, pb.minY));
                        return !(interX > 0 && interY > 0);
                    });

                    AppState.data.lockedBlobs.push(pb);
                    logAudit("MAGIC_WAND", `Wand focused on (${pb.centerX}, ${pb.centerY}). Area: ${Math.round(pb.area)}, Width: ${wWand}px (Ref: ${refW}px)`);
                    capturedCount++;
                    
                    // 觸發畫布高亮 (如果切出兩個，最後一個會觸發閃爍)
                    triggerCanvasFlash(`coord-${rx + pb.centerX}-${ry + pb.centerY}`);
                }
            }

            if (capturedCount > 0) {
                syncLockMapToWorker(); 
                renderCompositeState(); 
                generateTable();
                setStatus(`🪄 魔術棒成功捕獲並分離了 ${capturedCount} 個弱訊號！`, false);
            } else {
                setStatus(`❌ 抓取失敗：不符物理特徵 (可能寬度異常或實心度過低)`, false);
            }
            return;
        }
        // ============================================================================

        // 點擊已鎖定波段 -> 解除鎖定
        if (AppState.data.masterLockMap[localIndex] === 1) {
            for (let i = 0; i < AppState.data.lockedBlobs.length; i++) {
                if (AppState.data.lockedBlobs[i].pixelIndices.includes(localIndex)) {
                    saveState(); 
                    lastInteractedBandId = `coord-${rx + AppState.data.lockedBlobs[i].centerX}-${ry + AppState.data.lockedBlobs[i].centerY}`;
                    AppState.data.lockedBlobs.splice(i, 1); 
                    syncLockMapToWorker(); 
                    logAudit("UNLOCK", `Manually unlocked band at local (${localX}, ${localY})`);
                    requestCalculation(); 
                    return;
                }
            }
        }
        
        // 點擊未鎖定波段 -> 建立鎖定
        for (let i = 0; i < AppState.data.workerBlobs.length; i++) {
            let b = AppState.data.workerBlobs[i];
            if (localX >= b.minX && localX <= b.maxX && localY >= b.minY && localY <= b.maxY) {
                if (b.pixelIndices.includes(localIndex)) {
                    saveState(); 
                    lastInteractedBandId = `coord-${rx + b.centerX}-${ry + b.centerY}`;
                    
                    let lockedBlobData = { ...b, pixelIndices: b.pixelIndices };
                    lockedBlobData.lockedParams = { 
                        angle: DOM.angleInput.value, 
                        smileFactorL: DOM.smileInputL.value || 0,
                        smileFactorR: DOM.smileInputR.value || 0,
                        bgRadius: DOM.rbRadiusInput.value, 
                        coreThreshold: getCoreThreshold(), 
                        boundaryThreshold: getBoundaryThreshold(), 
                        minArea: DOM.minAreaInput.value 
                    };
                    
                    AppState.data.lockedBlobs.push(lockedBlobData);
                    syncLockMapToWorker(); 
                    AppState.data.workerBlobs.splice(i, 1);
                    logAudit("LOCK", `Manually locked band at local (${b.centerX}, ${b.centerY}) with Area ${Math.round(b.area)}`);
                    renderCompositeState(); 
                    return;
                }
            }
        }
    });

    /* ============================================================================
       向量重繪與狀態整合 (Vector Overlays & Composite Rendering)
       ============================================================================ */
    // 全局共用繪圖函數，用於處理剛性旋轉與非線性微笑變形的雙重逆映射 (升級分段高精度 Polyline)
    function drawWarpedBoundingBox(ctx, localMinX, localMaxX, localMinY, localMaxY, centerX, centerY, roiW, roiH, smileFactorL, smileFactorR, isLocked, labelText, dynamicLineWidth, dynamicRadius, dynamicFontSize, isExport = false, isFlashing = false) {
        let x1 = localMinX - roiW / 2;
        let x2 = localMaxX - roiW / 2;
        let y1 = localMinY - roiH / 2;
        let y2 = localMaxY - roiH / 2;
        let cx = centerX - roiW / 2;
        
        let kL = smileFactorL ? (smileFactorL / Math.pow(roiW / 2, 2)) : 0;
        let kR = smileFactorR ? (smileFactorR / Math.pow(roiW / 2, 2)) : 0;
        
        let warpedCy = (centerY - roiH / 2) - (cx < 0 ? kL : kR) * cx * cx;
        let sy1 = y1 - (x1 < 0 ? kL : kR) * x1 * x1;
        let sy2 = y2 - (x1 < 0 ? kL : kR) * x1 * x1;
        
        if (isFlashing) {
            ctx.shadowColor = '#ffc107'; 
            ctx.shadowBlur = 12;
            ctx.strokeStyle = '#ffc107';
            ctx.lineWidth = dynamicLineWidth * 2; 
        } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isLocked ? "rgba(13, 110, 253, 0.85)" : (isExport ? "rgba(40, 167, 69, 1)" : "rgba(220, 53, 69, 0.9)");
            ctx.lineWidth = dynamicLineWidth;
        }
        
        ctx.beginPath();
        // 上方邊界 (高密度逼近)
        let step = Math.max(1, roiW / 50);
        for (let x = x1; x <= x2; x += step) {
            let curveY = y1 - (x < 0 ? kL : kR) * x * x;
            if (x === x1) ctx.moveTo(x, curveY);
            else ctx.lineTo(x, curveY);
        }
        let endTopY = y1 - (x2 < 0 ? kL : kR) * x2 * x2;
        ctx.lineTo(x2, endTopY); // 確保右端點閉合
        
        // 右側邊界
        let endBotY = y2 - (x2 < 0 ? kL : kR) * x2 * x2;
        ctx.lineTo(x2, endBotY);
        
        // 下方邊界 (反向逼近)
        for (let x = x2; x >= x1; x -= step) {
            let curveY = y2 - (x < 0 ? kL : kR) * x * x;
            ctx.lineTo(x, curveY);
        }
        ctx.lineTo(x1, sy2); // 確保左端點閉合
        ctx.closePath(); 
        ctx.stroke();
        
        // 重置陰影，避免污染接下來畫的文字與質心
        ctx.shadowColor = 'transparent'; 
        ctx.shadowBlur = 0;

        ctx.fillStyle = isFlashing ? "#ffc107" : (isLocked ? "rgba(13, 110, 253, 0.8)" : (isExport ? "rgba(40, 167, 69, 1)" : "rgba(40, 167, 69, 1)"));
        ctx.beginPath(); 
        ctx.arc(cx, warpedCy, dynamicRadius, 0, Math.PI * 2); 
        ctx.fill();
        
        ctx.font = `bold ${dynamicFontSize}px Arial`;
        if (labelText) {
            ctx.fillStyle = isFlashing ? "#ffc107" : (isLocked ? "#0d6efd" : "#28a745");
            ctx.fillText(labelText, x1, sy2 + dynamicFontSize + 2); 
        } else if (isLocked && !isExport) { 
            ctx.fillStyle = isFlashing ? "#ffc107" : "#0d6efd"; 
            ctx.fillText("🔒", x1 - dynamicFontSize/1.5, sy1 - 2); 
        }
    }

    function renderCompositeState(isJustFlashing = false) {
        let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
        let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
        
        overlayCtx.clearRect(0, 0, AppState.img.width, AppState.img.height);

        const dynamicLineWidth = Math.max(1, Math.min(3, Math.round(AppState.img.width / 2000) + 1));
        const dynamicRadius = Math.max(2, Math.min(4, Math.round(AppState.img.width / 1500) + 1));
        const dynamicFontSize = Math.max(11, Math.min(20, Math.round(AppState.img.width / 400) + 9));

        // 1. 渲染歷史已儲存波段 (加入 index 追蹤)
        AppState.data.saved.forEach((item, index) => {
            // 【跨影像視覺隔離】若這筆存檔不屬於目前畫布上的影像，則跳過不畫
            if (item.imageFingerprint && item.imageFingerprint !== AppState.img.fingerprint) return;

            let cx = item.roiX + item.roiW / 2;
            let cy = item.roiY + item.roiH / 2;
            
            let localMinX = item.minX - item.roiX;
            let localMaxX = item.maxX - item.roiX;
            let localMinY = item.minY - item.roiY;
            let localMaxY = item.maxY - item.roiY;
            
            overlayCtx.save();
            overlayCtx.translate(cx, cy);
            overlayCtx.rotate(-item.angle * Math.PI / 180); 
            
            overlayCtx.setLineDash([8, 6]);
            overlayCtx.strokeStyle = 'rgba(108, 117, 125, 0.4)';
            overlayCtx.lineWidth = 1; 
            overlayCtx.strokeRect(-item.roiW / 2, -item.roiH / 2, item.roiW, item.roiH);
            overlayCtx.setLineDash([]);

            // 判斷此儲存波段是否正在被點擊高亮
            let isFlashing = (flashingBandId === `saved-${index}`) && isFlashVisible;

            drawWarpedBoundingBox(
                overlayCtx, 
                localMinX, localMaxX, localMinY, localMaxY, 
                item.globalX - item.roiX, item.globalY - item.roiY, 
                item.roiW, item.roiH, 
                item.smileFactorL ?? item.smileFactor ?? 0, 
                item.smileFactorR ?? item.smileFactor ?? 0, 
                item.status === 'Locked', 
                `L${item.laneIdx}`, 
                dynamicLineWidth, dynamicRadius, dynamicFontSize, false, isFlashing
            );
            
            overlayCtx.restore();
        });

        // 2. 渲染當前作用中 (微調中) 波段
        const drawBlobStraight = (blob, isLocked) => {
            let globalMinX = rx + blob.minX;
            let globalMinY = ry + blob.minY;
            let w = blob.maxX - blob.minX;
            let h = blob.maxY - blob.minY;
            let globalCenterX = rx + blob.centerX;
            let globalCenterY = ry + blob.centerY;
            
            // 判斷此即時波段是否正在被點擊高亮
            let isFlashing = (flashingBandId === `coord-${globalCenterX}-${globalCenterY}`) && isFlashVisible;
            
            if (isFlashing) {
                overlayCtx.shadowColor = '#ffc107';
                overlayCtx.shadowBlur = 12;
                overlayCtx.strokeStyle = '#ffc107';
                overlayCtx.lineWidth = dynamicLineWidth * 2;
            } else {
                overlayCtx.shadowColor = 'transparent';
                overlayCtx.shadowBlur = 0;
                overlayCtx.strokeStyle = isLocked ? "rgba(13, 110, 253, 1)" : "rgba(220, 53, 69, 0.9)"; 
                overlayCtx.lineWidth = dynamicLineWidth;
            }

            overlayCtx.strokeRect(globalMinX, globalMinY, w, h);
            
            overlayCtx.shadowColor = 'transparent'; // 重置發光
            overlayCtx.shadowBlur = 0;
            
            overlayCtx.fillStyle = isFlashing ? "#ffc107" : (isLocked ? "rgba(13, 110, 253, 0.8)" : "rgba(40, 167, 69, 1)"); 
            overlayCtx.beginPath(); 
            overlayCtx.arc(globalCenterX, globalCenterY, dynamicRadius, 0, Math.PI * 2); 
            overlayCtx.fill();
            
            if (isLocked) { 
                overlayCtx.font = `bold ${dynamicFontSize}px Arial`; 
                overlayCtx.fillStyle = isFlashing ? "#ffc107" : "#0d6efd"; 
                overlayCtx.fillText("🔒", globalMinX - dynamicFontSize/1.5, globalMinY - 2); 
            }
        };

        AppState.data.lockedBlobs.forEach(b => drawBlobStraight(b, true)); 
        AppState.data.workerBlobs.forEach(b => drawBlobStraight(b, false));

        // 【優化】如果是為了「純閃爍」而重繪畫布，跳過耗時的表格分組與重建，避免卡死使用者的連續點擊
        if (!isJustFlashing) {
            const allBlobs = [...AppState.data.lockedBlobs, ...AppState.data.workerBlobs]; 
            AppState.data.finalLanes = []; 
            if (allBlobs.length > 0) {
                let totalWidth = 0; 
                allBlobs.forEach(b => { totalWidth += (b.maxX - b.minX); });
                let dynamicLaneTolerance = Math.max((totalWidth / allBlobs.length) * 0.6, 5); 

                allBlobs.sort((a, b) => a.centerX - b.centerX);
                let currentLane = [allBlobs[0]]; 
                
                for (let i = 1; i < allBlobs.length; i++) {
                    if (allBlobs[i].centerX - currentLane[currentLane.length - 1].centerX < dynamicLaneTolerance) { 
                        currentLane.push(allBlobs[i]);
                    } else { 
                        AppState.data.finalLanes.push(currentLane); 
                        currentLane = [allBlobs[i]]; 
                    }
                }
                AppState.data.finalLanes.push(currentLane);
                AppState.data.finalLanes.forEach(lane => lane.sort((a, b) => a.centerY - b.centerY));
            }
            generateTable();
        }

        if (AppState.sys.hasStartedAnalysis && !AppState.sys.isLocked) {
            DOM.unlockAllBtn.disabled = (AppState.data.lockedBlobs.length === 0);
        }
    }

    /* ============================================================================
       虛擬表格渲染與比值分析 (Virtual Table & Ratio Analysis)
       ============================================================================ */
    let unifiedTableData = []; 
    const ROW_HEIGHT = 42; 
    const OVERSCAN = 5; 
    const tableScrollContainer = document.querySelector('.table-scroll');

    function updateAnalysisOptions() {
        let maxLane = 0;
        let uniqueRois = new Set(); 
        
        unifiedTableData.forEach(r => { 
            if (r.laneIdx > maxLane) maxLane = r.laneIdx; 
            if (r.roiLabel !== "Full Image" && !r.roiLabel.includes("微調中")) {
                uniqueRois.add(r.roiLabel); 
            }
        });
        
        let currentRef = DOM.refLaneSelect.value;
        DOM.refLaneSelect.innerHTML = '<option value="none">None comparison</option>';
        for (let i = 1; i <= maxLane; i++) {
            let opt = document.createElement('option');
            opt.value = i; 
            opt.innerText = `Lane ${i} (設為基準 1.0)`;
            if (i.toString() === currentRef) opt.selected = true;
            DOM.refLaneSelect.appendChild(opt);
        }

        let currentRefRoi = DOM.refRoiSelect.value;
        DOM.refRoiSelect.innerHTML = '<option value="none">None_Only 1 block</option>';
        uniqueRois.forEach(roiName => {
            let opt = document.createElement('option');
            opt.value = roiName; 
            opt.innerText = `[${roiName}] 作為分母`;
            if (roiName === currentRefRoi) opt.selected = true;
            DOM.refRoiSelect.appendChild(opt);
        });
    }

    function prepareTableData() {
        unifiedTableData = [];
        
        AppState.data.saved.forEach((band, index) => {
            unifiedTableData.push({ 
                type: 'saved', 
                originalIndex: index, 
                id: `saved-${index}`, 
                roiLabel: band.roiLabel, 
                laneIdx: band.laneIdx, 
                bandIdx: band.bandIdx, 
                icon: band.status === 'Locked' ? '<span class="locked-icon">🔒</span>' : '自動', 
                globalX: band.globalX, 
                globalY: band.globalY, 
                area: band.area, 
                status: band.status,
                angle: band.angle, 
                bgRadius: band.bgRadius, 
                coreThreshold: band.coreThreshold, 
                boundaryThreshold: band.boundaryThreshold, 
                minArea: band.minArea
            });
        });
        
        if (AppState.data.finalLanes.length > 0) {
            // 從檔名萃取簡稱作為 Channel Name (去附檔名並截斷防破版)
            let shortName = AppState.img.fileName.split('.').slice(0, -1).join('.') || AppState.img.fileName;
            if (shortName.length > 12) shortName = shortName.substring(0, 12) + '...';
        
            // 【Multiplex 支援】動態前綴
            let chPrefix = (AppState.img.channels && AppState.img.channels.length > 1) 
                           ? `[CH${AppState.img.currentChannelIdx + 1}] ` 
                           : '';
                           
            let currentRoiLabel = AppState.roi.current.w === 0 ? `${chPrefix}Full [${shortName}]` : `${chPrefix}ROI #${AppState.roi.count} [${shortName}]`; 
            let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
            let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
            let currentAngle = DOM.angleInput.value; 
            let currentRadius = DOM.rbRadiusInput.value;
            let currentMinArea = DOM.minAreaInput.value;

            AppState.data.finalLanes.forEach((lane, laneIdx) => {
                lane.forEach((band, bandIdx) => {
                    let lockedBlob = AppState.data.lockedBlobs.find(lb => lb.centerX === band.centerX && lb.centerY === band.centerY);
                    let isLocked = !!lockedBlob; 
                    let globalX = rx + band.centerX;
                    let globalY = ry + band.centerY;
                    let bAngle = isLocked ? lockedBlob.lockedParams.angle : currentAngle;
                    let bBgRadius = isLocked ? lockedBlob.lockedParams.bgRadius : currentRadius;
                    let bCore = isLocked ? lockedBlob.lockedParams.coreThreshold : getCoreThreshold();
                    let bBoundary = isLocked ? lockedBlob.lockedParams.boundaryThreshold : getBoundaryThreshold();
                    let bMinArea = isLocked ? lockedBlob.lockedParams.minArea : currentMinArea;

                    unifiedTableData.push({ 
                        type: 'current', 
                        id: `row-coord-${globalX}-${globalY}`, 
                        roiLabel: currentRoiLabel, 
                        laneIdx: laneIdx + 1, 
                        bandIdx: bandIdx + 1, 
                        icon: isLocked ? '<span class="locked-icon">🔒</span>' : '自動', 
                        globalX: globalX, 
                        globalY: globalY, 
                        area: Math.round(band.area), 
                        isLocked: isLocked, 
                        status: isLocked ? "Locked" : "Auto", 
                        angle: bAngle, 
                        bgRadius: bBgRadius, 
                        coreThreshold: bCore, 
                        boundaryThreshold: bBoundary, 
                        minArea: bMinArea
                    });
                });
            });
        }

        updateAnalysisOptions();
        
        // --- 生化比值運算 (升級版雙重正規化引擎 Double Normalization) ---
        let intraMode = DOM.intraRatioSelect.value;
        let refLaneStr = DOM.refLaneSelect.value;
        let refLaneIdx = parseInt(refLaneStr, 10);
        let refRoiStr = DOM.refRoiSelect.value;
        let onlyLocked = DOM.onlyLockedFilter.checked; 

        let laneActiveBands = {};
        
        unifiedTableData.forEach(r => {
            if (onlyLocked && r.status !== 'Locked') return;
            let key = r.roiLabel + "_L" + r.laneIdx;
            if (!laneActiveBands[key]) laneActiveBands[key] = [];
            laneActiveBands[key].push(r);
        });

        for (let key in laneActiveBands) {
            laneActiveBands[key].sort((a, b) => a.globalY - b.globalY);
            laneActiveBands[key].forEach((band, idx) => {
                band.effectiveBandIdx = idx + 1;
            });
        }

        // 輔助函式：計算給定 ROI 與 Lane 的基礎運算值 (Base Value)
        const getBaseValue = (roiLabel, laneIndex) => {
            let key = roiLabel + "_L" + laneIndex;
            let bands = laneActiveBands[key];
            if (!bands || bands.length === 0) return null;

            let totalArea = bands.reduce((sum, b) => sum + b.area, 0);

            if (intraMode === "sum") return totalArea;
            if (intraMode === "1/2") {
                let b1 = bands.find(b => b.effectiveBandIdx === 1);
                let b2 = bands.find(b => b.effectiveBandIdx === 2);
                return (b1 && b2 && b2.area > 0) ? b1.area / b2.area : null;
            }
            if (intraMode === "2/1") {
                let b1 = bands.find(b => b.effectiveBandIdx === 1);
                let b2 = bands.find(b => b.effectiveBandIdx === 2);
                return (b2 && b1 && b1.area > 0) ? b2.area / b1.area : null;
            }
            // 針對 none 與 percent，回傳該 Lane 的總面積作為基準 (用於 Control ROI 對齊)
            return totalArea; 
        };

        unifiedTableData.forEach(row => {
            if (onlyLocked && row.status !== 'Locked') {
                row.ratioVal = `<span style="color:var(--text-muted); font-size:0.8em;" title="被過濾器排除">Ignored</span>`;
                return; 
            }

            let currentKey = row.roiLabel + "_L" + row.laneIdx;
            let currentActiveBands = laneActiveBands[currentKey];
            if (!currentActiveBands) return;

            // 1. 取得分子 (Numerator / Base Value)
            let intraVal = null;
            let totalArea = currentActiveBands.reduce((sum, b) => sum + b.area, 0);

            if (intraMode === "none") {
                intraVal = row.area;
            } else if (intraMode === "percent") {
                if (totalArea > 0) intraVal = (row.area / totalArea) * 100;
            } else {
                intraVal = getBaseValue(row.roiLabel, row.laneIdx);
            }

            if (intraVal === null) {
                row.ratioVal = `<span style="color:var(--text-muted)">N/A</span>`;
                return;
            }

            // 2. 取得分母並執行第一次正規化 (Internal Control Normalization)
            let refRoiVal = 1; 
            if (refRoiStr !== "none") {
                // 不論 Target ROI 有幾個 Band，Control ROI (如 GAPDH) 皆抓取該 Lane 的總和面積
                let controlTotal = getBaseValue(refRoiStr, row.laneIdx);
                if (controlTotal && controlTotal > 0) {
                    refRoiVal = controlTotal;
                } else {
                    row.ratioVal = `<span style="color:var(--text-muted)" title="找不到對應的 Internal Control">No Ctrl</span>`;
                    return;
                }
            }

            let normalizedVal = intraVal / refRoiVal;

            // 3. 計算基準組並執行第二次正規化 (Reference Lane Normalization)
            let finalRatio = normalizedVal;
            if (refLaneStr !== "none") {
                let refLaneBase = getBaseValue(row.roiLabel, refLaneIdx);
                
                // 例外處理：若為獨立 Band 比較 (none / percent)，必須精準找到 Ref Lane 相同索引的 Band
                if (intraMode === "none") {
                     let refLaneBands = laneActiveBands[row.roiLabel + "_L" + refLaneIdx];
                     if (refLaneBands) {
                         let targetRefBand = refLaneBands.find(b => b.effectiveBandIdx === row.effectiveBandIdx);
                         if (targetRefBand) refLaneBase = targetRefBand.area;
                         else refLaneBase = null;
                     } else refLaneBase = null;
                } else if (intraMode === "percent") {
                     let refLaneBands = laneActiveBands[row.roiLabel + "_L" + refLaneIdx];
                     if (refLaneBands) {
                         let targetRefBand = refLaneBands.find(b => b.effectiveBandIdx === row.effectiveBandIdx);
                         let refLaneTotal = refLaneBands.reduce((sum, b) => sum + b.area, 0);
                         if (targetRefBand && refLaneTotal > 0) refLaneBase = (targetRefBand.area / refLaneTotal) * 100;
                         else refLaneBase = null;
                     } else refLaneBase = null;
                }

                let refLaneCtrl = 1;
                if (refRoiStr !== "none") {
                    let refLaneCtrlTotal = getBaseValue(refRoiStr, refLaneIdx);
                    if (refLaneCtrlTotal && refLaneCtrlTotal > 0) refLaneCtrl = refLaneCtrlTotal;
                    else refLaneCtrl = null;
                }

                if (refLaneBase !== null && refLaneCtrl !== null && refLaneBase > 0) {
                    let refLaneNormalizedVal = refLaneBase / refLaneCtrl;
                    finalRatio = normalizedVal / refLaneNormalizedVal;
                } else {
                    row.ratioVal = `<span style="color:var(--text-muted)" title="基準 Lane 缺失數據">N/A Ctrl Lane</span>`;
                    return;
                }
            }

            // --- 輸出最終結果與顯示邏輯判斷 ---
            
            // 1. 處理 1/2 模式：比值只顯示在 Band 1，其餘顯示 N/A
            if (intraMode === "1/2" && row.effectiveBandIdx !== 1) {
                row.ratioVal = `<span style="color:var(--text-muted)">N/A</span>`;
                return;
            }
            
            // 2. 處理 2/1 模式：比值只顯示在 Band 2，其餘顯示 N/A
            if (intraMode === "2/1" && row.effectiveBandIdx !== 2) {
                row.ratioVal = `<span style="color:var(--text-muted)">N/A</span>`;
                return;
            }

            // 3. 處理 none 模式：若無進行跨區塊/跨Lane計算，不顯示數值，只顯示 "-"
            if (intraMode === "none" && refLaneStr === "none" && refRoiStr === "none") {
                row.ratioVal = `<span style="color:var(--text-muted); font-weight:bold;">-</span>`;
                return;
            }

            // 4. 數值格式化與後綴處理
            let suffix = (intraMode === "percent" && refLaneStr === "none" && refRoiStr === "none") ? "%" : "";
            let formattedRatio;
            
            if (intraMode === "sum" && refLaneStr === "none" && refRoiStr === "none") {
                // 單純顯示 Lane 總和時，去除小數點 (四捨五入至整數)
                formattedRatio = Math.round(finalRatio).toString();
            } else {
                // 其他比值或 Fold Change (已包含 Control 正規化後)，固定保留小數後三位以確保準確度
                formattedRatio = finalRatio.toFixed(3);
            }

            row.ratioVal = `<span class="ratio-val">${formattedRatio}${suffix}</span>`;
        });
    }

    function renderVirtualTable() {
        if (unifiedTableData.length === 0) { 
            DOM.tableBody.innerHTML = '<tr><td colspan="7" style="color: var(--text-muted); padding: 20px;">未偵測到 Band，或尚無已儲存的資料</td></tr>'; 
            return; 
        }
        
        const scrollTop = tableScrollContainer.scrollTop; 
        const viewportHeight = tableScrollContainer.clientHeight; 
        const totalRows = unifiedTableData.length;
        
        const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
        const endIndex = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
        
        const topPadding = startIndex * ROW_HEIGHT; 
        const bottomPadding = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

        let htmlBuffer = [];
        if (topPadding > 0) { 
            htmlBuffer.push(`<tr style="height: ${topPadding}px"><td colspan="7" style="padding: 0; border: none;"></td></tr>`); 
        }

        for (let i = startIndex; i < endIndex; i++) {
            const row = unifiedTableData[i];
            if (row.type === 'saved') {
                htmlBuffer.push(`
                    <tr id="${row.id}" class="saved-row">
                        <td><strong>${row.roiLabel} (已存)</strong></td>
                        <td class="lane-header">L${row.laneIdx}</td>
                        <td>${row.icon}</td>
                        <td>(${row.globalX}, ${row.globalY})</td>
                        <td class="val-display"><strong>${row.area.toLocaleString()}</strong></td>
                        <td>${row.ratioVal}</td>
                        <td><button class="btn-table-action delete-btn" data-index="${row.originalIndex}" title="刪除此筆數據">❌</button></td>
                    </tr>
                `);
            } else {
                let rowClass = row.isLocked ? 'class="locked-row"' : '';
                htmlBuffer.push(`
                    <tr id="${row.id}" class="${rowClass}">
                        <td><strong>${row.roiLabel} (微調中)</strong></td>
                        <td class="lane-header">L${row.laneIdx}</td>
                        <td>${row.icon}</td>
                        <td>(${row.globalX}, ${row.globalY})</td>
                        <td class="val-display"><strong>${row.area.toLocaleString()}</strong></td>
                        <td>${row.ratioVal}</td>
                        <td style="color: var(--text-muted); font-size: 0.85em;">-</td>
                    </tr>
                `);
            }
        }
        
        if (bottomPadding > 0) { 
            htmlBuffer.push(`<tr style="height: ${bottomPadding}px"><td colspan="7" style="padding: 0; border: none;"></td></tr>`); 
        }
        
        DOM.tableBody.innerHTML = htmlBuffer.join('');
    }

    let isScrolling = false;
    tableScrollContainer.addEventListener('scroll', () => {
        if (!isScrolling) { 
            window.requestAnimationFrame(() => { 
                renderVirtualTable(); 
                isScrolling = false; 
            }); 
            isScrolling = true; 
        }
    });

    function generateTable() {
        prepareTableData(); 
        renderVirtualTable();
        
        DOM.exportSessionBtn.disabled = AppState.data.saved.length === 0; 
        
        if (lastInteractedBandId !== null) {
            // 自動適配 'coord-...' 與 'saved-...' 兩種 ID 前綴格式
            const targetRowId = lastInteractedBandId.startsWith('coord-') ? `row-${lastInteractedBandId}` : lastInteractedBandId;
            const targetIndex = unifiedTableData.findIndex(row => row.id === targetRowId);
            
            if (targetIndex !== -1) {
                const rowTop = targetIndex * ROW_HEIGHT;
                const rowBottom = rowTop + ROW_HEIGHT;
                const currentScrollTop = tableScrollContainer.scrollTop;
                const containerHeight = tableScrollContainer.clientHeight;
                
                // 設定上下邊界的安全緩衝區 (設定為一個 ROW_HEIGHT 的距離，防止貼齊邊緣)
                const buffer = ROW_HEIGHT;

                // 智慧滑動判定：只有在太靠近邊界或超出視野時，才進行微調
                if (rowTop < currentScrollTop + buffer) {
                    // 太靠近上方邊界 -> 往上微滑
                    tableScrollContainer.scrollTop = Math.max(0, rowTop - buffer);
                } else if (rowBottom > currentScrollTop + containerHeight - buffer) {
                    // 太靠近下方邊界 -> 往下微滑
                    tableScrollContainer.scrollTop = rowBottom - containerHeight + buffer;
                }
                
                renderVirtualTable();
                
                // 中斷舊的 DOM 表格列高亮計時器，防止快速點擊時狀態互相覆蓋
                if (window.rowFlashTimeout1) clearTimeout(window.rowFlashTimeout1);
                if (window.rowFlashTimeout2) clearTimeout(window.rowFlashTimeout2);
                
                window.rowFlashTimeout1 = setTimeout(() => {
                    // 清除畫面上可能殘留的所有舊高亮
                    document.querySelectorAll('.highlight-flash').forEach(el => el.classList.remove('highlight-flash'));
                    
                    let targetElement = document.getElementById(targetRowId);
                    if (targetElement) { 
                        // 強制重啟 CSS 動畫 (Reflow 觸發)
                        void targetElement.offsetWidth;
                        targetElement.classList.add('highlight-flash'); 
                        
                        window.rowFlashTimeout2 = setTimeout(() => { 
                            if(targetElement) targetElement.classList.remove('highlight-flash'); 
                            // 只有在當前追蹤的 ID 沒被切換時，才清空它，保護連續點擊的狀態
                            if (window.currentTrackingId === targetRowId) {
                                lastInteractedBandId = null; 
                            }
                        }, 1500); 
                        window.currentTrackingId = targetRowId;
                    } else {
                        lastInteractedBandId = null;
                    }
                }, 10);
            } else { 
                lastInteractedBandId = null; 
            }
        }
    }

    DOM.intraRatioSelect.addEventListener('change', generateTable);
    DOM.refLaneSelect.addEventListener('change', generateTable);
    DOM.onlyLockedFilter.addEventListener('change', generateTable);
    DOM.refRoiSelect.addEventListener('change', generateTable);

    /* ============================================================================
       儲存與系統邏輯
       ============================================================================ */
    DOM.saveBtn.addEventListener('click', function() {
        if (AppState.data.finalLanes.length === 0) return;
        saveState();
        
        let shortName = AppState.img.fileName.split('.').slice(0, -1).join('.') || AppState.img.fileName;
        if (shortName.length > 12) shortName = shortName.substring(0, 12) + '...';
        
        // 【Multiplex 支援】動態前綴
        let chPrefix = (AppState.img.channels && AppState.img.channels.length > 1) 
                       ? `[CH${AppState.img.currentChannelIdx + 1}] ` 
                       : '';
                       
        let roiLabel = AppState.roi.current.w === 0 ? `${chPrefix}Full [${shortName}]` : `${chPrefix}ROI #${AppState.roi.count} [${shortName}]`;
        let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
        let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;

        let currentAngle = parseFloat(DOM.angleInput.value) || 0;
        let currentSmileL = parseFloat(DOM.smileInputL.value) || 0;
        let currentSmileR = parseFloat(DOM.smileInputR.value) || 0;
        let currentRadius = DOM.rbRadiusInput.value;
        let currentMinArea = DOM.minAreaInput.value;

        let processedData = AppState.sys.pingPongBuffer ? new Float32Array(AppState.sys.pingPongBuffer) : null;
        let nextGlobalSavedData = [...AppState.data.saved];

        AppState.data.finalLanes.forEach((lane, laneIdx) => {
            let laneMinY = Infinity;
            let laneMaxY = -Infinity;
            let laneMinX = Infinity;
            let laneMaxX = -Infinity;
            
            lane.forEach(b => {
                if (b.minY < laneMinY) laneMinY = b.minY;
                if (b.maxY > laneMaxY) laneMaxY = b.maxY;
                if (b.minX < laneMinX) laneMinX = b.minX;
                if (b.maxX > laneMaxX) laneMaxX = b.maxX;
            });
            
            laneMinY = Math.max(0, laneMinY - 15);
            laneMaxY = Math.min(rh - 1, laneMaxY + 15);
            
            let profileCache = [];
            if (processedData) {
                for (let y = laneMinY; y <= laneMaxY; y++) {
                    let sum = 0;
                    for (let x = laneMinX; x <= laneMaxX; x++) { 
                        sum += processedData[y * rw + x]; 
                    }
                    profileCache.push(sum);
                }
            }
            
            let laneBoundaries = lane.map(b => ({minY: b.minY, maxY: b.maxY}));

            lane.forEach((band, bandIdx) => {
                let lockedBlob = AppState.data.lockedBlobs.find(lb => lb.centerX === band.centerX && lb.centerY === band.centerY);
                let isLocked = !!lockedBlob;
                let bAngle = isLocked ? parseFloat(lockedBlob.lockedParams.angle) : currentAngle;
                let bSmileL = isLocked ? parseFloat(lockedBlob.lockedParams.smileFactorL ?? lockedBlob.lockedParams.smileFactor ?? 0) : currentSmileL;
                let bSmileR = isLocked ? parseFloat(lockedBlob.lockedParams.smileFactorR ?? lockedBlob.lockedParams.smileFactor ?? 0) : currentSmileR;
                let bBgRadius = isLocked ? lockedBlob.lockedParams.bgRadius : currentRadius;
                let bCore = isLocked ? lockedBlob.lockedParams.coreThreshold : getCoreThreshold();
                let bBoundary = isLocked ? lockedBlob.lockedParams.boundaryThreshold : getBoundaryThreshold();
                let bMinArea = isLocked ? lockedBlob.lockedParams.minArea : currentMinArea;

                nextGlobalSavedData.push({ 
                    roiLabel: roiLabel, 
                    laneIdx: laneIdx + 1, 
                    bandIdx: bandIdx + 1, 
                    status: isLocked ? "Locked" : "Auto", 
                    globalX: rx + band.centerX, 
                    globalY: ry + band.centerY, 
                    area: Math.round(band.area),
                    minX: rx + band.minX, 
                    maxX: rx + band.maxX, 
                    minY: ry + band.minY, 
                    maxY: ry + band.maxY,
                    localMinY: band.minY, 
                    localMaxY: band.maxY, 
                    roiX: rx, 
                    roiY: ry, 
                    roiW: rw, 
                    roiH: rh, 
                    angle: bAngle, 
                    smileFactorL: bSmileL, 
                    smileFactorR: bSmileR, 
                    bgRadius: bBgRadius, 
                    coreThreshold: bCore, 
                    boundaryThreshold: bBoundary, 
                    minArea: bMinArea,
                    profileCache: profileCache,
                    laneMinY: laneMinY,
                    laneMaxY: laneMaxY,
                    laneBoundaries: laneBoundaries,
                    imageFingerprint: AppState.img.fingerprint // 記錄此數據屬於哪一張影像指紋
                });
            });
        });
        
        AppState.data.saved = nextGlobalSavedData;
        DOM.savedCounter.innerText = `Archived: ${[...new Set(AppState.data.saved.map(item => item.roiLabel))].length} Block`;
        
        AppState.data.lockedBlobs = []; 
        AppState.data.masterLockMap = null; 
        AppState.data.finalLanes = []; 
        AppState.sys.hasStartedAnalysis = false; 
        AppState.data.workerBlobs = [];
        
        if (AppState.img.basePreview) {
            ctx.putImageData(AppState.img.basePreview, 0, 0);
        }
        clearUiLayer(); 
        drawPersistentROI();
        
        DOM.saveBtn.disabled = true; 
        setStatus(`✅ ${roiLabel} 已儲存！請框選下一個區域`, false); 
        generateTable();
        renderCompositeState(); 
    });

    function requestCalculation() {
        syncDisplays(); 
        if (!AppState.sys.hasStartedAnalysis) { 
            DOM.analyzeBtn.click(); 
            return; 
        }
        if (AppState.sys.isWorkerBusy) { 
            AppState.sys.pendingJob = true; 
        } else { 
            triggerWorker(); 
        }
    }

    const handleGeometricChange = () => {
        clearUiLayer(); 
        drawPersistentROI(); 
        if (AppState.data.lockedBlobs.length > 0) { 
            AppState.data.lockedBlobs = []; 
            if (AppState.data.masterLockMap) { 
                AppState.data.masterLockMap.fill(0); 
                syncLockMapToWorker(); 
            } 
            alert('注意：改變空間幾何參數會重置當前區域所有已鎖定之 Band。'); 
        }
        requestCalculation();
    };

    DOM.angleInput.addEventListener('input', () => { 
        DOM.angleVal.innerText = DOM.angleInput.value + '°'; 
        drawRotationPreview(parseFloat(DOM.angleInput.value), parseFloat(DOM.smileInput.value)); 
    });
    
    let isSmileLinked = true;

    DOM.linkSmileBtn.addEventListener('click', () => {
        isSmileLinked = !isSmileLinked;
        DOM.linkSmileBtn.innerText = isSmileLinked ? '🔗 Linked' : '🔓 Unlinked';
        DOM.linkSmileBtn.style.background = isSmileLinked ? 'var(--primary)' : 'var(--text-muted)';
        if (isSmileLinked) {
            DOM.smileInputR.value = DOM.smileInputL.value;
            DOM.smileValR.innerText = 'R: ' + DOM.smileInputR.value;
            drawRotationPreview(parseFloat(DOM.angleInput.value), parseFloat(DOM.smileInputL.value), parseFloat(DOM.smileInputR.value));
            handleGeometricChange();
        }
    });

    const updateSmilePreview = () => {
        DOM.smileValL.innerText = 'L: ' + DOM.smileInputL.value;
        DOM.smileValR.innerText = 'R: ' + DOM.smileInputR.value;
        drawRotationPreview(parseFloat(DOM.angleInput.value), parseFloat(DOM.smileInputL.value), parseFloat(DOM.smileInputR.value));
    };

    DOM.smileInputL.addEventListener('input', (e) => {
        if (isSmileLinked) DOM.smileInputR.value = e.target.value;
        updateSmilePreview();
    });
    DOM.smileInputR.addEventListener('input', (e) => {
        if (isSmileLinked) DOM.smileInputL.value = e.target.value;
        updateSmilePreview();
    });

    DOM.angleInput.addEventListener('change', (e) => {
        logAudit("PARAM", `Rotation Angle changed to ${e.target.value}°`);
        handleGeometricChange();
    });
    const logSmileChange = () => {
        logAudit("PARAM", `Smile Factor changed - L: ${DOM.smileInputL.value}, R: ${DOM.smileInputR.value}`);
        handleGeometricChange();
    };
    DOM.smileInputL.addEventListener('change', logSmileChange);
    DOM.smileInputR.addEventListener('change', logSmileChange);

    DOM.rbRadiusInput.addEventListener('input', requestCalculation); 
    DOM.rbRadiusInput.addEventListener('change', (e) => {
        logAudit("PARAM", `Rolling Ball Radius manually set to ${e.target.value}px`);
    });

    DOM.minAreaInput.addEventListener('input', requestCalculation);
    DOM.minAreaInput.addEventListener('change', (e) => {
        logAudit("PARAM", `Min Area Filter set to ${e.target.value}px`);
    });

    DOM.autoBgToggle.addEventListener('change', function() {
        logAudit("PARAM", `Auto Rolling Ball Background is now ${this.checked ? 'ON' : 'OFF'}`);
        DOM.rbRadiusInput.disabled = this.checked;
        if (this.checked) {
            DOM.rbVal.style.color = 'var(--success)';
            if (AppState.sys.hasStartedAnalysis) requestCalculation(); 
        } else {
            DOM.rbVal.style.color = 'var(--primary)';
            DOM.rbVal.innerText = DOM.rbRadiusInput.value + ' px';
            if (AppState.sys.hasStartedAnalysis) requestCalculation();
        }
    });

    /* ============================================================================
       檔案匯出與專案儲存 (Export & Session)
       ============================================================================ */
    DOM.exportImgBtn.addEventListener('click', function() {
        if (!AppState.img.width || !AppState.img.height) return;

        setStatus('正在生成高畫質標註圖...', true);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = AppState.img.width;
        tempCanvas.height = AppState.img.height;
        const tCtx = tempCanvas.getContext('2d');

        let baseImg = new ImageData(
            new Uint8ClampedArray(AppState.img.basePreview.data), 
            AppState.img.basePreview.width, 
            AppState.img.basePreview.height
        );
        tCtx.putImageData(baseImg, 0, 0);

        const dynamicLineWidth = Math.max(1, Math.min(3, Math.round(AppState.img.width / 2000) + 1));
        const dynamicRadius = Math.max(2, Math.min(4, Math.round(AppState.img.width / 1500) + 1));
        const dynamicFontSize = Math.max(11, Math.min(20, Math.round(AppState.img.width / 400) + 9));

        AppState.data.saved.forEach(item => {
            // 【跨影像視覺隔離】匯出影像時，不畫出其他 Channel 的框
            if (item.imageFingerprint && item.imageFingerprint !== AppState.img.fingerprint) return;

            let cx = item.roiX + item.roiW / 2;
            let cy = item.roiY + item.roiH / 2;
            let localMinX = item.minX - item.roiX;
            let localMaxX = item.maxX - item.roiX;
            let localMinY = item.minY - item.roiY;
            let localMaxY = item.maxY - item.roiY;
            
            tCtx.save();
            tCtx.translate(cx, cy);
            tCtx.rotate(-item.angle * Math.PI / 180); 
            
            tCtx.setLineDash([8, 6]);
            tCtx.strokeStyle = 'rgba(108, 117, 125, 0.8)';
            tCtx.lineWidth = 1; 
            tCtx.strokeRect(-item.roiW / 2, -item.roiH / 2, item.roiW, item.roiH);
            tCtx.setLineDash([]);

            // 套用全域變形渲染
            drawWarpedBoundingBox(
                tCtx, 
                localMinX, localMaxX, localMinY, localMaxY, 
                item.globalX - item.roiX, item.globalY - item.roiY, 
                item.roiW, item.roiH, 
                item.smileFactorL ?? item.smileFactor ?? 0, 
                item.smileFactorR ?? item.smileFactor ?? 0, 
                item.status === 'Locked', 
                `L${item.laneIdx}`, 
                dynamicLineWidth, dynamicRadius, dynamicFontSize, true
            );
            
            tCtx.restore();
        });

        if (AppState.sys.hasStartedAnalysis) {
            let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
            let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
            let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
            let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
            let currentAngle = parseFloat(DOM.angleInput.value) || 0;
            let currentSmileL = parseFloat(DOM.smileInputL.value) || 0;
            let currentSmileR = parseFloat(DOM.smileInputR.value) || 0;

            tCtx.save();
            tCtx.translate(rx + rw / 2, ry + rh / 2);
            tCtx.rotate(-currentAngle * Math.PI / 180);

            tCtx.setLineDash([15, 10]);
            tCtx.strokeStyle = 'rgba(255, 193, 7, 0.8)'; 
            tCtx.lineWidth = 1; 
            tCtx.strokeRect(-rw / 2, -rh / 2, rw, rh);
            tCtx.setLineDash([]);

            const currentAll = [...AppState.data.lockedBlobs, ...AppState.data.workerBlobs];
            currentAll.forEach(b => {
                let isLocked = AppState.data.lockedBlobs.includes(b);
                let blobSmileL = isLocked ? parseFloat(b.lockedParams.smileFactorL ?? b.lockedParams.smileFactor ?? 0) : currentSmileL;
                let blobSmileR = isLocked ? parseFloat(b.lockedParams.smileFactorR ?? b.lockedParams.smileFactor ?? 0) : currentSmileR;
                drawWarpedBoundingBox(tCtx, b.minX, b.maxX, b.minY, b.maxY, b.centerX, b.centerY, rw, rh, blobSmileL, blobSmileR, isLocked, null, dynamicLineWidth, dynamicRadius, dynamicFontSize, true);
            });
            
            tCtx.restore();
        }

        tempCanvas.toBlob(function(blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a"); 
            link.setAttribute("href", url);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            link.setAttribute("download", `Annotated_Image_${timestamp}.png`);
            
            document.body.appendChild(link); 
            link.click(); 
            document.body.removeChild(link); 
            URL.revokeObjectURL(url);
            
            setStatus('影像匯出成功！', false);
        }, 'image/png');
    });

    // --- 密碼學輔助函式：計算 SHA-256 Checksum ---
    async function generateSHA256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    DOM.exportSessionBtn.addEventListener('click', async function() {
        if (AppState.data.saved.length === 0) return;
        
        // 1. 準備原始核心數據 (Payload)
        const payloadData = {
            version: "12.5.08",
            operator: AppState.sys.operator,             // 【合規：身份綁定】
            experimentId: AppState.sys.experimentId,     // 【合規：身份綁定】
            imageWidth: AppState.img.width,
            imageHeight: AppState.img.height,
            originalFileName: AppState.img.fileName, 
            imageFingerprint: AppState.img.fingerprint, 
            savedData: AppState.data.saved,
            auditTrail: AppState.data.auditTrail 
        };
        
        // 2. 將核心數據字串化，準備進行密碼學雜湊
        const payloadString = JSON.stringify(payloadData);
        
        try {
            setStatus('正在生成數位簽章...', true);
            
            // 3. 產生 SHA-256 簽章
            const checksum = await generateSHA256(payloadString);
            
            // 4. 封裝最終的合規專案檔 (加入 Meta 保護殼)
            const secureSessionData = {
                _meta: {
                    type: "AutoQuantifier_SecureProject",
                    generatedAt: new Date().toISOString(),
                    signature: checksum
                },
                payload: payloadData
            };

            const blob = new Blob([JSON.stringify(secureSessionData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); 
            const link = document.createElement("a"); 
            
            link.setAttribute("href", url);
            link.setAttribute("download", `AQ_Project_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.aq`);
            document.body.appendChild(link); 
            link.click(); 
            document.body.removeChild(link); 
            URL.revokeObjectURL(url);
            
            setStatus('🔒 專案檔 (.aq) 已安全加密匯出！', false);
        } catch (e) {
            console.error("數位簽章生成失敗", e);
            setStatus('匯出失敗：加密模組異常', false);
        }
    });

    DOM.importSessionBtn.addEventListener('click', () => {
        if (!AppState.img.width) { 
            alert("請先從上方 '1. Upload Image' 載入原始圖檔！"); 
            return; 
        }
        DOM.importSessionInput.click();
    });

    DOM.importSessionInput.addEventListener('change', async function(e) {
        const file = e.target.files[0]; 
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                let parsedFile = JSON.parse(event.target.result);
                let sessionData;
                
                // 【合規性審查 (Integrity Check)】
                // 判斷是否為新版帶有數位簽章的檔案
                if (parsedFile._meta && parsedFile._meta.signature && parsedFile.payload) {
                    setStatus('驗證數位簽章中...', true);
                    const currentPayloadString = JSON.stringify(parsedFile.payload);
                    const calculatedHash = await generateSHA256(currentPayloadString);
                    
                    if (calculatedHash !== parsedFile._meta.signature) {
                        alert('🚨 【嚴重安全性警告】\n\n系統偵測到此專案檔的數位簽章 (SHA-256) 與內容不符。\n此檔案的定量數據可能已遭第三方竄改，基於資料合規性，系統拒絕載入此檔案。');
                        DOM.importSessionInput.value = ''; 
                        setStatus('載入失敗：檔案已遭竄改', false);
                        return;
                    }
                    sessionData = parsedFile.payload; // 驗證通過，解開 Payload
                } else {
                    // 向下相容舊版沒有加密的 .aq 檔
                    console.warn("載入未加密的舊版專案檔");
                    sessionData = parsedFile;
                }
                
                // 【雙重防呆驗證機制：Hash Fingerprint + Fallback Dimension】
                if (sessionData.imageFingerprint && AppState.img.fingerprint) {
                    if (sessionData.imageFingerprint !== AppState.img.fingerprint) {
                        const msg = `⚠️ 【資料錯置警告】\n此專案檔的特徵與您目前載入的影像完全不符！\n\n[專案原始圖檔]：${sessionData.originalFileName || '未知'}\n[當前載入圖檔]：${AppState.img.fileName}\n\n強制匯入將導致定量框完全錯位。您確定要強制載入嗎？`;
                        if (!confirm(msg)) {
                            DOM.importSessionInput.value = ''; 
                            setStatus('已取消載入', false);
                            return;
                        }
                    }
                } else {
                    if (sessionData.imageWidth !== AppState.img.width || sessionData.imageHeight !== AppState.img.height) {
                        if (!confirm(`⚠️ 【解析度不符警告 (舊版專案)】\n專案檔所屬影像：${sessionData.imageWidth} x ${sessionData.imageHeight}\n當前載入影像：${AppState.img.width} x ${AppState.img.height}\n\n是否仍要強制載入？`)) {
                            DOM.importSessionInput.value = ''; 
                            setStatus('已取消載入', false);
                            return;
                        }
                    }
                }
                
                saveState(); 
                AppState.data.saved = sessionData.savedData;
                AppState.data.auditTrail = sessionData.auditTrail || [];
                
                // 恢復身份認證並更新 UI
                AppState.sys.operator = sessionData.operator || "";
                AppState.sys.experimentId = sessionData.experimentId || "";
                DOM.operatorInput.value = AppState.sys.operator;
                DOM.expIdInput.value = AppState.sys.experimentId;

                logAudit("SYSTEM", `Session imported from .aq file. Operator: ${AppState.sys.operator}`);
                
                let maxRoi = 0;
                AppState.data.saved.forEach(item => {
                    let match = item.roiLabel.match(/ROI #(\d+)/);
                    if (match && parseInt(match[1]) > maxRoi) maxRoi = parseInt(match[1]);
                });
                AppState.roi.count = maxRoi;
                
                DOM.savedCounter.innerText = `Archived: ${[...new Set(AppState.data.saved.map(item => item.roiLabel))].length} Block`;
                
                renderCompositeState(); 
                generateTable();        
                setStatus('📂 🔒 專案載入成功！數位簽章驗證通過', false);
            } catch (err) { 
                alert('專案檔解析失敗，檔案可能已損毀或格式錯誤。'); 
                console.error(err); 
                setStatus('載入失敗', false);
            }
            DOM.importSessionInput.value = ''; 
        };
        reader.readAsText(file);
    });

    DOM.exportBtn.addEventListener('click', function() {
        if (unifiedTableData.length === 0) { 
            alert('沒有可匯出的數據'); 
            return; 
        }
        
        // 【合規表頭】在 CSV 最上方強制印出檔案與身份的絕對溯源資訊 & 動態檢測是否為 8-bit 測試圖檔
        let bitDepthInfo = AppState.img.bitDepth === 8 
            ? " (WARNING: 8-bit Lossy Format.)" 
            : ` (${AppState.img.bitDepth}-bit Lossless)`;

        let csvContent = `# Auto Quantifier Export Report\n`;
        csvContent += `# Operator (操作者): ${AppState.sys.operator || "Not Specified"}\n`;
        csvContent += `# Experiment ID (實驗代號): ${AppState.sys.experimentId || "Not Specified"}\n`;
        csvContent += `# Original File Name: ${AppState.img.fileName}${bitDepthInfo}\n`;
        csvContent += `# File SHA-256 Fingerprint: ${AppState.img.fingerprint}\n`;
        csvContent += `# Export Timestamp: ${new Date().toISOString()}\n`;
        csvContent += `# Audit Trail Records: ${AppState.data.auditTrail.length} events logged in the .aq session file.\n`;
        csvContent += `------------------------------------------------------------\n`;
        csvContent += "ROI,Lane,Band_Index,Status,Global_X,Global_Y,Integrated_Area,Ratio,Angle,Bg_Radius,Core_Threshold,Boundary_Threshold,Min_Area\n";
        
        unifiedTableData.forEach(item => { 
            let cleanRatio = item.ratioVal.toString().replace(/<[^>]*>?/gm, '');
            csvContent += `${item.roiLabel},${item.laneIdx},${item.bandIdx},${item.status},${item.globalX},${item.globalY},${item.area},${cleanRatio},${item.angle},${item.bgRadius},${item.coreThreshold},${item.boundaryThreshold},${item.minArea}\n`; 
        });
        
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob); 
        const link = document.createElement("a"); 
        
        link.setAttribute("href", url);
        link.setAttribute("download", `Quantification_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`);
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link); 
        URL.revokeObjectURL(url);
    });

    // --- 不可逆唯讀 PDF 報告匯出引擎 ---
    DOM.exportPdfBtn.addEventListener('click', async function() {
        if (unifiedTableData.length === 0) { 
            alert('沒有可匯出的數據'); 
            return; 
        }
        
        setStatus('正在渲染合規 PDF 報告...', true);
        
        try {
            const doc = new jsPDF('p', 'mm', 'a4'); // 直向 A4 (210 x 297 mm)
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 15;
            
            // ==========================================
            // 頁面一：Metadata 與 視覺證據 (Visual Proof)
            // ==========================================
            doc.setFontSize(18);
            doc.setTextColor(13, 110, 253); // Primary Blue
            doc.text("Auto Quantifier - Final Analysis Report", margin, 20);
            
            doc.setFontSize(10);
            doc.setTextColor(50);
            let metaY = 30;
            doc.text(`Operator: ${AppState.sys.operator || 'Not Specified'}`, margin, metaY); metaY += 6;
            doc.text(`Experiment ID: ${AppState.sys.experimentId || 'Not Specified'}`, margin, metaY); metaY += 6;
            
            // 【合規防護】8-bit 圖檔在 PDF 報告中強制標紅警告
            if (AppState.img.bitDepth === 8) {
                doc.text(`Original File: ${AppState.img.fileName}`, margin, metaY);
                doc.setTextColor(220, 53, 69); // Bootstrap Danger Red
                doc.setFont("helvetica", "bold");
                doc.text(` [8-bit Lossy Format]`, margin + doc.getTextWidth(`Original File: ${AppState.img.fileName}`), metaY);
                doc.setTextColor(50); // 恢復預設文字顏色與字重
                doc.setFont("helvetica", "normal");
                metaY += 6;
            } else {
                doc.text(`Original File: ${AppState.img.fileName} (${AppState.img.bitDepth}-bit Lossless)`, margin, metaY); metaY += 6;
            }
            
            doc.text(`Fingerprint (SHA-256): ${AppState.img.fingerprint || 'N/A'}`, margin, metaY); metaY += 6;
            doc.text(`Report Generated: ${new Date().toLocaleString()}`, margin, metaY); metaY += 10;
            
            // --- 重構：利用隱藏的 Canvas 渲染高畫質標註影像 ---
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = AppState.img.width;
            tempCanvas.height = AppState.img.height;
            const tCtx = tempCanvas.getContext('2d');

            let baseImg = new ImageData(
                new Uint8ClampedArray(AppState.img.basePreview.data), 
                AppState.img.basePreview.width, 
                AppState.img.basePreview.height
            );
            tCtx.putImageData(baseImg, 0, 0);

            const dynamicLineWidth = Math.max(1, Math.min(3, Math.round(AppState.img.width / 2000) + 1));
            const dynamicRadius = Math.max(2, Math.min(4, Math.round(AppState.img.width / 1500) + 1));
            const dynamicFontSize = Math.max(11, Math.min(20, Math.round(AppState.img.width / 400) + 9));

            // 繪製歷史歸檔波段
            AppState.data.saved.forEach(item => {
                if (item.imageFingerprint && item.imageFingerprint !== AppState.img.fingerprint) return;
                let cx = item.roiX + item.roiW / 2;
                let cy = item.roiY + item.roiH / 2;
                tCtx.save();
                tCtx.translate(cx, cy);
                tCtx.rotate(-item.angle * Math.PI / 180); 
                tCtx.setLineDash([8, 6]);
                tCtx.strokeStyle = 'rgba(108, 117, 125, 0.8)';
                tCtx.lineWidth = 1; 
                tCtx.strokeRect(-item.roiW / 2, -item.roiH / 2, item.roiW, item.roiH);
                tCtx.setLineDash([]);
                drawWarpedBoundingBox(
                    tCtx, item.minX - item.roiX, item.maxX - item.roiX, 
                    item.minY - item.roiY, item.maxY - item.roiY, 
                    item.globalX - item.roiX, item.globalY - item.roiY, 
                    item.roiW, item.roiH, 
                    item.smileFactorL ?? item.smileFactor ?? 0,
                    item.smileFactorR ?? item.smileFactor ?? 0,
                    item.status === 'Locked', 
                    `L${item.laneIdx}`, 
                    dynamicLineWidth, dynamicRadius, dynamicFontSize, true
                );
                tCtx.restore();
            });

            // 繪製微調中波段
            if (AppState.sys.hasStartedAnalysis) {
                let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
                let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
                let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
                let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;
                let currentAngle = parseFloat(DOM.angleInput.value) || 0;
                let currentSmileL = parseFloat(DOM.smileInputL.value) || 0;
                let currentSmileR = parseFloat(DOM.smileInputR.value) || 0;

                tCtx.save();
                tCtx.translate(rx + rw / 2, ry + rh / 2);
                tCtx.rotate(-currentAngle * Math.PI / 180);
                tCtx.setLineDash([15, 10]);
                tCtx.strokeStyle = 'rgba(255, 193, 7, 0.8)'; 
                tCtx.lineWidth = 1; 
                tCtx.strokeRect(-rw / 2, -rh / 2, rw, rh);
                tCtx.setLineDash([]);

                const currentAll = [...AppState.data.lockedBlobs, ...AppState.data.workerBlobs];
                currentAll.forEach(b => {
                    let isLocked = AppState.data.lockedBlobs.includes(b);
                    let blobSmileL = isLocked ? parseFloat(b.lockedParams.smileFactorL ?? b.lockedParams.smileFactor ?? 0) : currentSmileL;
                    let blobSmileR = isLocked ? parseFloat(b.lockedParams.smileFactorR ?? b.lockedParams.smileFactor ?? 0) : currentSmileR;
                    drawWarpedBoundingBox(tCtx, b.minX, b.maxX, b.minY, b.maxY, b.centerX, b.centerY, rw, rh, blobSmileL, blobSmileR, isLocked, null, dynamicLineWidth, dynamicRadius, dynamicFontSize, true);
            });
                tCtx.restore();
            }

            // 抽取圖片轉為高壓縮比的 JPEG (縮減 PDF 體積)
            const imgData = tempCanvas.toDataURL('image/jpeg', 0.85);
            
            // 計算 A4 版面最適縮放比例
            const maxImgWidth = pageWidth - margin * 2;
            const imgRatio = tempCanvas.height / tempCanvas.width;
            let finalImgW = maxImgWidth;
            let finalImgH = maxImgWidth * imgRatio;
            
            // 保護機制：若影像屬於瘦長型 (如切割單排的膠片)，限制其高度避免超過一頁
            if (finalImgH > 130) {
                finalImgH = 130;
                finalImgW = finalImgH / imgRatio;
            }
            
            // 置中繪製影像
            const imgOffsetX = margin + (maxImgWidth - finalImgW) / 2;
            doc.addImage(imgData, 'JPEG', imgOffsetX, metaY, finalImgW, finalImgH);
            let currentY = metaY + finalImgH + 15;

            // ==========================================
            // 頁面二：定量數據總表 (AutoTable)
            // ==========================================
            const tableHead = [["ROI Label", "Lane", "Band", "Area (Int)", "Ratio"]];
            // 清理 HTML tag，轉換為純文字
            const tableBody = unifiedTableData.map(row => [
                row.roiLabel,
                `Lane ${row.laneIdx}`,
                `B${row.bandIdx}`,
                row.area.toLocaleString(),
                row.ratioVal.toString().replace(/<[^>]*>?/gm, '')
            ]);
            
            doc.autoTable({
                startY: currentY,
                head: tableHead,
                body: tableBody,
                theme: 'striped',
                headStyles: { fillColor: [13, 110, 253] },
                styles: { fontSize: 9 },
                margin: { left: margin, right: margin }
            });
            
            // ==========================================
            // 頁面三：系統稽核軌跡 (Audit Trail Logs)
            // ==========================================
            doc.addPage();
            doc.setFontSize(14);
            doc.setTextColor(0);
            doc.text("System Audit Trail", margin, 20);
            
            const auditBody = AppState.data.auditTrail.map(log => {
                // 利用正則表達式拆解我們之前設計的 Log 格式：[時間] [動作] 細節
                const match = log.match(/\[(.*?)\] \[(.*?)\] (.*)/);
                if(match) return [match[1], match[2], match[3]];
                return ["", "SYS", log]; // Fallback
            });
            
            doc.autoTable({
                startY: 28,
                head: [["Timestamp", "Action", "Detail"]],
                body: auditBody,
                theme: 'plain',
                styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
                headStyles: { textColor: [100, 100, 100], fontStyle: 'bold' },
                columnStyles: {
                    0: { cellWidth: 42 },
                    1: { cellWidth: 20 },
                    2: { cellWidth: 'auto' }
                },
                margin: { left: margin, right: margin }
            });
            
            // 匯出實體檔案
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            doc.save(`AQ_GLP_Report_${timestamp}.pdf`);
            
            setStatus('📄 PDF 合規報告匯出成功！', false);
            logAudit("EXPORT", "Exported GLP-compliant PDF report.");
            
        } catch (err) {
            console.error(err);
            setStatus('PDF 匯出失敗', false);
        }
    });

    /* ============================================================================
       介面響應式與熱鍵綁定
       ============================================================================ */
    let isResizingWorkspace = false;

    DOM.resizer.addEventListener('pointerdown', (e) => {
        isResizingWorkspace = true; 
        DOM.resizer.setPointerCapture(e.pointerId); 
        DOM.resizer.classList.add('active'); 
        document.body.style.cursor = 'row-resize'; 
    });

    DOM.resizer.addEventListener('pointermove', (e) => {
        if (!isResizingWorkspace) return;
        
        const containerRect = DOM.workspace.getBoundingClientRect();
        let newTableHeight = containerRect.bottom - e.clientY - 15; 
        const minTableHeight = 100; 
        const maxTableHeight = containerRect.height - 150; 
        
        if (newTableHeight < minTableHeight) newTableHeight = minTableHeight;
        if (newTableHeight > maxTableHeight) newTableHeight = maxTableHeight;
        
        DOM.tableSection.style.flexBasis = newTableHeight + 'px'; 
        DOM.tableSection.style.height = newTableHeight + 'px';
    });

    function stopWorkspaceResize(e) {
        if (!isResizingWorkspace) return;
        isResizingWorkspace = false; 
        DOM.resizer.releasePointerCapture(e.pointerId); 
        DOM.resizer.classList.remove('active'); 
        document.body.style.cursor = ''; 
    }

    DOM.resizer.addEventListener('pointerup', stopWorkspaceResize); 
    DOM.resizer.addEventListener('pointercancel', stopWorkspaceResize);

    function toggleSidebar() {
        const isOpen = DOM.sidebar.classList.contains('open');
        if (isOpen) {
            DOM.sidebar.classList.remove('open'); 
            DOM.sidebarBackdrop.classList.remove('active');
            setTimeout(() => { DOM.sidebarBackdrop.style.display = 'none'; }, 300);
        } else {
            DOM.sidebarBackdrop.style.display = 'block'; 
            void DOM.sidebarBackdrop.offsetWidth;
            DOM.sidebar.classList.add('open'); 
            DOM.sidebarBackdrop.classList.add('active');
        }
    }

    DOM.mobileMenuBtn.addEventListener('click', toggleSidebar);
    DOM.sidebarBackdrop.addEventListener('click', toggleSidebar);
    
    DOM.analyzeBtn.addEventListener('click', () => { 
        if (window.innerWidth <= 768 && DOM.sidebar.classList.contains('open')) { 
            toggleSidebar(); 
        } 
    });

    document.addEventListener('keydown', function(e) {
        if (AppState.sys.isLocked) { 
            e.preventDefault(); 
            return; 
        } 
        if (e.target.tagName === 'INPUT' && e.target.type !== 'file' && e.target.type !== 'range' && e.target.type !== 'checkbox') {
            return;
        }
        
        const key = e.key.toLowerCase(); 
        const isCtrl = e.ctrlKey || e.metaKey; 
        const isShift = e.shiftKey;
        
        // 🪄 當按下 Ctrl 鍵時
        if (e.key === 'Control' && AppState.sys.hasStartedAnalysis && !isDrawingROI) {
            if (isMagicWandMode) {
                // 如果已經開啟魔術棒模式，按下 Ctrl 就幫他解除 (觸發按鈕點擊)
                DOM.magicWandBtn.click();
            }
            // 【UX 護欄】無論是哪種情況，只要此時按著 Ctrl，游標就必須維持魔術棒狀態
            // 這樣可以防禦使用者開啟按鈕後，又習慣性地使用 Ctrl+Click 導致的誤觸
            DOM.overlayCanvas.style.cursor = CURSOR_WAND;
        }

        if (isCtrl && !isShift && key === 'z') { 
            e.preventDefault(); 
            undoAction(); 
            return; 
        }
        if ((isCtrl && key === 'y') || (isCtrl && isShift && key === 'z')) { 
            e.preventDefault(); 
            redoAction(); 
            return; 
        }
        if (isCtrl && key === 's') { 
            e.preventDefault(); 
            if (!DOM.saveBtn.disabled) DOM.saveBtn.click(); 
            return; 
        }
        if (isCtrl && key === 'd') { 
            e.preventDefault(); 
            if (!DOM.exportBtn.disabled) DOM.exportBtn.click(); 
            return; 
        }
        if (isCtrl && key === 'e') { 
            e.preventDefault(); 
            if (!DOM.exportImgBtn.disabled) DOM.exportImgBtn.click(); 
            return; 
        }
        if (isShift && key === 'c') { 
            e.preventDefault(); 
            if (!DOM.drawRoiBtn.disabled) DOM.drawRoiBtn.click(); 
            return; 
        }
        // ✅ Esc 鍵防護升級
        if (key === 'escape') { 
            e.preventDefault(); 
            if (isDrawingROI) { DOM.drawRoiBtn.click(); return; } 
            if (isMagicWandMode) { DOM.magicWandBtn.click(); return; } // 優先解除魔術棒，而不是重置系統
            if (!DOM.resetBtn.disabled) DOM.resetBtn.click(); 
            return; 
        }
    });
    
    document.addEventListener('keyup', function(e) {
        // 🪄 當放開 Ctrl 鍵時，根據目前是否處於魔術棒模式決定游標狀態
        if (e.key === 'Control' && AppState.sys.hasStartedAnalysis && !isDrawingROI) {
            DOM.overlayCanvas.style.cursor = isMagicWandMode ? CURSOR_WAND : ""; // ✅ 清空行內樣式，還給 CSS
        }
    });

    /* ============================================================================
       光譜圖表控制邏輯 (Profile Plot Modal Dragging)
       ============================================================================ */
    let plotDragState = { 
        isDragging: false, 
        startX: 0, 
        startY: 0, 
        currentX: 0, 
        currentY: 0 
    };

    DOM.plotHeader.addEventListener('pointerdown', (e) => {
        // 防止拖曳事件吞噬按鈕的點擊 (加入 button 的通用豁免)
        if (e.target.closest('button')) return;
        
        plotDragState.isDragging = true;
        plotDragState.startX = e.clientX - plotDragState.currentX;
        plotDragState.startY = e.clientY - plotDragState.currentY;
        
        DOM.plotModal.style.transition = 'none'; 
        DOM.plotHeader.setPointerCapture(e.pointerId);
    });

    DOM.plotHeader.addEventListener('pointermove', (e) => {
        if (!plotDragState.isDragging) return;
        
        plotDragState.currentX = e.clientX - plotDragState.startX;
        plotDragState.currentY = e.clientY - plotDragState.startY;
        DOM.plotModal.style.transform = `translate(${plotDragState.currentX}px, ${plotDragState.currentY}px)`;
    });

    const endPlotDrag = (e) => {
        if (!plotDragState.isDragging) return;
        
        plotDragState.isDragging = false;
        DOM.plotHeader.releasePointerCapture(e.pointerId);
        DOM.plotModal.style.transition = 'bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    };
    
    DOM.plotHeader.addEventListener('pointerup', endPlotDrag);
    DOM.plotHeader.addEventListener('pointercancel', endPlotDrag);

    DOM.closePlotBtn.addEventListener('click', () => {
        DOM.plotModal.classList.remove('active');
        currentPlotState.active = false; 
        
        setTimeout(() => {
            plotDragState.currentX = 0;
            plotDragState.currentY = 0;
            DOM.plotModal.style.transform = `translate(0px, 0px)`;
        }, 400); 
    });

    // --- 高畫質 PNG 圖表匯出引擎 ---
    DOM.exportPlotBtn.addEventListener('click', () => {
        if (!currentPlotState.active) return;
        
        const canvas = DOM.profilePlotCanvas;
        
        // 建立虛擬畫布，尺寸與高解析度的 PlotCanvas 一致
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const ctx = tempCanvas.getContext('2d');
        
        // 1. 填滿實體背景色 (防止 PNG 透明底造成黑線隱形)
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 2. 將包含光譜曲線的高畫質畫布疊加上去
        ctx.drawImage(canvas, 0, 0);

        // ========================================================
        // 3. 補繪製圖例 (Legend) 進入 Canvas (解決 HTML 浮水印漏匯出)
        // ========================================================
        const dpr = window.devicePixelRatio || 1;
        const cw = tempCanvas.width;
        
        const pad = 10 * dpr;
        const boxW = 100 * dpr;
        const boxH = 65 * dpr;
        const rightM = 25 * dpr;
        const topM = 20 * dpr;
        
        const lx = cw - rightM - boxW;
        const ly = topM;

        // 畫半透明白底與邊框 (支援舊版瀏覽器的備用矩形語法)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeStyle = '#dddddd';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(lx, ly, boxW, boxH, 6 * dpr);
        } else {
            ctx.rect(lx, ly, boxW, boxH);
        }
        ctx.fill();
        ctx.stroke();

        const fontSize = 12 * dpr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let ty = ly + pad + fontSize / 2;
        
        // [標籤 A] Intensity
        ctx.fillStyle = '#0d6efd';
        ctx.font = `bold ${fontSize + 2*dpr}px Arial`;
        ctx.fillText('—', lx + pad, ty);
        ctx.font = `${fontSize}px Arial`;
        ctx.fillStyle = '#212529';
        ctx.fillText('Intensity', lx + pad + 20*dpr, ty);
        
        // [標籤 B] Watershed
        ty += fontSize * 1.6;
        ctx.fillStyle = 'rgba(220,53,69,0.7)';
        ctx.font = `bold ${fontSize + 2*dpr}px Arial`;
        ctx.fillText('|', lx + pad + 3*dpr, ty);
        ctx.font = `${fontSize}px Arial`;
        ctx.fillStyle = '#212529';
        ctx.fillText('Watershed', lx + pad + 20*dpr, ty);
        
        // [標籤 C] Area
        ty += fontSize * 1.6;
        ctx.fillStyle = 'rgba(40,167,69,0.3)';
        ctx.fillRect(lx + pad, ty - 6*dpr, 12*dpr, 12*dpr);
        ctx.fillStyle = '#212529';
        ctx.fillText('Area', lx + pad + 20*dpr, ty);
        
        // 4. 轉為 Blob 並觸發下載
        tempCanvas.toBlob(function(blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a"); 
            link.setAttribute("href", url);
            
            // 智慧命名：包含識別類型與時間戳
            const prefix = currentPlotState.type === 'saved' ? 'Saved_ROI' : 'Active_ROI';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            link.setAttribute("download", `ProfilePlot_${prefix}_${timestamp}.png`);
            
            document.body.appendChild(link); 
            link.click(); 
            document.body.removeChild(link); 
            URL.revokeObjectURL(url);
            
            setStatus('光譜圖已匯出', false);
            logAudit("EXPORT", `Exported Profile Plot as PNG (${prefix})`);
        }, 'image/png');
    });

    function drawProfilePlot(targetBlob, allBlobsInLane) {
        if (!AppState.sys.pingPongBuffer) return;
        
        let rw = AppState.roi.current.w > 0 ? AppState.roi.current.w : AppState.img.width;
        let rh = AppState.roi.current.h > 0 ? AppState.roi.current.h : AppState.img.height;

        const canvas = DOM.profilePlotCanvas;
        const ctxPlot = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctxPlot.setTransform(1, 0, 0, 1, 0, 0); 
        ctxPlot.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const cw = rect.width; 
        const ch = rect.height;

        let laneMinY = Infinity, laneMaxY = -Infinity;
        let laneMinX = Infinity, laneMaxX = -Infinity;
        
        allBlobsInLane.forEach(b => {
            if (b.minY < laneMinY) laneMinY = b.minY;
            if (b.maxY > laneMaxY) laneMaxY = b.maxY;
            if (b.minX < laneMinX) laneMinX = b.minX;
            if (b.maxX > laneMaxX) laneMaxX = b.maxX;
        });
        
        laneMinY = Math.max(0, laneMinY - 15);
        laneMaxY = Math.min(rh - 1, laneMaxY + 15);
        let laneHeight = laneMaxY - laneMinY + 1;

        let processedData = new Float32Array(AppState.sys.pingPongBuffer);
        let profile = new Float32Array(laneHeight);
        let maxIntensity = 0;

        for (let y = laneMinY; y <= laneMaxY; y++) {
            let sum = 0;
            for (let x = laneMinX; x <= laneMaxX; x++) sum += processedData[y * rw + x];
            profile[y - laneMinY] = sum;
            if (sum > maxIntensity) maxIntensity = sum;
        }

        ctxPlot.clearRect(0, 0, cw, ch);
        const padding = { top: 35, bottom: 25, left: 15, right: 15 };
        const plotW = cw - padding.left - padding.right;
        const plotH = ch - padding.top - padding.bottom;

        const getX = (yVal) => padding.left + ((yVal - laneMinY) / laneHeight) * plotW;
        const getY = (intensity) => ch - padding.bottom - (intensity / (maxIntensity || 1)) * plotH;

        // --- 1. 繪製背景參考網格線 (Grid Lines) ---
        ctxPlot.strokeStyle = "#e9ecef";
        ctxPlot.lineWidth = 1;
        ctxPlot.beginPath();
        for(let i = 1; i <= 4; i++) {
            let y = ch - padding.bottom - (plotH / 4) * i;
            ctxPlot.moveTo(padding.left, y);
            ctxPlot.lineTo(cw - padding.right, y);
        }
        ctxPlot.stroke();

        // --- 2. 繪製目標波段積分面積填充 ---
        ctxPlot.beginPath();
        ctxPlot.moveTo(getX(targetBlob.minY), getY(0));
        for (let y = targetBlob.minY; y <= targetBlob.maxY; y++) {
            ctxPlot.lineTo(getX(y), getY(profile[y - laneMinY]));
        }
        ctxPlot.lineTo(getX(targetBlob.maxY), getY(0));
        ctxPlot.closePath();
        ctxPlot.fillStyle = "rgba(40, 167, 69, 0.25)"; 
        ctxPlot.fill();

        // --- 3. 繪製主波形曲線 ---
        ctxPlot.beginPath();
        ctxPlot.moveTo(getX(laneMinY), getY(profile[0]));
        for (let i = 1; i < laneHeight; i++) {
            ctxPlot.lineTo(getX(laneMinY + i), getY(profile[i]));
        }
        ctxPlot.strokeStyle = "#0d6efd"; 
        ctxPlot.lineWidth = 2.5;
        ctxPlot.lineJoin = 'round';
        ctxPlot.stroke();

        // --- 4. 繪製切割邊界 (Watershed) ---
        ctxPlot.strokeStyle = "rgba(220, 53, 69, 0.6)"; 
        ctxPlot.lineWidth = 1.5;
        ctxPlot.setLineDash([4, 4]);
        const drawBoundary = (yVal) => {
            let px = getX(yVal);
            ctxPlot.beginPath(); 
            ctxPlot.moveTo(px, padding.top - 10); 
            ctxPlot.lineTo(px, ch - padding.bottom); 
            ctxPlot.stroke();
        };
        allBlobsInLane.forEach(b => {
            drawBoundary(b.minY); drawBoundary(b.maxY);
        });
        ctxPlot.setLineDash([]); 

        // --- 5. 尋找與標記波段峰值 (Peak Detection) ---
        let blobPeakY = targetBlob.minY;
        let blobPeakVal = -1;
        for (let y = targetBlob.minY; y <= targetBlob.maxY; y++) {
            let val = profile[y - laneMinY];
            if (val > blobPeakVal) {
                blobPeakVal = val;
                blobPeakY = y;
            }
        }
        
        let px = getX(blobPeakY);
        let py = getY(blobPeakVal);
        ctxPlot.fillStyle = "#dc3545";
        ctxPlot.beginPath();
        ctxPlot.arc(px, py, 4, 0, Math.PI * 2);
        ctxPlot.fill();
        
        let peakText = `Peak: ${Math.round(blobPeakVal).toLocaleString()}`;
        ctxPlot.font = "bold 11px Arial";
        let textWidth = ctxPlot.measureText(peakText).width;
        ctxPlot.fillStyle = "rgba(255,255,255,0.85)";
        ctxPlot.fillRect(px - textWidth/2 - 4, py - 22, textWidth + 8, 16);
        ctxPlot.fillStyle = "#dc3545";
        ctxPlot.fillText(peakText, px - textWidth/2, py - 10);

        // --- 將狀態寫入快取，供 Hover 互動使用 ---
        currentPlotState.hoverData = {
            profile, laneMinY, laneHeight, maxIntensity,
            padding, plotW, plotH, cw, ch
        };

        DOM.plotTitle.innerText = `📊 Densitometry Profile (Area: ${Math.round(targetBlob.area).toLocaleString()})`;
        DOM.plotModal.classList.add('active');
    }

    function drawSavedProfilePlot(savedItem) {
        if (!savedItem.profileCache || savedItem.profileCache.length === 0) return;

        const canvas = DOM.profilePlotCanvas;
        const ctxPlot = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctxPlot.setTransform(1, 0, 0, 1, 0, 0); 
        ctxPlot.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const cw = rect.width; 
        const ch = rect.height;

        let laneMinY = savedItem.laneMinY;
        let laneHeight = savedItem.laneMaxY - laneMinY + 1;
        let profile = savedItem.profileCache;
        
        let maxIntensity = 0;
        for(let i = 0; i < profile.length; i++) { 
            if (profile[i] > maxIntensity) maxIntensity = profile[i]; 
        }

        ctxPlot.clearRect(0, 0, cw, ch);
        const padding = { top: 35, bottom: 25, left: 15, right: 15 };
        const plotW = cw - padding.left - padding.right;
        const plotH = ch - padding.top - padding.bottom;

        const getX = (yVal) => padding.left + ((yVal - laneMinY) / laneHeight) * plotW;
        const getY = (intensity) => ch - padding.bottom - (intensity / (maxIntensity || 1)) * plotH;

        // --- 1. 繪製背景參考網格線 (Grid Lines) ---
        ctxPlot.strokeStyle = "#e9ecef";
        ctxPlot.lineWidth = 1;
        ctxPlot.beginPath();
        for(let i = 1; i <= 4; i++) {
            let y = ch - padding.bottom - (plotH / 4) * i;
            ctxPlot.moveTo(padding.left, y);
            ctxPlot.lineTo(cw - padding.right, y);
        }
        ctxPlot.stroke();

        // --- 2. 繪製目標波段積分面積填充 ---
        ctxPlot.beginPath();
        ctxPlot.moveTo(getX(savedItem.localMinY), getY(0));
        for (let y = savedItem.localMinY; y <= savedItem.localMaxY; y++) {
            ctxPlot.lineTo(getX(y), getY(profile[y - laneMinY]));
        }
        ctxPlot.lineTo(getX(savedItem.localMaxY), getY(0));
        ctxPlot.closePath();
        ctxPlot.fillStyle = "rgba(111, 66, 193, 0.25)"; 
        ctxPlot.fill();

        // --- 3. 繪製主波形曲線 ---
        ctxPlot.beginPath();
        ctxPlot.moveTo(getX(laneMinY), getY(profile[0]));
        for (let i = 1; i < profile.length; i++) {
            ctxPlot.lineTo(getX(laneMinY + i), getY(profile[i]));
        }
        ctxPlot.strokeStyle = "#6f42c1"; 
        ctxPlot.lineWidth = 2.5;
        ctxPlot.lineJoin = 'round';
        ctxPlot.stroke();

        // --- 4. 繪製切割邊界 (Watershed) ---
        ctxPlot.strokeStyle = "rgba(220, 53, 69, 0.6)"; 
        ctxPlot.lineWidth = 1.5;
        ctxPlot.setLineDash([4, 4]);
        savedItem.laneBoundaries.forEach(b => {
            let px = getX(b.minY);
            ctxPlot.beginPath(); ctxPlot.moveTo(px, padding.top - 10); ctxPlot.lineTo(px, ch - padding.bottom); ctxPlot.stroke();
            px = getX(b.maxY);
            ctxPlot.beginPath(); ctxPlot.moveTo(px, padding.top - 10); ctxPlot.lineTo(px, ch - padding.bottom); ctxPlot.stroke();
        });
        ctxPlot.setLineDash([]); 

        // --- 5. 尋找與標記波段峰值 (Peak Detection) ---
        let blobPeakY = savedItem.localMinY;
        let blobPeakVal = -1;
        for (let y = savedItem.localMinY; y <= savedItem.localMaxY; y++) {
            let val = profile[y - laneMinY];
            if (val > blobPeakVal) {
                blobPeakVal = val;
                blobPeakY = y;
            }
        }
        
        let px = getX(blobPeakY);
        let py = getY(blobPeakVal);
        ctxPlot.fillStyle = "#dc3545";
        ctxPlot.beginPath();
        ctxPlot.arc(px, py, 4, 0, Math.PI * 2);
        ctxPlot.fill();
        
        let peakText = `Peak: ${Math.round(blobPeakVal).toLocaleString()}`;
        ctxPlot.font = "bold 11px Arial";
        let textWidth = ctxPlot.measureText(peakText).width;
        ctxPlot.fillStyle = "rgba(255,255,255,0.85)";
        ctxPlot.fillRect(px - textWidth/2 - 4, py - 22, textWidth + 8, 16);
        ctxPlot.fillStyle = "#dc3545";
        ctxPlot.fillText(peakText, px - textWidth/2, py - 10);

        // --- 將狀態寫入快取，供 Hover 互動使用 ---
        currentPlotState.hoverData = {
            profile, laneMinY, laneHeight, maxIntensity,
            padding, plotW, plotH, cw, ch
        };

        DOM.plotTitle.innerText = `📊 Densitometry Profile (Saved Area: ${savedItem.area.toLocaleString()})`;
        DOM.plotModal.classList.add('active');
    }

    // --- 光譜圖互動行為 (Hover Interactivity) ---
    DOM.profilePlotCanvas.addEventListener('pointermove', (e) => {
        if (!currentPlotState.hoverData || !currentPlotState.active) return;
        
        const rect = DOM.profilePlotCanvas.getBoundingClientRect();
        // 取得滑鼠相對於 Canvas DOM 元素的座標 (CSS pixels)
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const hd = currentPlotState.hoverData;

        // 將 CSS 座標映射回內部繪圖網格的 X 軸進度比例
        // 注意：hd.padding.left 是內部的高解析度座標，需除以 dPR 轉回 CSS 座標對齊
        const dPR = window.devicePixelRatio;
        const cssPaddingLeft = hd.padding.left / dPR;
        const cssPlotW = hd.plotW / dPR;
        
        let pct = (mouseX - cssPaddingLeft) / cssPlotW;
        
        if (pct < 0 || pct > 1) {
            DOM.plotTooltip.style.opacity = 0;
            return;
        }

        // 從比例換算回 Array 索引與實際 Y 座標
        let idx = Math.floor(pct * hd.laneHeight);
        if (idx >= 0 && idx < hd.profile.length) {
            let intensity = hd.profile[idx];
            let actualY = hd.laneMinY + idx;
            
            DOM.plotTooltip.innerText = `Pos Y: ${actualY} px | Int: ${Math.round(intensity).toLocaleString()}`;
            // 將 Tooltip 定位在滑鼠游標正上方
            DOM.plotTooltip.style.left = `${mouseX}px`;
            DOM.plotTooltip.style.top = `${mouseY}px`;
            DOM.plotTooltip.style.opacity = 1;
        }
    });

    DOM.profilePlotCanvas.addEventListener('pointerleave', () => {
        DOM.plotTooltip.style.opacity = 0;
    });

    DOM.tableBody.addEventListener('click', function(e) {
        const btn = e.target.closest('.delete-btn'); 
        if (btn) {
            const index = parseInt(btn.getAttribute('data-index'), 10); 
            deleteSavedRow(index); 
            return;
        }

        const row = e.target.closest('tr');
        if (!row || row.classList.contains('spacer-row')) return;
        const rowId = row.id; 
        
        if (rowId.startsWith('row-coord-')) {
            const parts = rowId.split('-');
            const gx = parseInt(parts[2], 10); 
            const gy = parseInt(parts[3], 10);
            let rx = AppState.roi.current.w > 0 ? AppState.roi.current.x : 0;
            let ry = AppState.roi.current.w > 0 ? AppState.roi.current.y : 0;
            let targetLocalX = gx - rx;
            let targetLocalY = gy - ry;

            const allBlobs = [...AppState.data.lockedBlobs, ...AppState.data.workerBlobs];
            const targetBlob = allBlobs.find(b => b.centerX === targetLocalX && b.centerY === targetLocalY);
            
            if (targetBlob) {
                currentPlotState = { active: true, type: 'current', x: targetBlob.centerX, y: targetBlob.centerY };
                
                let totalWidth = 0; 
                allBlobs.forEach(b => { totalWidth += (b.maxX - b.minX); });
                let dynamicLaneTolerance = Math.max((totalWidth / allBlobs.length) * 0.6, 5); 
                
                const blobsInSameLane = allBlobs.filter(b => Math.abs(b.centerX - targetBlob.centerX) < dynamicLaneTolerance);
                drawProfilePlot(targetBlob, blobsInSameLane);
                
                lastInteractedBandId = `coord-${gx}-${gy}`;
                triggerCanvasFlash(lastInteractedBandId); // 觸發畫布端的高亮閃爍
                generateTable(); 
            }
        } 
        else if (rowId.startsWith('saved-')) {
            const originalIndex = parseInt(rowId.replace('saved-', ''), 10);
            const savedItem = AppState.data.saved[originalIndex];
            
            if (savedItem) {
                currentPlotState = { active: true, type: 'saved' }; 
                drawSavedProfilePlot(savedItem);
                
                lastInteractedBandId = rowId; // 保持 'saved-X' 格式供渲染器比對
                triggerCanvasFlash(lastInteractedBandId); // 觸發畫布端的高亮閃爍
                generateTable();
            }
        }
    });

    /* ============================================================================
       Auto HDR 狀態機與執行引擎 (State Machine)
       ============================================================================ */
    const curvePowerSlider = document.getElementById('curvePowerSlider');
    const curvePowerLabel = document.getElementById('curvePowerLabel');
    const hdrTrack = document.getElementById('hdrTrack');
    const hdrRange = document.getElementById('hdrRange');
    const thumbBoundary = document.getElementById('thumbBoundary');
    const thumbCore = document.getElementById('thumbCore');
    const valBoundaryText = document.getElementById('valBoundary');
    const valCoreText = document.getElementById('valCore');

    let currentCurvePower = 2.5;
    
    function physicalToLogical(p) { return Math.pow(p / 100, currentCurvePower) * 100; }
    function logicalToPhysical(l) { return Math.pow(l / 100, 1 / currentCurvePower) * 100; }

    let physBoundary = logicalToPhysical(2.0);  
    let physCore = logicalToPhysical(15.0);     
    let dragState = { isDragging: false, mode: null, startX: 0, startPhysBoundary: 0, startPhysCore: 0 };

    function updateSliderUI() {
        if (physBoundary > physCore) physBoundary = physCore;
        
        thumbBoundary.style.left = `${physBoundary}%`;
        thumbCore.style.left = `${physCore}%`;
        hdrRange.style.left = `${physBoundary}%`;
        hdrRange.style.width = `${physCore - physBoundary}%`;

        const logBoundary = physicalToLogical(physBoundary);
        const logCore = physicalToLogical(physCore);
        let strPctBoundary = logBoundary < 10 ? `${logBoundary.toFixed(2)}%` : `${logBoundary.toFixed(1)}%`;
        let strPctCore = logCore < 10 ? `${logCore.toFixed(2)}%` : `${logCore.toFixed(1)}%`;

        let realBoundary = getBoundaryThreshold();
        let realCore = getCoreThreshold();

        let realBoundaryText = Math.round(realBoundary).toLocaleString();
        let realCoreText = Math.round(realCore).toLocaleString();

        valBoundaryText.innerText = realBoundaryText;
        valCoreText.innerText = realCoreText;

        thumbBoundary.setAttribute('data-val', strPctBoundary);
        thumbCore.setAttribute('data-val', strPctCore);
    }

    curvePowerSlider.addEventListener('input', (e) => {
        const currentLogCore = physicalToLogical(physCore);
        const currentLogBoundary = physicalToLogical(physBoundary);
        currentCurvePower = parseFloat(e.target.value);
        
        curvePowerLabel.innerText = `${currentCurvePower.toFixed(1)}x`;
        physCore = logicalToPhysical(currentLogCore);
        physBoundary = logicalToPhysical(currentLogBoundary);
        
        updateSliderUI();
    });

    hdrTrack.addEventListener('pointerdown', (e) => {
        dragState.isDragging = true; 
        dragState.startX = e.clientX;
        dragState.startPhysBoundary = physBoundary; 
        dragState.startPhysCore = physCore;
        
        if (e.target === thumbCore) { 
            dragState.mode = 'core'; 
            thumbCore.classList.add('is-dragging'); 
        } else if (e.target === thumbBoundary) { 
            dragState.mode = 'boundary'; 
            thumbBoundary.classList.add('is-dragging');
        } else if (e.target === hdrRange) { 
            dragState.mode = 'range'; 
            thumbCore.classList.add('is-dragging');
            thumbBoundary.classList.add('is-dragging');
        } else {
            dragState.isDragging = false; 
        }

        if(dragState.isDragging) {
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        }
    });

    function onPointerMove(e) {
        if (!dragState.isDragging) return;
        
        const trackRect = hdrTrack.getBoundingClientRect();
        const deltaPct = ((e.clientX - dragState.startX) / trackRect.width) * 100; 

        if (dragState.mode === 'core') {
            physCore = Math.max(physBoundary, Math.min(100, dragState.startPhysCore + deltaPct));
        } else if (dragState.mode === 'boundary') {
            physBoundary = Math.max(0, Math.min(physCore, dragState.startPhysBoundary + deltaPct));
        } else if (dragState.mode === 'range') {
            let newBoundary = dragState.startPhysBoundary + deltaPct;
            let newCore = dragState.startPhysCore + deltaPct;
            const rangeWidth = dragState.startPhysCore - dragState.startPhysBoundary;

            if (newBoundary < 0) { 
                newBoundary = 0; 
                newCore = rangeWidth; 
            } else if (newCore > 100) { 
                newCore = 100; 
                newBoundary = 100 - rangeWidth; 
            }
            physBoundary = newBoundary; 
            physCore = newCore;
        }
        updateSliderUI();
    }

    function onPointerUp() {
        dragState.isDragging = false; 
        dragState.mode = null;
        
        thumbCore.classList.remove('is-dragging');
        thumbBoundary.classList.remove('is-dragging');
        
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        logAudit("PARAM", `HDR Threshold adjusted: Core=${physicalToLogical(physCore).toFixed(1)}%, Boundary=${physicalToLogical(physBoundary).toFixed(1)}%`);
        requestCalculation(); 
    }

    function getCoreThreshold() { 
        return AppState.roi.localMax ? AppState.roi.localMax * (physicalToLogical(physCore) / 100) : 0; 
    }
    
    function getBoundaryThreshold() { 
        return AppState.roi.localMax ? AppState.roi.localMax * (physicalToLogical(physBoundary) / 100) : 0; 
    }

    updateSliderUI();

    function executeLockAllCurrent() {
        if (!AppState.data.workerBlobs || AppState.data.workerBlobs.length === 0) return;
        saveState();
        
        AppState.data.workerBlobs.forEach(b => {
            let lockedBlobData = { ...b, pixelIndices: b.pixelIndices };
            lockedBlobData.lockedParams = { 
                angle: DOM.angleInput.value, 
                smileFactorL: DOM.smileInputL.value || 0,
                smileFactorR: DOM.smileInputR.value || 0,
                bgRadius: DOM.rbRadiusInput.value,
                coreThreshold: getCoreThreshold(), 
                boundaryThreshold: getBoundaryThreshold(), 
                minArea: DOM.minAreaInput.value 
            };
            AppState.data.lockedBlobs.push(lockedBlobData);
        });
        
        AppState.data.workerBlobs = [];
        syncLockMapToWorker();
        renderCompositeState();
    }
    
    DOM.lockAllBtn.addEventListener('click', executeLockAllCurrent);

    function executeUnlockAllCurrent() {
        if (AppState.data.lockedBlobs.length === 0) return;
        saveState(); 
        
        AppState.data.lockedBlobs = [];
        syncLockMapToWorker(); 
        renderCompositeState();
        requestCalculation(); 
    }
    DOM.unlockAllBtn.addEventListener('click', executeUnlockAllCurrent);

    let isAutoHdrReady = false; 
    
    const autoHdrConfigPanel = document.getElementById('autoHdrConfigPanel');
    const mserStartSlider = document.getElementById('mserStartSlider');
    const mserEndSlider = document.getElementById('mserEndSlider');
    const mserGrowthSlider = document.getElementById('mserGrowthSlider');
    
    mserStartSlider.addEventListener('input', (e) => document.getElementById('valMserStart').innerText = Number(e.target.value).toFixed(1) + '%');
    mserEndSlider.addEventListener('input', (e) => document.getElementById('valMserEnd').innerText = Number(e.target.value).toFixed(1) + '%');
    mserGrowthSlider.addEventListener('input', (e) => document.getElementById('valMserGrowth').innerText = Number(e.target.value) + '%');

    DOM.autoHdrBtn.addEventListener('click', async () => {
        if (!AppState.img.maxVal || !AppState.sys.hasStartedAnalysis || AppState.sys.isLocked) { 
            alert("請先載入影像並點擊分析！"); 
            return; 
        }
        
        if (!isAutoHdrReady) {
            autoHdrConfigPanel.style.display = 'block';
            DOM.autoHdrBtn.innerHTML = '<span title="MSER (Maximally Stable Extremal Regions) Scanning ">🚀 Scanning</span>';
            DOM.autoHdrBtn.style.backgroundColor = '#286ca7'; 
            DOM.autoHdrBtn.style.boxShadow = '0 0 8px rgba(111, 66, 193, 0.6)'; 
            isAutoHdrReady = true;
            return; 
        }

        AppState.sys.isLocked = true; 
        document.body.style.cursor = 'wait'; 
        const appContainer = document.querySelector('.app-container');
        appContainer.style.pointerEvents = 'none'; 

        DOM.autoHdrBtn.disabled = true; 
        DOM.lockAllBtn.disabled = true; 
        DOM.unlockAllBtn.disabled = true;
        
        DOM.modeBanner.innerText = "✨ 正在執行 MSER 地形拓撲掃描 (系統鎖定中以確保資料安全)...";
        DOM.modeBanner.style.backgroundColor = "#6f42c1"; 
        DOM.modeBanner.style.color = "white";

        saveState(); // 進入全自動掃描前，先備份時光機狀態

        // 【狀態防護】記住使用者手動設定的 HDR 滑桿位置，掃描結束後歸位
        let originalPhysCore = physCore;
        let originalPhysBoundary = physBoundary;
        
        // 【效能優化】備份 Auto BG 狀態並強制關閉。
        let originalAutoBg = DOM.autoBgToggle.checked;
        DOM.autoBgToggle.checked = false;

        // 讀取 MSER UI 參數
        let sweepStart = parseFloat(mserStartSlider.value);
        let sweepEnd = parseFloat(mserEndSlider.value);
        let maxSpilloverGrowth = parseFloat(mserGrowthSlider.value) / 100.0;
        let sweepStep = 2.0; // 核心精度：每步下降 2%

        // 輔助函式：觸發 Worker 進行單一閾值計算 (支援自訂張力比例)
        const executeSweepStep = (corePct, customBoundaryRatio = 0.4) => {
            return new Promise((resolve, reject) => {
                let dynamicBoundary = Math.max(0.5, corePct * customBoundaryRatio);
                physCore = logicalToPhysical(corePct);
                physBoundary = logicalToPhysical(dynamicBoundary);
                updateSliderUI();

                // 【修補：加入 8 秒 Timeout 保險絲】
                let timeoutFuse = setTimeout(() => {
                    window.autoHdrResolveHook = null;
                    reject(new Error("Worker Calculation Timeout"));
                }, 8000); // 假設單次 sweep 極限不會超過 8 秒

                window.autoHdrResolveHook = (blobs) => {
                    clearTimeout(timeoutFuse); // 成功回來就拆除炸彈
                    resolve(blobs);
                };

                requestCalculation();
            });
        };

        // 輔助函式：將判定收斂的 Blob 上鎖
        const commitToLock = (blob, lockedCorePct, lockedBoundPct) => {
            let lockedBlobData = { ...blob, pixelIndices: blob.pixelIndices };
            // 將 % 轉回物理真實強度值
            let coreVal = AppState.roi.localMax * (physicalToLogical(logicalToPhysical(lockedCorePct)) / 100);
            let boundVal = AppState.roi.localMax * (physicalToLogical(logicalToPhysical(lockedBoundPct)) / 100);

            lockedBlobData.lockedParams = { 
                angle: DOM.angleInput.value, 
                smileFactorL: DOM.smileInputL.value || 0,
                smileFactorR: DOM.smileInputR.value || 0,
                bgRadius: DOM.rbRadiusInput.value, 
                coreThreshold: coreVal, 
                boundaryThreshold: boundVal, 
                minArea: DOM.minAreaInput.value 
            };
            AppState.data.lockedBlobs.push(lockedBlobData);
        };

        try {            
            let activeRegions = []; // 用於追蹤在降維過程中持續成長的波段
            let uiMinArea = parseInt(DOM.minAreaInput.value, 10);
            let lockedCountThisRun = 0;
            // 【動態自適應底線 - Gel separation 幾何校正版】：利用開根號從面積推算合理的最小寬度/高度，不再寫死
            // 寬度 (W)：WB 波段特性為橫向發展 (W > H)。 給予 sqrt(Area) 的 80% 作為寬容下限。若 Area=500，MinW ≈ 17px。
            let absoluteMinW = Math.max(5, Math.floor(Math.sqrt(uiMinArea) * 0.80)); 
            // 高度 (H)：波段通常極扁，給予 sqrt(Area) 的 15% 作為下限。若 Area=500，MinH ≈ 3px。
            let absoluteMinH = Math.max(3, Math.floor(Math.sqrt(uiMinArea) * 0.15));

            // ============================================================================
            // 核心 MSER 演算法迴圈 (全方位防融合終極版)
            // ============================================================================
            for (let c = sweepStart; c >= sweepEnd; c -= sweepStep) {
                setStatus(`MSER 掃描中: 水位下降至 ${c.toFixed(1)}%...`, true);

                let frameBlobs = await executeSweepStep(c);
                let nextActiveRegions = [];
                let lockedThisFrame = false;

                // 1. 父代生命週期審查 (Parent-Centric Evaluation)
                for (let region of activeRegions) {
                    if (region.isLocked) continue;

                    let matchedBlob = null;
                    let maxOverlap = 0;

                    for (let blob of frameBlobs) {
                        let interX = Math.max(0, Math.min(blob.maxX, region.maxX) - Math.max(blob.minX, region.minX));
                        let interY = Math.max(0, Math.min(blob.maxY, region.maxY) - Math.max(blob.minY, region.minY));
                        if (interX > 0 && interY > 0) {
                            let overlapArea = interX * interY;
                            if (overlapArea > maxOverlap) {
                                maxOverlap = overlapArea;
                                matchedBlob = blob;
                            }
                        }
                    }

                    if (matchedBlob) {
                        // 檢測指標 A：面積暴增率
                        let areaDiff = matchedBlob.area - region.area;
                        let areaGrowth = areaDiff / region.area;
                        let isAreaSpill = (areaDiff > (uiMinArea * 0.5)) && (areaGrowth > maxSpilloverGrowth);
                        
                        // 檢測指標 B：寬度暴增率 (防禦左右融合)
                        let oldWidth = region.maxX - region.minX;
                        let newWidth = matchedBlob.maxX - matchedBlob.minX;
                        let widthGrowth = oldWidth > 0 ? (newWidth - oldWidth) / oldWidth : 0;
                        // 必須「實際變寬超過 5px」且「成長率 > 40-80%」，防止 4px 長到 6px 就被誤殺
                        let isWidthSpill = (newWidth - oldWidth > 5) && (widthGrowth > 0.70);

                        // 檢測指標 C：高度暴增率 (防禦上下吞噬)
                        let oldHeight = region.maxY - region.minY;
                        let newHeight = matchedBlob.maxY - matchedBlob.minY;
                        let heightGrowth = oldHeight > 0 ? (newHeight - oldHeight) / oldHeight : 0;
                        let isHeightSpill = (newHeight - oldHeight > 4) && (heightGrowth > 0.40);

                        // 檢測指標 D：絕對邊界框實體排斥 (Strict AABB Collision)
                        // 保持 1px 安全社交距離，防止任何視覺與幾何上的框線交疊
                        let isCollidingWithLocked = false;
                        for (let locked of AppState.data.lockedBlobs) {
                            if (!(matchedBlob.maxX < locked.minX - 1 || 
                                  matchedBlob.minX > locked.maxX + 1 || 
                                  matchedBlob.maxY < locked.minY - 1 || 
                                  matchedBlob.minY > locked.maxY + 1)) {
                                isCollidingWithLocked = true;
                                break;
                            }
                        }

                        // 【四大防護罩全開】
                        if (isAreaSpill || isWidthSpill || isHeightSpill || isCollidingWithLocked) {
                            // 發生撞擊時，不退回「撞擊前一刻 (可能剛出生)」，
                            // 而是退回歷史紀錄中「最完美的高原期狀態 (Best Cache)」
                            let bestBlob = region.bestBlobData || region.blobData;
                            let finalW = bestBlob.maxX - bestBlob.minX; 
                            let finalH = bestBlob.maxY - bestBlob.minY; 
                            
                            if (bestBlob.area >= uiMinArea && finalW >= absoluteMinW && finalH >= absoluteMinH) { 
                                commitToLock(bestBlob, region.lockedCore, region.lockedBoundary);
                                region.isLocked = true;
                                lockedCountThisRun++;
                                lockedThisFrame = true;
                            }
                        } else {
                            // 寬容版最佳高原期快取系統 (Forgiving Best State Tracking)
                            // 不死守「絕對最低成長率」。只要還在安全高原期內，就允許框「貪婪地盡量長大」
                            let currentStability = areaGrowth; 
                            let bestStability = region.bestStability !== undefined ? region.bestStability : Infinity;
                            
                            let bestBlob = region.bestBlobData || region.blobData;
                            let bestCore = region.lockedCore;
                            let bestBound = region.lockedBoundary;
                            let hasFoundPlateau = region.hasFoundPlateau || false; // 讀取歷史記憶

                            // 1. 記錄該波段歷史上最完美的平穩度 (底線)
                            if (currentStability < bestStability && areaGrowth >= 0) {
                                bestStability = currentStability;
                            }

                            // 2. 寬容快取條件 (讓框長大的魔法)：
                            // 條件 A：成長率非常低 (< 12%)，代表這圈水流只是在填補波段的模糊邊緣，很安全，繼續長大！
                            // 條件 B：成長率雖然略微上升，但距離歷史最佳沒差太多 (容忍 +8% 波動)，且未達危險邊界 (< 25%)
                            if (areaGrowth < 0.12 || (areaGrowth <= bestStability + 0.08 && areaGrowth < 0.25)) {
                                bestBlob = matchedBlob;
                                bestCore = c;
                                bestBound = Math.max(sweepEnd, c * 0.9);
                                // 注意：這裡只更新 bestBlob，不墊高 bestStability，
                                // 這樣才能確保未來依然是用「歷史最完美」的標準來檢視起伏。
                                hasFoundPlateau = true; // 【標記】它成功找到平坦區了！
                            } else if (!hasFoundPlateau) {
                                // 安全網快取：如果這輩子還沒找到過平坦區，代表它是一路順暢擴張的模糊波段
                                // 必須持續更新快取，避免最後回溯到剛出生的微小狀態而被誤殺！
                                bestBlob = matchedBlob;
                                bestCore = c;
                                bestBound = Math.max(sweepEnd, c * 0.9);
                            }

                            nextActiveRegions.push({
                                blobData: matchedBlob,
                                bestBlobData: bestBlob,       
                                bestStability: bestStability, 
                                hasFoundPlateau: hasFoundPlateau, // 將記憶傳遞給下一幀
                                area: matchedBlob.area,
                                minX: matchedBlob.minX, maxX: matchedBlob.maxX, minY: matchedBlob.minY, maxY: matchedBlob.maxY,
                                lockedCore: bestCore,
                                lockedBoundary: bestBound,
                                isLocked: false
                            });
                        }
                    } else {
                        // 孤兒波段 (撞牆或消失)
                        let bestBlob = region.bestBlobData || region.blobData;
                        let finalW = bestBlob.maxX - bestBlob.minX; 
                        let finalH = bestBlob.maxY - bestBlob.minY; 
                        if (bestBlob.area >= uiMinArea && finalW >= absoluteMinW && finalH >= absoluteMinH) { 
                            commitToLock(bestBlob, region.lockedCore, region.lockedBoundary);
                            region.isLocked = true;
                            lockedCountThisRun++;
                            lockedThisFrame = true;
                        }
                    }
                }

                // 2. 尋找新生波段 (Newborn Detection) - 加入出生即撞牆防禦
                for (let blob of frameBlobs) {
                    let isNew = true;
                    for (let region of activeRegions) {
                        let interX = Math.max(0, Math.min(blob.maxX, region.maxX) - Math.max(blob.minX, region.minX));
                        let interY = Math.max(0, Math.min(blob.maxY, region.maxY) - Math.max(blob.minY, region.minY));
                        if (interX > 0 && interY > 0) { 
                            isNew = false; 
                            break; 
                        }
                    }
                    
                    // 出生篩查：如果剛出生的波段，邊界框就已經跟別人疊在一起，視為無效殘骸，直接扼殺
                    let collidesWithLockedAtBirth = false;
                    for (let locked of AppState.data.lockedBlobs) {
                        if (!(blob.maxX < locked.minX - 1 || blob.minX > locked.maxX + 1 || 
                              blob.maxY < locked.minY - 1 || blob.minY > locked.maxY + 1)) {
                            collidesWithLockedAtBirth = true;
                            break;
                        }
                    }
                    
                    // 必須是全新、沒撞牆、且面積達標的健康波段，才允許進入追蹤系統
                    if (isNew && !collidesWithLockedAtBirth && blob.area >= (uiMinArea * 0.3)) {
                        nextActiveRegions.push({
                            blobData: blob,
                            area: blob.area,
                            minX: blob.minX, maxX: blob.maxX, minY: blob.minY, maxY: blob.maxY,
                            lockedCore: c,
                            lockedBoundary: Math.max(sweepEnd, c * 0.9),
                            hasFoundPlateau: false, // 出生時尚未找到平坦區
                            isLocked: false
                        });
                    }
                }

                activeRegions = nextActiveRegions;

                // 3. 即時物理牆構建：只要這回合有任何 Band 上鎖，立刻同步給 Worker
                if (lockedThisFrame) {
                    syncLockMapToWorker();
                }
            } // <--- MSER 核心迴圈結束

            // ============================================================================
            // 【終點收網結算 (End-of-Sweep Flush)】
            // ============================================================================
            let flushCount = 0;
            for (let region of activeRegions) {
                let bestBlob = region.bestBlobData || region.blobData; // 改為提取最佳快取
                let finalW = bestBlob.maxX - bestBlob.minX; 
                let finalH = bestBlob.maxY - bestBlob.minY; 
                
                if (!region.isLocked && bestBlob.area >= uiMinArea && finalW >= absoluteMinW && finalH >= absoluteMinH) { 
                    commitToLock(bestBlob, region.lockedCore, region.lockedBoundary);
                    region.isLocked = true;
                    lockedCountThisRun++;
                    flushCount++;
                }
            }
            
            if (flushCount > 0) {
                syncLockMapToWorker(); // 同步最後的實體牆
                console.log(`[MSER Engine] 掃描觸底！已將 ${flushCount} 個撐到最後的微弱波段強制收網。`);
            }

            // ============================================================================
            // 執行後處理品質管理 (Post-Processing QC & Area Filtering)
            // ============================================================================
            // 確保這次掃描真的有抓到新東西，才執行過濾，節省算力
            if (lockedCountThisRun > 0) { 
                let dropped = 0;
                let uiMinArea = parseInt(DOM.minAreaInput.value, 10);
                
                // 計算「舊框」的數量界線
                let initialLockedCount = AppState.data.lockedBlobs.length - lockedCountThisRun;

                // 1. 建立全域母體特徵：統計「畫面上現存的舊框 + 這次掃到的新框」
                // 納入歷史資料可以極大程度穩定中位數，避免單一 Lane 雜訊過多導致標準失真
                let sortedByArea = AppState.data.lockedBlobs.map(b => b).sort((a, b) => b.pixelIndices.length - a.pixelIndices.length);
                let totalBlobs = sortedByArea.length;
                
                let dropTop = Math.min(2, Math.floor(totalBlobs * 0.05)); 
                let takeCount = Math.max(1, Math.floor(totalBlobs * 0.50)); 
                let eliteBlobs = sortedByArea.slice(dropTop, dropTop + takeCount);
                
                let widths = eliteBlobs.map(b => b.maxX - b.minX).sort((a,b) => a - b);
                let heights = eliteBlobs.map(b => b.maxY - b.minY).sort((a,b) => a - b);
                
                let medianW = widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 25;
                let medianH = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 12;

                // 基於全域母體特徵推算動態物理限制
                let maxW = Math.max(medianW * 1.5, 60); 
                let maxH = Math.max(medianH * 3.0, 40); 
                let minDynamicW = Math.max(medianW * 0.70, 10); 
                let minDynamicH = Math.max(medianH * 0.10, 4);  

                // 2. 執行過濾：只針對「這次 MSER 掃描到的新框」進行嚴格審查
                // 優先將使用者之前的舊框放入安全名單，確保不被誤刪
                let validBlobs = AppState.data.lockedBlobs.slice(0, initialLockedCount); 

                for (let i = initialLockedCount; i < AppState.data.lockedBlobs.length; i++) {
                    let b = AppState.data.lockedBlobs[i];
                    let w = b.maxX - b.minX;
                    let h = b.maxY - b.minY;
                    let pixelCount = b.pixelIndices.length;

                    // 六重過濾條件
                    let isTooSmall = pixelCount < uiMinArea; 
                    let isTooNarrow = w < minDynamicW;       
                    let isTooBig = (AppState.data.lockedBlobs.length >= 3) && (w > maxW || h > maxH); 
                    let isVerticalArtifact = h > (w * 3);  
                    let isScannerScratch = w > (h * 15);     
                    
                    let boundingBoxArea = w * h;
                    let solidity = boundingBoxArea > 0 ? (pixelCount / boundingBoxArea) : 0;
                    let isGhostShape = (solidity < 0.02) && (pixelCount < uiMinArea * 2);      

                    if (isTooSmall || isTooNarrow || isTooBig || isVerticalArtifact || isScannerScratch || isGhostShape) {
                        dropped++; 
                    } else {
                        validBlobs.push(b); 
                    }
                }

                if (dropped > 0) {
                        AppState.data.lockedBlobs = validBlobs;
                        console.log(`[MSER QC] 已結合全域母體特徵，精準剔除 ${dropped} 個不合理的新雜訊波段`);
                    }
                }
                // ============================================================================

                // ============================================================================
                // Phase 3: 適應性形態學打撈 (Adaptive Morphological Descent)
                // 從已鎖定波段的最弱閾值開始，進行多層高張力掃描，抓到即鎖定以防溢流
                // ============================================================================
                // 檢查使用者是否在 UI 面板中勾選了 Phase 3 開關
                const isPhase3Enabled = document.getElementById('mserPhase3Toggle').checked;

                if (isPhase3Enabled && AppState.data.lockedBlobs.length >= 2) {
                    setStatus(`Phase 3: 啟動適應性多層打撈...`, true);

                    // 1. 萃取全域成功者的「形態學 DNA」
                    let finalWidths = AppState.data.lockedBlobs.map(b => b.maxX - b.minX).sort((a, b) => a - b);
                    let finalHeights = AppState.data.lockedBlobs.map(b => b.maxY - b.minY).sort((a, b) => a - b);
                    let targetW = finalWidths[Math.floor(finalWidths.length / 2)];
                    let targetH = finalHeights[Math.floor(finalHeights.length / 2)];

                    // 2. 動態運算打撈起點 (往下掃)
                    // 將物理閾值反向推算回百分比
                    let rescueStart = Math.max(sweepStart);

                    let rescuedCount = 0;

                    // 3. 多層貪婪掃描迴圈
                    for (let r = rescueStart; r >= 0.5; r -= sweepStep) {
                        setStatus(`Phase 3 打撈: 水位下降至 ${r.toFixed(1)}%...`, true);
                        
                        // 【高張力防護】傳入 0.85 (85%) 的自訂張力，確保弱訊號獨立不沾黏背景
                        let rescueBlobs = await executeSweepStep(r, 0.85); 
                        let lockedInThisLayer = false;

                        for (let rb of rescueBlobs) {
                            let rw = rb.maxX - rb.minX;
                            let rh = rb.maxY - rb.minY;

                            // 條件 A：形態學相似比對 (放寬至 40% ~ 160%)
                            let isShapeSimilar = (rw >= targetW * 0.7 && rw <= targetW * 1.2) &&
                                                 (rh >= targetH * 0.01 && rh <= targetH * 2.0);

                            // 條件 B：實體排斥 (不能撞到既有的強訊號或其他剛打撈的弱訊號)
                            let isColliding = false;
                            for (let locked of AppState.data.lockedBlobs) {
                                if (!(rb.maxX < locked.minX - 1 || rb.minX > locked.maxX + 1 ||
                                      rb.maxY < locked.minY - 1 || rb.minY > locked.maxY + 1)) {
                                    isColliding = true;
                                    break;
                                }
                            }

                            // 條件 C：基本面積防呆 (極度寬容)
                            let isAreaValid = rb.area >= (uiMinArea * 0.01);

                            // 條件 D：實心度防護 (Solidity Check)
                            // 即使外框長寬完美符合，如果內部像素太稀疏(空心)，依然視為幽靈雜訊
                            let boundingBoxArea = rw * rh;
                            let solidity = boundingBoxArea > 0 ? (rb.pixelIndices.length / boundingBoxArea) : 0;
                            let isNotGhost = solidity >= 0.08; // 實心度至少要有 8% 才算有效波段

                            // 貪婪鎖定：一旦達標，立刻轉化為實體牆！
                            if (isShapeSimilar && !isColliding && isAreaValid && isNotGhost) {
                                commitToLock(rb, r, Math.max(sweepEnd, r * 0.85));
                                rescuedCount++;
                                lockedInThisLayer = true;
                            }
                        }

                        // 如果這層有打撈到新波段，立刻同步物理牆
                        // 這能保護剛撈到的微弱訊號，在下一次更低閾值的掃描中絕對不會溢流擴張
                        if (lockedInThisLayer) {
                            syncLockMapToWorker();
                        }
                    }

                    if (rescuedCount > 0) {
                        syncLockMapToWorker(); // 同步打撈後的物理牆
                        console.log(`[Phase 3 Rescue] 成功從雜訊底層打撈了 ${rescuedCount} 個形態相似的弱訊號波段！`);
                    }
                }
                // ============================================================================

                // ============================================================================
                // 【幾何裁切引擎 (Geometric Bounding Crop)】
                // 檢查是否勾選「移除 ROI 外冗餘」，且使用者確實有畫框 (存在 origW 與 origH)
                // ============================================================================
                const isCropEnabled = document.getElementById('mserCropToggle').checked;
                if (isCropEnabled && AppState.roi.current.origW && AppState.roi.current.origH) {
                    let cx = (AppState.roi.current.w || AppState.img.width) / 2;
                    let cy = (AppState.roi.current.h || AppState.img.height) / 2;
                    let halfW = AppState.roi.current.origW / 2;
                    let halfH = AppState.roi.current.origH / 2;
                    
                    // 給予 5px 的安全邊距容錯，防止剛好貼在邊界上的真實波段被誤殺
                    let safeMargin = 5; 
                    let validMinX = cx - halfW - safeMargin;
                    let validMaxX = cx + halfW + safeMargin;
                    let validMinY = cy - halfH - safeMargin;
                    let validMaxY = cy + halfH + safeMargin;

                    let beforeCount = AppState.data.lockedBlobs.length;
                    
                    // 過濾器：只保留質心 (Center of Mass) 落在原始 ROI 範圍內的波段
                    AppState.data.lockedBlobs = AppState.data.lockedBlobs.filter(b => {
                        return b.centerX >= validMinX && b.centerX <= validMaxX &&
                               b.centerY >= validMinY && b.centerY <= validMaxY;
                    });
                    
                    let removedCount = beforeCount - AppState.data.lockedBlobs.length;
                    if (removedCount > 0) {
                        console.log(`[Geometric Crop] 已移除 ${removedCount} 個落在原始 ROI 之外的冗餘波段。`);
                    }
                }

                // 【清除暫存殘骸】倒掉最後一趟掃描的未鎖定波段，防止紅框疊加與幽靈雜訊顯示
                AppState.data.workerBlobs = []; 

                syncLockMapToWorker(); 
                renderCompositeState(); 
                generateTable(); 
            
            console.log(`[MSER Engine] 掃描完畢。過濾後共保留 ${AppState.data.lockedBlobs.length} 個真實波段。`);

        } catch(e) { 
            console.error("[MSER Deadlock Prevented]", e); 
            setStatus('❌ 掃描過程發生硬體超時或錯誤，已強制中斷', false);
        } finally {
            AppState.sys.isLocked = false;
            document.body.style.cursor = 'default';
            if (appContainer) appContainer.style.pointerEvents = 'auto';

            DOM.modeBanner.innerText = "當前模式：全圖檢視 / 參數微調";
            DOM.modeBanner.style = ""; 
            
            // Auto HDR 掃描結束並解除系統鎖定後，必須手動喚醒儲存與匯出按鈕
            DOM.saveBtn.disabled = false;
            DOM.exportBtn.disabled = false;
            
            DOM.autoHdrBtn.disabled = false; 
            DOM.lockAllBtn.disabled = false;
            DOM.magicWandBtn.disabled = false; // ✅ Auto HDR 結束，解鎖魔術棒
            
            DOM.unlockAllBtn.disabled = (AppState.data.lockedBlobs.length === 0);

            // 【狀態復原】將 HDR 滑桿、變數與 Auto BG 歸還給使用者原本的設定
            physCore = originalPhysCore;
            physBoundary = originalPhysBoundary;
            DOM.autoBgToggle.checked = originalAutoBg; 
            updateSliderUI();
            
            // 如果原本是 Auto 狀態，要把字體顏色變回綠色
            DOM.rbVal.style.color = originalAutoBg ? 'var(--success)' : 'var(--primary)';
            
            requestCalculation(); // 重繪最後的視覺狀態
            
            isAutoHdrReady = false;
            autoHdrConfigPanel.style.display = 'none';
            DOM.autoHdrBtn.innerHTML = '<span title="自動執行 MSER 拓撲降維掃描">✨ Auto HDR</span>';
            DOM.autoHdrBtn.style.backgroundColor = '#17a2b8'; 
            DOM.autoHdrBtn.style.boxShadow = 'none';
            
            setStatus(`✨ MSER 拓撲掃描完成！共鎖定 ${AppState.data.lockedBlobs.length} 個完美波段`, false);
        }
    });
    
    /* ============================================================================
       Methodology Modal 控制與 KaTeX 渲染邏輯
       ============================================================================ */
    const helpBtn = document.getElementById('helpBtn');
    const methodologyModal = document.getElementById('methodologyModal');
    const closeMethodologyBtn = document.getElementById('closeMethodologyBtn');
    let isMathRendered = false;

    helpBtn.addEventListener('click', () => {
        methodologyModal.classList.add('active');
        
        // 延遲渲染數學公式，避免在系統啟動初期佔用 Main Thread
        if (!isMathRendered && typeof renderMathInElement === 'function') {
            renderMathInElement(methodologyModal, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false}
                ],
                throwOnError: false
            });
            isMathRendered = true;
        }
    });

    closeMethodologyBtn.addEventListener('click', () => {
        methodologyModal.classList.remove('active');
    });

    // 點擊 Modal 外側空白處關閉
    methodologyModal.addEventListener('click', (e) => {
        if (e.target === methodologyModal) {
            methodologyModal.classList.remove('active');
        }
    });
