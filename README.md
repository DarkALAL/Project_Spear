# ⚡ Project Spear
### AI-Powered Code Analysis and Review System for C and Python

<div align="center">

![Project Spear Banner](https://img.shields.io/badge/Project-Spear-blue?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js)
![React](https://img.shields.io/badge/React-18-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

**A privacy-first, offline-capable static analysis and AI code review tool**
**built for C and Python projects.**

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Objective](#-objective)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [AI Model Setup](#-ai-model-setup)
- [Configuration](#-configuration)
- [Running the Application](#-running-the-application)
- [Usage Guide](#-usage-guide)
- [Static Analysis Tools](#-static-analysis-tools)
- [API Reference](#-api-reference)
- [Team](#-team)

---

## 🔍 Overview

**Project Spear** is a final year B.Tech project developed at **Thejus Engineering College, KTU**. It is a web-based code analysis platform that combines traditional static analysis tools with a locally-running AI model to help developers identify bugs, security vulnerabilities, and code quality issues in C and Python codebases — entirely offline, with no data leaving the machine.

Upload a `.zip` of your project, run analysis, and get instant feedback with AI-powered explanations for every issue found.

---

## 🎯 Objective

The primary objectives of Project Spear are:

1. **Automate code review** — Run multiple static analysis tools simultaneously and aggregate results into a unified, readable interface.
2. **AI-powered explanations** — Use a locally-running 1B parameter LLM to explain each issue in plain English and suggest fixes, without relying on cloud APIs.
3. **Privacy-first design** — All processing happens on the developer's machine. No code is ever sent to an external server or third-party service.
4. **Offline capability** — The entire system works without an internet connection once set up.
5. **Visual dependency analysis** — Automatically parse `#include` and `import` statements to render an interactive force-directed dependency graph of the project's file relationships.

---

## ✨ Features

### 🔬 Static Analysis
- **Multi-tool analysis pipeline** — Runs 5 industry-standard linters in parallel
- **C/C++ analysis** via Cppcheck (memory leaks, null pointers, undefined behavior) and Clang-Tidy (style, modernization, bug patterns)
- **Python analysis** via Pylint (errors, conventions, refactors), Flake8 (PEP8 compliance), and Bandit (security vulnerabilities)
- **Header file support** — `.h` files are fully analyzed alongside `.c` source files
- **Deduplication** — Multiple tools reporting the same issue are merged into a single entry
- **Severity classification** — Issues classified as Error, Warning, or Info with color-coded badges

### 🤖 AI-Powered Explanations
- **Local inference** — Powered by `Maincoder-1B-ONNX`, a 1-billion parameter code model running entirely on-device
- **GPU acceleration** — Automatically detects and uses NVIDIA GPU (CUDA) when available, falls back to CPU gracefully
- **Structured responses** — AI explains the root cause, provides a corrected code snippet, and explains the fix
- **Markdown rendering** — AI responses render with syntax-highlighted code blocks, lists, and formatted text
- **Graceful degradation** — Static analysis works fully even if the AI model is not loaded

### 🖥️ Code Editor
- **Monaco Editor** — The same editor that powers VS Code, embedded in the browser
- **Syntax highlighting** — Full support for C, C headers, and Python
- **Inline squiggles** — Diagnostic issues rendered directly in the code as red/yellow/blue underlines
- **Click-to-navigate** — Clicking any issue in the panel jumps the editor to that exact line
- **Line highlight** — Navigated-to line is highlighted with a 2-second animated blue highlight

### 📊 Dependency Graph
- **Force-directed physics simulation** — Nodes repel each other and links act as springs
- **Automatic edge parsing** — Detects `#include "file.h"` (C) and `import module` (Python) relationships
- **Color-coded nodes** — Blue for `.c`, teal for `.h`, amber for `.py`
- **Interactive** — Drag nodes to rearrange, hover for glow effect
- **Arrowheads** — Dependency direction shown with animated arrows

### 🎨 UI/UX
- **VS Code-inspired dark theme** throughout
- **File tree** with per-file issue count badges
- **Issues panel** with search, filter by severity, and sort by file or severity
- **Real-time feedback** — Loading states, error banners, and status indicators
- **Fully responsive** — Works on desktop, tablet, and mobile viewports

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                         │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  File Tree  │  │ Monaco Editor│  │     Issues Panel       │  │
│  │  (App.tsx)  │  │(CodeEditor   │  │   (IssuesPanel.tsx)    │  │
│  │             │  │  .tsx)       │  │  Search │ Filter │ Sort│  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐ │
│  │   AI Explanation Modal       │  │   Dependency Graph       │ │
│  │  (AIExplanationModal.tsx)    │  │  (DependencyGraph.tsx)   │ │
│  │   ReactMarkdown rendering    │  │   Canvas + Physics sim   │ │
│  └──────────────────────────────┘  └──────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │  REST API (HTTP/JSON)
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                     EXPRESS SERVER (Node.js)                    │
│                                                                 │
│   POST /api/upload          →  projectService.ts                │
│   GET  /api/project/:id/file →  projectService.ts               │
│   POST /api/project/:id/analyze → analysisService.ts            │
│   POST /api/project/:id/explain → aiService.ts                  │
│   GET  /health                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              analysisService.ts                         │    │
│  │                                                         │    │
│  │  ┌──────────┐ ┌────────┐ ┌────────┐ ┌───────────────┐   │    │
│  │  │  Pylint  │ │ Flake8 │ │ Bandit │ │   Cppcheck    │   │    │
│  │  │ (Python) │ │(Python)│ │(Python)│ │  + Clang-Tidy │   │    │
│  │  └──────────┘ └────────┘ └────────┘ └───────────────┘   │    │
│  │           All run in parallel via Promise.allSettled()  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   aiService.ts                          │    │
│  │                                                         │    │
│  │   AutoTokenizer + AutoModelForCausalLM (HuggingFace)    │    │
│  │   Maincoder-1B-ONNX  ←→  ONNX Runtime (CUDA / CPU)      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 5 | Build tool and dev server |
| Monaco Editor | latest | VS Code-like code editor |
| react-markdown | latest | AI response rendering |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Runtime |
| Express | 4 | REST API framework |
| TypeScript | 5 | Type safety |
| @huggingface/transformers | latest | AI model loading and inference |
| onnxruntime-node | 1.20.1 | ONNX model execution (CPU + CUDA) |
| multer | latest | File upload handling |
| unzipper | latest | ZIP extraction |
| dotenv | latest | Environment configuration |

### AI Model
| Component | Details |
|---|---|
| Model | Maincoder-1B-ONNX |
| Parameters | ~1 Billion |
| Format | ONNX (fp32) |
| Runtime | ONNX Runtime with CUDA / CPU execution provider |
| Context | 1024 max new tokens per response |

### Static Analysis Tools
| Tool | Language | What it checks |
|---|---|---|
| Pylint | Python | Errors, warnings, conventions, refactors |
| Flake8 | Python | PEP8 style compliance, undefined names |
| Bandit | Python | Security vulnerabilities |
| Cppcheck | C/C++ | Memory leaks, null pointers, undefined behavior |
| Clang-Tidy | C/C++ | Style, modernization, bug-prone patterns |

---

## 📁 Project Structure

```
Project_Spear/
│
├── client/                          # React frontend (Vite + TypeScript)
│   ├── .env                         # Client environment variables
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── App.tsx                  # Main application component + state
│       ├── App.css                  # Global dark theme styles
│       ├── main.tsx
│       └── components/
│           ├── CodeEditor.tsx       # Monaco editor wrapper with squiggles
│           ├── IssuesPanel.tsx      # Issues list with filter/search/sort
│           ├── AIExplanationModal.tsx  # AI response modal with markdown
│           └── DependencyGraph.tsx  # Canvas force-directed graph
│
├── server/                          # Express backend (Node.js + TypeScript)
│   ├── .env                         # Server environment variables
│   ├── tsconfig.json                # TypeScript configuration
│   ├── nodemon.json                 # Dev server configuration
│   ├── package.json
│   ├── models/
│   │   └── Maincoder-1B-ONNX/       # AI model files (download separately)
│   │       ├── tokenizer.json
│   │       ├── decoder_with_past_model.onnx
│   │       └── decoder_with_past_model.onnx_data
│   └── src/
│       ├── index.ts                 # Express server, routes, startup
│       ├── aiService.ts             # Model loading, GPU detection, inference
│       ├── analysisService.ts       # Linter orchestration, prompt building
│       └── projectService.ts        # ZIP upload, file serving, cleanup
│
└── README.md
```

---

## 📦 Prerequisites

### System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 20.04 / Windows 10 WSL2 / macOS 12 | Ubuntu 24.04 LTS |
| RAM | 8 GB | 16 GB |
| Disk | 10 GB free | 20 GB free |
| GPU | Optional | NVIDIA GPU with 4GB+ VRAM |

### Required Software

**Node.js 18+**
```bash
# Check version
node --version   # should show v18.x.x or higher

# Install via nvm if needed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

**Python 3.8+**
```bash
python3 --version   # should show 3.8.x or higher
pip3 --version
```

**Python Static Analysis Tools**
```bash
pip install pylint flake8 bandit

# Verify all three are installed
pylint --version
flake8 --version
bandit --version
```

**C Static Analysis Tools**

Ubuntu / Debian / WSL2:
```bash
sudo apt update
sudo apt install -y cppcheck clang-tidy

# Verify both are installed
cppcheck --version
clang-tidy --version
```

macOS:
```bash
brew install cppcheck llvm
echo 'export PATH="/opt/homebrew/opt/llvm/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/DarkALAL/Project_Spear.git
cd Project_Spear
```

### 2. Install server dependencies

```bash
cd server
npm install
```

### 3. Install client dependencies

```bash
cd ../client
npm install
```

---

## 🤖 AI Model Setup

The AI model must be downloaded separately and placed in the correct directory. It is not included in the repository due to its large size (~2 GB).

### Download via Git LFS (recommended)

```bash
# Install git-lfs if not already installed
git lfs install

# Create the models directory
mkdir -p server/models

# Clone the model into the models directory
git clone https://huggingface.co/maincoder/Maincoder-1B-ONNX \
  server/models/Maincoder-1B-ONNX
```

### Manual Download

If `git lfs` is unavailable, download these four files manually from the [HuggingFace model page](https://huggingface.co/maincoder/Maincoder-1B-ONNX) and place them in `server/models/Maincoder-1B-ONNX/`:

```
server/models/Maincoder-1B-ONNX/
├── tokenizer.json                     (~2 MB)
├── tokenizer_config.json              (~1 KB)
├── decoder_with_past_model.onnx       (~50 MB)
└── decoder_with_past_model.onnx_data  (~2 GB)
```

### GPU Setup (Optional but Recommended)

If you have an NVIDIA GPU, follow these steps to enable CUDA acceleration:

**Ubuntu / WSL2:**
```bash
# 1. Add NVIDIA CUDA repository
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update

# 2. Install cuDNN runtime
sudo apt install -y libcudnn9-cuda-12

# 3. Register the library path
echo "/usr/lib/x86_64-linux-gnu" | sudo tee /etc/ld.so.conf.d/cudnn.conf
sudo ldconfig

# 4. Add to shell profile
echo 'export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# 5. Verify GPU is visible
nvidia-smi
```

The server will automatically detect your GPU on startup and use it. You can verify which device is active by visiting `http://localhost:3001/health`.

> **Note:** If GPU setup fails for any reason, the server automatically falls back to CPU inference. The application works fully on CPU — GPU just makes the AI responses faster.

---

## ⚙️ Configuration

### Server — `server/.env`

Create this file if it doesn't exist:

```env
# Server port
PORT=3001

# Frontend origin for CORS
CLIENT_ORIGIN=http://localhost:5173

# Path to AI model (relative to server/)
MODEL_DIR=./models/Maincoder-1B-ONNX

# Project upload directories
UPLOADS_DIR=./project_uploads
TEMP_UPLOADS_DIR=./temp_uploads

# Project TTL — auto-delete after this many milliseconds (default: 1 hour)
PROJECT_TTL_MS=3600000

# Device selection: auto | cpu | cuda
# auto = detect GPU automatically (recommended)
# cuda = force GPU (will fail if CUDA not available)
# cpu  = force CPU always
DEVICE=auto
```

### Client — `client/.env`

Create this file if it doesn't exist:

```env
# Backend API URL
VITE_API_BASE=http://localhost:3001
```

---

## ▶️ Running the Application

Open two terminal windows:

**Terminal 1 — Start the backend server:**
```bash
cd server
npm run dev
```

Expected output:
```
Starting Project Spear server...

📂 Model path : /path/to/server/models/Maincoder-1B-ONNX
  🔍 Auto-detecting available device...
  🎮 NVIDIA GPU detected.
  ✓ libcudnn.so.9 found
  ✅ GPU + cuDNN both available — using CUDA.
  Target device : CUDA
  dtype         : fp32
  This may take 30–60 seconds on first load...
  Loading tokenizer...
  ✓ Tokenizer loaded
  Loading ONNX model on CUDA (fp32)...
  ✓ Model loaded on CUDA (fp32)
✅ AI model loaded successfully.
─────────────────────────────────────────
🚀 Server running at http://localhost:3001
   CORS origin : http://localhost:5173
   AI features : ✅ ENABLED
   Health check: http://localhost:3001/health
─────────────────────────────────────────
```

**Terminal 2 — Start the frontend:**
```bash
cd client
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in 300 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

**Open the application:**

Navigate to **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 📖 Usage Guide

### Step 1 — Prepare your project

Compress your C or Python project into a `.zip` file. The zip can contain subdirectories and mixed C/Python files.

```bash
# Example
zip -r my_project.zip my_project/
```

Supported file types: `.c`, `.h`, `.py`

### Step 2 — Upload your project

1. Click the **Browse...** button in the top-right of the header
2. Select your `.zip` file
3. The file tree will populate with all supported source files

### Step 3 — Browse files

- Click any file in the **Project Files** tree to open it in the Monaco editor
- The editor provides full syntax highlighting for C and Python

### Step 4 — Analyze the project

1. Click the **Analyze Project** button
2. Wait for all 5 linters to run (typically 5–15 seconds depending on project size)
3. Issues appear in the right panel with severity badges (ERR / WARN / INFO)
4. Red/yellow/blue squiggle underlines appear directly in the code editor
5. The file tree shows per-file issue counts as red badges

### Step 5 — Navigate issues

- Click any issue in the right panel to jump the editor to that exact line
- The problem line is highlighted with a blue gutter bar for 2 seconds
- Use the **search box** to filter issues by message, file, or tool name
- Use the **filter buttons** to show only Errors, Warnings, or Info
- Use the **sort dropdown** to sort by File (default) or by Severity

### Step 6 — Ask AI for explanation

1. Click the **Ask AI ✨** button next to any issue
2. The AI modal opens and begins generating an explanation
3. The response includes:
   - **Root Cause** — what the problem is and why it matters
   - **Fixed Code** — a corrected code snippet
   - **Explanation** — what the fix does
4. Press **Escape** or click outside the modal to close it

### Step 7 — View dependency graph

1. Click the **Dependencies** tab in the top navigation
2. The force-directed graph shows all files as nodes connected by their import/include relationships
3. **Drag nodes** to rearrange the layout
4. **Hover nodes** to highlight them
5. Arrows show which file depends on which

---

## 🔧 Static Analysis Tools

### Python Tools

| Tool | What it detects | Example issues |
|---|---|---|
| **Pylint** | Errors, warnings, code conventions | Unused variables, undefined names, missing docstrings |
| **Flake8** | PEP8 style violations | Missing whitespace, line too long, unused imports |
| **Bandit** | Security vulnerabilities | Hardcoded passwords, shell injection, weak cryptography |

### C/C++ Tools

| Tool | What it detects | Example issues |
|---|---|---|
| **Cppcheck** | Memory and logic bugs | Memory leaks, null pointer dereference, buffer overflows, resource leaks |
| **Clang-Tidy** | Style and bug patterns | Signed/unsigned mismatch, unused parameters, modernization hints |

---

## 📡 API Reference

### `GET /health`
Returns server and AI status.
```json
{
  "status": "ok",
  "ai": true,
  "device": "cuda",
  "timestamp": "2026-03-05T10:00:00.000Z"
}
```

### `POST /api/upload`
Upload a `.zip` project file.
- **Body:** `multipart/form-data` with field `project` (zip file)
- **Response:** `{ "projectId": "uuid", "files": ["src/main.c", "utils/helper.h"] }`

### `GET /api/project/:projectId/file?path=<relative-path>`
Get the content of a specific file.
- **Response:** Raw file content as plain text

### `POST /api/project/:projectId/analyze`
Run static analysis on the project.
- **Body:** `{ "files": ["src/main.c", "utils/helper.py"] }`
- **Response:** Array of `Diagnostic` objects

### `POST /api/project/:projectId/explain`
Get an AI explanation for a diagnostic.
- **Body:** `{ "diagnostic": { "filePath": "...", "line": 12, "message": "...", ... } }`
- **Response:** `{ "explanation": "markdown string" }`

---

## 👥 Team

**Thejus Engineering College, KTU**
**Department of Computer Science and Engineering**
**Final Year B.Tech Project — 2025–2026**

| Name | Role |
|---|---|
| **Alfred Francis** | Backend, AI Integration, GPU Setup |
| **Arjun C** | Frontend, Monaco Editor, Dependency Graph |
| **Amal Joe Sebi** | Static Analysis Pipeline, Linter Integration |
| **Ananya M S** | UI/UX Design, React Components, CSS |

**Project Guide:** Ms. Densy David E

---

## 🙏 Acknowledgements

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Microsoft's VS Code editor for the web
- [HuggingFace Transformers.js](https://huggingface.co/docs/transformers.js) — Local model loading and inference
- [Maincoder-1B-ONNX](https://huggingface.co/maincoder/Maincoder-1B-ONNX) — The code analysis AI model
- [Cppcheck](https://cppcheck.sourceforge.io/) — C/C++ static analyzer
- [Clang-Tidy](https://clang.llvm.org/extra/clang-tidy/) — LLVM-based C++ linter
- [Pylint](https://pylint.org/), [Flake8](https://flake8.pycqa.org/), [Bandit](https://bandit.readthedocs.io/) — Python analysis tools

---

<div align="center">

Made with ❤️ at Thejus Engineering College

</div>
