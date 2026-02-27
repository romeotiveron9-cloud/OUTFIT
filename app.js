/* =========================================================
   Outfit Vault — app.js (Full upgrade)
   ✅ Tags + Notes
   ✅ Wear tracking (lastWornAt + wearCount)
   ✅ Export/Import JSON (incl immagini)
   ✅ Toast + Undo delete
   ✅ Crop semplice (quadrato centrato) prima di salvare
   ✅ Micro-animazioni (modali, toast)
   ✅ Multi-select (long press + pulsante) + bulk actions
   ========================================================= */

/* -----------------------------
   0) Keys + DB
----------------------------- */
const SETTINGS_KEY = "outfit_vault_settings_v1";

const DB_NAME = "OutfitVaultDB";
const DB_VERSION = 2;
const STORE = "outfits";

/* -----------------------------
   1) Settings + theme
----------------------------- */
const settingsDefault = { theme: "system" };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...settingsDefault, ...JSON.parse(raw) } : { ...settingsDefault };
  } catch {
    return { ...settingsDefault };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function setThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}
function syncThemeColorWithSystem() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setThemeColor(prefersDark ? "#0b1020" : "#f7f3ff");
}
function setTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    syncThemeColorWithSystem();
    return;
  }
  root.setAttribute("data-theme", theme);
  setThemeColor(theme === "dark" ? "#0b1020" : "#f7f3ff");
}

/* -----------------------------
   2) IndexedDB
   outfit:
   { id, name, rating, favorite, createdAt, imageBlob,
     tags:[], notes:"", wearCount, lastWornAt }
----------------------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("rating", "rating", { unique: false });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("favorite", "favorite", { unique: false });
        store.createIndex("wearCount", "wearCount", { unique: false });
        store.createIndex("lastWornAt", "lastWornAt", { unique: false });
      } else {
        const store = req.transaction.objectStore(STORE);
        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt", { unique: false });
        if (!store.indexNames.contains("rating")) store.createIndex("rating", "rating", { unique: false });
        if (!store.indexNames.contains("name")) store.createIndex("name", "name", { unique: false });
        if (!store.indexNames.contains("favorite")) store.createIndex("favorite", "favorite", { unique: false });
        if (!store.indexNames.contains("wearCount")) store.createIndex("wearCount", "wearCount", { unique: false });
        if (!store.indexNames.contains("lastWornAt")) store.createIndex("lastWornAt", "lastWornAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function dbAddOutfit(outfit) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.add(outfit));
}
async function dbPutOutfit(outfit) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.put(outfit));
}
async function dbDeleteOutfit(id) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.delete(id));
}
async function dbGetAllOutfits() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbGetOutfit(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* -----------------------------
   3) Helpers
----------------------------- */
function uid() {
  return `o_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function clampRating(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(5, Math.max(0, Math.round(x)));
}
function safeName(name) {
  const s = (name || "").trim();
  return s ? s : "Outfit senza nome";
}
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function formatDateOrDash(ts) {
  if (!ts) return "—";
  return formatDate(ts);
}
function debounce(fn, wait = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function parseTags(raw) {
  const s = (raw || "")
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(s)).slice(0, 20);
}

function tagsToText(tags) {
  return (tags || []).join(", ");
}

/* File/Blob helpers for export/import */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  // data:[mime];base64,xxxx
  const res = await fetch(dataUrl);
  return await res.blob();
}

/* FIX immagini: converti in JPEG sicuro */
async function fileToSafeJpegBlob(file, maxSide = 1600, quality = 0.9) {
  let bitmap = null;

  if ("createImageBitmap" in window) {
    try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }
  }

  if (!bitmap) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  const w = bitmap.width, h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, cw, ch);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return blob || file;
}

/* Crop quadrato centrato (semplice) */
async function cropCenterSquareToJpeg(blobOrFile, maxSide = 1200, quality = 0.9) {
  // decodifica
  let bitmap = null;
  if ("createImageBitmap" in window) {
    try { bitmap = await createImageBitmap(blobOrFile); } catch { bitmap = null; }
  }
  if (!bitmap) return fileToSafeJpegBlob(blobOrFile, maxSide, quality);

  const w = bitmap.width;
  const h = bitmap.height;
  const side = Math.min(w, h);

  const sx = Math.floor((w - side) / 2);
  const sy = Math.floor((h - side) / 2);

  // output
  const outSide = Math.min(maxSide, side);
  const canvas = document.createElement("canvas");
  canvas.width = outSide;
  canvas.height = outSide;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, outSide, outSide);

  const outBlob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return outBlob || blobOrFile;
}

/* -----------------------------
   4) UI Elements
----------------------------- */
const el = {
  grid: document.getElementById("grid"),
  emptyState: document.getElementById("emptyState"),

  addBtn: document.getElementById("addBtn"),
  emptyAddBtn: document.getElementById("emptyAddBtn"),
  fileInput: document.getElementById("fileInput"),

  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  savedCount: document.getElementById("savedCount"),

  // filters
  filterAll: document.getElementById("filterAll"),
  filterFav: document.getElementById("filterFav"),
  filter4plus: document.getElementById("filter4plus"),
  filterStale: document.getElementById("filterStale"),
  filterClearTag: document.getElementById("filterClearTag"),
  tagChips: document.getElementById("tagChips"),

  // select mode
  selectModeBtn: document.getElementById("selectModeBtn"),
  bulkBar: document.getElementById("bulkBar"),
  bulkCount: document.getElementById("bulkCount"),
  bulkFav: document.getElementById("bulkFav"),
  bulkExport: document.getElementById("bulkExport"),
  bulkDelete: document.getElementById("bulkDelete"),
  bulkDone: document.getElementById("bulkDone"),

  // toast
  toast: document.getElementById("toast"),
  toastMsg: document.getElementById("toastMsg"),
  toastAction: document.getElementById("toastAction"),

  // Create modal
  createBackdrop: document.getElementById("createBackdrop"),
  createModal: document.getElementById("createModal"),
  closeCreate: document.getElementById("closeCreate"),
  createPreview: document.getElementById("createPreview"),
  createName: document.getElementById("createName"),
  createStars: document.getElementById("createStars"),
  createFav: document.getElementById("createFav"),
  createTags: document.getElementById("createTags"),
  createTagPreview: document.getElementById("createTagPreview"),
  createNotes: document.getElementById("createNotes"),
  createCropSquare: document.getElementById("createCropSquare"),
  createCancel: document.getElementById("createCancel"),
  createSave: document.getElementById("createSave"),

  // Detail modal
  detailBackdrop: document.getElementById("detailBackdrop"),
  detailModal: document.getElementById("detailModal"),
  closeDetail: document.getElementById("closeDetail"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  detailImg: document.getElementById("detailImg"),
  detailName: document.getElementById("detailName"),
  detailStars: document.getElementById("detailStars"),
  detailFav: document.getElementById("detailFav"),
  detailTags: document.getElementById("detailTags"),
  detailTagPreview: document.getElementById("detailTagPreview"),
  detailNotes: document.getElementById("detailNotes"),
  wearCount: document.getElementById("wearCount"),
  lastWorn: document.getElementById("lastWorn"),
  wearTodayBtn: document.getElementById("wearTodayBtn"),

  shareBtn: document.getElementById("shareBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  saveDetailBtn: document.getElementById("saveDetailBtn"),

  // Settings modal
  openSettings: document.getElementById("openSettings"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettings: document.getElementById("closeSettings"),
  themeSelect: document.getElementById("themeSelect"),
  saveSettings: document.getElementById("saveSettings"),

  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),

  // Install
  installBtn: document.getElementById("installBtn"),
  installBtnText: document.getElementById("installBtnText")
};

/* -----------------------------
   5) State
----------------------------- */
const state = {
  outfits: [],
  filtered: [],
  search: "",
  sort: "date_desc",
  settings: loadSettings(),

  // filters
  filter: {
    fav: false,
    minRating: 0,
    staleDays: 0,
    tag: ""
  },

  // detail
  selectedId: null,
  selectedURL: null,

  // selection mode
  selectMode: false,
  selectedSet: new Set(),

  // undo delete
  lastDeleted: null,
  undoTimer: null
};

/* Thumb URL cache */
const urlCache = new Map(); // id -> objectURL
function getThumbURL(outfit) {
  if (!outfit?.id || !outfit?.imageBlob) return "";
  if (urlCache.has(outfit.id)) return urlCache.get(outfit.id);
  const url = URL.createObjectURL(outfit.imageBlob);
  urlCache.set(outfit.id, url);
  return url;
}
function revokeThumbURL(id) {
  const url = urlCache.get(id);
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch {}
  urlCache.delete(id);
}
function keepOnlyThumbs(idsSet) {
  for (const [id, url] of urlCache.entries()) {
    if (idsSet.has(id)) continue;
    try { URL.revokeObjectURL(url); } catch {}
    urlCache.delete(id);
  }
}

/* Create state */
const createState = {
  file: null,
  previewURL: null
};

/* -----------------------------
   6) Toast
----------------------------- */
function hideToast() {
  if (!el.toast) return;
  el.toast.classList.remove("show");
  setTimeout(() => { el.toast.hidden = true; }, 170);
}
function showToast(message, actionText = "", onAction = null, ttlMs = 3500) {
  if (!el.toast || !el.toastMsg || !el.toastAction) return;

  el.toastMsg.textContent = message;

  el.toastAction.hidden = true;
  el.toastAction.onclick = null;

  if (actionText && typeof onAction === "function") {
    el.toastAction.hidden = false;
    el.toastAction.textContent = actionText;
    el.toastAction.onclick = () => {
      try { onAction(); } finally { hideToast(); }
    };
  }

  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add("show"));

  if (ttlMs > 0) {
    setTimeout(() => {
      // non chiudere se è stato rimpiazzato? qui ok semplice
      hideToast();
    }, ttlMs);
  }
}

/* -----------------------------
   7) Modal helpers (with animation classes)
----------------------------- */
function showModal(backdropEl, modalEl) {
  backdropEl.hidden = false;
  modalEl.hidden = false;
  requestAnimationFrame(() => {
    backdropEl.classList.add("show");
    modalEl.classList.add("show");
  });
}
function hideModal(backdropEl, modalEl) {
  backdropEl.classList.remove("show");
  modalEl.classList.remove("show");
  setTimeout(() => {
    backdropEl.hidden = true;
    modalEl.hidden = true;
  }, 170);
}

/* -----------------------------
   8) Stars renderer
----------------------------- */
function renderStars(container, value, onChange) {
  if (!container) return;
  container.innerHTML = "";
  const current = clampRating(value);

  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "star-btn" + (i <= current ? " active" : "");
    b.textContent = i <= current ? "⭐" : "☆";
    b.setAttribute("aria-label", `Voto ${i}`);
    b.addEventListener("click", () => onChange(i));
    container.appendChild(b);
  }
}

/* -----------------------------
   9) Tag chips render (filters + preview)
----------------------------- */
function renderTagPreview(container, tags, clickable = false, onClick = null, activeTag = "") {
  if (!container) return;
  container.innerHTML = "";
  for (const t of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tagchip" + (activeTag === t ? " active" : "");
    chip.textContent = t;
    chip.disabled = !clickable;
    if (clickable && onClick) chip.addEventListener("click", () => onClick(t));
    container.appendChild(chip);
  }
}

function collectAllTags(outfits) {
  const set = new Set();
  for (const o of outfits) for (const t of (o.tags || [])) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 40);
}

/* -----------------------------
   10) Filters + sorting
----------------------------- */
function applyFiltersAndSort() {
  const q = state.search.trim().toLowerCase();
  let arr = [...state.outfits];

  // quick filters
  if (state.filter.fav) arr = arr.filter(o => !!o.favorite);
  if (state.filter.minRating > 0) arr = arr.filter(o => (o.rating || 0) >= state.filter.minRating);
  if (state.filter.staleDays > 0) {
    const limit = Date.now() - state.filter.staleDays * 24 * 60 * 60 * 1000;
    arr = arr.filter(o => {
      const lw = o.lastWornAt || 0;
      // se mai indossato -> consideralo "stale"
      return lw === 0 || lw < limit;
    });
  }
  if (state.filter.tag) arr = arr.filter(o => (o.tags || []).includes(state.filter.tag));

  // search
  if (q) {
    arr = arr.filter(o => (o.name || "").toLowerCase().includes(q) || (o.notes || "").toLowerCase().includes(q));
  }

  // sort
  const s = state.sort;

  if (s === "fav_only") arr = arr.filter(o => !!o.favorite);

  arr.sort((a, b) => {
    const af = a.favorite ? 1 : 0;
    const bf = b.favorite ? 1 : 0;

    if (s === "fav_first") {
      if (bf !== af) return bf - af;
      return (b.createdAt || 0) - (a.createdAt || 0);
    }

    if (s === "date_desc") return (b.createdAt || 0) - (a.createdAt || 0);
    if (s === "date_asc") return (a.createdAt || 0) - (b.createdAt || 0);
    if (s === "rating_desc") return (b.rating || 0) - (a.rating || 0);
    if (s === "rating_asc") return (a.rating || 0) - (b.rating || 0);
    if (s === "name_asc") return (a.name || "").localeCompare(b.name || "");
    if (s === "name_desc") return (b.name || "").localeCompare(a.name || "");
    if (s === "wear_desc") return (b.wearCount || 0) - (a.wearCount || 0);
    if (s === "wear_asc") return (a.wearCount || 0) - (b.wearCount || 0);
    if (s === "lastworn_asc") return (a.lastWornAt || 0) - (b.lastWornAt || 0);     // non usati da tanto (più vecchi)
    if (s === "lastworn_desc") return (b.lastWornAt || 0) - (a.lastWornAt || 0);    // usati di recente
    return 0;
  });

  state.filtered = arr;
}

function setFilterChipActive() {
  const setActive = (btn, on) => btn && btn.classList.toggle("chip-active", !!on);

  setActive(el.filterAll, !state.filter.fav && state.filter.minRating === 0 && state.filter.staleDays === 0 && !state.filter.tag);
  setActive(el.filterFav, state.filter.fav);
  setActive(el.filter4plus, state.filter.minRating === 4);
  setActive(el.filterStale, state.filter.staleDays === 30);

  if (el.filterClearTag) {
    el.filterClearTag.hidden = !state.filter.tag;
  }
}

/* -----------------------------
   11) Render grid (with select mode)
----------------------------- */
function renderGrid() {
  applyFiltersAndSort();

  const items = state.filtered;
  if (!el.grid) return;

  keepOnlyThumbs(new Set(items.map(o => o.id)));
  el.grid.innerHTML = "";

  if (!items.length) {
    if (el.emptyState) el.emptyState.hidden = false;
    return;
  }
  if (el.emptyState) el.emptyState.hidden = true;

  for (const outfit of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    if (state.selectMode) card.classList.add("selectable");
    if (state.selectedSet.has(outfit.id)) card.classList.add("selected");

    const sel = document.createElement("div");
    sel.className = "selbox";
    sel.textContent = state.selectedSet.has(outfit.id) ? "✓" : "";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = outfit.name || "Outfit";
    img.loading = "lazy";
    img.src = getThumbURL(outfit);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = safeName(outfit.name);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const date = document.createElement("span");
    date.textContent = formatDate(outfit.createdAt || Date.now());

    const badge = document.createElement("span");
    badge.className = "badge";
    const r = clampRating(outfit.rating);
    const fav = outfit.favorite ? " ❤️" : "";
    badge.textContent = (r ? `⭐ ${r}/5` : "⭐ —") + fav;

    meta.appendChild(date);
    meta.appendChild(badge);

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(sel);
    card.appendChild(img);
    card.appendChild(body);

    const toggleSelection = () => {
      if (state.selectedSet.has(outfit.id)) state.selectedSet.delete(outfit.id);
      else state.selectedSet.add(outfit.id);
      syncBulkUI();
      renderGrid(); // semplice (ok per dataset piccolo)
    };

    const open = () => openDetail(outfit.id);

    // click behavior
    card.addEventListener("click", () => {
      if (state.selectMode) toggleSelection();
      else open();
    });

    // keyboard
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (state.selectMode) toggleSelection();
        else open();
      }
    });

    // long press -> enter select mode
    let pressTimer = null;
    card.addEventListener("pointerdown", () => {
      if (state.selectMode) return;
      pressTimer = setTimeout(() => {
        enableSelectMode(true);
        state.selectedSet.add(outfit.id);
        syncBulkUI();
        renderGrid();
        showToast("Modalità selezione attiva", "", null, 1600);
      }, 420);
    });
    card.addEventListener("pointerup", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });
    card.addEventListener("pointercancel", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });

    el.grid.appendChild(card);
  }
}

/* -----------------------------
   12) Create flow (preview + data + save)
----------------------------- */
function openCreateModal() {
  showModal(el.createBackdrop, el.createModal);
}
function closeCreateModal() {
  hideModal(el.createBackdrop, el.createModal);

  if (createState.previewURL) {
    try { URL.revokeObjectURL(createState.previewURL); } catch {}
  }
  createState.previewURL = null;
  createState.file = null;

  if (el.fileInput) el.fileInput.value = "";
}

function startCreateFromFile(file) {
  if (!file) return;

  if (createState.previewURL) {
    try { URL.revokeObjectURL(createState.previewURL); } catch {}
  }

  createState.file = file;
  createState.previewURL = URL.createObjectURL(file);

  if (el.createPreview) el.createPreview.src = createState.previewURL;

  const baseName = file.name ? file.name.replace(/\.[^/.]+$/, "") : "";
  if (el.createName) el.createName.value = baseName;

  const setCreateRating = (n) => {
    renderStars(el.createStars, n, setCreateRating);
    el.createStars.dataset.value = String(n);
  };
  setCreateRating(0);

  el.createFav.checked = false;
  el.createTags.value = "";
  el.createNotes.value = "";
  el.createCropSquare.checked = true;
  renderTagPreview(el.createTagPreview, []);

  openCreateModal();
  try { el.createName.focus(); } catch {}
}

async function confirmCreateSave() {
  if (!createState.file) return;

  el.createSave.disabled = true;

  try {
    const name = safeName(el.createName.value);
    const rating = clampRating(el.createStars.dataset.value || 0);
    const favorite = !!el.createFav.checked;
    const tags = parseTags(el.createTags.value);
    const notes = (el.createNotes.value || "").trim();

    // Convert + optionally crop (only now)
    const safeBlob = await fileToSafeJpegBlob(createState.file, 1600, 0.9);
    const finalBlob = el.createCropSquare.checked
      ? await cropCenterSquareToJpeg(safeBlob, 1200, 0.9)
      : safeBlob;

    const outfit = {
      id: uid(),
      name,
      rating,
      favorite,
      createdAt: Date.now(),
      imageBlob: finalBlob,
      tags,
      notes,
      wearCount: 0,
      lastWornAt: 0
    };

    await dbAddOutfit(outfit);
    closeCreateModal();
    await refresh();

    showToast("Salvato ✅", "", null, 1800);
  } catch (e) {
    console.error(e);
    showToast("Errore nel salvataggio", "", null, 2500);
    alert("Errore nel salvataggio. Prova con una foto più piccola o libera spazio.");
  } finally {
    el.createSave.disabled = false;
  }
}

/* live tag preview in create */
function updateCreateTagPreview() {
  const tags = parseTags(el.createTags.value);
  renderTagPreview(el.createTagPreview, tags);
}

/* -----------------------------
   13) Detail modal (edit)
----------------------------- */
function openDetailModal() {
  showModal(el.detailBackdrop, el.detailModal);
}
function closeDetailModal() {
  hideModal(el.detailBackdrop, el.detailModal);

  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = null;
  state.selectedId = null;
}

async function openDetail(id) {
  const outfit = await dbGetOutfit(id);
  if (!outfit) return;

  state.selectedId = id;

  el.detailTitle.textContent = safeName(outfit.name);
  el.detailMeta.textContent = `Creato: ${formatDate(outfit.createdAt || Date.now())}`;

  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = URL.createObjectURL(outfit.imageBlob);
  el.detailImg.src = state.selectedURL;

  el.detailName.value = outfit.name || "";
  el.detailFav.checked = !!outfit.favorite;
  el.detailTags.value = tagsToText(outfit.tags || []);
  el.detailNotes.value = outfit.notes || "";

  renderTagPreview(el.detailTagPreview, outfit.tags || []);

  const setDetailRating = (n) => {
    renderStars(el.detailStars, n, setDetailRating);
    el.detailStars.dataset.value = String(n);
  };
  setDetailRating(clampRating(outfit.rating || 0));

  el.wearCount.textContent = String(outfit.wearCount || 0);
  el.lastWorn.textContent = formatDateOrDash(outfit.lastWornAt || 0);

  openDetailModal();
}

async function saveDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const updated = {
    ...outfit,
    name: safeName(el.detailName.value),
    rating: clampRating(el.detailStars.dataset.value || 0),
    favorite: !!el.detailFav.checked,
    tags: parseTags(el.detailTags.value),
    notes: (el.detailNotes.value || "").trim()
  };

  await dbPutOutfit(updated);
  el.detailTitle.textContent = updated.name;

  renderTagPreview(el.detailTagPreview, updated.tags || []);
  await refresh();

  showToast("Aggiornato ✅", "", null, 1600);
}

async function wearToday() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const updated = {
    ...outfit,
    wearCount: (outfit.wearCount || 0) + 1,
    lastWornAt: Date.now()
  };

  await dbPutOutfit(updated);
  el.wearCount.textContent = String(updated.wearCount);
  el.lastWorn.textContent = formatDate(updated.lastWornAt);

  await refresh();
  showToast("Segnato come indossato 👟", "", null, 1600);
}

/* Delete with Undo (no confirm) */
async function deleteDetailWithUndo() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  // cancel previous undo timer
  if (state.undoTimer) clearTimeout(state.undoTimer);
  state.lastDeleted = outfit;

  await dbDeleteOutfit(outfit.id);
  revokeThumbURL(outfit.id);

  closeDetailModal();
  await refresh();

  showToast("Eliminato", "Undo", async () => {
    if (!state.lastDeleted) return;
    // restore (id might collide if re-added quickly; in our case just put back)
    await dbPutOutfit(state.lastDeleted);
    state.lastDeleted = null;
    await refresh();
    showToast("Ripristinato ✅", "", null, 1500);
  }, 4500);

  state.undoTimer = setTimeout(() => {
    state.lastDeleted = null;
    state.undoTimer = null;
  }, 5000);
}

async function shareDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const name = safeName(outfit.name);
  const file = new File([outfit.imageBlob], `${name}.jpg`, { type: outfit.imageBlob.type || "image/jpeg" });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: name, text: `Guarda il mio outfit: ${name}`, files: [file] });
      return;
    } catch { return; }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "Outfit Vault", text: `Ho salvato un outfit: ${name}`, url: location.href });
      return;
    } catch {}
  }

  alert("Condivisione non supportata su questo dispositivo/browser.");
}

/* -----------------------------
   14) PWA install + SW
----------------------------- */
let deferredInstallEvent = null;

function setupPWAInstall() {
  if (!el.installBtn) return;
  el.installBtn.hidden = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    el.installBtn.hidden = false;
  });

  el.installBtn.addEventListener("click", async () => {
    if (!deferredInstallEvent) {
      alert("Installazione non disponibile ora. Riprova dal menu ⋮ di Chrome.");
      return;
    }
    deferredInstallEvent.prompt();
    try { await deferredInstallEvent.userChoice; } catch {}
    deferredInstallEvent = null;
    el.installBtn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallEvent = null;
    el.installBtn.hidden = true;
  });
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {});
  });
}

/* -----------------------------
   15) Settings modal + Backup
----------------------------- */
function openSettingsModal() { showModal(el.settingsBackdrop, el.settingsModal); }
function closeSettingsModal() { hideModal(el.settingsBackdrop, el.settingsModal); }

async function exportOutfits(outfits, filename = "outfit-vault-backup.json") {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    outfits: []
  };

  for (const o of outfits) {
    const imgData = await blobToDataURL(o.imageBlob);
    payload.outfits.push({
      ...o,
      imageDataUrl: imgData,
      imageBlob: undefined
    });
  }

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1500);
  showToast("Export creato ⬇️", "", null, 1800);
}

async function importOutfitsFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.outfits)) throw new Error("Formato backup non valido");

  // prevent id collisions
  const existing = new Set(state.outfits.map(o => o.id));

  for (const o of data.outfits) {
    if (!o || !o.imageDataUrl) continue;

    const blob = await dataURLToBlob(o.imageDataUrl);

    const id = (o.id && !existing.has(o.id)) ? o.id : uid();
    existing.add(id);

    const outfit = {
      id,
      name: safeName(o.name),
      rating: clampRating(o.rating || 0),
      favorite: !!o.favorite,
      createdAt: Number(o.createdAt || Date.now()),
      imageBlob: blob,
      tags: Array.isArray(o.tags) ? parseTags(o.tags.join(",")) : parseTags(o.tags || ""),
      notes: (o.notes || "").trim(),
      wearCount: Number(o.wearCount || 0),
      lastWornAt: Number(o.lastWornAt || 0)
    };

    await dbPutOutfit(outfit);
  }

  await refresh();
  showToast("Import completato ✅", "", null, 2200);
}

/* -----------------------------
   16) Multi-select mode + bulk actions
----------------------------- */
function enableSelectMode(on) {
  state.selectMode = !!on;
  if (!state.selectMode) state.selectedSet.clear();
  syncBulkUI();
  renderGrid();
}

function toggleSelectMode() {
  enableSelectMode(!state.selectMode);
  if (state.selectMode) showToast("Modalità selezione", "", null, 1300);
}

function syncBulkUI() {
  const count = state.selectedSet.size;
  if (el.bulkCount) el.bulkCount.textContent = String(count);

  if (!el.bulkBar) return;

  if (state.selectMode) el.bulkBar.hidden = false;
  else el.bulkBar.hidden = true;

  // change button label
  if (el.selectModeBtn) {
    el.selectModeBtn.textContent = state.selectMode ? "✓ Selezione attiva" : "✓ Seleziona";
    el.selectModeBtn.classList.toggle("chip-active", state.selectMode);
  }

  // disable actions when none selected
  const disabled = count === 0;
  if (el.bulkFav) el.bulkFav.disabled = disabled;
  if (el.bulkExport) el.bulkExport.disabled = disabled;
  if (el.bulkDelete) el.bulkDelete.disabled = disabled;
}

async function bulkToggleFavorite() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;

  // decide: if all fav -> remove fav else set fav
  const selectedOutfits = state.outfits.filter(o => ids.includes(o.id));
  const allFav = selectedOutfits.length > 0 && selectedOutfits.every(o => !!o.favorite);
  const targetFav = !allFav;

  for (const o of selectedOutfits) {
    await dbPutOutfit({ ...o, favorite: targetFav });
  }

  await refresh();
  showToast(targetFav ? "Preferiti ✅" : "Preferiti rimossi", "", null, 1600);
}

async function bulkDeleteWithUndo() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;

  // snapshot for undo
  const deleted = state.outfits.filter(o => ids.includes(o.id));
  if (!deleted.length) return;

  // delete now
  for (const o of deleted) {
    await dbDeleteOutfit(o.id);
    revokeThumbURL(o.id);
  }

  enableSelectMode(false);
  await refresh();

  showToast(`Eliminati ${deleted.length}`, "Undo", async () => {
    for (const o of deleted) await dbPutOutfit(o);
    await refresh();
    showToast("Ripristinati ✅", "", null, 1500);
  }, 5000);
}

async function bulkExportSelected() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;
  const selected = state.outfits.filter(o => ids.includes(o.id));
  await exportOutfits(selected, "outfit-vault-selezionati.json");
}

/* -----------------------------
   17) Filters UI
----------------------------- */
function setTagFilter(tag) {
  state.filter.tag = tag;
  setFilterChipActive();
  renderTagPreview(el.tagChips, collectAllTags(state.outfits), true, setTagFilter, state.filter.tag);
  renderGrid();
}
function clearTagFilter() {
  state.filter.tag = "";
  setFilterChipActive();
  renderTagPreview(el.tagChips, collectAllTags(state.outfits), true, setTagFilter, state.filter.tag);
  renderGrid();
}

function setQuickFilter({ fav, minRating, staleDays }) {
  state.filter.fav = !!fav;
  state.filter.minRating = Number(minRating || 0);
  state.filter.staleDays = Number(staleDays || 0);
  setFilterChipActive();
  renderGrid();
}

/* -----------------------------
   18) Refresh
----------------------------- */
async function refresh() {
  state.outfits = await dbGetAllOutfits();

  if (el.savedCount) el.savedCount.textContent = String(state.outfits.length);

  // render tags chips
  const tags = collectAllTags(state.outfits);
  renderTagPreview(el.tagChips, tags, true, setTagFilter, state.filter.tag);

  setFilterChipActive();
  syncBulkUI();
  renderGrid();
}

/* -----------------------------
   19) Init
----------------------------- */
(function init() {
  // Theme
  setTheme(state.settings.theme);
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq) {
    mq.addEventListener("change", () => {
      if (state.settings.theme === "system") syncThemeColorWithSystem();
    });
  }

  // Initial load
  refresh().catch(console.error);

  // Add
  el.addBtn.addEventListener("click", () => el.fileInput.click());
  if (el.emptyAddBtn) el.emptyAddBtn.addEventListener("click", () => el.fileInput.click());

  el.fileInput.addEventListener("change", (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    startCreateFromFile(file);
  });

  // Create modal events
  el.closeCreate.addEventListener("click", closeCreateModal);
  el.createBackdrop.addEventListener("click", closeCreateModal);
  el.createCancel.addEventListener("click", closeCreateModal);
  el.createSave.addEventListener("click", confirmCreateSave);
  el.createTags.addEventListener("input", updateCreateTagPreview);

  // create stars init (in case)
  renderStars(el.createStars, 0, (n) => {
    renderStars(el.createStars, n, arguments.callee);
    el.createStars.dataset.value = String(n);
  });
  el.createStars.dataset.value = "0";

  // Search
  const onSearch = debounce(() => {
    state.search = el.searchInput.value || "";
    renderGrid();
  }, 120);
  el.searchInput.addEventListener("input", onSearch);

  // Sort
  el.sortSelect.addEventListener("change", () => {
    state.sort = el.sortSelect.value;
    renderGrid();
  });

  // Quick filters
  el.filterAll.addEventListener("click", () => {
    state.filter = { fav:false, minRating:0, staleDays:0, tag:"" };
    setFilterChipActive();
    renderTagPreview(el.tagChips, collectAllTags(state.outfits), true, setTagFilter, state.filter.tag);
    renderGrid();
  });
  el.filterFav.addEventListener("click", () => setQuickFilter({ fav: !state.filter.fav, minRating: state.filter.minRating, staleDays: state.filter.staleDays }));
  el.filter4plus.addEventListener("click", () => setQuickFilter({ fav: state.filter.fav, minRating: state.filter.minRating === 4 ? 0 : 4, staleDays: state.filter.staleDays }));
  el.filterStale.addEventListener("click", () => setQuickFilter({ fav: state.filter.fav, minRating: state.filter.minRating, staleDays: state.filter.staleDays === 30 ? 0 : 30 }));
  el.filterClearTag.addEventListener("click", clearTagFilter);

  // Select mode
  el.selectModeBtn.addEventListener("click", toggleSelectMode);
  el.bulkDone.addEventListener("click", () => enableSelectMode(false));
  el.bulkFav.addEventListener("click", bulkToggleFavorite);
  el.bulkDelete.addEventListener("click", bulkDeleteWithUndo);
  el.bulkExport.addEventListener("click", bulkExportSelected);

  // Detail modal events
  el.closeDetail.addEventListener("click", closeDetailModal);
  el.detailBackdrop.addEventListener("click", closeDetailModal);
  el.saveDetailBtn.addEventListener("click", saveDetail);
  el.deleteBtn.addEventListener("click", deleteDetailWithUndo);
  el.shareBtn.addEventListener("click", shareDetail);
  el.wearTodayBtn.addEventListener("click", wearToday);

  // Detail tags preview live
  el.detailTags.addEventListener("input", () => {
    renderTagPreview(el.detailTagPreview, parseTags(el.detailTags.value));
  });

  // Settings modal
  el.openSettings.addEventListener("click", openSettingsModal);
  el.closeSettings.addEventListener("click", closeSettingsModal);
  el.settingsBackdrop.addEventListener("click", closeSettingsModal);

  el.themeSelect.value = state.settings.theme;
  el.saveSettings.addEventListener("click", () => {
    state.settings.theme = el.themeSelect.value;
    saveSettings(state.settings);
    setTheme(state.settings.theme);
    closeSettingsModal();
    showToast("Impostazioni salvate ✅", "", null, 1500);
  });

  // Backup buttons
  el.exportBtn.addEventListener("click", async () => {
    const outfits = await dbGetAllOutfits();
    await exportOutfits(outfits);
  });
  el.importBtn.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    try {
      await importOutfitsFromFile(file);
    } catch (err) {
      console.error(err);
      alert("Import fallito: file non valido.");
    } finally {
      el.importFile.value = "";
    }
  });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (!el.createModal.hidden) closeCreateModal();
    else if (!el.detailModal.hidden) closeDetailModal();
    else if (!el.settingsModal.hidden) closeSettingsModal();
    else if (state.selectMode) enableSelectMode(false);
  });

  // PWA
  setupServiceWorker();
  setupPWAInstall();
})();
