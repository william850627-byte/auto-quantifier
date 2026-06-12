import * as UTIF from 'utif';

self.onmessage = function(e) {
    const msg = e.data;
    if (msg.type === 'PARSE_TIFF') {
        const buffer = msg.buffer;
        try {
            const ifds = UTIF.decode(buffer);
            let channelsData = [];
            let transferables = [];

            // 【多通道特徵提取 (Multiplex Heuristic)】
            // 掃描儀的 TIFF 通常包含主圖層與低解析度縮圖。
            // 以「最大解析度」尋找主通道特徵，防禦 Thumbnail 在 IFD[0] 的異常。
            let maxArea = 0;
            let targetW = 0, targetH = 0;
            
            // 1. 掃描所有 IFD，找出最大的面積 (真實圖層)
            for (let i = 0; i < ifds.length; i++) {
                let area = ifds[i].width * ifds[i].height;
                if (area > maxArea) {
                    maxArea = area;
                    targetW = ifds[i].width;
                    targetH = ifds[i].height;
                }
            }
            
            // 2. 以最大面積的寬高作為 Multiplex 過濾基準
            let mainIfds = ifds.filter(ifd => ifd.width === targetW && ifd.height === targetH);
            if(mainIfds.length === 0) mainIfds = [ifds[0]]; // 終極防呆
            
            // 防呆：如果沒有抓到，至少解析第一層
            if(mainIfds.length === 0) mainIfds = [ifds[0]]; 

            // 迴圈解析每一個通道 (Channel)
            for (let c = 0; c < mainIfds.length; c++) {
                let ifd = mainIfds[c];
                UTIF.decodeImage(buffer, ifd); 
                
                const width = ifd.width; 
                const height = ifd.height;
                const isBigEndian = new DataView(buffer).getUint16(0, false) === 0x4D4D; 
                const bitDepth = ifd.t258 ? ifd.t258[0] : 8;
                const sampleFormat = ifd.t259 ? ifd.t259[0] : 1; 
                
                const dataView = new DataView(ifd.data.buffer, ifd.data.byteOffset, ifd.data.byteLength);
                let mathDataPipeline = new Float32Array(width * height);
                
                for (let i = 0; i < width * height; i++) {
                    if (bitDepth === 32) { 
                        mathDataPipeline[i] = (sampleFormat === 3) ? dataView.getFloat32(i * 4, !isBigEndian) : dataView.getUint32(i * 4, !isBigEndian);
                    } else if (bitDepth === 16) { 
                        mathDataPipeline[i] = dataView.getUint16(i * 2, !isBigEndian);
                    } else { 
                        mathDataPipeline[i] = dataView.getUint8(i); 
                    }
                }

                // 各通道獨立的降採樣與強健統計
                let sampleSize = Math.min(mathDataPipeline.length, 100000);
                let subsample = new Float32Array(sampleSize);
                let step = Math.max(1, Math.floor(mathDataPipeline.length / sampleSize));
                for (let i = 0; i < sampleSize; i++) { subsample[i] = mathDataPipeline[i * step]; }
                subsample.sort(); 

                let robustMin = subsample[Math.floor(sampleSize * 0.001)];
                let robustMax = subsample[Math.floor(sampleSize * 0.999)];
                if (robustMax <= robustMin) robustMax = robustMin + 1; 

                const NUM_BINS = 256; 
                const histogram = new Uint32Array(NUM_BINS);
                const range = robustMax - robustMin;
                
                for (let i = 0; i < sampleSize; i++) {
                    let val = subsample[i];
                    if (val >= robustMin && val <= robustMax) {
                        let binIndex = Math.floor(((val - robustMin) / range) * (NUM_BINS - 1));
                        histogram[binIndex]++;
                    }
                }
                
                let maxCount = 0, peakBinIndex = 0;
                for (let b = 0; b < NUM_BINS; b++) { 
                    if (histogram[b] > maxCount) { maxCount = histogram[b]; peakBinIndex = b; } 
                }
                
                const bgMode = robustMin + (peakBinIndex / (NUM_BINS - 1)) * range;
                const needsInversion = Math.abs(bgMode - robustMax) < Math.abs(bgMode - robustMin);

                let renderPixels = new Uint8ClampedArray(width * height * 4);
                for (let i = 0; i < mathDataPipeline.length; i++) {
                    let val = mathDataPipeline[i];
                    if (val < robustMin) val = robustMin;
                    if (val > robustMax) val = robustMax;
                    
                    let normalized = (val - robustMin) / range;
                    mathDataPipeline[i] = needsInversion ? (robustMax - val) : (val - robustMin);
                    if (needsInversion) normalized = 1.0 - normalized; 
                    
                    let renderVal = 255 - Math.round(normalized * 255); 
                    let rgbaIdx = i * 4; 
                    renderPixels[rgbaIdx] = renderPixels[rgbaIdx+1] = renderPixels[rgbaIdx+2] = renderVal; 
                    renderPixels[rgbaIdx+3] = 255; 
                }

                // 將單一通道的結果存入陣列
                channelsData.push({
                    index: c, width: width, height: height, bitDepth: bitDepth, sampleFormat: sampleFormat,
                    globalImageMax: robustMax - robustMin,
                    mathDataPipeline: mathDataPipeline.buffer, 
                    renderPixels: renderPixels.buffer
                });
                
                transferables.push(mathDataPipeline.buffer, renderPixels.buffer);
            }

            // Zero-Copy 傳回主執行緒 (包含所有通道的資料)
            self.postMessage({
                type: 'TIFF_PARSED_MULTIPLEX', 
                channels: channelsData
            }, transferables);

        } catch (e) { 
            self.postMessage({ type: 'TIFF_ERROR', error: e.toString() }); 
        }
    }
};
