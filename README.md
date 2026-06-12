---

### 💡 下一步行動清單 (TODOs)：

當這份 `README.md` 放進您實體資料夾後，請完成這三件能讓專案氣場拉滿的事：

1. **替換連結**：
   * 把 `#` 與 `https://github.com/YourUsername/...` 換成您未來真實部署的 Netlify / Github Pages 網址與 Repo 網址。
2. **準備測試圖檔 (`demo_data`)**：
   * 在您的 `aq-refactored` 實體目錄下建立一個 `demo_data` 資料夾，放 1~2 張不具隱私問題的測試用 `.tif` 圖檔。
3. **錄製並替換 GIF 動圖 (最重要的一環！)**：
   * 開啟您的本地伺服器 (`npm run dev`)。
   * 下載免費的 [ScreenToGif](https://www.screentogif.com/)，錄製我在文字中預留的 **那 3 個操作情境 (Auto HDR / Magic Wand / PDF 匯出)**，每段約 10 秒。
   * 將錄好的 GIF 放在專案內（例如建個 `assets/` 資料夾），並把 Markdown 裡面的 `https://via.placeholder.com...` 替換成相對路徑（例如：`![Auto HDR Demo](./assets/demo-autohdr.gif)`）。

完成這些後，您的專案大門就會瞬間變得極具「國際學術頂刊與頂級開源專案」的氣勢！🚀

### 🎬 行動指南：如何把 GIF 動圖放進這份 README？

這份 README 的骨架已經具備了頂級開源專案的氣勢，現在我們需要把「靈魂（動圖）」填進去。請按照以下 3 步走：

#### 1. 建立測試數據資料夾 (`demo_data`)
在您的實體專案資料夾 (`aq-refactored`) 中，建立一個名為 `demo_data` 的資料夾。挑選一張有代表性、具備挑戰性（有沾黏或變形）的 16/32-bit TIFF 圖檔放進去，並命名為 `Sample_Blot_32bit.tif`。

#### 2. 錄製 3 段震撼的 GIF 動圖 (最重要的武器！)
*   **推薦工具：** Windows 用戶強烈建議使用 **[ScreenToGif](https://www.screentogif.com/)**（免費開源，可以精準剪輯不要的畫格，並添加按鍵提示，讓檔案變小又專業）。
*   **錄製訣竅：** 
    *   開啟 `npm run dev` 在本地端錄製。
    *   **不要全螢幕錄影！** 將軟體的錄影框縮小，**只框住「左側控制面板」與「中間的影像畫布區」**。這樣上傳後，GIF 的字體才會大且清晰。
    *   節奏要明快，每段 GIF 長度控制在 **5 ~ 10 秒**內。
    *   檔案大小盡量壓在 **3MB ~ 5MB**，確保全球各地的 Reviewer 載入網頁時不會卡頓。

#### 3. 取得圖片網址（白嫖 GitHub 免費圖床秘技）
如果您不想自己架設伺服器放圖片，最快的做法是：
1. 將專案推上您的 GitHub Repository 後，點擊上方的 **"Issues"** 頁籤 -> 點擊 **"New Issue"**。
2. **直接把您錄好的 GIF 檔案拖曳進文字輸入框裡**。
3. GitHub 會自動上傳並在框內產生一串類似 `https://github.com/user-attachments/assets/...` 的 Markdown 圖片語法。
4. **把那串網址複製下來，貼進 README 對應的 `<img src="...">` 裡面，替換掉預設的 `placehold.co` 佔位圖！** 
*(註：那個 Issue 不用真的 Submit 發布出去，只要網址產生出來，圖片就永久存在 GitHub 伺服器上了，您可以直接關閉分頁)。*

<div align="center">

# 🧬 Auto Quantifier (AQ)

**A Serverless, Edge-Computing Workstation for Automated Western Blot Quantification**

[![Version](https://img.shields.io/badge/version-v12.5.08-blue.svg?style=for-the-badge&logo=appveyor)](https://github.com/your-username/auto-quantifier)
[![Build: Vite](https://img.shields.io/badge/Build-Vite_Single_File-646CFF?style=for-the-badge&logo=vite)](https://github.com/your-username/auto-quantifier)
[![License: MIT](https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform: Web Browser](https://img.shields.io/badge/Platform-Web_Browser_(Serverless)-orange.svg)](https://auto-quantifier.netlify.app)
[![Paper](https://img.shields.io/badge/bioRxiv-In_Preparation-b31b1b.svg?style=for-the-badge)](https://biorxiv.org)

[![NCKU](https://img.shields.io/badge/NCKU-BIMB_Yu_Lab-purple.svg?style=for-the-badge)](https://scholar.google.com/citations?user=dtKIjzkAAAAJ&hl=en)

[**🚀 Launch Live Demo (No Install Required)**](https://auto-quantifier.netlify.app) | [**📥 Download Demo Dataset**](./demo_data/) | [**📖 Methodology**](#-methodology-highlights)


</div>

<br/>

## 🎯 Overview & The "Why"

**Auto Quantifier (AQ)** is a high-performance, browser-based automated scientific imaging workstation explicitly designed to address the **reproducibility crisis** in Western Blotting (WB) and densitometry analysis. 

Traditional tools (e.g., ImageJ/Fiji) rely heavily on subjective manual bounding boxes and global thresholding, leading to severe inter-operator bias. AQ establishes an objective, mathematically rigorous boundary for every protein band, effectively eliminating human bias. AQ revolutionizes this workflow by introducing **Hysteresis Thresholding with Breadth-First Search (BFS)** & **Maximally Stable Extremal Regions (MSER)** for topology-based automated extraction and **Log-Driven 1D Watershed segmentation** for resolving weakened, fused, smeared bands.

Built entirely on a dual-engine Web Worker architecture, AQ processes lossless multi-channel 16/32-bit Float TIFFs locally. **Your unpublished sensitive biomedical data never leaves your device**, ensuring absolute data privacy, Zero-Latency interactions, and GLP-compliant audit trails without requiring any server-side installation or data uploading.

---

## 🔥 Core Innovations & Features

### 🔬 Unparalleled Algorithmic Precision
- **✨ Auto HDR Topology (MSER)**: Simulates a threshold "water level descent" to track signal lineages dynamically, locking onto the most mathematically stable topographical plateau of protein bands to eliminate subjective human bias.
- **🪄 Log-Driven Magic Wand**: Employs logarithmic spatial mapping coupled with dynamic lane clamping to forcefully extract extremely weak signals from high-background noise.
- **🔪 1D Projected Watershed Segmentation**: Intelligently separates physically fused/smeared bands using 1D spectral valley detection and intensity-symmetric trimming, preventing asymmetric trailing artifacts.
- **📐 Asymmetrical Piecewise Quadratic Warp**: Corrects the classic "smiling effect" in electrophoresis using independent left/right parabolic mathematical mapping, conserving absolute integrated intensity.
- **🗂️ Multi-channel Alignment**: Supports Li-COR multiplex TIFFs with absolute physical coordinate locking across different fluorescence channels.

### 🛡️ Data Integrity & GLP Compliance
- **🔒 Cryptographic Fingerprinting**: Automatically generates a unique SHA-256 hash for every uploaded multiplex 16/32-bit TIFF, preventing data falsification.
- **📊 Real-time Biostatistics**: Built-in Double-Normalization engine. Calculates Intra-lane ratios (e.g., Target / GAPDH) and Inter-lane Fold Changes (Control Group vs. Experimental Groups) on the fly.
- **📋 Immutable PDF Reports**: Exports A4-sized, read-only GLP (Good Laboratory Practice) reports containing high-res visual proofs, quantitative data, and chronological audit trails.

### ⚡ Serverless Edge Computing
- **🌐 Privacy-First Architecture**: Runs 100% locally in modern browsers (Chrome, Edge, Safari). Complete extraction and processing within the browser using Ping-Pong buffer Web Workers. No server uploads, no cloud bottlenecks, no data leakage.
- **🧠 Extreme Memory Management**: Utilizes Dual-Engine Web Workers with Zero-Copy architecture and aggressive GC to prevent out-of-memory (OOM) crashes even with gigapixel floating-point matrices.

---

## 📸 Visual Highlights (Features in Action)

### 0. Basic

<div align="center">
  <img src="https://github.com/user-attachments/assets/e0f025ac-03a9-4ca6-b152-02eb681c388e" alt="Basic" width="800">
</div>
<br>

### 1. ✨ Auto HDR: Topographical MSER Scanning
Forget manual thresholding. AQ simulates a "water-level descent" (Threshold Descent) to find the most stable topological plateau for each band. It automatically locks onto strong signals while employing adaptive morphological sweeps to rescue faint bands submerged in background noise.

<div align="center">
  <img src="https://via.placeholder.com/800x400/1e1e1e/8be9fd?text=[+Upload+Auto_HDR.gif+Here+]" alt="Auto HDR Demo" width="800">
</div>
<br>

### 2. 🪄 Magic Wand: Log-Driven Rescue & 1D Watershed
Tired of fused and smeared bands? AQ projects 2D pixels into a 1D spectral valley. Combined with a Log-Driven Breadth-First Search (BFS) restricted by dynamic lane clamping, it applies **Intensity-Symmetric Trimming** to cleanly cleave touching bands without the infamous "asymmetric tailing" artifacts.

<div align="center">
  <img src="https://via.placeholder.com/800x400/1e1e1e/bd93f9?text=[+Upload+Magic_Wand.gif+Here+]" alt="Magic Wand Demo" width="800">
</div>
<br>

### 3. 📋 Biostats & GLP-Compliant Audit Reports
Publishing in top-tier journals requires absolute data integrity. AQ automatically computes **Double-Normalization Fold Changes** (Internal Control & Reference Lane). With one click, it exports a Read-Only PDF report embedded with **SHA-256 cryptographic fingerprints** and an immutable Audit Trail.

<div align="center">
  <img src="https://via.placeholder.com/800x400/1e1e1e/50fa7b?text=[+Upload+PDF_Report.gif+Here+]" alt="PDF Report Demo" width="800">
</div>

---

## 🎬 Quick Showcases

*(💡 Note for maintainer: Replace the placeholders below with actual GIF URLs)*

### 1. Zero-Click Extraction via Auto HDR (MSER)
![Auto HDR Demo](https://via.placeholder.com/800x400/1e1e1e/8be9fd?text=[+Upload+Auto_HDR.gif+Here+])
> AQ automatically scans topological parameters to lock onto stable protein bands while filtering out artifacts based on geometric features.

### 2. Resolving Fused Bands with 1D Watershed
![Watershed Demo](https://via.placeholder.com/800x400/1e1e1e/bd93f9?text=[+Upload+Magic_Wand.gif+Here+])
> Applying Log-Driven BFS and Intensity-Symmetric Trimming to perfectly slice fused bands without asymmetric trailing.

### 3. One-Click GLP Audit Report
![PDF Report Demo](https://via.placeholder.com/800x400/1e1e1e/50fa7b?text=[+Upload+PDF_Report.gif+Here+])
> Generating a read-only PDF containing digital signatures, visual proofs, and double-normalized biostatistical tables.

---

## 🚀 Try It Now (Live Demo)

You don't need to install anything. Experience AQ directly in your browser:

👉 **[Launch Auto Quantifier Live Workspace](https://auto-quantifier.netlify.app)**

### 📥 Download Demo Dataset
Don't have a Western Blot image at hand? Download our validated 16-bit TIFF datasets to test the algorithms:
1. Download the sample images from the [`/demo_data/`](./demo_data/) directory.
2. Open the **Live Demo Workstation**.
3. Upload the image and click **✨ Auto HDR** to experience automated quantification.

---

## 💻 Local Development & Build (Single-File App)

AQ has been refactored into a modern, modularized ES Module architecture using **Vite**. It leverages `vite-plugin-singlefile` to compile all logic, CSS, and Web Workers into a **single, highly-portable ~1MB `index.html` file** for maximum offline usability. You can run this file from a USB drive deep in the Amazon rainforest with zero internet connection.

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)

### Setup Instructions
```bash
# 1. Clone the repository
git clone https://github.com/YourUsername/auto-quantifier.git
cd auto-quantifier

# 2. Install dependencies (UTIF, jsPDF, Vite)
npm install

# 3. Start the ultra-fast development server (HMR enabled)
npm run dev

# 4. Build the ultimate single-file executable
npm run build
```

After running `npm run build`, the final standalone application will be located at `dist/index.html`. You can distribute this single file via USB drives; it requires no internet connection to function.

---

## 📖 Methodology Highlights

AQ bridges computer vision and biophysics. Key algorithmic implementations include:

1. **Asymmetrical Piecewise Quadratic Warp**: 
Corrects the classic "smiling effect" in electrophoresis using independent left/right quadratic factors combined with Inverse Spatial Mapping and Bilinear Interpolation to ensure 100% mass preservation.

2. **Downsampled Morphological Opening**: 
A linear-time $\mathcal{O}(W \cdot H \cdot r)$ rolling ball algorithm for dynamic background subtraction.

3. **Forgiving Plateau Tracking**: 
A custom state-machine implemented over the MSER algorithm that allows bands to greedily converge during threshold descent without being killed by micro-fluctuations.

*(Detailed mathematical derivations are available in the Methodology panel within the application and our upcoming publication).*

---

## 📝 Citation

If you utilize Auto Quantifier in your research, please cite our upcoming paper:

```bibtex
@article{AutoQuantifier2026,
  title={Auto Quantifier: An Edge-Computing Serverless Workstation for Reproducible Western Blot Analysis via MSER Topology},
  author={SHIH HONG_William Frederic_YIR • HUANG},
  publisher={NCKU BIMB Yu Lab},
  journal={bioRxiv (Manuscript in preparation)},
  year={2026},
  doi={10.1101/2026.xx.xx.xxxxxx}
}
```

---

## ⚖️ License & Copyright

This project is distributed under the MIT License - see the LICENSE file for details.

Designed and engineered by SHIH HONG_William Frederic_YIR • HUANG.

Copyright © 2026 SHIH HONG_William Frederic_YIR • HUANG | NCKU BIMB Yu Lab. All Rights Reserved.

