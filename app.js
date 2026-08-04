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
    utteranceQueue: []    // Store active utterances to prevent mobile GC & ensure continuous playback
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
    loadingState.style.display = "block";
    loadingState.textContent = "Opening your book…";
    try{
      let result;
      if (name.endsWith(".pdf")) {
        result = await parsePdf(file);
      } else if (name.endsWith(".epub")) {
        result = await parseEpub(file);
      } else {
        throw new Error("Please choose a .pdf or .epub file.");
      }
      state.sections = result.sections;
      state.bookTitle = result.title || file.name;
      bookMeta.innerHTML = "<b>" + escapeHtml(state.bookTitle) + "</b>";
      buildToc();
      loadingState.style.display = "none";
      readerEl.style.display = "block";
      controls.classList.remove("disabled");
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
      loadingState.textContent = "Reading page " + i + " of " + pdf.numPages + "…";
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
      loadingState.textContent = "Reading chapter " + idx + " of " + spineIds.length + "…";
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
  }
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  function clearHighlight(){
    if (state.lastWordEl) state.lastWordEl.classList.remove("current");
    if (state.lastSentenceEl) state.lastSentenceEl.classList.remove("active");
    state.lastWordEl = null;
    state.lastSentenceEl = null;
  }

  function speakFrom(sentenceIndex){
    state.playToken++;
    const myToken = state.playToken;
    state.sentenceIndex = sentenceIndex;
    if (voices.length === 0) loadVoices();

    speechSynthesis.cancel();
    state.currentUtterance = null;
    state.utteranceQueue = [];

    if (sentenceIndex < 0 || sentenceIndex >= state.sentenceList.length) return;

    // Build unified section text & offset map starting from sentenceIndex
    const remainingSentences = state.sentenceList.slice(sentenceIndex);
    let fullText = "";
    const offsets = [];

    remainingSentences.forEach((item, relIdx) => {
      if (relIdx > 0) fullText += " ";
      const start = fullText.length;
      fullText += item.text;
      const end = fullText.length;
      offsets.push({
        globalIndex: sentenceIndex + relIdx,
        entry: item,
        start,
        end
      });
    });

    if (!fullText.trim()) return;

    // Single Utterance for Mobile Android & iOS Web Speech API compatibility
    const utter = new SpeechSynthesisUtterance(fullText);
    state.currentUtterance = utter;

    const vIdx = voiceSelect.value;
    const selectedVoice = (vIdx !== "" && voices[vIdx]) ? voices[vIdx] : null;
    if (selectedVoice) utter.voice = selectedVoice;
    utter.rate = parseFloat(rateSlider.value) || 1.0;

    let boundaryFired = false;
    let iosTimer = null;

    utter.onboundary = (e) => {
      boundaryFired = true;
      if (iosTimer) { clearInterval(iosTimer); iosTimer = null; }
      if (myToken !== state.playToken) return;
      if (e.name && e.name !== "word") return;

      const ci = e.charIndex;
      const matchedOffset = offsets.find(o => ci >= o.start && ci <= o.end) || offsets[0];
      if (matchedOffset) {
        state.sentenceIndex = matchedOffset.globalIndex;
        const entry = matchedOffset.entry;

        // Highlight full sentence container if not already active
        if (state.lastSentenceEl !== entry.el) {
          if (state.lastSentenceEl) state.lastSentenceEl.classList.remove("active");
          entry.el.classList.add("active");
          state.lastSentenceEl = entry.el;
          entry.el.scrollIntoView({ block: "center", behavior: "smooth" });
        }

        // Highlight current word over sentence container
        const relIndex = ci - matchedOffset.start;
        let targetWord = null;
        for (const w of entry.words) {
          if (relIndex >= w.start && relIndex < w.end) { targetWord = w; break; }
        }
        if (!targetWord) {
          for (const w of entry.words) { if (w.start >= relIndex) { targetWord = w; break; } }
        }
        if (targetWord && targetWord.el && state.lastWordEl !== targetWord.el) {
          if (state.lastWordEl) state.lastWordEl.classList.remove("current");
          targetWord.el.classList.add("current");
          state.lastWordEl = targetWord.el;
        }
      }
    };

    // iOS Safari fallback timer if onboundary doesn't fire
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      let sOffsetIdx = 0;
      let wOffsetIdx = 0;
      const estCharMs = (60 / (180 * utter.rate)) * 1000;
      const stepMs = Math.max(120, (fullText.length * estCharMs) / (offsets.length * 5 || 1));
      iosTimer = setInterval(() => {
        if (boundaryFired || myToken !== state.playToken) {
          clearInterval(iosTimer);
          return;
        }
        const matchedOffset = offsets[sOffsetIdx];
        if (matchedOffset) {
          state.sentenceIndex = matchedOffset.globalIndex;
          const entry = matchedOffset.entry;
          if (state.lastSentenceEl !== entry.el) {
            if (state.lastSentenceEl) state.lastSentenceEl.classList.remove("active");
            entry.el.classList.add("active");
            state.lastSentenceEl = entry.el;
            entry.el.scrollIntoView({ block: "center", behavior: "smooth" });
            wOffsetIdx = 0;
          }
          if (wOffsetIdx < entry.words.length) {
            const targetWord = entry.words[wOffsetIdx++];
            if (targetWord && targetWord.el && state.lastWordEl !== targetWord.el) {
              if (state.lastWordEl) state.lastWordEl.classList.remove("current");
              targetWord.el.classList.add("current");
              state.lastWordEl = targetWord.el;
            }
          } else {
            sOffsetIdx++;
            wOffsetIdx = 0;
          }
        } else {
          clearInterval(iosTimer);
        }
      }, stepMs);
    }

    utter.onend = () => {
      if (iosTimer) clearInterval(iosTimer);
      if (myToken !== state.playToken) return;
      if (autoAdvance.checked && state.sectionIndex < state.sections.length - 1) {
        loadSection(state.sectionIndex + 1);
        if (myToken === state.playToken) speakFrom(0);
      } else {
        stopSpeaking();
      }
    };

    utter.onerror = (e) => {
      console.warn("Utterance error:", e);
      if (iosTimer) clearInterval(iosTimer);
      if (myToken !== state.playToken) return;
      stopSpeaking();
    };

    speechSynthesis.speak(utter);
  }

  function togglePlay(){
    if (state.sentenceList.length === 0) return;
    if (state.isPlaying){
      stopSpeaking(true);
    } else {
      state.isPlaying = true;
      state.playToken++;
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
    state.utteranceQueue = [];
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
    // Do NOT run pause/resume keep-alive on iOS because calling pause() on iOS Safari cancels TTS
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) return;

    // Chrome bug workaround: speechSynthesis silently halts long sessions
    state.keepAliveTimer = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused){
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 4000);
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
    if (state.isPlaying) speakFrom(state.sentenceIndex);
  });
  rateSlider.addEventListener("change", () => {
    if (state.isPlaying) speakFrom(state.sentenceIndex);
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
      darkModeBtn.innerHTML = "☀️ Light";
      if (readerWrap.classList.contains("theme-paper")) {
        setReaderTheme("night");
      }
      localStorage.setItem("readalong_darkmode", "true");
    } else {
      document.body.classList.remove("dark-theme");
      darkModeBtn.innerHTML = "🌙 Dark";
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
})();
