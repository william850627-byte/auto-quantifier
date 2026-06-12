/* --- DOM 參照與元件綁定 --- */
export const DOM = {
    fileInput: document.getElementById('fileInput'), 
    channelControl: document.getElementById('channelControl'), // 多通道控制面板
    channelSelect: document.getElementById('channelSelect'),   // 多通道下拉選單 
    analyzeBtn: document.getElementById('analyzeBtn'),
    saveBtn: document.getElementById('saveBtn'), 
    exportBtn: document.getElementById('exportBtn'), 
    exportImgBtn: document.getElementById('exportImgBtn'), 
    exportPdfBtn: document.getElementById('exportPdfBtn'), // PDF 按鈕綁定 
    resetBtn: document.getElementById('resetBtn'), 
    exportSessionBtn: document.getElementById('exportSessionBtn'), 
    importSessionBtn: document.getElementById('importSessionBtn'), 
    importSessionInput: document.getElementById('importSessionInput'), 
    drawRoiBtn: document.getElementById('drawRoiBtn'), 
    tableBody: document.getElementById('tableBody'),
    roiStatus: document.getElementById('roiStatus'), 
    operatorInput: document.getElementById('operatorInput'),
    expIdInput: document.getElementById('expIdInput'), 
    modeBanner: document.getElementById('modeBanner'), 
    savedCounter: document.getElementById('savedCounter'),

    refRoiSelect: document.getElementById('refRoiSelect'),
    angleInput: document.getElementById('rotationAngle'), 
    angleVal: document.getElementById('angleVal'),
    smileInputL: document.getElementById('smileAngleL'),
    smileInputR: document.getElementById('smileAngleR'),
    smileValL: document.getElementById('smileValL'),
    smileValR: document.getElementById('smileValR'),
    linkSmileBtn: document.getElementById('linkSmileBtn'),
    rbRadiusInput: document.getElementById('rbRadius'), 
    rbVal: document.getElementById('rbVal'),
    autoBgToggle: document.getElementById('autoBgToggle'),
    minAreaInput: document.getElementById('minArea'), 
    areaVal: document.getElementById('areaVal'),
    lockAllBtn: document.getElementById('lockAllBtn'), 
    unlockAllBtn: document.getElementById('unlockAllBtn'), 
    autoHdrBtn: document.getElementById('autoHdrBtn'),
    magicWandBtn: document.getElementById('magicWandBtn'),
    
    imgCanvas: document.getElementById('imgCanvas'), 
    overlayCanvas: document.getElementById('overlayCanvas'), 
    uiCanvas: document.getElementById('uiCanvas'),
    canvasSection: document.getElementById('canvasSection'), 
    scrollSpacer: document.getElementById('scrollSpacer'), 
    canvasStack: document.getElementById('canvasStack'),
    bitDepthBadge: document.getElementById('bitDepthBadge'), 
    statusBadge: document.getElementById('statusBadge'), 
    zoomBadge: document.getElementById('zoomBadge'),

    plotModal: document.getElementById('plotModal'),
    plotHeader: document.getElementById('plotHeader'), 
    plotTitle: document.getElementById('plotTitle'),
    closePlotBtn: document.getElementById('closePlotBtn'),
    exportPlotBtn: document.getElementById('exportPlotBtn'), // 綁定匯出按鈕
    profilePlotCanvas: document.getElementById('profilePlotCanvas'),
    plotTooltip: document.getElementById('plotTooltip'), // 綁定 DOM

    intraRatioSelect: document.getElementById('intraRatioSelect'),
    refLaneSelect: document.getElementById('refLaneSelect'),
    onlyLockedFilter: document.getElementById('onlyLockedFilter'),
    
    workspace: document.getElementById('workspace'),
    resizer: document.getElementById('resizer'),
    tableSection: document.getElementById('tableSection'),
    
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    sidebar: document.querySelector('.sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop')
};

/* --- 畫布渲染引擎上下文 --- */
export const ctx = DOM.imgCanvas.getContext('2d', { willReadFrequently: true });
export const overlayCtx = DOM.overlayCanvas.getContext('2d'); 
export const uiCtx = DOM.uiCanvas.getContext('2d');

/* --- 單一資料流狀態中心 (App State Store) --- */
export const ZOOM_MIN = 0.1; 
export const ZOOM_MAX = 5.0;

export const AppState = {
    // 1. 影像實體資料
    img: {
        width: 0,
        height: 0,
        bitDepth: 8,
        maxVal: 255,
        fileName: "Unknown",
        fingerprint: null,
        rawTiff: null,
        raw8Bit: null,
        basePreview: null,
        channels: [],          // 儲存多通道 TIFF 的各個陣列資料
        currentChannelIdx: 0   // 目前正在檢視/分析的通道索引
    },
    // 2. 幾何與鎖定區域
    roi: {
        current: { x: 0, y: 0, w: 0, h: 0 },
        count: 0,
        localMax: 255,
        workerSynced: null
    },
    // 3. 核心運算數據
    data: {
        workerBlobs: [],
        lockedBlobs: [],
        finalLanes: [],
        saved: [],
        masterLockMap: null,
        auditTrail: [] // 【合規核心：稽核軌跡日誌】
    },
    // 4. 系統與 Worker 狀態
    sys: {
        operator: "",       // 操作者身份
        experimentId: "",   // 實驗代號
        hasStartedAnalysis: false,
        isLocked: false,
        isWorkerBusy: false,
        pendingJob: false,
        needsAutoBoundary: false,
        zoom: 1.0,
        pingPongBuffer: null,
        renderPingPongBuffer: null
    }
};

/* ============================================================================
   時光機備忘錄引擎 (Memento Pattern History Engine) 
   ============================================================================ */
export let historyStack = [];
export let redoStack = [];
export const MAX_HISTORY = 30;
