/* =========================================================
   Outfit Vault — app.js
   Offline-first outfits storage with IndexedDB + PWA install
   + Preferiti (Mi piace)
   + Contatore outfit salvati
   + Ordina: preferiti prima / solo preferiti / voto
   + FIX: immagini che non si visualizzano (conversione JPEG)
   ========================================================= */

/* -----------------------------
   1) Settings (LocalStorage)
----------------------------- */

const SETTINGS_KEY = "outfit_vault_settings_v1";
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

function setThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}

function syncThemeColorWithSystem() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setThemeColor(prefersDark ? "#0b1020" : "#f7f3ff");
}

/* -----------------------------
   2) IndexedDB (Photos + Data)
   - Stores: { id, name, rating, favorite, createdAt, imageBlob }
----------------------------- */

const DB_NAME = "OutfitVaultDB";
const DB_VERSION = 2;
const STORE = "outfits";

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

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
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

function makeObjectURL(blob) {
  return URL.createObjectURL(blob);
}

/**
 * FIX immagini non visualizzate:
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
  selectedId: null,
  selectedURL: null,
  search: "",
  sort: "date_desc",
  settings: loadSettings()
};

/* -----------------------------
   5) UI Elements
----------------------------- */

const el = {
  grid: document.getElementById("grid"),
  emptyState: document.getElementById("emptyState"),

  addBtn: document.getElementById("addBtn"),
  fileInput: document.getElementById("fileInput"),

  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),

  savedCount: document.getElementById("savedCount"),

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
   6) Rendering (Grid)
----------------------------- */

function applyFiltersAndSort() {
  const q = state.search.trim().toLowerCase();
  let arr = [...state.outfits];

  if (q) {
    arr = arr.filter(o => (o.name || "").toLowerCase().includes(q));
  }

  const s = state.sort;

  if (s === "fav_only") {
    arr = arr.filter(o => !!o.favorite);
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
}

function renderGrid() {
  applyFiltersAndSort();

  const items = state.filtered;
  el.grid.innerHTML = "";

  if (!items.length) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  for (const outfit of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = outfit.name || "Outfit";
    img.loading = "lazy";

    const url = makeObjectURL(outfit.imageBlob);
    img.src = url;

    // Non revocare subito: su alcuni Android rompe la preview (immagine rotta)
    // (se vuoi pulizia memoria: si può fare in modo più sicuro con una cache URL)

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
      if (e.key === "Enter" || e.key === " ") open();
    });

    el.grid.appendChild(card);
  }
}

/* -----------------------------
   7) Detail modal (view/edit/share)
----------------------------- */

function openDetailModal() {
  el.detailBackdrop.hidden = false;
  el.detailModal.hidden = false;
}

function closeDetailModal() {
  el.detailBackdrop.hidden = true;
  el.detailModal.hidden = true;

  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = null;
  state.selectedId = null;
}

function renderStars(container, value, onChange) {
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

  el.detailTitle.textContent = safeName(outfit.name);
  el.detailMeta.textContent = `Creato: ${formatDate(outfit.createdAt)}`;

  if (state.selectedURL) {
    try { URL.revokeObjectURL(state.selectedURL); } catch {}
  }
  state.selectedURL = makeObjectURL(outfit.imageBlob);
  el.detailImg.src = state.selectedURL;

  el.detailName.value = outfit.name || "";

  const handleStar = (newRating) => {
    renderStars(el.detailStars, newRating, handleStar);
    el.detailStars.dataset.value = String(newRating);
  };

  renderStars(el.detailStars, outfit.rating || 0, handleStar);
  el.detailStars.dataset.value = String(clampRating(outfit.rating || 0));

  setFavoriteBtn(!!outfit.favorite);

  openDetailModal();
}

async function saveDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const newName = safeName(el.detailName.value);
  const newRating = clampRating(el.detailStars.dataset.value || 0);

  const updated = {
    ...outfit,
    name: newName,
    rating: newRating
  };

  await dbPutOutfit(updated);
  await refresh();

  el.detailTitle.textContent = newName;
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

  await dbDeleteOutfit(state.selectedId);
  closeDetailModal();
  await refresh();
}

async function shareDetail() {
  if (!state.selectedId) return;

  const outfit = await dbGetOutfit(state.selectedId);
  if (!outfit) return;

  const name = safeName(outfit.name);
  const file = new File([outfit.imageBlob], `${name}.jpg`, { type: outfit.imageBlob.type || "image/jpeg" });

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

  try {
    await navigator.share({
      title: "Outfit Vault",
      text: `Ho salvato un outfit: ${name}`,
      url: location.href
    });
    return;
  } catch {}

  alert("Condivisione non supportata su questo dispositivo/browser.");
}

/* -----------------------------
   8) Add outfit (from file)
----------------------------- */

async function addOutfitFromFile(file) {
  if (!file) return;

  // FIX: convertiamo sempre a JPEG sicuro
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
   9) PWA install + Service Worker
----------------------------- */

let deferredInstallEvent = null;

function setupPWAInstall() {
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
   10) Settings modal
----------------------------- */

function openSettingsModal() {
  el.settingsBackdrop.hidden = false;
  el.settingsModal.hidden = false;
}
function closeSettingsModal() {
  el.settingsBackdrop.hidden = true;
  el.settingsModal.hidden = true;
}

/* -----------------------------
   11) Refresh
----------------------------- */

async function refresh() {
  state.outfits = await dbGetAllOutfits();

  if (el.savedCount) {
    el.savedCount.textContent = String(state.outfits.length);
  }

  renderGrid();
}

/* -----------------------------
   12) Init
----------------------------- */

(function init() {
  setTheme(state.settings.theme);

  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq) {
    mq.addEventListener("change", () => {
      if (state.settings.theme === "system") syncThemeColorWithSystem();
    });
  }

  refresh().catch(console.error);

  el.addBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      await addOutfitFromFile(f);
    }
    el.fileInput.value = "";
  });

  el.searchInput.addEventListener("input", () => {
    state.search = el.searchInput.value;
    renderGrid();
  });

  el.sortSelect.addEventListener("change", () => {
    state.sort = el.sortSelect.value;
    renderGrid();
  });

  el.closeDetail.addEventListener("click", closeDetailModal);
  el.detailBackdrop.addEventListener("click", closeDetailModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!el.detailModal.hidden) closeDetailModal();
      if (!el.settingsModal.hidden) closeSettingsModal();
    }
  });

  el.saveDetailBtn.addEventListener("click", saveDetail);
  el.deleteBtn.addEventListener("click", deleteDetail);
  el.shareBtn.addEventListener("click", shareDetail);
  if (el.favoriteBtn) el.favoriteBtn.addEventListener("click", toggleFavorite);

  el.openSettings.addEventListener("click", openSettingsModal);
  el.closeSettings.addEventListener("click", closeSettingsModal);
  el.settingsBackdrop.addEventListener("click", closeSettingsModal);

  el.themeSelect.value = state.settings.theme;
  el.saveSettings.addEventListener("click", () => {
    state.settings.theme = el.themeSelect.value;
    saveSettings(state.settings);

    setTheme(state.settings.theme);
    closeSettingsModal();
  });

  setupServiceWorker();
  setupPWAInstall();
})();
