/* =========================================================
   Outfit Vault — app.js (refactor completo)
   Offline-first outfits storage with IndexedDB + PWA install
   - Preferiti
   - Contatore outfit salvati
   - Ricerca + ordina
   - Fix immagini (conversione JPEG sicura)
   - Pulizia ObjectURL per evitare leak
   ========================================================= */

/* -----------------------------
   0) Costanti
----------------------------- */

const SETTINGS_KEY = "outfit_vault_settings_v1";

const DB_NAME = "OutfitVaultDB";
const DB_VERSION = 2;
const STORE = "outfits";

/* -----------------------------
   1) Settings (LocalStorage + theme)
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
   Store: { id, name, rating, favorite, createdAt, imageBlob }
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
      } else {
        const store = req.transaction.objectStore(STORE);
        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt", { unique: false });
        if (!store.indexNames.contains("rating")) store.createIndex("rating", "rating", { unique: false });
        if (!store.indexNames.contains("name")) store.createIndex("name", "name", { unique: false });
        if (!store.indexNames.contains("favorite")) store.createIndex("favorite", "favorite", { unique: false });
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

function debounce(fn, wait = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Fix immagini non visualizzate:
 * Convertiamo sempre il file in JPEG standard (ridimensionato),
 * evitando problemi su Android con HEIC / mime vuoto / immagini enormi.
 */
async function fileToSafeJpegBlob(file, maxSide = 1600, quality = 0.9) {
  let bitmap = null;

  if ("createImageBitmap" in window) {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      bitmap = null;
    }
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

  const w = bitmap.width;
  const h = bitmap.height;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, cw, ch);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return blob || file;
}

/* -----------------------------
   4) State
----------------------------- */

const state = {
  outfits: [],
  filtered: [],
  search: "",
  sort: "date_desc",
  selectedId: null,
  selectedURL: null,
  settings: loadSettings()
};

/**
 * Cache ObjectURL per le thumbnail:
 * - non le revoco subito (alcuni Android rompono la preview)
 * - le revoco quando rifaccio render o quando elimino/chiudo
 */
const urlCache = new Map(); // id -> objectURL

function getThumbURL(outfit) {
  if (!outfit?.id || !outfit?.imageBlob) return "";
  const existing = urlCache.get(outfit.id);
  if (existing) return existing;

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

function resetThumbCacheKeeping(keepIds = new Set()) {
  for (const [id, url] of urlCache.entries()) {
    if (keepIds.has(id)) continue;
    try { URL.revokeObjectURL(url); } catch {}
    urlCache.delete(id);
  }
}

/* -----------------------------
   5) UI Elements
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
  filterLabel: document.getElementById("filterLabel"),

  // Detail modal
  detailBackdrop: document.getElementById("detailBackdrop"),
  detailModal: document.getElementById("detailModal"),
  closeDetail: document.getElementById("closeDetail"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  detailImg: document.getElementById("detailImg"),
  detailName: document.getElementById("detailName"),
  detailStars: document.getElementById("detailStars"),
  favoriteBtn: document.getElementById("favoriteBtn"),
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

  // Install
  installBtn: document.getElementById("installBtn"),
  installBtnText: document.getElementById("installBtnText")
};

/* -----------------------------
   6) Filters + sort
----------------------------- */

function applyFiltersAndSort() {
  const q = state.search.trim().toLowerCase();
  let arr = [...state.outfits];

  if (q) {
    arr = arr.filter((o) => (o.name || "").toLowerCase().includes(q));
  }

  const s = state.sort;

  if (s === "fav_only") {
    arr = arr.filter((o) => !!o.favorite);
  }

  arr.sort((a, b) => {
    const af = a.favorite ? 1 : 0;
    const bf = b.favorite ? 1 : 0;

    if (s === "fav_first") {
      if (bf !== af) return bf - af;
      return b.createdAt - a.createdAt;
    }

    if (s === "date_desc") return b.createdAt - a.createdAt;
    if (s === "date_asc") return a.createdAt - b.createdAt;
    if (s === "rating_desc") return (b.rating || 0) - (a.rating || 0);
    if (s === "rating_asc") return (a.rating || 0) - (b.rating || 0);
    if (s === "name_asc") return (a.name || "").localeCompare(b.name || "");
    if (s === "name_desc") return (b.name || "").localeCompare(a.name || "");
    return 0;
  });

  state.filtered = arr;

  if (el.filterLabel) {
    el.filterLabel.textContent = (state.sort === "fav_only") ? "Preferiti" : "Tutti";
  }
}

/* -----------------------------
   7) Rendering (Grid)
----------------------------- */

function renderGrid() {
  applyFiltersAndSort();

  const items = state.filtered;
  if (!el.grid) return;

  // Mantieni URLs solo per gli elementi effettivamente in lista per ridurre memoria
  const keepIds = new Set(items.map((o) => o.id));
  resetThumbCacheKeeping(keepIds);

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
    card.setAttribute("aria-label", `Apri ${safeName(outfit.name)}`);

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = outfit.name || "Outfit";
    img.loading = "lazy";

    img.src = getThumbURL(outfit);
    img.addEventListener("error", () => {
      console.warn("Immagine non caricata:", outfit.id, outfit.name, outfit.imageBlob);
    });

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = safeName(outfit.name);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const date = document.createElement("span");
    date.textContent = formatDate(outfit.createdAt);

    const badge = document.createElement("span");
    badge.className = "badge";
    const r = clampRating(outfit.rating);
    const fav = outfit.favorite ? " ❤️" : "";
    badge.textContent = (r ? `⭐ ${r}/5` : "⭐ —") + fav;

    meta.appendChild(date);
    meta.appendChild(badge);

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(img);
    card.appendChild(body);

    const open = () => openDetail(outfit.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    el.grid.appendChild(card);
  }
}

/* -----------------------------
   8) Detail modal (open/close)
----------------------------- */

function openDetailModal() {
  if (el.detailBackdrop) el.detailBackdrop.hidden = false;
  if (el.detailModal) el.detailModal.hidden = false;
}

function closeDetailModal() {
  if (el.detailBackdrop) el.detailBackdrop.hidden = true;
  if (el.detailModal) el.detailModal.hidden = true;

  // revoca preview detail (non le thumb)
  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = null;
  state.selectedId = null;
}

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

function setFavoriteBtn(isFav) {
  if (!el.favoriteBtn) return;
  el.favoriteBtn.textContent = isFav ? "♥ Preferito" : "♡ Preferito";
  el.favoriteBtn.classList.toggle("fav-active", !!isFav);
}

async function openDetail(id) {
  const outfit = await dbGetOutfit(id);
  if (!outfit) return;

  state.selectedId = id;

  if (el.detailTitle) el.detailTitle.textContent = safeName(outfit.name);
  if (el.detailMeta) el.detailMeta.textContent = `Creato: ${formatDate(outfit.createdAt)}`;

  // Preview detail (revoca la precedente)
  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = URL.createObjectURL(outfit.imageBlob);
  if (el.detailImg) el.detailImg.src = state.selectedURL;

  if (el.detailName) el.detailName.value = outfit.name || "";

  const handleStar = (newRating) => {
    renderStars(el.detailStars, newRating, handleStar);
    if (el.detailStars) el.detailStars.dataset.value = String(newRating);
  };

  renderStars(el.detailStars, outfit.rating || 0, handleStar);
  if (el.detailStars) el.detailStars.dataset.value = String(clampRating(outfit.rating || 0));

  setFavoriteBtn(!!outfit.favorite);

  openDetailModal();

  // piccolo comfort: focus sul nome
  if (el.detailName) {
    try { el.detailName.focus(); } catch {}
  }
}

async function saveDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const newName = safeName(el.detailName ? el.detailName.value : outfit.name);
  const newRating = clampRating(el.detailStars ? (el.detailStars.dataset.value || 0) : (outfit.rating || 0));

  const updated = { ...outfit, name: newName, rating: newRating };
  await dbPutOutfit(updated);

  // UI
  if (el.detailTitle) el.detailTitle.textContent = newName;

  await refresh();
}

async function toggleFavorite() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const updated = { ...outfit, favorite: !outfit.favorite };
  await dbPutOutfit(updated);

  setFavoriteBtn(updated.favorite);
  await refresh();
}

async function deleteDetail() {
  if (!state.selectedId) return;

  const ok = confirm("Vuoi eliminare questo outfit? (Non si può annullare)");
  if (!ok) return;

  const id = state.selectedId;

  await dbDeleteOutfit(id);
  revokeThumbURL(id);

  closeDetailModal();
  await refresh();
}

async function shareDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const name = safeName(outfit.name);
  const file = new File([outfit.imageBlob], `${name}.jpg`, { type: outfit.imageBlob.type || "image/jpeg" });

  // Web Share (files)
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: name,
        text: `Guarda il mio outfit: ${name}`,
        files: [file]
      });
      return;
    } catch {
      return;
    }
  }

  // Web Share (fallback link)
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Outfit Vault",
        text: `Ho salvato un outfit: ${name}`,
        url: location.href
      });
      return;
    } catch {}
  }

  alert("Condivisione non supportata su questo dispositivo/browser.");
}

/* -----------------------------
   9) Add outfit (from file)
----------------------------- */

async function addOutfitFromFile(file) {
  if (!file) return;

  const safeBlob = await fileToSafeJpegBlob(file, 1600, 0.9);

  const outfit = {
    id: uid(),
    name: file.name ? file.name.replace(/\.[^/.]+$/, "") : "Nuovo outfit",
    rating: 0,
    favorite: false,
    createdAt: Date.now(),
    imageBlob: safeBlob
  };

  try {
    await dbAddOutfit(outfit);
    await refresh();
  } catch (e) {
    alert("Spazio insufficiente o errore nel salvataggio. Prova a liberare memoria o ridurre la foto.");
    console.error(e);
  }
}

/* -----------------------------
   10) PWA install + Service Worker
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
      alert("Installazione non disponibile ora. Riprova tra poco dal menu ⋮ di Chrome.");
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
   11) Settings modal
----------------------------- */

function openSettingsModal() {
  if (el.settingsBackdrop) el.settingsBackdrop.hidden = false;
  if (el.settingsModal) el.settingsModal.hidden = false;
}

function closeSettingsModal() {
  if (el.settingsBackdrop) el.settingsBackdrop.hidden = true;
  if (el.settingsModal) el.settingsModal.hidden = true;
}

/* -----------------------------
   12) Refresh
----------------------------- */

async function refresh() {
  state.outfits = await dbGetAllOutfits();

  if (el.savedCount) el.savedCount.textContent = String(state.outfits.length);

  renderGrid();
}

/* -----------------------------
   13) Init + events
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
  if (el.addBtn && el.fileInput) el.addBtn.addEventListener("click", () => el.fileInput.click());
  if (el.emptyAddBtn && el.fileInput) el.emptyAddBtn.addEventListener("click", () => el.fileInput.click());

  if (el.fileInput) {
    el.fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        await addOutfitFromFile(f);
      }
      el.fileInput.value = "";
    });
  }

  // Search (debounced)
  if (el.searchInput) {
    const onSearch = debounce(() => {
      state.search = el.searchInput.value || "";
      renderGrid();
    }, 120);

    el.searchInput.addEventListener("input", onSearch);
  }

  // Sort
  if (el.sortSelect) {
    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      renderGrid();
    });
  }

  // Detail modal events
  if (el.closeDetail) el.closeDetail.addEventListener("click", closeDetailModal);
  if (el.detailBackdrop) el.detailBackdrop.addEventListener("click", closeDetailModal);

  if (el.saveDetailBtn) el.saveDetailBtn.addEventListener("click", saveDetail);
  if (el.deleteBtn) el.deleteBtn.addEventListener("click", deleteDetail);
  if (el.shareBtn) el.shareBtn.addEventListener("click", shareDetail);
  if (el.favoriteBtn) el.favoriteBtn.addEventListener("click", toggleFavorite);

  // Settings modal events
  if (el.openSettings) el.openSettings.addEventListener("click", openSettingsModal);
  if (el.closeSettings) el.closeSettings.addEventListener("click", closeSettingsModal);
  if (el.settingsBackdrop) el.settingsBackdrop.addEventListener("click", closeSettingsModal);

  if (el.themeSelect) el.themeSelect.value = state.settings.theme;

  if (el.saveSettings) {
    el.saveSettings.addEventListener("click", () => {
      if (!el.themeSelect) return;
      state.settings.theme = el.themeSelect.value;
      saveSettings(state.settings);
      setTheme(state.settings.theme);
      closeSettingsModal();
    });
  }

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (el.detailModal && !el.detailModal.hidden) closeDetailModal();
    if (el.settingsModal && !el.settingsModal.hidden) closeSettingsModal();
  });

  // PWA
  setupServiceWorker();
  setupPWAInstall();
})();
