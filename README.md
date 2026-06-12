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

## 🎯 Overview

**Auto Quantifier (AQ)** is a high-performance, browser-based automated scientific imaging workstation explicitly designed to address the reproducibility crisis in Western Blotting (WB) and densitometry analysis. 

Traditional tools (e.g., ImageJ/Fiji) rely heavily on subjective manual bounding boxes and global thresholding, leading to severe inter-operator bias. AQ revolutionizes this workflow by introducing **Maximally Stable Extremal Regions (MSER)** for topology-based automated extraction and **Log-Driven 1D Watershed segmentation** for resolving fused, smeared bands.

Built entirely on a dual-engine Web Worker architecture, AQ processes lossless multi-channel 16/32-bit Float TIFFs locally. **Your unpublished sensitive biomedical data never leaves your device**, ensuring absolute data privacy, Zero-Latency interactions, and GLP-compliant audit trails without requiring any server-side installation or data uploading.

---

## 🔥 Core Innovations & Features

### 🔬 Unparalleled Algorithmic Precision
- **✨ Auto HDR Topology (MSER)**: Simulates a threshold "water level descent" to track signal lineages dynamically, locking onto the most mathematically stable topographical plateau of protein bands to eliminate subjective human bias.
- **🪄 Log-Driven Magic Wand**: Employs logarithmic spatial mapping coupled with dynamic lane clamping to forcefully extract extremely weak signals from high-background noise.
- **🔪 1D Projected Watershed Segmentation**: Intelligently separates physically fused/smeared bands using 1D spectral valley detection and intensity-symmetric trimming, preventing asymmetric trailing artifacts.
- **📐 Asymmetrical Piecewise Quadratic Warp**: Corrects the classic "smiling effect" in electrophoresis using independent left/right parabolic mathematical mapping, conserving absolute integrated intensity.

### 🛡️ Data Integrity & GLP Compliance
- **🔒 Cryptographic Fingerprinting**: Automatically generates a unique SHA-256 hash for every uploaded multiplex 16/32-bit TIFF, preventing data falsification.
- **📊 Real-time Biostatistics**: Built-in Double-Normalization engine. Calculates Intra-lane ratios (e.g., Target / GAPDH) and Inter-lane Fold Changes (Control Group vs. Experimental Groups) on the fly.
- **📋 Immutable PDF Reports**: Exports A4-sized, read-only GLP (Good Laboratory Practice) reports containing high-res visual proofs, quantitative data, and chronological audit trails.

### ⚡ Serverless Edge Computing
- **🌐 Privacy-First Architecture**: Runs 100% locally in modern browsers (Chrome, Edge, Safari). Complete extraction and processing within the browser using Ping-Pong buffer Web Workers. No server uploads, no cloud bottlenecks, no data leakage.
- **🧠 Extreme Memory Management**: Utilizes Dual-Engine Web Workers with Zero-Copy architecture and aggressive GC to prevent out-of-memory (OOM) crashes even with gigapixel floating-point matrices.

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

