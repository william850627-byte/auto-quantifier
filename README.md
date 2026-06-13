<div align="center">

# 🧬 Auto Quantifier (AQ)

**A Serverless, Edge-Computing Workstation for Automated Western Blot Quantification**

[![Version](https://img.shields.io/badge/version-v12.5.08-blue.svg?style=for-the-badge&logo=appveyor)](https://github.com/william850627-byte/auto-quantifier)
[![Build: Vite](https://img.shields.io/badge/Build-Vite_Single_File-646CFF?style=for-the-badge&logo=vite)](https://github.com/william850627-byte/auto-quantifier)
[![License: MIT](https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform: Web Browser](https://img.shields.io/badge/Platform-Web_Browser_(Serverless)-orange.svg)](https://auto-quantifier.netlify.app)
[![Paper](https://img.shields.io/badge/bioRxiv-In_Preparation-b31b1b.svg?style=for-the-badge)](https://biorxiv.org)

[![NCKU](https://img.shields.io/badge/NCKU-BIMB_Yu_Lab-purple.svg?style=for-the-badge)](https://scholar.google.com/citations?user=dtKIjzkAAAAJ&hl=en)

[**🚀 Launch Live Demo (No Install Required)**](https://auto-quantifier.netlify.app) | [**📥 Download Demo Dataset**](./demo_data/) | [**📖 Methodology**](#-methodology-highlights)


</div>

<br/>

## 🎯 Overview & The "Why"

**Auto Quantifier (AQ)** is a high-performance, browser-based automated scientific imaging workstation explicitly designed to address the **Reproducibility Crisis** in Western Blotting (WB) and densitometry analysis. 

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

## 🎬 Visual Highlights (Features in Action)

### 0. ▶ 𝓓ynamic Analysis
Upload Image -> Select Interest Region -> Correction (Rotation/Smile) -> Auto Rolling Ball radius Estimation -> Hysteresis BFS -> Data Locking

<div align="center">
  <img src="https://github.com/user-attachments/assets/71d541bf-080f-4e76-a0b2-0a3cd293ef8c" alt="Basic" width="800">
</div>
<div align="center">
  <img src="https://github.com/user-attachments/assets/20b26cad-aa9e-45f1-a017-9c6e093fd959" alt="Basic" width="800">
</div>
<br>

### 1. ✨ Auto HDR: Topographical MSER Scanning
Forget manual thresholding. AQ simulates a "water-level descent" (Threshold Descent) to find the most stable topological plateau for each band. It automatically locks onto strong signals while employing adaptive morphological sweeps to rescue faint bands submerged in background noise.

<div align="center">
  <img src="https://github.com/user-attachments/assets/13699953-24e8-43e2-9828-c5af3319d2db" alt="Auto HDR Demo" width="800">
</div>
<br>

### 2. 🪄 Magic Wand: Log-Driven Rescue & 1D Watershed
Tired of fused and smeared bands? AQ projects 2D pixels into a 1D spectral valley. Combined with a Log-Driven Breadth-First Search (BFS) restricted by dynamic lane clamping, it applies **Intensity-Symmetric Trimming** to cleanly cleave touching bands without the infamous "asymmetric tailing" artifacts.

<div align="center">
  <img src="https://github.com/user-attachments/assets/8ed8abd9-3d80-4141-98ea-b0a1550e9fb8" alt="Magic Wand Demo" width="800">
</div>
<br>

### 3. 📋 Biostats & GLP-Compliant Audit Reports
Publishing in top-tier journals requires absolute data integrity. AQ automatically computes **Double-Normalization Fold Changes** (Internal Control & Reference Lane). With one click, it exports a Read-Only PDF report embedded with **SHA-256 cryptographic fingerprints** and an immutable Audit Trail.

<div align="center">
  <img src="./assets/Biostats.gif" alt="PDF Report Demo" width="800">
</div>

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

3. **Auto HDR Topology (MSER)**: Simulates a threshold "water level descent" to track signal lineages dynamically, locking onto the most mathematically stable topographical plateau of protein bands to eliminate subjective human bias.

4. **1D Projected Watershed Segmentation**: Intelligently separates physically fused/smeared bands using 1D spectral valley detection and intensity-symmetric trimming, preventing asymmetric trailing artifacts.

5. **Forgiving Plateau Tracking**: 
A custom state-machine implemented over the MSER algorithm that allows bands to greedily converge during threshold descent without being killed by micro-fluctuations.

*(Detailed mathematical derivations are available in the Methodology panel within the application and our upcoming publication).*

---

## 📝 Citation

If you utilize Auto Quantifier in your research, please cite our upcoming paper:

```bibtex
@article{AutoQuantifier2026,
  title={Auto Quantifier: An Edge-Computing Serverless Workstation for Reproducible Western Blot Analysis via MSER Topology},
  author={SHIH HONG_William Frederic_YIR • HUANG},
  orcid={0009-0008-2033-4880},
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

