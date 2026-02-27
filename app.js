/* =========================
   STATE
========================= */
const state = {
  selectMode: false,
  selectedSet: new Set()
};

/* =========================
   ELEMENTI
========================= */
const el = {
  bulkBar: document.getElementById("bulkBar"),

  createBackdrop: document.getElementById("createBackdrop"),
  createModal: document.getElementById("createModal"),

  detailBackdrop: document.getElementById("detailBackdrop"),
  detailModal: document.getElementById("detailModal"),

  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsModal: document.getElementById("settingsModal"),

  addBtn: document.getElementById("addBtn")
};

/* =========================
   SELEZIONE
========================= */
function enableSelectMode(on){
  state.selectMode = on;

  if(!on){
    state.selectedSet.clear();
  }

  syncBulkUI();
}

function syncBulkUI(){
  if(!el.bulkBar) return;

  if(state.selectMode){
    el.bulkBar.hidden = false;
  } else {
    el.bulkBar.hidden = true;
  }
}

/* =========================
   SOSPENDI SELEZIONE
   quando apri un modal
========================= */
function suspendSelectionUI(){
  state.selectMode = false;
  state.selectedSet.clear();

  if(el.bulkBar){
    el.bulkBar.hidden = true;
  }
}

/* =========================
   MODAL HELPERS
========================= */
function showModal(backdrop, modal){
  suspendSelectionUI();  // ← FIX PRINCIPALE

  backdrop.hidden = false;
  modal.hidden = false;
}

function hideModal(backdrop, modal){
  backdrop.hidden = true;
  modal.hidden = true;
}

/* =========================
   EVENTI
========================= */

// Aggiungi outfit
if(el.addBtn){
  el.addBtn.addEventListener("click", ()=>{
    suspendSelectionUI();
    showModal(el.createBackdrop, el.createModal);
  });
}

// Chiudi modali cliccando backdrop
if(el.createBackdrop){
  el.createBackdrop.addEventListener("click", ()=>{
    hideModal(el.createBackdrop, el.createModal);
  });
}
if(el.detailBackdrop){
  el.detailBackdrop.addEventListener("click", ()=>{
    hideModal(el.detailBackdrop, el.detailModal);
  });
}
if(el.settingsBackdrop){
  el.settingsBackdrop.addEventListener("click", ()=>{
    hideModal(el.settingsBackdrop, el.settingsModal);
  });
}

/* ESC chiude */
document.addEventListener("keydown",(e)=>{
  if(e.key === "Escape"){
    hideModal(el.createBackdrop, el.createModal);
    hideModal(el.detailBackdrop, el.detailModal);
    hideModal(el.settingsBackdrop, el.settingsModal);
  }
});
