## 🛑 License and Commercial Use

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE). It is free for personal, educational, and noncommercial use, and open to contributions — but commercial use is strictly prohibited.

Full license: [LICENSE](./LICENSE) • [polyformproject.org/licenses/noncommercial/1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3"/>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript"/>
</p>

<h1 align="center">📖 Read alond</h1>

<p align="center">
  <strong>Your books, read aloud.</strong><br/>
  A privacy-first, in-browser book reader with text-to-speech and word-level highlighting.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#project-structure">Structure</a> •
  <a href="#license">License</a>
</p>

---

## ✨ Features

- **PDF & EPUB Support** — Open any `.pdf` or `.epub` file directly in the browser
- **Text-to-Speech** — Listen to your book read aloud using the Web Speech API
- **Word-Level Highlighting** — Follow along as each word is highlighted in real-time
- **Sentence Tracking** — Active sentence is visually marked with a warm tint
- **Multiple Reading Themes** — Paper, Sepia, and Night modes for comfortable reading
- **Dark Mode** — Full UI dark mode with automatic system preference detection
- **Speed Control** — Adjustable playback speed from 0.5× to 3.0×
- **Voice Selection** — Choose from all available system TTS voices
- **Font Size Control** — Increase or decrease reader text size
- **Book Index** — Searchable chapter/page index with quick navigation
- **PDF Original View** — Toggle between extracted text and original PDF page rendering
- **Auto-Continue** — Automatically advance to the next chapter/page when reading finishes
- **Drag & Drop** — Drop files directly onto the reader to open them
- **100% Private** — Your books never leave your device. Zero uploads, zero tracking.
- **Mobile Optimized** — Fully responsive with touch-friendly controls and a settings drawer
- **Cross-Browser TTS** — Engineered to work reliably on Chrome, Safari, Firefox, Android, and iOS

## 🎬 Demo

> Open `index.html` in any modern browser, drop a PDF or EPUB, and hit play.

## 🚀 Getting Started

### Option 1: Open Directly

No build step, no dependencies, no server required.

```bash
# Clone the repo
git clone https://github.com/your-username/readalong.git

# Open in your browser
open readalong/index.html
# or on Windows
start readalong/index.html
```

### Option 2: Serve Locally

If you prefer a local dev server (for example, to avoid CORS issues with some EPUBs):

```bash
# Using Python
python -m http.server 3000

# Using Node.js
npx serve .

# Then open http://localhost:3000
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| Click any word | Jump to that sentence |
| Click section label | Open Book Index |

## 🎨 Reading Themes

| Theme | Description |
|-------|-------------|
| **Paper** | Warm off-white background, classic reading feel |
| **Sepia** | Golden-tinted parchment for reduced eye strain |
| **Night** | Dark background with soft warm text for low-light reading |

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Structure** | Vanilla HTML5 |
| **Styling** | Vanilla CSS with glassmorphism, custom properties, and responsive design |
| **Logic** | Vanilla JavaScript (no frameworks) |
| **TTS** | Web Speech API (`SpeechSynthesis`) |
| **PDF Parsing** | [pdf.js](https://mozilla.github.io/pdf.js/) v3.4.120 (CDN) |
| **EPUB Parsing** | [JSZip](https://stuk.github.io/jszip/) v3.10.1 (CDN) + custom XML/HTML parser |
| **Fonts** | [Inter](https://fonts.google.com/specimen/Inter) (UI) + [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) (headings) via Google Fonts |

## 📁 Project Structure

```
readalong/
├── index.html      # Main HTML — app shell, controls, modals
├── style.css       # All styles — themes, responsive, animations
├── app.js          # App logic — file parsing, TTS engine, UI state
└── README.md       # You are here
```

### Architecture Overview

```
┌─────────────────────────────────────┐
│            index.html               │
│  ┌──────┐  ┌────────┐  ┌────────┐  │
│  │Topbar│  │ Reader │  │Controls│  │
│  └──────┘  │  Pane  │  │  Bar   │  │
│            └────────┘  └────────┘  │
└──────────────┬──────────────────────┘
               │
       ┌───────▼───────┐
       │    app.js     │
       │               │
       │ • PDF Parser  │──▶ pdf.js (CDN)
       │ • EPUB Parser │──▶ JSZip (CDN)
       │ • TTS Engine  │──▶ Web Speech API
       │ • UI State    │
       └───────────────┘
```

## 🔒 Privacy

Readalong runs entirely in your browser. Your files are processed locally using JavaScript — **nothing is uploaded to any server**. There are no analytics, no cookies, no tracking.

## 📱 Mobile Support

The app is fully responsive with dedicated mobile optimizations:

- **Touch-friendly controls** — 46px play button, 36px icon buttons
- **Settings drawer** — Slide-up panel for voice, font size, and auto-continue
- **Reliable TTS** — Engineered around Android Chrome and iOS Safari quirks
- **Compact layout** — Optimized spacing and typography for small screens

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Free for personal, educational, and noncommercial use — commercial use is not permitted. See the [LICENSE](./LICENSE) file for full terms.

---

<p align="center">
  Made with ☕ and a love for reading.
</p>
