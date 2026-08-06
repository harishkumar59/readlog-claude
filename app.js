(function(){
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

  // ---------------- State ----------------
  const state = {
    sections: [],        // [{label, text}]
    sectionIndex: 0,
    sentenceList: [],     // built per loaded section: [{text, words:[{start,end}], el}]
    sentenceIndex: 0,
    isPlaying: false,
    playToken: 0,         // incremented to invalidate stale async speech chains
    lastWordEl: null,
    lastSentenceEl: null,
    bookTitle: "",
    keepAliveTimer: null,
    currentUtterance: null,
    utteranceQueue: [],   // Store active utterances to prevent mobile GC & ensure continuous playback
    pdfDoc: null,         // pdf.js document reference for rendering pages
    isPdf: false,         // true when the loaded file is a PDF
    viewMode: 'text'      // 'text' = extracted text (TTS highlight), 'pdf' = original page render
  };

  // ---------------- DOM refs ----------------
  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput");
  const openBtn = $("openBtn");
  const emptyState = $("emptyState");
  const loadingState = $("loadingState");
  const readerEl = $("reader");
  const readerWrap = $("readerWrap");
  const bookMeta = $("bookMeta");
  const tocList = $("tocList");
  const tocPanel = $("toc");
  const tocBackdrop = $("tocBackdrop");
  const tocToggleBtn = $("tocToggleBtn");
  const darkModeBtn = $("darkModeBtn");
  const speedMinus = $("speedMinus");
  const speedPlus = $("speedPlus");
  const indexModal = $("indexModal");
  const indexCloseBtn = $("indexCloseBtn");
  const indexSearchInput = $("indexSearchInput");
  const indexGrid = $("indexGrid");
  const controls = $("controls");
  const sectionLabel = $("sectionLabel");
  const ribbonFill = $("ribbonFill");
  const playBtn = $("playBtn");
  const playIcon = $("playIcon");
  const pauseIcon = $("pauseIcon");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const stopBtn = $("stopBtn");
  const voiceSelect = $("voiceSelect");
  const rateSlider = $("rateSlider");
  const rateLabel = $("rateLabel");
  const fontPlus = $("fontPlus");
  const fontMinus = $("fontMinus");
  const autoAdvance = $("autoAdvance");
  const viewToggleBtn = $("viewToggleBtn");
  const pdfViewer = $("pdfViewer");
  const pdfCanvas = $("pdfCanvas");

  // ---------------- File open plumbing ----------------
  openBtn.addEventListener("click", () => fileInput.click());
  emptyState.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  ["dragover"].forEach(evt => emptyState.addEventListener(evt, (e) => {
    e.preventDefault(); emptyState.classList.add("dragover");
  }));
  ["dragleave","drop"].forEach(evt => emptyState.addEventListener(evt, (e) => {
    e.preventDefault(); emptyState.classList.remove("dragover");
  }));
  emptyState.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  readerWrap.addEventListener("dragover", (e) => e.preventDefault());
  readerWrap.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  async function handleFile(file){
    stopSpeaking();
    const name = file.name.toLowerCase();
    emptyState.style.display = "none";
    readerEl.style.display = "none";
    loadingState.style.display = "flex";
    const loadingText = loadingState.querySelector('.loadingText');
    if (loadingText) loadingText.textContent = "Opening your book…";
    try{
      let result;
      if (name.endsWith(".pdf")) {
        result = await parsePdf(file);
        state.isPdf = true;
      } else if (name.endsWith(".epub")) {
        result = await parseEpub(file);
        state.isPdf = false;
        state.pdfDoc = null;
      } else {
        throw new Error("Please choose a .pdf or .epub file.");
      }
      state.sections = result.sections;
      state.bookTitle = result.title || file.name;
      bookMeta.innerHTML = "<b>" + escapeHtml(state.bookTitle) + "</b>";
      buildToc();
      loadingState.style.display = "none";
      readerEl.style.display = "block";
      pdfViewer.style.display = "none";
      controls.classList.remove("disabled");
      // Show/hide view toggle button (only for PDFs)
      state.viewMode = 'text';
      if (state.isPdf) {
        viewToggleBtn.style.display = '';
        viewToggleBtn.innerHTML = '📄 PDF View';
        viewToggleBtn.classList.remove('active');
      } else {
        viewToggleBtn.style.display = 'none';
      }
      loadSection(0);
    } catch(err){
      console.error(err);
      loadingState.style.display = "none";
      emptyState.style.display = "block";
      alert("Couldn't open that file: " + (err.message || err));
    }
  }

  function escapeHtml(s){
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ---------------- PDF parsing ----------------
  async function parsePdf(file){
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const sections = [];
    for (let i = 1; i <= pdf.numPages; i++){
      const lt = loadingState.querySelector('.loadingText');
      if (lt) lt.textContent = "Reading page " + i + " of " + pdf.numPages + "…";
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      let lastY = null, lastHeight = 12;
      for (const item of content.items){
        const y = item.transform[5];
        const height = Math.abs(item.transform[3]) || lastHeight;
        if (lastY !== null){
          const gap = Math.abs(y - lastY);
          if (gap > lastHeight * 1.6) text += "\n\n";
          else if (gap > 1) text += " ";
        }
        text += item.str;
        lastY = y;
        lastHeight = height || lastHeight;
      }
      const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      sections.push({ label: "Page " + i, text: clean || "(No extractable text on this page.)" });
    }
    let title = file.name.replace(/\.pdf$/i, "");
    try{
      const meta = await pdf.getMetadata();
      if (meta && meta.info && meta.info.Title) title = meta.info.Title;
    }catch(e){}
    state.pdfDoc = pdf; // Store for later page rendering
    return { title, sections };
  }

  // ---------------- EPUB parsing ----------------
  async function parseEpub(file){
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("Not a valid EPUB (missing container.xml).");
    const containerXml = await containerFile.async("text");
    const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
    const rootfileEl = containerDoc.querySelector("rootfile");
    if (!rootfileEl) throw new Error("Not a valid EPUB (missing rootfile).");
    const opfPath = rootfileEl.getAttribute("full-path");
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

    const opfFile = zip.file(opfPath);
    const opfXml = await opfFile.async("text");
    const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

    const manifest = {};
    opfDoc.querySelectorAll("manifest > item").forEach(item => {
      manifest[item.getAttribute("id")] = item.getAttribute("href");
    });
    const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref")).map(el => el.getAttribute("idref"));
    let title = "";
    const titleEl = opfDoc.querySelector("metadata > *[*|title], metadata > title");
    if (titleEl) title = titleEl.textContent.trim();
    if (!title) title = file.name.replace(/\.epub$/i, "");

    function resolvePath(href){
      if (!opfDir) return decodeURIComponent(href);
      const parts = (opfDir + "/" + href).split("/");
      const stack = [];
      for (const p of parts){
        if (p === "." || p === "") continue;
        if (p === "..") stack.pop(); else stack.push(p);
      }
      return decodeURIComponent(stack.join("/"));
    }

    const sections = [];
    let idx = 0;
    for (const id of spineIds){
      const href = manifest[id];
      if (!href) continue;
      const path = resolvePath(href);
      const zf = zip.file(path);
      if (!zf) continue;
      idx++;
      const lt = loadingState.querySelector('.loadingText');
      if (lt) lt.textContent = "Reading chapter " + idx + " of " + spineIds.length + "…";
      const html = await zf.async("text");
      const parsed = htmlToChapter(html, idx);
      if (parsed.text.trim().length === 0) continue;
      sections.push(parsed);
    }
    if (sections.length === 0) throw new Error("No readable text found in this EPUB.");
    return { title, sections };
  }

  function htmlToChapter(html, fallbackIndex){
    // Insert paragraph breaks before parsing so textContent extraction keeps structure
    let processed = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|blockquote|h1|h2|h3|h4|h5|h6|tr)\s*>/gi, "$&\n\n");
    let doc;
    try{
      doc = new DOMParser().parseFromString(processed, "application/xhtml+xml");
      if (doc.querySelector("parsererror")) throw new Error("xml parse failed");
    }catch(e){
      doc = new DOMParser().parseFromString(processed, "text/html");
    }
    const body = doc.body || doc.documentElement;
    body.querySelectorAll("script, style").forEach(n => n.remove());

    let label = "Chapter " + fallbackIndex;
    const h = body.querySelector("h1, h2, h3");
    if (h && h.textContent.trim()) label = h.textContent.trim().slice(0, 60);

    let text = body.textContent || "";
    text = text.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { label, text };
  }

  function openIndexModal(){
    renderIndexGrid();
    if (indexModal) indexModal.classList.remove("hidden");
    if (indexSearchInput) {
      indexSearchInput.value = "";
      indexSearchInput.focus();
    }
  }

  function closeIndexModal(){
    if (indexModal) indexModal.classList.add("hidden");
  }

  function renderIndexGrid(filterText = ""){
    if (!indexGrid) return;
    indexGrid.innerHTML = "";
    const term = filterText.toLowerCase().trim();
    let count = 0;
    state.sections.forEach((s, i) => {
      if (term && !s.label.toLowerCase().includes(term)) return;
      count++;
      const div = document.createElement("div");
      div.className = "indexCardItem" + (i === state.sectionIndex ? " active" : "");
      div.innerHTML = `<span>${escapeHtml(s.label)}</span><span style="font-size:12px;opacity:.7;">Section ${i + 1}</span>`;
      div.addEventListener("click", () => {
        const wasPlaying = state.isPlaying;
        stopSpeaking();
        loadSection(i);
        closeIndexModal();
        if (wasPlaying) togglePlay();
      });
      indexGrid.appendChild(div);
    });
    if (count === 0){
      indexGrid.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa3b8;font-size:13px;">No matching chapters found</div>';
    }
  }

  if (indexCloseBtn) indexCloseBtn.addEventListener("click", closeIndexModal);
  if (indexModal) indexModal.addEventListener("click", (e) => {
    if (e.target === indexModal) closeIndexModal();
  });
  if (indexSearchInput) indexSearchInput.addEventListener("input", (e) => {
    renderIndexGrid(e.target.value);
  });
  if (sectionLabel) sectionLabel.addEventListener("click", () => {
    if (state.sections.length > 0) openIndexModal();
  });

  function toggleToc(show){
    if (window.innerWidth <= 760 || state.sections.length === 0) {
      const isHidden = show === undefined ? !tocPanel.classList.contains("hidden") : !show;
      tocPanel.classList.toggle("hidden", isHidden);
      if (tocBackdrop) tocBackdrop.classList.toggle("hidden", isHidden);
    } else {
      openIndexModal();
    }
  }

  function buildToc(){
    tocList.innerHTML = "";
    state.sections.forEach((s, i) => {
      const div = document.createElement("div");
      div.className = "tocItem";
      div.textContent = s.label;
      div.dataset.idx = i;
      div.addEventListener("click", () => {
        const wasPlaying = state.isPlaying;
        stopSpeaking();
        loadSection(i);
        if (window.innerWidth <= 760) toggleToc(false);
        if (wasPlaying) togglePlay();
      });
      tocList.appendChild(div);
    });
  }
  function highlightTocActive(i){
    tocList.querySelectorAll(".tocItem").forEach(el => {
      el.classList.toggle("active", Number(el.dataset.idx) === i);
    });
    const active = tocList.querySelector(".tocItem.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }
  tocToggleBtn.addEventListener("click", () => toggleToc());
  if (tocBackdrop) tocBackdrop.addEventListener("click", () => toggleToc(false));

  // ---------------- Sentence tokenizing / rendering ----------------
  function splitSentences(paragraph){
    const matches = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    return matches ? matches.map(s => s.trim()).filter(Boolean) : [paragraph.trim()];
  }
  function getWordSpans(sentence){
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(sentence))){
      words.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return words;
  }

  function loadSection(i){
    if (i < 0 || i >= state.sections.length) return;
    state.sectionIndex = i;
    state.sentenceIndex = 0;
    state.lastWordEl = null;
    state.lastSentenceEl = null;
    state.playToken++;
    speechSynthesis.cancel();

    const section = state.sections[i];
    readerEl.innerHTML = "";
    state.sentenceList = [];

    const titleH = document.createElement("h1");
    titleH.className = "chapterTitle";
    titleH.textContent = section.label;
    readerEl.appendChild(titleH);

    const paragraphs = section.text.split(/\n{2,}/).map(p => p.replace(/\n/g, " ").trim()).filter(Boolean);
    paragraphs.forEach(paragraph => {
      const pEl = document.createElement("p");
      const sentences = splitSentences(paragraph);
      sentences.forEach((sentence, sIdx) => {
        const words = getWordSpans(sentence);
        if (words.length === 0) return;
        const sentSpan = document.createElement("span");
        sentSpan.className = "sentence";
        let cursor = 0;
        words.forEach((w, wIdx) => {
          if (w.start > cursor) sentSpan.appendChild(document.createTextNode(sentence.slice(cursor, w.start)));
          const wordSpan = document.createElement("span");
          wordSpan.className = "word";
          wordSpan.textContent = w.text;
          const entryIndex = state.sentenceList.length;
          wordSpan.addEventListener("click", () => seekTo(entryIndex));
          sentSpan.appendChild(wordSpan);
          w.el = wordSpan;
          cursor = w.end;
        });
        if (cursor < sentence.length) sentSpan.appendChild(document.createTextNode(sentence.slice(cursor)));
        pEl.appendChild(sentSpan);
        pEl.appendChild(document.createTextNode(" "));
        state.sentenceList.push({ text: sentence, words, el: sentSpan });
      });
      readerEl.appendChild(pEl);
    });

    sectionLabel.textContent = section.label + "  ·  " + (i + 1) + " / " + state.sections.length;
    ribbonFill.style.width = (((i + 1) / state.sections.length) * 100).toFixed(1) + "%";
    highlightTocActive(i);
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === state.sections.length - 1;
    readerWrap.scrollTop = 0;

    // If in PDF view mode, render the original page
    if (state.viewMode === 'pdf' && state.isPdf && state.pdfDoc) {
      renderPdfPage(i + 1); // pdf.js pages are 1-indexed
    }
  }

  function seekTo(sentenceIndex){
    const wasPlaying = state.isPlaying;
    state.playToken++;
    speechSynthesis.cancel();
    clearHighlight();
    state.sentenceIndex = sentenceIndex;
    if (wasPlaying) {
      state.isPlaying = true;
      speakFrom(sentenceIndex);
    } else {
      const entry = state.sentenceList[sentenceIndex];
      if (entry){
        entry.el.classList.add("active");
        state.lastSentenceEl = entry.el;
        entry.el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }

  // ---------------- Speech engine ----------------
  let voices = [];
  function loadVoices(){
    voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;
    const current = voiceSelect.value;
    voiceSelect.innerHTML = "";
    voices.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = v.name + " (" + v.lang + ")";
      voiceSelect.appendChild(opt);
    });
    let preferred = voices.findIndex(v => v.lang && v.lang.startsWith("en") && /default|natural/i.test(v.name));
    if (preferred === -1) preferred = voices.findIndex(v => v.lang && v.lang.startsWith("en"));
    if (preferred === -1) preferred = 0;
    if (current && voices[current]) voiceSelect.value = current;
    else voiceSelect.value = preferred;
    // Sync mobile voice selector
    syncMobileVoices();
  }
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  function clearHighlight(){
    if (state.lastWordEl) state.lastWordEl.classList.remove("current");
    if (state.lastSentenceEl) state.lastSentenceEl.classList.remove("active");
    state.lastWordEl = null;
    state.lastSentenceEl = null;
  }

  // Detect mobile once at startup
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // ---------- Mobile-first speech engine ----------
  // Strategy: speak ONE sentence at a time, chain via onend.
  // This is the ONLY approach that works reliably on both
  // Android Chrome and iOS Safari mobile browsers.

  function isAutoAdvanceEnabled() {
    const mobileCheckbox = document.getElementById('autoAdvanceMobile');
    const desktopCheckbox = autoAdvance;
    // On mobile the desktop checkbox is hidden, so check both
    if (mobileCheckbox && mobileCheckbox.offsetParent !== null) return mobileCheckbox.checked;
    return desktopCheckbox.checked;
  }

  function speakSentence(idx, myToken) {
    if (myToken !== state.playToken) return;
    if (idx >= state.sentenceList.length) {
      // Section finished — auto-advance to next page/chapter
      if (isAutoAdvanceEnabled() && state.sectionIndex < state.sections.length - 1) {
        loadSection(state.sectionIndex + 1);
        // loadSection increments playToken, so we must use the NEW token
        const newToken = state.playToken;
        if (isMobile) {
          setTimeout(() => speakSentence(0, newToken), 150);
        } else {
          speakSentence(0, newToken);
        }
      } else {
        stopSpeaking();
      }
      return;
    }

    state.sentenceIndex = idx;
    const entry = state.sentenceList[idx];

    // Highlight sentence container
    if (state.lastSentenceEl !== entry.el) {
      if (state.lastSentenceEl) state.lastSentenceEl.classList.remove("active");
      if (state.lastWordEl) state.lastWordEl.classList.remove("current");
      state.lastWordEl = null;
      entry.el.classList.add("active");
      state.lastSentenceEl = entry.el;
      entry.el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    const utter = new SpeechSynthesisUtterance(entry.text);
    state.currentUtterance = utter; // prevent GC on mobile

    const vIdx = voiceSelect.value;
    if (vIdx !== "" && voices[vIdx]) utter.voice = voices[vIdx];
    utter.rate = parseFloat(rateSlider.value) || 1.0;

    // Word-level highlighting via onboundary
    utter.onboundary = (e) => {
      if (myToken !== state.playToken) return;
      if (e.name && e.name !== "word") return;
      const ci = e.charIndex;
      let target = null;
      for (const w of entry.words) {
        if (ci >= w.start && ci < w.end) { target = w; break; }
      }
      if (!target) {
        for (const w of entry.words) { if (w.start >= ci) { target = w; break; } }
      }
      if (target && target.el && state.lastWordEl !== target.el) {
        if (state.lastWordEl) state.lastWordEl.classList.remove("current");
        target.el.classList.add("current");
        state.lastWordEl = target.el;
      }
    };

    utter.onend = () => {
      if (myToken !== state.playToken) return;
      // Chain to next sentence — this works from onend on both Android & iOS
      speakSentence(idx + 1, myToken);
    };

    utter.onerror = (e) => {
      // On Android, 'interrupted' errors fire when we cancel — ignore those
      if (e && e.error === "interrupted") return;
      if (myToken !== state.playToken) return;
      console.warn("TTS error on sentence", idx, e && e.error);
      // Try to continue to next sentence on non-fatal errors
      speakSentence(idx + 1, myToken);
    };

    speechSynthesis.speak(utter);
  }

  function speakFrom(sentenceIndex) {
    // Cancel any in-progress speech first
    speechSynthesis.cancel();
    state.currentUtterance = null;

    if (sentenceIndex < 0 || sentenceIndex >= state.sentenceList.length) return;
    if (voices.length === 0) loadVoices();

    // Use the CURRENT playToken — do NOT increment here.
    // togglePlay() already set the token before calling us.
    const myToken = state.playToken;

    // On Android, cancel() needs a moment to fully release the TTS engine.
    // Without this delay, the next speak() call gets silently swallowed.
    if (isMobile) {
      setTimeout(() => speakSentence(sentenceIndex, myToken), 100);
    } else {
      speakSentence(sentenceIndex, myToken);
    }
  }

  function togglePlay(){
    if (state.sentenceList.length === 0) return;
    if (state.isPlaying){
      stopSpeaking(true);
    } else {
      state.isPlaying = true;
      state.playToken++;  // Only ONE increment per play session
      playIcon.style.display = "none";
      pauseIcon.style.display = "block";
      startKeepAlive();
      speakFrom(state.sentenceIndex);
    }
  }
  function stopSpeaking(keepPosition){
    state.isPlaying = false;
    state.playToken++;
    state.currentUtterance = null;
    speechSynthesis.cancel();
    stopKeepAlive();
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
    if (!keepPosition){
      clearHighlight();
      state.sentenceIndex = 0;
    }
  }
  function startKeepAlive(){
    stopKeepAlive();
    // DISABLE keep-alive on ALL mobile browsers.
    // pause()/resume() kills TTS on Android Chrome AND iOS Safari.
    if (isMobile) return;

    // Desktop Chrome bug workaround: speechSynthesis silently halts after ~15s
    state.keepAliveTimer = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused){
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 5000);
  }
  function stopKeepAlive(){
    if (state.keepAliveTimer) clearInterval(state.keepAliveTimer);
    state.keepAliveTimer = null;
  }

  playBtn.addEventListener("click", togglePlay);
  stopBtn.addEventListener("click", () => stopSpeaking(false));
  prevBtn.addEventListener("click", () => {
    const wasPlaying = state.isPlaying;
    stopSpeaking();
    loadSection(state.sectionIndex - 1);
    if (wasPlaying) togglePlay();
  });
  nextBtn.addEventListener("click", () => {
    const wasPlaying = state.isPlaying;
    stopSpeaking();
    loadSection(state.sectionIndex + 1);
    if (wasPlaying) togglePlay();
  });

  voiceSelect.addEventListener("change", () => {
    if (state.isPlaying) { state.playToken++; speakFrom(state.sentenceIndex); }
  });
  rateSlider.addEventListener("change", () => {
    if (state.isPlaying) { state.playToken++; speakFrom(state.sentenceIndex); }
  });
  rateSlider.addEventListener("input", () => {
    rateLabel.textContent = parseFloat(rateSlider.value).toFixed(1) + "×";
  });

  function adjustSpeed(delta){
    let cur = parseFloat(rateSlider.value) || 1.0;
    let next = Math.round((cur + delta) * 10) / 10;
    next = Math.max(0.5, Math.min(3.0, next));
    rateSlider.value = next;
    rateLabel.textContent = next.toFixed(1) + "×";
  }
  if (speedMinus) speedMinus.addEventListener("click", () => adjustSpeed(-0.1));
  if (speedPlus) speedPlus.addEventListener("click", () => adjustSpeed(0.1));

  fontPlus.addEventListener("click", () => adjustFont(1));
  fontMinus.addEventListener("click", () => adjustFont(-1));
  function adjustFont(dir){
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size"));
    const next = Math.max(14, Math.min(32, cur + dir * 2));
    document.documentElement.style.setProperty("--reader-font-size", next + "px");
  }

  function setDarkMode(isDark){
    if (isDark){
      document.body.classList.add("dark-theme");
      darkModeBtn.innerHTML = "☀️";
      if (readerWrap.classList.contains("theme-paper")) {
        setReaderTheme("night");
      }
      localStorage.setItem("readalong_darkmode", "true");
    } else {
      document.body.classList.remove("dark-theme");
      darkModeBtn.innerHTML = "🌙";
      if (readerWrap.classList.contains("theme-night")) {
        setReaderTheme("paper");
      }
      localStorage.setItem("readalong_darkmode", "false");
    }
  }

  function setReaderTheme(themeName){
    document.querySelectorAll(".swatch").forEach(s => {
      s.classList.toggle("active", s.dataset.theme === themeName);
    });
    readerWrap.className = "theme-" + themeName;
  }

  if (darkModeBtn) {
    darkModeBtn.addEventListener("click", () => {
      const isDark = !document.body.classList.contains("dark-theme");
      setDarkMode(isDark);
    });
    const savedDark = localStorage.getItem("readalong_darkmode");
    if (savedDark === "true" || (savedDark === null && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)){
      setDarkMode(true);
    }
  }

  document.querySelectorAll(".swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      setReaderTheme(sw.dataset.theme);
    });
  });

  // ---------- PDF original-page rendering ----------
  async function renderPdfPage(pageNum) {
    if (!state.pdfDoc || pageNum < 1 || pageNum > state.pdfDoc.numPages) return;
    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const scale = window.devicePixelRatio >= 2 ? 2 : 1.5;
      const viewport = page.getViewport({ scale });

      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;

      const ctx = pdfCanvas.getContext('2d');
      ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) {
      console.warn('PDF page render error:', err);
    }
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    if (mode === 'pdf') {
      readerEl.style.display = 'none';
      pdfViewer.style.display = 'flex';
      viewToggleBtn.innerHTML = '📝 Text View';
      viewToggleBtn.classList.add('active');
      // Render current page
      if (state.pdfDoc) {
        renderPdfPage(state.sectionIndex + 1);
      }
    } else {
      readerEl.style.display = 'block';
      pdfViewer.style.display = 'none';
      viewToggleBtn.innerHTML = '📄 PDF View';
      viewToggleBtn.classList.remove('active');
    }
    readerWrap.scrollTop = 0;
  }

  if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
      setViewMode(state.viewMode === 'text' ? 'pdf' : 'text');
    });
  }

  // keyboard shortcut: space to play/pause when not typing in a field
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "SELECT"){
      if (state.sentenceList.length){
        e.preventDefault();
        togglePlay();
      }
    }
  });

  window.addEventListener("beforeunload", () => speechSynthesis.cancel());

  // ---------- Mobile settings drawer ----------
  const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
  const mobileSettingsDrawer = document.getElementById('mobileSettingsDrawer');
  const voiceSelectMobile = document.getElementById('voiceSelectMobile');
  const fontPlusMobile = document.getElementById('fontPlusMobile');
  const fontMinusMobile = document.getElementById('fontMinusMobile');
  const autoAdvanceMobile = document.getElementById('autoAdvanceMobile');

  if (mobileSettingsBtn && mobileSettingsDrawer) {
    mobileSettingsBtn.addEventListener('click', () => {
      const isHidden = mobileSettingsDrawer.classList.contains('hidden');
      mobileSettingsDrawer.classList.toggle('hidden', !isHidden);
      mobileSettingsBtn.classList.toggle('active', isHidden);
    });
  }

  // Populate mobile voice select (mirrors desktop)
  function syncMobileVoices() {
    if (!voiceSelectMobile) return;
    voiceSelectMobile.innerHTML = voiceSelect.innerHTML;
    voiceSelectMobile.value = voiceSelect.value;
  }
  // Sync once in case voices already loaded
  syncMobileVoices();

  // Keep both voice selects in sync
  if (voiceSelectMobile) {
    voiceSelectMobile.addEventListener('change', () => {
      voiceSelect.value = voiceSelectMobile.value;
      voiceSelect.dispatchEvent(new Event('change'));
    });
  }
  voiceSelect.addEventListener('change', () => {
    if (voiceSelectMobile) voiceSelectMobile.value = voiceSelect.value;
  });

  // Keep both auto-advance checkboxes in sync
  if (autoAdvanceMobile) {
    autoAdvanceMobile.addEventListener('change', () => {
      autoAdvance.checked = autoAdvanceMobile.checked;
    });
    autoAdvance.addEventListener('change', () => {
      autoAdvanceMobile.checked = autoAdvance.checked;
    });
  }

  // Mobile font size controls
  if (fontPlusMobile) fontPlusMobile.addEventListener('click', () => adjustFont(1));
  if (fontMinusMobile) fontMinusMobile.addEventListener('click', () => adjustFont(-1));

  // Close drawer when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (!mobileSettingsDrawer || mobileSettingsDrawer.classList.contains('hidden')) return;
    if (mobileSettingsDrawer.contains(e.target)) return;
    if (mobileSettingsBtn && mobileSettingsBtn.contains(e.target)) return;
    mobileSettingsDrawer.classList.add('hidden');
    if (mobileSettingsBtn) mobileSettingsBtn.classList.remove('active');
  });

  // ---------- Mobile view toggle ----------
  const viewToggleMobile = document.getElementById('viewToggleMobile');
  const mobileViewToggleRow = document.getElementById('mobileViewToggleRow');

  if (viewToggleMobile) {
    viewToggleMobile.addEventListener('click', () => {
      setViewMode(state.viewMode === 'text' ? 'pdf' : 'text');
      // Update mobile button text
      viewToggleMobile.textContent = state.viewMode === 'pdf' ? '📝 Text View' : '📄 PDF View';
    });
  }

  // Watch for viewToggleBtn display changes to sync mobile row visibility
  const viewObserver = new MutationObserver(() => {
    if (mobileViewToggleRow) {
      mobileViewToggleRow.style.display = viewToggleBtn.style.display === 'none' ? 'none' : 'flex';
    }
    if (viewToggleMobile) {
      viewToggleMobile.textContent = state.viewMode === 'pdf' ? '📝 Text View' : '📄 PDF View';
    }
  });
  if (viewToggleBtn) {
    viewObserver.observe(viewToggleBtn, { attributes: true, attributeFilter: ['style'] });
  }
})();
