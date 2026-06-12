let originalPixels, rotatedPixels, backgroundPixels, tempFilter, displayPixels;
let visited, bfsQueue;
let imgWidth, imgHeight, imgSize;
let lockedOwnershipMap = null; 
let fullImagePixels = null;
let fullImageWidth = 0;

function warpArray(angle, smileFactorL, smileFactorR) {
    if (angle === 0 && smileFactorL === 0 && smileFactorR === 0) { rotatedPixels.set(originalPixels); return; }
    let rad = -angle * Math.PI / 180; let cosA = Math.cos(rad); let sinA = Math.sin(rad);
    let cx = imgWidth / 2; let cy = imgHeight / 2;
    for (let y = 0; y < imgHeight; y++) {
        let offset = y * imgWidth; let dy = y - cy;
        for (let x = 0; x < imgWidth; x++) {
            let dx = x - cx; let normDx = dx / cx; 
            let currentSmileFactor = normDx < 0 ? smileFactorL : smileFactorR;
            let warpedDy = dy - (currentSmileFactor * normDx * normDx); 
            let exactX = cx + dx * cosA - warpedDy * sinA;
            let exactY = cy + dx * sinA + warpedDy * cosA;
            if (exactX >= 0 && exactX < imgWidth && exactY >= 0 && exactY < imgHeight) {
                let x0 = Math.floor(exactX); let y0 = Math.floor(exactY);
                let x1 = Math.min(x0 + 1, imgWidth - 1); let y1 = Math.min(y0 + 1, imgHeight - 1);
                let fx = exactX - x0; let fy = exactY - y0;
                let p00 = originalPixels[y0 * imgWidth + x0]; let p10 = originalPixels[y0 * imgWidth + x1]; 
                let p01 = originalPixels[y1 * imgWidth + x0]; let p11 = originalPixels[y1 * imgWidth + x1]; 
                rotatedPixels[offset + x] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
            } else { rotatedPixels[offset + x] = 0; }
        }
    }
}

function autoEstimateBackgroundRadius(width, height) {
    let profileY = new Float32Array(height);
    let rowBuffer = new Float32Array(width); 
    for (let y = 0; y < height; y++) {
        let offset = y * width;
        for (let x = 0; x < width; x++) rowBuffer[x] = rotatedPixels[offset + x];
        rowBuffer.sort();
        profileY[y] = rowBuffer[Math.floor(width * 0.90)];
    }
    let smoothed = new Float32Array(height);
    for (let i = 2; i < height - 2; i++) smoothed[i] = (profileY[i-2] + profileY[i-1] + profileY[i] + profileY[i+1] + profileY[i+2]) / 5;
    let maxProfile = -Infinity, minProfile = Infinity;
    for (let i = 2; i < height - 2; i++) {
        if (smoothed[i] > maxProfile) maxProfile = smoothed[i];
        if (smoothed[i] < minProfile) minProfile = smoothed[i];
    }
    let globalThreshold = minProfile + (maxProfile - minProfile) * 0.15; 
    let fwhmList = [];
    for (let i = 2; i < height - 2; i++) {
        if (smoothed[i] > smoothed[i-1] && smoothed[i] > smoothed[i+1] && smoothed[i] > globalThreshold) {
            let halfMax = minProfile + (smoothed[i] - minProfile) / 2;
            let left = i, right = i;
            while (left >= 0 && smoothed[left] > halfMax) left--; left++; 
            while (right < height && smoothed[right] > halfMax) right++; right--; 
            let fwhm = (right - left) + 1; 
            if (fwhm >= 2 && fwhm < height / 2) fwhmList.push(fwhm);
        }
    }
    let autoRadius = 50; 
    if (fwhmList.length > 0) {
        fwhmList.sort((a, b) => a - b);
        autoRadius = Math.max(40, Math.round(fwhmList[Math.floor(fwhmList.length / 2)] * 2));
        autoRadius = Math.min(200, autoRadius); 
    }
    return autoRadius;
}

function applyRollingBall(radius) {
    let shrinkFactor = Math.max(1, Math.floor(radius / 5));
    let sRadius = Math.max(1, Math.round(radius / shrinkFactor));
    if (shrinkFactor === 1) {
        for (let y = 0; y < imgHeight; y++) {
            let offset = y * imgWidth;
            for (let x = 0; x < imgWidth; x++) {
                let val = Infinity; let startK = Math.max(0, x - radius); let endK = Math.min(imgWidth - 1, x + radius);
                for (let k = startK; k <= endK; k++) { if (rotatedPixels[offset + k] < val) val = rotatedPixels[offset + k]; }
                tempFilter[offset + x] = val;
            }
        }
        for (let x = 0; x < imgWidth; x++) {
            for (let y = 0; y < imgHeight; y++) {
                let val = Infinity; let startK = Math.max(0, y - radius); let endK = Math.min(imgHeight - 1, y + radius);
                for (let k = startK; k <= endK; k++) { if (tempFilter[k * imgWidth + x] < val) val = tempFilter[k * imgWidth + x]; }
                backgroundPixels[y * imgWidth + x] = val;
            }
        }
        for (let y = 0; y < imgHeight; y++) {
            let offset = y * imgWidth;
            for (let x = 0; x < imgWidth; x++) {
                let val = -Infinity; let startK = Math.max(0, x - radius); let endK = Math.min(imgWidth - 1, x + radius);
                for (let k = startK; k <= endK; k++) { if (backgroundPixels[offset + k] > val) val = backgroundPixels[offset + k]; }
                tempFilter[offset + x] = val;
            }
        }
        for (let x = 0; x < imgWidth; x++) {
            for (let y = 0; y < imgHeight; y++) {
                let val = -Infinity; let startK = Math.max(0, y - radius); let endK = Math.min(imgHeight - 1, y + radius);
                for (let k = startK; k <= endK; k++) { if (tempFilter[k * imgWidth + x] > val) val = tempFilter[k * imgWidth + x]; }
                backgroundPixels[y * imgWidth + x] = val;
            }
        }
    } else {
        let sWidth = Math.ceil(imgWidth / shrinkFactor); let sHeight = Math.ceil(imgHeight / shrinkFactor);
        let sSize = sWidth * sHeight; let sPixels = new Float32Array(sSize); let sTemp = new Float32Array(sSize); let sBg = new Float32Array(sSize);
        for (let sy = 0; sy < sHeight; sy++) {
            for (let sx = 0; sx < sWidth; sx++) {
                let minVal = Infinity, startY = sy * shrinkFactor, endY = Math.min(imgHeight, startY + shrinkFactor);
                let startX = sx * shrinkFactor, endX = Math.min(imgWidth, startX + shrinkFactor);
                for (let y = startY; y < endY; y++) {
                    let offset = y * imgWidth;
                    for (let x = startX; x < endX; x++) {
                        let p = rotatedPixels[offset + x]; if (p < minVal) minVal = p;
                    }
                }
                sPixels[sy * sWidth + sx] = minVal === Infinity ? 0 : minVal;
            }
        }
        for (let sy = 0; sy < sHeight; sy++) {
            let offset = sy * sWidth;
            for (let sx = 0; sx < sWidth; sx++) {
                let val = Infinity; let startK = Math.max(0, sx - sRadius); let endK = Math.min(sWidth - 1, sx + sRadius);
                for (let k = startK; k <= endK; k++) { if (sPixels[offset + k] < val) val = sPixels[offset + k]; }
                sTemp[offset + sx] = val;
            }
        }
        for (let sx = 0; sx < sWidth; sx++) {
            for (let sy = 0; sy < sHeight; sy++) {
                let val = Infinity; let startK = Math.max(0, sy - sRadius); let endK = Math.min(sHeight - 1, sy + sRadius);
                for (let k = startK; k <= endK; k++) { if (sTemp[k * sWidth + sx] < val) val = sTemp[k * sWidth + sx]; }
                sBg[sy * sWidth + sx] = val;
            }
        }
        for (let sy = 0; sy < sHeight; sy++) {
            let offset = sy * sWidth;
            for (let sx = 0; sx < sWidth; sx++) {
                let val = -Infinity; let startK = Math.max(0, sx - sRadius); let endK = Math.min(sWidth - 1, sx + sRadius);
                for (let k = startK; k <= endK; k++) { if (sBg[offset + k] > val) val = sBg[offset + k]; }
                sTemp[offset + sx] = val;
            }
        }
        for (let sx = 0; sx < sWidth; sx++) {
            for (let sy = 0; sy < sHeight; sy++) {
                let val = -Infinity; let startK = Math.max(0, sy - sRadius); let endK = Math.min(sHeight - 1, sy + sRadius);
                for (let k = startK; k <= endK; k++) { if (sTemp[k * sWidth + sx] > val) val = sTemp[k * sWidth + sx]; }
                sBg[sy * sWidth + sx] = val;
            }
        }
        for (let y = 0; y < imgHeight; y++) {
            let syExact = y / shrinkFactor; let sy0 = Math.floor(syExact); let sy1 = Math.min(sHeight - 1, sy0 + 1); let fy = syExact - sy0;
            let offset = y * imgWidth;
            for (let x = 0; x < imgWidth; x++) {
                let sxExact = x / shrinkFactor; let sx0 = Math.floor(sxExact); let sx1 = Math.min(sWidth - 1, sx0 + 1); let fx = sxExact - sx0;
                let p00 = sBg[sy0 * sWidth + sx0]; let p10 = sBg[sy0 * sWidth + sx1];
                let p01 = sBg[sy1 * sWidth + sx0]; let p11 = sBg[sy1 * sWidth + sx1];
                backgroundPixels[offset + x] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
            }
        }
    }
    for (let i = 0; i < imgSize; i++) displayPixels[i] = Math.max(0, rotatedPixels[i] - backgroundPixels[i]);
}

function createEmptyBlob(width, height) {
    return { area: 0, sumX: 0, sumY: 0, minX: width, maxX: 0, minY: height, maxY: 0, pixelIndices: [], isTouchingLock: false };
}

function apply1DWatershed(blob, imgWidth, imgHeight) {
    let h = blob.maxY - blob.minY + 1;
    if (h < 15) return [blob];
    let profile = new Float32Array(h);
    for (let i = 0; i < blob.pixelIndices.length; i++) {
        let idx = blob.pixelIndices[i];
        profile[Math.floor(idx / imgWidth) - blob.minY] += displayPixels[idx];
    }
    let smoothed = new Float32Array(h), kernel = [0.05, 0.25, 0.40, 0.25, 0.05];
    for (let i = 0; i < h; i++) {
        let sum = 0, weightSum = 0;
        for (let k = -2; k <= 2; k++) {
            let idx = i + k;
            if (idx >= 0 && idx < h) { sum += profile[idx] * kernel[k + 2]; weightSum += kernel[k + 2]; }
        }
        smoothed[i] = sum / weightSum;
    }
    let peaks = [];
    for (let i = 2; i < h - 2; i++) {
        if (smoothed[i] > smoothed[i-1] && smoothed[i] > smoothed[i+1]) peaks.push({ y: i, val: smoothed[i] });
    }
    if (peaks.length < 2) return [blob]; 
    let splitLines = [];
    for (let p = 0; p < peaks.length - 1; p++) {
        let p1 = peaks[p], p2 = peaks[p+1], minVal = Infinity, valleyY = -1;
        for (let i = p1.y + 1; i < p2.y; i++) { if (smoothed[i] < minVal) { minVal = smoothed[i]; valleyY = i; } }
        let lowerPeak = Math.min(p1.val, p2.val);
        if (lowerPeak > 0 && (lowerPeak - minVal) / lowerPeak > 0.05) splitLines.push(valleyY + blob.minY); 
    }
    if (splitLines.length === 0) return [blob];
    splitLines.sort((a, b) => a - b); splitLines.push(Infinity); 
    let subBlobArray = Array.from({length: splitLines.length}, () => createEmptyBlob(imgWidth, imgHeight));
    for (let i = 0; i < blob.pixelIndices.length; i++) {
        let idx = blob.pixelIndices[i];
        let y = Math.floor(idx / imgWidth), x = idx % imgWidth, intensity = displayPixels[idx], sIdx = 0;
        while (y > splitLines[sIdx]) sIdx++; 
        let sb = subBlobArray[sIdx];
        sb.area += intensity; sb.sumX += x * intensity; sb.sumY += y * intensity;
        if (x < sb.minX) sb.minX = x; if (x > sb.maxX) sb.maxX = x;
        if (y < sb.minY) sb.minY = y; if (y > sb.maxY) sb.maxY = y;
        sb.pixelIndices.push(idx);
    }
    let finalSubBlobs = [];
    for (let sb of subBlobArray) {
        if (sb.pixelIndices.length >= 10) { 
            sb.centerX = Math.round(sb.sumX / sb.area); sb.centerY = Math.round(sb.sumY / sb.area);
            finalSubBlobs.push(sb);
        }
    }
    return finalSubBlobs.length > 0 ? finalSubBlobs : [blob];
}

function findConnectedComponents(coreThreshold, boundaryThreshold, minArea) {
    visited.fill(0); let blobs = [];
    const dirs = [-imgWidth-1, -imgWidth, -imgWidth+1, -1, 1, imgWidth-1, imgWidth, imgWidth+1];
    let hasLockMap = (lockedOwnershipMap !== null);

    for (let i = 0; i < imgSize; i++) {
        if (visited[i] === 0 && displayPixels[i] >= coreThreshold && (!hasLockMap || lockedOwnershipMap[i] === 0)) {
            let head = 0, tail = 0; bfsQueue[tail++] = i; visited[i] = 1;
            let blob = createEmptyBlob(imgWidth, imgHeight);
            while (head < tail) {
                let curr = bfsQueue[head++];
                let intensity = displayPixels[curr], x = curr % imgWidth, y = Math.floor(curr / imgWidth);
                blob.area += intensity; blob.sumX += x * intensity; blob.sumY += y * intensity;
                if (x < blob.minX) blob.minX = x; if (x > blob.maxX) blob.maxX = x;
                if (y < blob.minY) blob.minY = y; if (y > blob.maxY) blob.maxY = y;
                blob.pixelIndices.push(curr); 

                for (let d of dirs) {
                    let next = curr + d, nx = next % imgWidth;
                    if (next >= 0 && next < imgSize && visited[next] === 0 && Math.abs(nx - x) <= 1) {
                        if (displayPixels[next] >= boundaryThreshold) { 
                            if (hasLockMap && lockedOwnershipMap[next] === 1) {
                                blob.isTouchingLock = true; continue;
                            }
                            visited[next] = 1; bfsQueue[tail++] = next; 
                        }
                    }
                }
            }
            if (tail >= minArea) {
                let w = blob.maxX - blob.minX, h = blob.maxY - blob.minY;
                let isGhostArtifact = blob.isTouchingLock && (tail < minArea * 1.5 || w < 8 || h < 4);
                if (!isGhostArtifact) {
                    blob.centerX = Math.round(blob.sumX / blob.area); blob.centerY = Math.round(blob.sumY / blob.area);
                    let splitBlobs = apply1DWatershed(blob, imgWidth, imgHeight);
                    for (let sb of splitBlobs) blobs.push(sb); 
                }
            }
        }
    }
    if (blobs.length > 2) {
        let widths = blobs.map(b => b.maxX - b.minX).sort((a, b) => a - b);
        let maxWidthLimit = Math.max(widths[Math.floor(widths.length / 2)] * 2.0, 15); 
        return blobs.filter(b => (b.maxX - b.minX) <= maxWidthLimit);
    }
    return blobs;
}

self.onmessage = function(e) {
    const msg = e.data;
    if (msg.type === 'LOAD_FULL_IMAGE') {
        fullImagePixels = new Float32Array(msg.pixels); 
        fullImageWidth = msg.globalWidth;
        return;
    }
    if (msg.type === 'INIT') {
        const { rx, ry, rw, rh } = msg.roi;
        imgWidth = rw; imgHeight = rh; imgSize = rw * rh;
        originalPixels = new Float32Array(imgSize);
        for (let subY = 0; subY < rh; subY++) {
            let globalY = ry + subY, subOffset = subY * rw, globalOffset = globalY * fullImageWidth;
            for (let subX = 0; subX < rw; subX++) originalPixels[subOffset + subX] = fullImagePixels[globalOffset + rx + subX];
        }
        rotatedPixels = new Float32Array(imgSize); backgroundPixels = new Float32Array(imgSize);
        tempFilter = new Float32Array(imgSize); visited = new Uint8Array(imgSize); bfsQueue = new Int32Array(imgSize); 
        lockedOwnershipMap = null; 
        let localMax = 0;
        for (let i = 0; i < imgSize; i++) { if (originalPixels[i] > localMax) localMax = originalPixels[i]; }
        self.postMessage({ type: 'INIT_DONE', currentRoiMax: localMax }); 
        return;
    }
    if (msg.type === 'UPDATE_LOCK_MAP') { lockedOwnershipMap = msg.lockMap; return; }
    if (msg.type === 'PROCESS') {
        displayPixels = new Float32Array(msg.returnedBuffer);
        const { angle, smileFactorL, smileFactorR, coreThreshold, boundaryThreshold, minArea, isAutoBg, globalImageMax } = msg;
        let { radius } = msg;
        warpArray(angle, smileFactorL, smileFactorR); 
        if (isAutoBg) {
            radius = autoEstimateBackgroundRadius(imgWidth, imgHeight);
            self.postMessage({ type: 'SYNC_RADIUS', radius: radius });
        }
        applyRollingBall(radius); 
        
        let sum = 0, count = 0;
        for (let i = 0; i < imgSize; i++) {
            if (displayPixels[i] > 0) { sum += displayPixels[i]; count++; }
        }
        let autoBoundaryVal = 0;
        if (count > 0) {
            let mean = sum / count, sqSum = 0;
            for (let i = 0; i < imgSize; i++) {
                if (displayPixels[i] > 0) { let diff = displayPixels[i] - mean; sqSum += diff * diff; }
            }
            autoBoundaryVal = mean + 0.5 * Math.sqrt(sqSum / count); 
        }

        const blobs = findConnectedComponents(coreThreshold, boundaryThreshold, minArea);
        let renderPixels = new Uint8ClampedArray(msg.returnedRenderBuffer);
        let maxVal = globalImageMax > 0 ? globalImageMax : 255;
        let logC = 255 / Math.log1p(maxVal); 

        for (let i = 0, j = 0; i < imgSize; i++, j += 4) {
            let renderVal = Math.round(logC * Math.log1p(displayPixels[i]));
            renderVal = Math.min(255, Math.max(0, renderVal));
            renderPixels[j] = renderPixels[j+1] = renderPixels[j+2] = renderVal;
            renderPixels[j+3] = 255;
        }

        self.postMessage({ 
            type: 'RESULT', blobs: blobs, autoBoundaryVal: autoBoundaryVal, 
            displayPixels: displayPixels, renderPixels: renderPixels.buffer 
        }, [displayPixels.buffer, renderPixels.buffer]);
    }
};
