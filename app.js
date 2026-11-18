'use strict';
/* Al Día — vehículos, papeles y mantenimientos de casa.
   Todos los datos se guardan solo en este dispositivo (IndexedDB). */

const APP_VERSION = '1.0.0';

/* ================= Utilidades ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => toStr(new Date());
function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return toStr(d); }
function addMonths(s, n) {
  const d = toDate(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last)); return toStr(d);
}
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

const G = (() => { try { return new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(1000) === '1.000' ? 'always' : true; } catch { return true; } })();
const nf = (d = 0) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: G });
const fNum = (n, d = 0) => nf(d).format(n || 0);
const fKm = n => fNum(Math.round(n)) + ' km';
const fEur = (n, dec = 2) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: G }).format(n || 0);
const fEur0 = n => fEur(n, Math.abs(n) >= 1000 ? 0 : 2);
function fDate(s, year = true) { if (!s) return '—'; const d = toDate(s); return `${d.getDate()} ${MESES[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`; }
function fDateRel(s) {
  if (!s) return '—';
  const d = daysBetween(s, todayStr());
  if (d === 0) return 'hoy'; if (d === 1) return 'ayer';
  if (d > 1 && d < 7) return `hace ${d} días`;
  return fDate(s, toDate(s).getFullYear() !== new Date().getFullYear());
}
function num(s) {
  if (s == null) return null; s = String(s).trim().replace(/\s|€/g, ''); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); return isFinite(n) ? n : null;
}
function intKm(s) { if (s == null) return null; const t = String(s).replace(/[^\d]/g, ''); return t ? parseInt(t, 10) : null; }

function spanText(d) {
  if (d < 45) return d === 1 ? '1 día' : `${d} días`;
  const m = Math.round(d / 30.44);
  if (m < 24) return `${m} meses`;
  const y = Math.floor(m / 12), r = m % 12;
  return r ? `${y} años y ${r} m` : `${y} años`;
}
function dueText(d, past = 'Atrasado') {
  if (d < 0) return `${past} ${spanText(-d)}`;
  if (d === 0) return 'Hoy'; if (d === 1) return 'Mañana';
  return `En ${spanText(d)}`;
}

/* ================= Almacenamiento (IndexedDB) ================= */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('aldia', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('photos'); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const q = fn(t.objectStore(store));
      t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  get(store, k) { return this.req(store, 'readonly', s => s.get(k)); },
  put(store, k, v) { return this.req(store, 'readwrite', s => s.put(v, k)); },
  del(store, k) { return this.req(store, 'readwrite', s => s.delete(k)); },
  clear(store) { return this.req(store, 'readwrite', s => s.clear()); },
  async all(store) {
    const keys = await this.req(store, 'readonly', s => s.getAllKeys());
    const vals = await this.req(store, 'readonly', s => s.getAll());
    const o = {}; keys.forEach((k, i) => o[k] = vals[i]); return o;
  }
};

const emptyData = () => ({ schema: 1, vehicles: [], docs: [], plans: [], mtos: [], fuels: [], pagos: [], casa: [], kmlog: [], settings: {} });
let D = emptyData();
function normalize(d) { const e = emptyData(); for (const k in e) if (d[k] == null) d[k] = e[k]; return d; }
function save() { return idb.put('kv', 'data', D).catch(e => toast('No se pudo guardar: ' + e.message)); }

let undoSnap = null;
function snapshot() { undoSnap = JSON.stringify(D); }
function undo() { if (!undoSnap) return; D = JSON.parse(undoSnap); undoSnap = null; save(); render(); toast('Deshecho'); }

const photoCache = {};
async function getPhoto(id) { if (!id) return null; if (photoCache[id]) return photoCache[id]; const p = await idb.get('photos', id); if (p) photoCache[id] = p; return p; }
async function savePhoto(dataUrl) { const id = 'p' + uid(); await idb.put('photos', id, dataUrl); photoCache[id] = dataUrl; return id; }
async function delPhoto(id) { if (id) { delete photoCache[id]; await idb.del('photos', id); } }
function resizeImage(file, max = 1400, q = .8) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
async function hydratePhotos(root = document) {
  for (const el of $$('[data-foto]', root)) {
    const id = el.dataset.foto; const p = await getPhoto(id); if (!p) continue;
    if (el.classList.contains('photo-prev')) el.innerHTML = `<img src="${p}">Cambiar foto`;
    else el.style.backgroundImage = `url("${p}")`;
    if (el.classList.contains('avatar') || el.classList.contains('img')) el.textContent = '';
  }
}

/* ================= Catálogos ================= */
const CATS = {
  combustible: { n: 'Combustible', c: 'var(--c1)', e: '⛽' },
  mantenimiento: { n: 'Mantenimiento', c: 'var(--c2)', e: '🔧' },
  seguro: { n: 'Seguro', c: 'var(--c3)', e: '🛡️' },
  impuesto: { n: 'Impuesto', c: 'var(--c4)', e: '🏛️' },
  itv: { n: 'ITV', c: 'var(--c5)', e: '✅' },
  otros: { n: 'Otros', c: 'var(--c6)', e: '💶' }
};
const DOC_TYPES = {
  itv: { n: 'ITV', e: '✅', renew: 12, cat: 'itv' },
  seguro: { n: 'Seguro', e: '🛡️', renew: 12, cat: 'seguro' },
  impuesto: { n: 'Impuesto de circulación', e: '🏛️', renew: 12, cat: 'impuesto' },
  carnet: { n: 'Carnet de conducir', e: '🪪', renew: 120, cat: 'otros', personal: true },
  dni: { n: 'DNI', e: '🪪', renew: 120, cat: 'otros', personal: true },
  pasaporte: { n: 'Pasaporte', e: '🛂', renew: 120, cat: 'otros', personal: true },
  otro: { n: 'Otro documento', e: '📄', renew: 12, cat: 'otros' }
};
const VTYPES = { coche: ['Coche', '🚗'], moto: ['Moto', '🏍️'], furgo: ['Furgoneta', '🚐'], otro: ['Otro', '🚙'] };
const FUELS = [['gasolina', 'Gasolina'], ['diesel', 'Diésel'], ['hibrido', 'Híbrido'], ['electrico', 'Eléctrico'], ['glp', 'GLP'], ['otro', 'Otro']];
const PRESET_PLANS = {
  coche: [['Aceite y filtro de aceite', 15000, 12], ['Filtro de aire', 30000, 24], ['Filtro de habitáculo', 15000, 12], ['Filtro de combustible', 60000, 48],
    ['Neumáticos', 40000, 60], ['Pastillas de freno', 40000, null], ['Líquido de frenos', null, 24], ['Batería', null, 48],
    ['Correa de distribución', 120000, 96], ['Líquido refrigerante', null, 48], ['Revisión general', 30000, 24]],
  moto: [['Aceite y filtro de aceite', 6000, 12], ['Engrasar cadena', 800, null], ['Kit de transmisión', 20000, null], ['Neumáticos', 15000, 48],
    ['Pastillas de freno', 15000, null], ['Líquido de frenos', null, 24], ['Filtro de aire', 12000, 24], ['Bujías', 12000, 36], ['Batería', null, 36], ['Revisión general', 12000, 12]]
};
PRESET_PLANS.furgo = PRESET_PLANS.coche; PRESET_PLANS.otro = PRESET_PLANS.coche;
const CASA_SUG = [
  ['🧺', 'Limpiar filtro de la lavadora', 1, 'm'], ['🧼', 'Lavado de cuba de la lavadora', 1, 'm'], ['🍽️', 'Limpiar filtro del lavavajillas', 1, 'm'],
  ['🔥', 'Revisión de la caldera', 1, 'a'], ['♨️', 'Purgar radiadores', 1, 'a'], ['🌬️', 'Limpiar filtros del aire acondicionado', 6, 'm'],
  ['🍳', 'Cambiar filtro de la campana', 3, 'm'], ['💧', 'Cambiar filtro de agua', 6, 'm'], ['☕', 'Descalcificar cafetera', 2, 'm'],
  ['🧊', 'Limpiar la nevera', 3, 'm'], ['🚨', 'Probar detector de humo', 6, 'm'], ['🛏️', 'Dar la vuelta al colchón', 6, 'm']
];
const EMOJIS = ['🏠', '🧺', '🧼', '🍽️', '🔥', '♨️', '🌬️', '💧', '🍳', '☕', '🧊', '🚨', '🛏️', '🪴', '🧹', '🔌', '💡', '🐾', '🪪', '📄', '🦷', '💊', '🔑', '🛠️'];
function planEmoji(n) {
  n = (n || '').toLowerCase();
  const m = [['aceite', '🛢️'], ['neum', '🛞'], ['rueda', '🛞'], ['freno', '🛑'], ['bater', '🔋'], ['correa', '⚙️'], ['distrib', '⚙️'], ['refrig', '❄️'],
    ['buj', '⚡'], ['cadena', '⛓️'], ['transm', '⛓️'], ['filtro', '🌀'], ['aire', '🌀'], ['revis', '🔧'], ['limpia', '🧽'], ['luces', '💡']];
  for (const [k, e] of m) if (n.includes(k)) return e; return '🔧';
}
const UNITS = { d: ['día', 'días', 1], s: ['semana', 'semanas', 7], m: ['mes', 'meses', 30.44], a: ['año', 'años', 365.25] };
const freqText = t => t.cada == 1 ? `Cada ${UNITS[t.unidad][0]}` : `Cada ${t.cada} ${UNITS[t.unidad][1]}`;

/* ================= Lógica ================= */
const veh = id => D.vehicles.find(v => v.id === id);
const vName = v => v ? ([v.marca, v.modelo].filter(Boolean).join(' ') || v.matricula || 'Vehículo') : 'Personal';
const vEmoji = v => (VTYPES[v?.tipo] || VTYPES.coche)[1];
const docName = d => d.tipo === 'otro' ? (d.nombre || 'Documento') : DOC_TYPES[d.tipo].n;

function setKm(v, km, fecha, manual = false) {
  if (!v || km == null || isNaN(km)) return;
  if (manual || km > (v.km || 0)) {
    v.km = km; v.kmFecha = fecha || todayStr();
    if (manual) D.kmlog.push({ id: uid(), vehicleId: v.id, fecha: v.kmFecha, km });
  }
}
function kmPoints(vId) {
  const p = [];
  D.kmlog.forEach(k => k.vehicleId === vId && p.push(k));
  D.fuels.forEach(f => f.vehicleId === vId && f.km && p.push(f));
  D.mtos.forEach(m => m.vehicleId === vId && m.km && p.push(m));
  return p;
}
function kmRate(vId) {
  const cut = addDays(todayStr(), -365);
  const p = kmPoints(vId).filter(x => x.fecha >= cut);
  if (p.length < 2) return null;
  const f = p.map(x => x.fecha).sort(); const span = daysBetween(f[0], f[f.length - 1]);
  if (span < 14) return null;
  const k = p.map(x => x.km); const r = (Math.max(...k) - Math.min(...k)) / span;
  return r > 0 ? r : null;
}

function docStatus(doc, ref = todayStr()) {
  if (!doc.vence) return { level: 'none', days: 1e9, text: 'Añade la fecha de vencimiento' };
  const days = daysBetween(ref, doc.vence);
  const level = days <= 15 ? 'red' : days <= 45 ? 'yellow' : 'green';
  const text = days < 0 ? `Caducó hace ${spanText(-days)}` : `${dueText(days)} · ${fDate(doc.vence)}`;
  return { level, days, text, short: days < 0 ? 'Caducado' : dueText(days) };
}

function planRecords(p) { return D.mtos.filter(m => (m.planIds || []).includes(p.id)).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.km || 0) - (a.km || 0)); }
function planLast(p) {
  const r = planRecords(p)[0];
  if (r) return { fecha: r.fecha, km: r.km ?? null, rec: r };
  if (p.ultimaFecha || p.ultimoKm != null) return { fecha: p.ultimaFecha || null, km: p.ultimoKm ?? null };
  return null;
}
function planStatus(p, ref = todayStr()) {
  const v = veh(p.vehicleId); const last = planLast(p);
  if (!last) return { level: 'none', days: 1e9, text: 'Indica cuándo se hizo por última vez', short: 'Sin datos' };
  const nextKm = p.cadaKm && last.km != null ? last.km + p.cadaKm : null;
  const nextDate = p.cadaMeses && last.fecha ? addMonths(last.fecha, p.cadaMeses) : null;
  if (nextKm == null && nextDate == null) return { level: 'none', days: 1e9, text: 'Falta el dato de la última vez', short: 'Sin datos', last };
  const kmLeft = nextKm != null ? nextKm - (v?.km || 0) : null;
  const daysLeft = nextDate ? daysBetween(ref, nextDate) : null;
  const rate = kmRate(p.vehicleId); const off = daysBetween(todayStr(), ref);
  let kmDays = null;
  if (kmLeft != null) kmDays = kmLeft <= 0 ? Math.min(-1, -off) : rate ? Math.floor(kmLeft / rate) - off : null;
  const redKm = Math.min(300, p.cadaKm * .1), yelKm = Math.min(Math.max(1000, p.cadaKm * .1), p.cadaKm * .3);
  let level = 'green';
  if ((kmLeft != null && kmLeft <= redKm) || (daysLeft != null && daysLeft <= 15) || (kmDays != null && kmDays <= 15)) level = 'red';
  else if ((kmLeft != null && kmLeft <= yelKm) || (daysLeft != null && daysLeft <= 45) || (kmDays != null && kmDays <= 45)) level = 'yellow';
  const parts = [];
  if (kmLeft != null) parts.push(kmLeft < 0 ? `Pasado ${fKm(-kmLeft)}` : `Faltan ${fKm(kmLeft)}`);
  if (nextDate) parts.push(daysLeft < 0 ? `atrasado ${spanText(-daysLeft)}` : (parts.length ? `antes del ${fDate(nextDate)}` : `${dueText(daysLeft)} · ${fDate(nextDate)}`));
  const est = kmLeft != null && kmLeft > 0 && kmLeft < 1e9 ? Math.floor(kmLeft / (rate || 35)) - off : null;
  const days = Math.min(daysLeft ?? 1e9, kmDays ?? (est ?? 1e9));
  let progress = null;
  if (kmLeft != null) progress = 1 - kmLeft / p.cadaKm;
  if (daysLeft != null) { const tot = daysBetween(last.fecha, nextDate) || 1; const pd = 1 - daysLeft / tot; progress = progress == null ? pd : Math.max(progress, pd); }
  let text = parts.join(' · '); text = text.charAt(0).toUpperCase() + text.slice(1);
  const short = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft < 0) ? 'Toca ya' : (kmLeft != null && (daysLeft == null || kmDays == null || kmDays < daysLeft) ? `${fKm(kmLeft)}` : dueText(daysLeft ?? kmDays));
  return { level, days, text, short, nextKm, nextDate, kmLeft, daysLeft, last, progress, rate };
}

function casaNext(t) {
  if (!t.ultima) return null;
  return t.unidad === 'm' ? addMonths(t.ultima, t.cada) : t.unidad === 'a' ? addMonths(t.ultima, t.cada * 12) : addDays(t.ultima, t.cada * UNITS[t.unidad][2]);
}
function casaStatus(t, ref = todayStr()) {
  const next = casaNext(t);
  if (!next) return { level: 'none', days: 1e9, text: 'Pulsa «Hecho» cuando lo hagas', short: 'Sin fecha' };
  const days = daysBetween(ref, next);
  const per = t.cada * UNITS[t.unidad][2];
  const yel = Math.max(2, Math.min(30, Math.round(per * .15)));
  const level = days <= 0 ? 'red' : days <= yel ? 'yellow' : 'green';
  const text = days < 0 ? `Atrasado ${spanText(-days)}` : days === 0 ? 'Toca hoy' : `${dueText(days)} · ${fDate(next)}`;
  return { level, days, text, short: days < 0 ? 'Atrasado' : days === 0 ? 'Hoy' : dueText(days), next, progress: 1 - days / per };
}

function upcoming(ref = todayStr()) {
  const it = [];
  D.docs.forEach(d => { const v = veh(d.vehicleId); it.push({ kind: 'doc', id: d.id, e: DOC_TYPES[d.tipo].e, title: docName(d), sub: d.vehicleId ? vName(v) : 'Personal', st: docStatus(d, ref) }); });
  D.plans.forEach(p => { const v = veh(p.vehicleId); if (!v) return; it.push({ kind: 'plan', id: p.id, e: planEmoji(p.nombre), title: p.nombre, sub: vName(v), st: planStatus(p, ref) }); });
  D.casa.forEach(t => it.push({ kind: 'casa', id: t.id, e: t.emoji || '🏠', title: t.nombre, sub: 'Casa', st: casaStatus(t, ref) }));
  const ord = { red: 0, yellow: 1, green: 2, none: 3 };
  return it.sort((a, b) => (a.st.level === 'none') - (b.st.level === 'none') || a.st.days - b.st.days || ord[a.st.level] - ord[b.st.level]);
}

function expenses(vId = 'all') {
  const o = [];
  D.fuels.forEach(f => o.push({ id: f.id, kind: 'fuel', fecha: f.fecha, cat: 'combustible', importe: f.total || 0, vehicleId: f.vehicleId, concepto: f.gasolinera || 'Repostaje' }));
  D.mtos.forEach(m => m.precio && o.push({ id: m.id, kind: 'mto', fecha: m.fecha, cat: 'mantenimiento', importe: m.precio, vehicleId: m.vehicleId, concepto: m.nombre }));
  D.pagos.forEach(p => o.push({ id: p.id, kind: 'pago', fecha: p.fecha, cat: p.cat, importe: p.importe || 0, vehicleId: p.vehicleId || null, concepto: p.concepto }));
  return vId === 'all' ? o : o.filter(e => e.vehicleId === vId);
}
function catBreak(list) {
  const s = {}; list.forEach(e => s[e.cat] = (s[e.cat] || 0) + e.importe);
  return Object.entries(s).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}
const sum = (list, f = e => e.importe) => list.reduce((a, e) => a + (f(e) || 0), 0);

function fuelStats(vId) {
  const fs = D.fuels.filter(f => f.vehicleId === vId).sort((a, b) => a.km - b.km || a.fecha.localeCompare(b.fecha));
  let lastFull = null, accL = 0, accC = 0, L = 0, K = 0, C = 0; const per = {};
  for (const f of fs) {
    if (lastFull === null) { if (f.lleno !== false) lastFull = f.km; continue; }
    accL += f.litros || 0; accC += f.total || 0;
    if (f.lleno !== false) {
      const km = f.km - lastFull;
      if (km > 0) { per[f.id] = accL / km * 100; L += accL; K += km; C += accC; }
      lastFull = f.km; accL = 0; accC = 0;
    }
  }
  return { per, avg: K ? L / K * 100 : null, costKm: K ? C / K : null, km: K, list: fs };
}
function last12Keys() {
  const n = new Date(); const out = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
  return out;
}

/* ================= UI helpers ================= */
const S = { tab: 'inicio', vehicleId: null, vtab: 'mto', period: 'mes', filter: 'all', hfilter: 'all', showAll: false };
let toastT;
function toast(msg, undoable = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undoable ? '<button data-a="undo">Deshacer</button>' : ''}`;
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), undoable ? 5000 : 2600);
}
const CHEV = '<svg class="chev" viewBox="0 0 8 13"><path d="M1 1l5.5 5.5L1 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

let sheetSubmit = null, sheetActions = null;
function openSheet({ title, body, submit = 'Guardar', onSubmit, onRender }) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-a="closeSheet"></div><form class="sheet" novalidate autocomplete="off">
    <div class="sheet-head"><button type="button" class="link" data-a="closeSheet">Cancelar</button><h3>${esc(title)}</h3><button type="submit" class="link strong">${submit}</button></div>
    <div class="sheet-body">${body}</div></form>`;
  const form = $('form', root); form._photos = {};
  sheetSubmit = onSubmit; sheetActions = null;
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (document.activeElement) document.activeElement.blur();
    const fd = Object.fromEntries(new FormData(form));
    for (const k in fd) if (typeof fd[k] === 'string') fd[k] = fd[k].trim();
    try {
      const r = await sheetSubmit(fd, form);
      if (r !== false) { closeSheet(); render(); }
    } catch (err) { console.error(err); toast('Error: ' + err.message); }
  });
  $$('[data-photo] input[type=file]', form).forEach(inp => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return; const box = inp.closest('[data-photo]');
    const prev = $('.photo-prev', box); prev.textContent = 'Procesando…';
    try { const url = await resizeImage(f); form._photos[box.dataset.photo] = url; prev.innerHTML = `<img src="${url}">Cambiar foto`; }
    catch (e) { prev.textContent = e.message; }
  }));
  requestAnimationFrame(() => root.classList.add('open'));
  hydratePhotos(root); onRender && onRender(form);
  return form;
}
function openActions(title, items) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-a="closeSheet"></div><div class="sheet"><div class="actions">
    ${title ? `<div class="ttl">${title}</div>` : ''}
    <div class="group">${items.map((it, i) => `<button type="button" data-a="sheetAct" data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')}</div>
    <div class="group"><button type="button" class="cancel" data-a="closeSheet">Cancelar</button></div></div></div>`;
  sheetActions = items;
  requestAnimationFrame(() => root.classList.add('open'));
}
function closeSheet() {
  const root = $('#sheet-root'); root.classList.remove('open');
  setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 320);
}

const F = {
  text: (n, l, v = '', a = '') => `<label class="f"><span>${l}</span><input name="${n}" value="${esc(v ?? '')}" ${a}></label>`,
  num: (n, l, v, a = '') => F.text(n, l, v == null ? '' : String(v).replace('.', ','), `inputmode="decimal" ${a}`),
  km: (n, l, v, a = '') => F.text(n, l, v != null ? fNum(v) : '', `inputmode="numeric" ${a}`),
  date: (n, l, v) => `<label class="f"><span>${l}</span><input type="date" name="${n}" value="${v || ''}"></label>`,
  select: (n, l, opts, v, a = '') => `<label class="f"><span>${l}</span><select name="${n}" ${a}>${opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v ?? '') ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`,
  area: (n, l, v) => `<label class="f"><span>${l}</span><textarea name="${n}" rows="2">${esc(v || '')}</textarea></label>`,
  check: (n, l, c) => `<label class="check"><input type="checkbox" name="${n}" ${c ? 'checked' : ''}><span>${l}</span></label>`,
  photo: (n, l, id) => `<div class="f"><span>${l}</span><label class="photo-in" data-photo="${n}"><input type="file" accept="image/*" hidden><div class="photo-prev" ${id ? `data-foto="${id}"` : ''}>📷 Añadir foto</div></label></div>`,
  row: (...f) => `<div class="frow">${f.join('')}</div>`,
  hint: t => `<div class="hint">${t}</div>`
};
const vehOpts = (personal = false) => [...D.vehicles.map(v => [v.id, `${vEmoji(v)} ${vName(v)}`]), ...(personal ? [['', 'Personal / sin vehículo']] : [])];
function vehSelect(vId, personal = false) {
  if (D.vehicles.length === 1 && !personal) return `<input type="hidden" name="vehicleId" value="${D.vehicles[0].id}">`;
  return F.select('vehicleId', 'Vehículo', vehOpts(personal), vId ?? (D.vehicles[0]?.id || ''));
}
async function takePhoto(form, name, oldId) {
  const url = form._photos[name]; if (!url) return oldId || null;
  if (oldId) await delPhoto(oldId);
  return savePhoto(url);
}

/* ================= Gráficas ================= */
function stackBar(br, total) {
  return `<div class="stack">${br.map(([k, v]) => `<i style="width:${v / total * 100}%;background:${CATS[k].c}"></i>`).join('')}</div>`;
}
function legend(br, total) {
  return `<div class="legend">${br.map(([k, v]) => `<div><i class="sw" style="background:${CATS[k].c}"></i><span class="n">${CATS[k].n}</span><span class="p">${Math.round(v / total * 100)}%</span><span class="a">${fEur(v)}</span></div>`).join('')}</div>`;
}
let chartN = 0;
function monthChart(list, opts = {}) {
  const keys = last12Keys(); const cats = Object.keys(CATS);
  const m = {}; keys.forEach(k => m[k] = {});
  list.forEach(e => { const k = e.fecha.slice(0, 7); if (m[k]) m[k][e.cat] = (m[k][e.cat] || 0) + e.importe; });
  const tot = keys.map(k => sum(Object.values(m[k]), x => x));
  const maxV = Math.max(...tot);
  if (!maxV) return `<div class="muted small">Aún no hay gastos en los últimos 12 meses.</div>`;
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find(s => maxV / s <= 4) || 20000;
  const top = Math.ceil(maxV / step) * step;
  const W = 340, H = 150, T = 8, B = 20, cw = W / 12, bw = cw * .58, ch = H - T - B;
  const y = v => T + ch - v / top * ch;
  const id = 'ch' + (++chartN);
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>` + (v ? `<text x="${W}" y="${y(v) - 3}" text-anchor="end">${fNum(v)} €</text>` : '');
  keys.forEach((k, i) => {
    const x = i * cw + (cw - bw) / 2; let acc = 0; let bars = '';
    for (const c of cats) {
      const v = m[k][c]; if (!v) continue;
      const y1 = y(acc + v), h = Math.max(1, y(acc) - y1 - (acc ? 1 : 0)); acc += v;
      bars += `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" rx="2.5" fill="${opts.color || CATS[c].c}"/>`;
    }
    const mo = +k.slice(5) - 1; const cur = i === 11;
    g += `<g class="col" data-a="mbar" data-chart="${id}" data-k="${k}" data-t="${tot[i]}"><rect class="hit" x="${i * cw + 1}" y="0" width="${cw - 2}" height="${H}" rx="6"/>${bars}<text x="${i * cw + cw / 2}" y="${H - 5}" text-anchor="middle" style="${cur ? 'fill:var(--text);font-weight:700' : ''}">${MESES[mo].charAt(0).toUpperCase()}</text></g>`;
  });
  const avg = sum(tot.map(t => ({ importe: t }))) / Math.max(1, tot.findIndex(t => t > 0) >= 0 ? 12 - tot.findIndex(t => t > 0) : 12);
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}">${g}</svg><div class="chart-cap">Toca un mes para ver el detalle · Media: <b>${fEur0(avg)}</b>/mes</div></div>`;
}

/* ================= Vistas ================= */
function render() {
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const v = { inicio: vInicio, vehiculos: S.vehicleId ? vVehiculo : vVehiculos, casa: vCasa, ajustes: vAjustes }[S.tab];
  $('#main').innerHTML = v();
  hydratePhotos($('#main'));
}

function rowItem(it, extra = '') {
  return `<button class="row lvl-${it.st.level}" data-a="item" data-kind="${it.kind}" data-id="${it.id}">
    <div class="ico">${it.e}</div>
    <div class="txt"><div class="t">${esc(it.title)}</div><div class="s">${esc(it.sub)} · <span class="st ${it.st.level}">${esc(it.st.text)}</span></div></div>
    ${extra}${CHEV}</button>`;
}

function vInicio() {
  const now = new Date();
  let h = `<div class="top"><div><h1>Al Día</h1><div class="sub">${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase())}</div></div></div>`;
  if (!D.vehicles.length && !D.casa.length && !D.docs.length) {
    return h + `<div class="card empty"><div class="big">👋</div><b>Empieza aquí</b>Añade tu vehículo y las tareas de casa. La app te avisará de lo que toca, por colores.</div>
      <div class="btns"><button class="btn" data-a="addVehicle">🚗 Añadir vehículo</button></div>
      <div class="btns"><button class="btn sec" data-a="tab" data-tab="casa">🏠 Tareas de casa</button></div>
      <div class="btns"><button class="btn ghost" data-a="demo">Probar con datos de ejemplo</button></div>`;
  }
  const all = upcoming();
  if (D.settings.demo) h += `<div class="banner"><div style="flex:1"><b>Datos de ejemplo</b>Cuando quieras empezar con los tuyos, bórralos.</div><button class="btn" data-a="wipeDemo">Borrar</button></div>`;
  const cnt = l => all.filter(i => i.st.level === l).length;
  h += `<div class="alerts"><div class="red"><b>${cnt('red')}</b><span>Urgente</span></div><div class="yellow"><b>${cnt('yellow')}</b><span>Pronto</span></div><div class="green"><b>${cnt('green')}</b><span>Al día</span></div></div>`;

  const lb = D.settings.lastBackup; const hasData = D.fuels.length + D.mtos.length + D.casa.length + D.docs.length > 3;
  if (hasData && !D.settings.demo && (!lb || daysBetween(lb, todayStr()) > 14)) {
    h += `<div class="banner"><div style="flex:1"><b>Haz una copia de seguridad</b>${lb ? `Última: ${fDateRel(lb)}` : 'Aún no has descargado ninguna'}</div><button class="btn" data-a="exportFull">Descargar</button></div>`;
  }

  if (D.vehicles.length) {
    const solo = D.vehicles.length === 1;
    h += `<div class="hscroll">${D.vehicles.map(v => `<div class="kmcard ${solo ? 'solo' : ''}">
      <div class="head"><div class="avatar" ${v.fotoId ? `data-foto="${v.fotoId}"` : ''}>${vEmoji(v)}</div><div style="min-width:0"><div class="name">${esc(vName(v))}</div><div class="muted small">Actualizado ${fDateRel(v.kmFecha)}</div></div></div>
      <div class="km">${fNum(v.km || 0)} <small>km</small></div>
      <button class="btn sec" data-a="km" data-id="${v.id}">Actualizar km</button></div>`).join('')}</div>`;
    h += `<div class="quick"><button data-a="addFuel"><span>⛽</span>Repostaje</button><button data-a="addMto"><span>🔧</span>Mantenimiento</button><button data-a="addPago"><span>💶</span>Otro gasto</button></div>`;
  }

  const relevant = all.filter(i => i.st.level !== 'none');
  const shown = S.showAll ? relevant : relevant.slice(0, 6);
  h += `<h2 class="sec">Lo próximo ${relevant.length > 6 ? `<button class="link" data-a="toggleAll">${S.showAll ? 'Ver menos' : 'Ver todo'}</button>` : ''}</h2>`;
  h += shown.length ? `<div class="card flush">${shown.map(i => rowItem(i)).join('')}</div>` : `<div class="card empty">Nada pendiente con fecha. 🎉</div>`;
  const nodata = all.filter(i => i.st.level === 'none').length;
  if (nodata) h += `<div class="note">${nodata} ${nodata === 1 ? 'elemento' : 'elementos'} sin fecha o sin la última vez. Complétalos en su sección para que entren en el aviso.</div>`;

  // Gastos
  if (D.vehicles.length || D.pagos.length) {
    const f = S.filter; const list = expenses(f === 'all' ? 'all' : f);
    const ym = todayStr().slice(0, 7), y = todayStr().slice(0, 4);
    const mes = list.filter(e => e.fecha.startsWith(ym)), anio = list.filter(e => e.fecha.startsWith(y));
    h += `<h2 class="sec">Gastos</h2>`;
    if (D.vehicles.length > 1) h += `<div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-a="filter" data-id="all">Todo</button>${D.vehicles.map(v => `<button class="chip ${f === v.id ? 'on' : ''}" data-a="filter" data-id="${v.id}">${vEmoji(v)} ${esc(vName(v))}</button>`).join('')}</div>`;
    h += `<div class="stats"><div class="stat"><div class="l">${MESES_L[now.getMonth()].replace(/^./, c => c.toUpperCase())}</div><div class="v">${fEur0(sum(mes))}</div></div><div class="stat"><div class="l">Año ${y}</div><div class="v">${fEur0(sum(anio))}</div></div></div>`;
    const sel = S.period === 'mes' ? mes : anio; const br = catBreak(sel); const tot = sum(sel);
    h += `<div class="card"><div class="seg"><button class="${S.period === 'mes' ? 'on' : ''}" data-a="period" data-p="mes">Este mes</button><button class="${S.period === 'anio' ? 'on' : ''}" data-a="period" data-p="anio">Este año</button></div>
      ${tot ? stackBar(br, tot) + legend(br, tot) : `<div class="muted small">Sin gastos ${S.period === 'mes' ? 'este mes' : 'este año'}.</div>`}</div>`;
    h += `<div class="card"><div style="font-weight:700;margin-bottom:8px">Últimos 12 meses</div>${monthChart(list)}</div>`;
  }
  return h;
}

function vehAlerts(v) {
  const it = upcoming().filter(i => (i.kind === 'plan' && D.plans.find(p => p.id === i.id)?.vehicleId === v.id) || (i.kind === 'doc' && D.docs.find(d => d.id === i.id)?.vehicleId === v.id));
  const r = it.filter(i => i.st.level === 'red').length, y = it.filter(i => i.st.level === 'yellow').length;
  if (r) return `<span class="pill red">${r} urgente${r > 1 ? 's' : ''}</span>`;
  if (y) return `<span class="pill yellow">${y} pronto</span>`;
  return `<span class="pill green">Al día</span>`;
}
function vVehiculos() {
  let h = `<div class="top"><h1>Vehículos</h1><button class="iconbtn" data-a="addVehicle" aria-label="Añadir vehículo">+</button></div>`;
  if (!D.vehicles.length) return h + `<div class="card empty"><div class="big">🚗</div><b>Sin vehículos</b>Añade tu coche, moto o furgoneta.</div><div class="btns"><button class="btn" data-a="addVehicle">Añadir vehículo</button></div>`;
  h += D.vehicles.map(v => `<div class="card flush"><button class="vcard" data-a="openVehicle" data-id="${v.id}">
    <div class="avatar" ${v.fotoId ? `data-foto="${v.fotoId}"` : ''}>${vEmoji(v)}</div>
    <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:18px">${esc(vName(v))}</div>
    <div class="muted small" style="margin:3px 0 6px">${v.matricula ? `<span class="plate"><span>${esc(v.matricula)}</span></span> · ` : ''}${fKm(v.km || 0)}</div>${vehAlerts(v)}</div>${CHEV}</button></div>`).join('');
  return h;
}

function vVehiculo() {
  const v = veh(S.vehicleId); if (!v) { S.vehicleId = null; return vVehiculos(); }
  const rate = kmRate(v.id);
  let h = `<button class="back" data-a="backVehicles">${BACK}Vehículos</button>`;
  h += `<div class="hero"><div class="img" ${v.fotoId ? `data-foto="${v.fotoId}"` : ''}>${vEmoji(v)}</div><div class="info">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div style="min-width:0"><h3>${esc(vName(v))}</h3>
    <div style="margin-top:6px">${v.matricula ? `<span class="plate"><span>${esc(v.matricula)}</span></span>` : ''}</div></div>
    <button class="link" data-a="editVehicle" data-id="${v.id}">Editar</button></div>
    <div class="facts"><div><span>Kilómetros</span><b>${fNum(v.km || 0)}</b></div><div><span>Año</span><b>${v.anio || '—'}</b></div><div><span>${rate ? 'Km al año' : 'Combustible'}</span><b>${rate ? '≈ ' + fNum(rate * 365, 0) : (FUELS.find(f => f[0] === v.combustible)?.[1] || '—')}</b></div></div>
    </div></div>`;
  h += `<div class="btns"><button class="btn sec" data-a="km" data-id="${v.id}">Actualizar km</button><button class="btn sec" data-a="addPago" data-v="${v.id}">+ Gasto</button></div>`;
  const tabs = [['mto', 'Mantenim.'], ['docs', 'Papeles'], ['fuel', 'Repostajes'], ['hist', 'Historial']];
  h += `<div class="seg">${tabs.map(([k, l]) => `<button class="${S.vtab === k ? 'on' : ''}" data-a="vtab" data-t="${k}">${l}</button>`).join('')}</div>`;
  h += { mto: vtMto, docs: vtDocs, fuel: vtFuel, hist: vtHist }[S.vtab](v);
  return h;
}

function vtMto(v) {
  const ps = D.plans.filter(p => p.vehicleId === v.id).map(p => ({ p, st: planStatus(p) }));
  const ord = { red: 0, yellow: 1, green: 2, none: 3 };
  ps.sort((a, b) => ord[a.st.level] - ord[b.st.level] || a.st.days - b.st.days);
  let h = `<div class="btns"><button class="btn" data-a="addMto" data-v="${v.id}">🔧 Registrar mantenimiento</button></div>`;
  if (ps.length) {
    h += `<div class="card flush">${ps.map(({ p, st }) => {
      const freq = [p.cadaKm ? fKm(p.cadaKm) : null, p.cadaMeses ? (p.cadaMeses % 12 === 0 ? `${p.cadaMeses / 12} año${p.cadaMeses > 12 ? 's' : ''}` : `${p.cadaMeses} meses`) : null].filter(Boolean).join(' o ');
      const pr = st.progress != null ? Math.max(.03, Math.min(1, st.progress)) : null;
      return `<button class="row lvl-${st.level}" data-a="item" data-kind="plan" data-id="${p.id}"><div class="ico">${planEmoji(p.nombre)}</div>
        <div class="txt"><div class="t">${esc(p.nombre)}</div><div class="s"><span class="st ${st.level}">${esc(st.text)}</span></div>
        <div class="s small">Cada ${freq || '—'}${st.last ? ` · Última: ${st.last.fecha ? fDate(st.last.fecha) : ''}${st.last.km != null ? ' · ' + fKm(st.last.km) : ''}` : ''}</div>
        ${pr != null ? `<div class="prog"><i class="${st.level}" style="width:${pr * 100}%"></i></div>` : ''}</div>${CHEV}</button>`;
    }).join('')}</div>`;
  } else h += `<div class="card empty">Aún no hay tipos de mantenimiento.</div>`;
  h += `<div class="btns"><button class="btn ghost" data-a="addPlan" data-v="${v.id}">+ Nuevo tipo de mantenimiento</button></div>`;
  h += `<div class="note">Los intervalos recomendados son orientativos: compruébalos en el manual del vehículo.</div>`;
  const recs = D.mtos.filter(m => m.vehicleId === v.id).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
  if (recs.length) h += `<h2 class="sec">Últimos registros</h2><div class="card flush">${recs.map(mtoRow).join('')}</div>`;
  return h;
}
function mtoRow(m) {
  return `<button class="row" data-a="editMto" data-id="${m.id}"><div class="ico">${planEmoji(m.nombre)}</div>
    <div class="txt"><div class="t">${esc(m.nombre)}</div><div class="s">${fDate(m.fecha)}${m.km ? ' · ' + fKm(m.km) : ''}${m.taller ? ' · ' + esc(m.taller) : ''}</div></div>
    ${m.fotoId ? `<div class="thumb" data-foto="${m.fotoId}"></div>` : ''}<div class="end">${m.precio ? fEur(m.precio) : ''}</div></button>`;
}

function docRow(d) {
  const st = docStatus(d);
  const sub = d.tipo === 'seguro' && d.compania ? esc(d.compania) + ' · ' : '';
  return `<button class="row lvl-${st.level}" data-a="item" data-kind="doc" data-id="${d.id}"><div class="ico">${DOC_TYPES[d.tipo].e}</div>
    <div class="txt"><div class="t">${esc(docName(d))}</div><div class="s">${sub}<span class="st ${st.level}">${esc(st.text)}</span></div></div>
    ${d.precio ? `<div class="end">${fEur0(d.precio)}</div>` : ''}${CHEV}</button>`;
}
function vtDocs(v) {
  const ds = D.docs.filter(d => d.vehicleId === v.id).sort((a, b) => docStatus(a).days - docStatus(b).days);
  let h = ds.length ? `<div class="card flush">${ds.map(docRow).join('')}</div>` : `<div class="card empty">Sin documentos.</div>`;
  const missing = ['itv', 'seguro', 'impuesto'].filter(t => !ds.some(d => d.tipo === t));
  h += `<div class="btns">${missing.map(t => `<button class="btn ghost" data-a="addDoc" data-v="${v.id}" data-t="${t}">+ ${DOC_TYPES[t].n.split(' ')[0]}</button>`).join('')}<button class="btn ghost" data-a="addDoc" data-v="${v.id}" data-t="otro">+ Otro</button></div>`;
  h += `<div class="note">🟢 más de 45 días · 🟡 menos de 45 días · 🔴 menos de 15 días o caducado. El carnet de conducir está en Casa → Documentos personales.</div>`;
  return h;
}

function vtFuel(v) {
  const fs = fuelStats(v.id);
  const list = D.fuels.filter(f => f.vehicleId === v.id);
  let h = `<div class="btns"><button class="btn" data-a="addFuel" data-v="${v.id}">⛽ Añadir repostaje</button></div>`;
  if (!list.length) return h + `<div class="card empty"><div class="big">⛽</div><b>Sin repostajes</b>Apunta cada repostaje con los km del cuentakilómetros. A partir del segundo depósito lleno verás el consumo real.</div>`;
  const ym = todayStr().slice(0, 7);
  const mes = sum(list.filter(f => f.fecha.startsWith(ym)), f => f.total);
  const cut = addDays(todayStr(), -365); const yr = list.filter(f => f.fecha > cut);
  const first = yr.map(f => f.fecha).sort()[0];
  const months = first ? Math.min(12, Math.max(1, Math.round(daysBetween(first, todayStr()) / 30.44) + 1)) : 1;
  const litros = sum(list, f => f.litros), total = sum(list, f => f.total);
  h += `<div class="stats">
    <div class="stat"><div class="l">Consumo real</div><div class="v">${fs.avg ? fNum(fs.avg, 1) + ' <small>L/100</small>' : '—'}</div><div class="d">${fs.km ? `en ${fKm(fs.km)}` : 'Necesita 2 llenos'}</div></div>
    <div class="stat"><div class="l">Coste por km</div><div class="v">${fs.costKm ? fNum(fs.costKm * 100, 1) + ' <small>cént.</small>' : '—'}</div><div class="d">${fs.costKm ? fEur(fs.costKm * 100) + ' cada 100 km' : 'Solo combustible'}</div></div>
    <div class="stat"><div class="l">Este mes</div><div class="v">${fEur0(mes)}</div><div class="d">en combustible</div></div>
    <div class="stat"><div class="l">Media mensual</div><div class="v">${fEur0(sum(yr, f => f.total) / months)}</div><div class="d">últimos ${months} ${months === 1 ? 'mes' : 'meses'}</div></div></div>`;
  h += `<div class="card"><div style="font-weight:700;margin-bottom:8px">Gasto en combustible</div>${monthChart(expenses(v.id).filter(e => e.cat === 'combustible'))}
    <div class="muted small" style="margin-top:8px">Total: ${fNum(litros, 0)} L · ${fEur(total)} · precio medio ${litros ? fEur(total / litros, 3) : '—'}/L</div></div>`;
  const sorted = [...list].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.km - a.km);
  h += `<h2 class="sec">Repostajes</h2><div class="card flush">${sorted.map(f => `<button class="row" data-a="editFuel" data-id="${f.id}"><div class="ico">⛽</div>
    <div class="txt"><div class="t">${fNum(f.litros, 2)} L · ${fEur(f.total / f.litros, 3)}/L</div><div class="s">${fDate(f.fecha)} · ${fKm(f.km)}${f.gasolinera ? ' · ' + esc(f.gasolinera) : ''}${f.lleno === false ? ' · parcial' : ''}</div></div>
    <div class="end"><div style="font-weight:650">${fEur(f.total)}</div>${fs.per[f.id] ? `<div class="s muted">${fNum(fs.per[f.id], 1)} L/100</div>` : ''}</div></button>`).join('')}</div>`;
  return h;
}

function histEvents(vId) {
  const ev = [];
  D.mtos.filter(m => m.vehicleId === vId).forEach(m => ev.push({ t: 'mto', fecha: m.fecha, km: m.km, html: mtoRow(m) }));
  D.fuels.filter(f => f.vehicleId === vId).forEach(f => ev.push({ t: 'fuel', fecha: f.fecha, km: f.km, html: `<button class="row" data-a="editFuel" data-id="${f.id}"><div class="ico">⛽</div><div class="txt"><div class="t">Repostaje · ${fNum(f.litros, 1)} L</div><div class="s">${fDate(f.fecha)} · ${fKm(f.km)}${f.gasolinera ? ' · ' + esc(f.gasolinera) : ''}</div></div><div class="end">${fEur(f.total)}</div></button>` }));
  D.pagos.filter(p => p.vehicleId === vId).forEach(p => ev.push({ t: 'pago', fecha: p.fecha, html: `<button class="row" data-a="editPago" data-id="${p.id}"><div class="ico">${CATS[p.cat]?.e || '💶'}</div><div class="txt"><div class="t">${esc(p.concepto || CATS[p.cat].n)}</div><div class="s">${fDate(p.fecha)} · ${CATS[p.cat].n}</div></div><div class="end">${fEur(p.importe)}</div></button>` }));
  D.kmlog.filter(k => k.vehicleId === vId).forEach(k => ev.push({ t: 'km', fecha: k.fecha, km: k.km, html: `<button class="row" data-a="editKm" data-id="${k.id}"><div class="ico">📍</div><div class="txt"><div class="t">Km actualizados</div><div class="s">${fDate(k.fecha)}</div></div><div class="end">${fKm(k.km)}</div></button>` }));
  return ev.sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.km || 0) - (a.km || 0));
}
function vtHist(v) {
  const f = S.hfilter; const all = histEvents(v.id);
  const ev = f === 'all' ? all : all.filter(e => e.t === f);
  const y = todayStr().slice(0, 4); const ex = expenses(v.id);
  const tot = sum(ex), anio = sum(ex.filter(e => e.fecha.startsWith(y)));
  const kms = kmPoints(v.id).map(p => p.km).concat(v.km || 0); const kmSpan = Math.max(...kms) - Math.min(...kms);
  let h = `<div class="stats"><div class="stat"><div class="l">Gastado en ${y}</div><div class="v">${fEur0(anio)}</div></div><div class="stat"><div class="l">Total registrado</div><div class="v">${fEur0(tot)}</div><div class="d">${kmSpan > 500 ? `${fNum(tot / kmSpan * 100, 1)} cént./km en total` : '&nbsp;'}</div></div></div>`;
  const fl = [['all', 'Todo'], ['mto', '🔧 Mantenim.'], ['fuel', '⛽ Repostajes'], ['pago', '💶 Gastos'], ['km', '📍 Km']];
  h += `<div class="chips">${fl.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-a="hfilter" data-f="${k}">${l}</button>`).join('')}</div>`;
  if (!ev.length) return h + `<div class="card empty">Sin registros.</div>`;
  let cur = ''; let open = false;
  for (const e of ev) {
    const k = e.fecha.slice(0, 7);
    if (k !== cur) { if (open) h += '</div>'; cur = k; h += `<div class="hmonth">${MESES_L[+k.slice(5) - 1]} ${k.slice(0, 4)}</div><div class="card flush">`; open = true; }
    h += e.html;
  }
  return h + (open ? '</div>' : '');
}

function vCasa() {
  let h = `<div class="top"><h1>Casa</h1><button class="iconbtn" data-a="addCasa" aria-label="Añadir tarea">+</button></div>`;
  const ord = { red: 0, yellow: 1, green: 2, none: 3 };
  const ts = D.casa.map(t => ({ t, st: casaStatus(t) })).sort((a, b) => ord[a.st.level] - ord[b.st.level] || a.st.days - b.st.days);
  h += `<h2 class="sec" style="margin-top:4px">Tareas periódicas</h2>`;
  if (ts.length) {
    h += `<div class="card flush">${ts.map(({ t, st }) => `<div class="row lvl-${st.level}"><div class="ico">${t.emoji || '🏠'}</div>
      <button class="txt" style="text-align:left" data-a="item" data-kind="casa" data-id="${t.id}"><div class="t">${esc(t.nombre)}</div>
      <div class="s"><span class="st ${st.level}">${esc(st.text)}</span></div><div class="s small">${freqText(t)}${t.ultima ? ' · Última: ' + fDate(t.ultima) : ''}</div></button>
      <button class="done-btn" data-a="hecho" data-id="${t.id}">✓ Hecho</button></div>`).join('')}</div>`;
  } else h += `<div class="card empty"><div class="big">🏠</div><b>Sin tareas</b>Añade las tuyas o elige entre las sugerencias.</div>`;
  const sug = CASA_SUG.filter(s => !D.casa.some(t => t.nombre === s[1]));
  if (sug.length) h += `<div class="note" style="margin-top:4px">Sugerencias (toca para añadir):</div><div class="chips" style="flex-wrap:wrap">${sug.map((s, i) => `<button class="chip" data-a="addSug" data-i="${CASA_SUG.indexOf(s)}">${s[0]} ${esc(s[1])}</button>`).join('')}</div>`;

  const pd = D.docs.filter(d => !d.vehicleId).sort((a, b) => docStatus(a).days - docStatus(b).days);
  h += `<h2 class="sec">Documentos personales</h2>`;
  h += pd.length ? `<div class="card flush">${pd.map(docRow).join('')}</div>` : `<div class="card empty">Apunta cuándo caducan tu DNI, pasaporte y carnet de conducir.</div>`;
  const miss = ['carnet', 'dni', 'pasaporte'].filter(t => !pd.some(d => d.tipo === t));
  h += `<div class="btns" style="flex-wrap:wrap">${miss.map(t => `<button class="btn ghost" data-a="addDoc" data-v="" data-t="${t}">+ ${t === 'carnet' ? 'Carnet' : DOC_TYPES[t].n}</button>`).join('')}<button class="btn ghost" data-a="addDoc" data-v="" data-t="otro">+ Otro</button></div>`;
  return h;
}

function vAjustes() {
  const s = D.settings;
  let h = `<div class="top"><h1>Ajustes</h1></div>`;
  h += `<h2 class="sec" style="margin-top:4px">Copia de seguridad</h2><div class="card">
    <p style="margin:0 0 12px" class="muted small">Tus datos solo están en este iPhone. Descarga una copia cada semana o cada dos y guárdala en iCloud Drive (Archivos).${s.lastBackup ? ` Última copia: <b>${fDateRel(s.lastBackup)}</b>.` : ''}</p>
    <button class="btn" data-a="exportFull">Descargar copia completa</button>
    <button class="btn sec" style="margin-top:10px" data-a="importFull">Importar copia</button></div>`;
  h += `<h2 class="sec">Exportar datos</h2><div class="card">
    <p style="margin:0 0 12px" class="muted small">Tabla con todos los registros (mantenimientos, repostajes y gastos) para abrir en Excel o Numbers.</p>
    <button class="btn sec" data-a="exportCsv">Exportar registros (CSV)</button></div>`;
  h += `<h2 class="sec">Avisos en el móvil</h2><div class="card">`;
  if (s.ntfyTopic && s.ntfyOn) {
    h += `<p style="margin:0" class="muted small">Recibirás un resumen a las 9:00 los días que haya algo urgente (en rojo). En la app <b>ntfy</b>, suscríbete a este tema:</p>
      <div class="topic">${esc(s.ntfyTopic)}</div>
      <button class="btn sec" data-a="ntfyTest">Enviar aviso de prueba</button>
      <button class="btn danger" style="margin-top:10px" data-a="ntfyOff">Desactivar avisos</button>
      <p class="muted small" style="margin:10px 0 0">Los avisos se programan para los 3 días siguientes cada vez que abres la app. Si pasas más de 3 días sin abrirla, dejan de llegar. No compartas el tema.</p>`;
  } else {
    h += `<p style="margin:0 0 12px" class="muted small">Instala la app gratuita <b>ntfy</b> desde la App Store para recibir un aviso cuando algo esté a punto de caducar o de tocar.</p>
      <button class="btn" data-a="ntfyOn">Activar avisos</button>`;
  }
  h += `</div>`;
  h += `<h2 class="sec">Datos</h2><div class="card"><div class="muted small" style="margin-bottom:12px">${D.vehicles.length} vehículos · ${D.mtos.length} mantenimientos · ${D.fuels.length} repostajes · ${D.pagos.length} gastos · ${D.casa.length} tareas · ${D.docs.length} documentos</div>
    <button class="btn danger" data-a="wipe">Borrar todos los datos</button></div>`;
  h += `<div class="version">Al Día · versión ${APP_VERSION}</div>`;
  return h;
}

/* ================= Formularios ================= */
function formVehicle(id) {
  const v = id ? veh(id) : { tipo: 'coche', combustible: 'gasolina' };
  let body = F.select('tipo', 'Tipo', Object.entries(VTYPES).map(([k, x]) => [k, `${x[1]} ${x[0]}`]), v.tipo)
    + F.row(F.text('marca', 'Marca', v.marca, 'placeholder="Seat" autocapitalize="words"'), F.text('modelo', 'Modelo', v.modelo, 'placeholder="León"'))
    + F.row(F.text('matricula', 'Matrícula', v.matricula, 'placeholder="1234 ABC" autocapitalize="characters"'), F.text('anio', 'Año', v.anio, 'inputmode="numeric" placeholder="2019"'))
    + F.row(F.km('km', 'Km actuales', v.km), F.select('combustible', 'Combustible', FUELS, v.combustible))
    + F.photo('foto', 'Foto', v.fotoId);
  if (id) body += `<button type="button" class="btn danger" data-a="delVehicle" data-id="${id}" style="margin-top:8px">Eliminar vehículo</button>`;
  else body += F.check('presetPlans', 'Añadir mantenimientos recomendados', true) + F.check('presetDocs', 'Añadir ITV, seguro e impuesto', true)
    + F.hint('Después podrás indicar cuándo se hizo cada cosa por última vez y ajustar los intervalos.');
  openSheet({
    body, title: id ? 'Editar vehículo' : 'Nuevo vehículo', submit: id ? 'Guardar' : 'Añadir',
    onSubmit: async (fd, form) => {
      if (!fd.marca && !fd.modelo && !fd.matricula) { toast('Escribe al menos la marca, el modelo o la matrícula'); return false; }
      const km = intKm(fd.km) ?? 0;
      const o = id ? v : { id: uid(), creado: todayStr() };
      Object.assign(o, { tipo: fd.tipo, marca: fd.marca, modelo: fd.modelo, matricula: fd.matricula.toUpperCase(), anio: fd.anio, combustible: fd.combustible });
      o.fotoId = await takePhoto(form, 'foto', o.fotoId);
      if (!id) {
        o.km = km; o.kmFecha = todayStr(); D.vehicles.push(o);
        D.kmlog.push({ id: uid(), vehicleId: o.id, fecha: todayStr(), km });
        if (fd.presetPlans) (PRESET_PLANS[o.tipo] || PRESET_PLANS.coche).forEach(([n, k, m]) => D.plans.push({ id: uid(), vehicleId: o.id, nombre: n, cadaKm: k, cadaMeses: m, ultimaFecha: null, ultimoKm: null }));
        if (fd.presetDocs) ['itv', 'seguro', 'impuesto'].forEach(t => D.docs.push({ id: uid(), vehicleId: o.id, tipo: t, vence: null }));
        S.tab = 'vehiculos'; S.vehicleId = o.id; S.vtab = 'mto';
      } else if (km !== v.km) setKm(o, km, todayStr(), true);
      save(); toast(id ? 'Guardado' : 'Vehículo añadido');
    }
  });
}

function formKm(vId) {
  const v = veh(vId);
  openSheet({
    title: 'Actualizar km', body: `<div style="text-align:center;margin-bottom:12px"><div class="avatar" style="margin:0 auto 6px;width:56px;height:56px" ${v.fotoId ? `data-foto="${v.fotoId}"` : ''}>${vEmoji(v)}</div><b>${esc(vName(v))}</b><div class="muted small">Ahora: ${fKm(v.km || 0)} · ${fDateRel(v.kmFecha)}</div></div>
      <label class="f"><span>Kilómetros del cuentakilómetros</span><input class="big-in" name="km" inputmode="numeric" value="" placeholder="${fNum(v.km || 0)}"></label>`,
    onRender: f => setTimeout(() => $('input[name=km]', f).focus(), 350),
    onSubmit: fd => {
      const km = intKm(fd.km); if (km == null) { toast('Escribe los kilómetros'); return false; }
      if (km < (v.km || 0) && !confirm(`Son menos km que los actuales (${fKm(v.km)}). ¿Corregir igualmente?`)) return false;
      snapshot(); setKm(v, km, todayStr(), true); save(); toast(`${vName(v)}: ${fKm(km)}`, true);
    }
  });
}
function formEditKm(id) {
  const k = D.kmlog.find(x => x.id === id);
  openSheet({
    title: 'Registro de km', body: F.row(F.date('fecha', 'Fecha', k.fecha), F.km('km', 'Km', k.km)) + `<button type="button" class="btn danger" data-a="delKm" data-id="${id}">Eliminar registro</button>`,
    onSubmit: fd => { k.fecha = fd.fecha || k.fecha; k.km = intKm(fd.km) ?? k.km; save(); }
  });
}

function formPlan(vId, id) {
  const p = id ? D.plans.find(x => x.id === id) : { vehicleId: vId };
  const hasRec = id && planRecords(p).length;
  let body = F.text('nombre', 'Nombre', p.nombre, 'placeholder="Cambio de aceite"')
    + F.row(F.km('cadaKm', 'Cada (km)', p.cadaKm), F.text('cadaMeses', 'Cada (meses)', p.cadaMeses, 'inputmode="numeric"'))
    + F.hint('Rellena uno o los dos: avisa con lo que llegue antes.');
  if (hasRec) body += F.hint(`Última vez según tus registros: ${fDate(planLast(p).fecha)}${planLast(p).km != null ? ' · ' + fKm(planLast(p).km) : ''}.`);
  else body += `<div class="f"><span class="lbl">Última vez que se hizo (si lo sabes)</span></div>` + F.row(F.date('ultimaFecha', 'Fecha', p.ultimaFecha), F.km('ultimoKm', 'Km', p.ultimoKm));
  body += F.area('notas', 'Notas', p.notas);
  if (id) body += `<button type="button" class="btn danger" data-a="delPlan" data-id="${id}">Eliminar este tipo</button>`;
  openSheet({
    body, title: id ? 'Editar mantenimiento' : 'Nuevo tipo de mantenimiento',
    onSubmit: fd => {
      if (!fd.nombre) { toast('Ponle un nombre'); return false; }
      const o = id ? p : { id: uid(), vehicleId: vId };
      Object.assign(o, { nombre: fd.nombre, cadaKm: intKm(fd.cadaKm), cadaMeses: intKm(fd.cadaMeses), notas: fd.notas });
      if (!hasRec) { o.ultimaFecha = fd.ultimaFecha || null; o.ultimoKm = intKm(fd.ultimoKm); }
      if (!o.cadaKm && !o.cadaMeses) { toast('Indica cada cuántos km o meses'); return false; }
      if (!id) D.plans.push(o); save();
    }
  });
}

function planTags(vId, sel = []) {
  const ps = D.plans.filter(p => p.vehicleId === vId);
  if (!ps.length) return '<div class="hint">Este vehículo no tiene tipos de mantenimiento. Escribe abajo qué se hizo.</div>';
  return `<div class="tagsel">${ps.map(p => `<label><input type="checkbox" name="plan_${p.id}" ${sel.includes(p.id) ? 'checked' : ''}><span>${planEmoji(p.nombre)} ${esc(p.nombre)}</span></label>`).join('')}</div>`;
}
function formMto(vId, id, planId) {
  if (!D.vehicles.length) { toast('Primero añade un vehículo'); return; }
  const m = id ? D.mtos.find(x => x.id === id) : { vehicleId: vId || (S.vehicleId && S.tab === 'vehiculos' ? S.vehicleId : D.vehicles[0].id), fecha: todayStr(), planIds: planId ? [planId] : [] };
  const v0 = veh(m.vehicleId);
  const otros = id ? (m.otros || '') : '';
  const body = (id ? `<input type="hidden" name="vehicleId" value="${m.vehicleId}">` : vehSelect(m.vehicleId))
    + `<div class="f"><span class="lbl">¿Qué se ha hecho? (puedes marcar varios)</span><div id="planTags">${planTags(m.vehicleId, m.planIds)}</div></div>`
    + F.text('otros', 'Otros trabajos', otros, 'placeholder="Ej.: cambio de escobillas"')
    + F.row(F.date('fecha', 'Fecha', m.fecha), F.km('km', 'Km', id ? m.km : v0?.km))
    + F.row(F.text('taller', 'Taller', m.taller, `list="talleres"`), F.num('precio', 'Precio (€)', m.precio))
    + `<datalist id="talleres">${[...new Set(D.mtos.map(x => x.taller).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('')}</datalist>`
    + F.area('notas', 'Notas', m.notas) + F.photo('foto', 'Foto de la factura', m.fotoId)
    + (id ? `<button type="button" class="btn danger" data-a="delMto" data-id="${id}">Eliminar registro</button>` : '');
  openSheet({
    body, title: id ? 'Mantenimiento' : 'Registrar mantenimiento',
    onRender: f => {
      const sel = $('select[name=vehicleId]', f);
      sel && sel.addEventListener('change', () => { $('#planTags', f).innerHTML = planTags(sel.value); const v = veh(sel.value); $('input[name=km]', f).value = fNum(v.km || 0); });
    },
    onSubmit: async (fd, form) => {
      const planIds = Object.keys(fd).filter(k => k.startsWith('plan_')).map(k => k.slice(5));
      if (!planIds.length && !fd.otros) { toast('Marca o escribe qué se ha hecho'); return false; }
      const names = planIds.map(pid => D.plans.find(p => p.id === pid)?.nombre).filter(Boolean);
      if (fd.otros) names.push(fd.otros);
      const o = id ? m : { id: uid() };
      Object.assign(o, { vehicleId: fd.vehicleId, planIds, otros: fd.otros, nombre: names.join(', '), fecha: fd.fecha || todayStr(), km: intKm(fd.km), taller: fd.taller, precio: num(fd.precio), notas: fd.notas });
      o.fotoId = await takePhoto(form, 'foto', o.fotoId);
      if (!id) D.mtos.push(o);
      setKm(veh(o.vehicleId), o.km, o.fecha); save(); toast(id ? 'Guardado' : 'Mantenimiento registrado');
    }
  });
}

function formFuel(vId, id) {
  if (!D.vehicles.length) { toast('Primero añade un vehículo'); return; }
  const f0 = id ? D.fuels.find(x => x.id === id) : { vehicleId: vId || (S.vehicleId && S.tab === 'vehiculos' ? S.vehicleId : D.vehicles[0].id), fecha: todayStr(), lleno: true };
  const gas = [...new Set(D.fuels.map(x => x.gasolinera).filter(Boolean))];
  const body = (id ? `<input type="hidden" name="vehicleId" value="${f0.vehicleId}">` : vehSelect(f0.vehicleId))
    + F.row(F.num('litros', 'Litros', f0.litros, 'placeholder="40,5"'), F.num('total', 'Precio total (€)', f0.total, 'placeholder="62,30"'))
    + `<div class="calc" id="ppl">Precio por litro: —</div>`
    + F.row(F.km('km', 'Km del cuentakilómetros', f0.km, `placeholder="${fNum(veh(f0.vehicleId)?.km || 0)}"`), F.date('fecha', 'Fecha', f0.fecha))
    + F.text('gasolinera', 'Gasolinera', f0.gasolinera, 'list="gasol"') + `<datalist id="gasol">${gas.map(g => `<option value="${esc(g)}">`).join('')}</datalist>`
    + F.check('lleno', 'He llenado el depósito', f0.lleno !== false)
    + F.hint('El consumo se calcula entre dos depósitos llenos. Si echas solo una parte, desmarca la casilla.')
    + (id ? `<button type="button" class="btn danger" data-a="delFuel" data-id="${id}">Eliminar repostaje</button>` : '');
  openSheet({
    body, title: id ? 'Repostaje' : 'Nuevo repostaje',
    onRender: f => {
      const upd = () => { const l = num($('input[name=litros]', f).value), t = num($('input[name=total]', f).value); $('#ppl', f).textContent = l && t ? `Precio por litro: ${fEur(t / l, 3)}` : 'Precio por litro: —'; };
      $$('input[name=litros],input[name=total]', f).forEach(i => i.addEventListener('input', upd)); upd();
    },
    onSubmit: fd => {
      const litros = num(fd.litros), total = num(fd.total), km = intKm(fd.km);
      if (!litros || !total) { toast('Pon los litros y el precio total'); return false; }
      if (!km) { toast('Pon los km del cuentakilómetros'); return false; }
      const o = id ? f0 : { id: uid() };
      Object.assign(o, { vehicleId: fd.vehicleId, litros, total, km, fecha: fd.fecha || todayStr(), gasolinera: fd.gasolinera, lleno: !!fd.lleno });
      if (!id) D.fuels.push(o);
      setKm(veh(o.vehicleId), km, o.fecha); save();
      const st = fuelStats(o.vehicleId).per[o.id];
      toast(st ? `Consumo: ${fNum(st, 1)} L/100 km` : 'Repostaje guardado');
    }
  });
}

function formPago(vId, id) {
  const p = id ? D.pagos.find(x => x.id === id) : { vehicleId: vId ?? (S.vehicleId && S.tab === 'vehiculos' ? S.vehicleId : D.vehicles[0]?.id || ''), fecha: todayStr(), cat: 'otros' };
  const body = F.select('vehicleId', 'Vehículo', vehOpts(true), p.vehicleId || '')
    + F.select('cat', 'Categoría', Object.entries(CATS).map(([k, c]) => [k, `${c.e} ${c.n}`]), p.cat)
    + F.text('concepto', 'Concepto', p.concepto, 'placeholder="Parking, peaje, lavado…"')
    + F.row(F.num('importe', 'Importe (€)', p.importe), F.date('fecha', 'Fecha', p.fecha))
    + F.area('notas', 'Notas', p.notas)
    + (id ? `<button type="button" class="btn danger" data-a="delPago" data-id="${id}">Eliminar gasto</button>` : '');
  openSheet({
    body, title: id ? 'Gasto' : 'Nuevo gasto',
    onSubmit: fd => {
      const imp = num(fd.importe); if (!imp) { toast('Pon el importe'); return false; }
      const o = id ? p : { id: uid() };
      Object.assign(o, { vehicleId: fd.vehicleId || null, cat: fd.cat, concepto: fd.concepto || CATS[fd.cat].n, importe: imp, fecha: fd.fecha || todayStr(), notas: fd.notas });
      if (!id) D.pagos.push(o); save(); toast('Gasto guardado');
    }
  });
}

function formDoc(vId, tipo, id) {
  const d = id ? D.docs.find(x => x.id === id) : { vehicleId: vId || null, tipo };
  const personal = !d.vehicleId;
  const types = Object.entries(DOC_TYPES).filter(([k, t]) => personal ? (t.personal || k === 'otro') : !t.personal).map(([k, t]) => [k, `${t.e} ${t.n}`]);
  const body = F.select('tipo', 'Tipo', types, d.tipo)
    + `<div data-show="otro">${F.text('nombre', 'Nombre', d.nombre, 'placeholder="Tarjeta sanitaria, garantía…"')}</div>`
    + F.date('vence', 'Fecha de vencimiento / renovación', d.vence)
    + `<div data-show="seguro">${F.row(F.text('compania', 'Compañía', d.compania), F.text('poliza', 'Nº de póliza', d.poliza))}${F.text('telefono', 'Teléfono de asistencia', d.telefono, 'inputmode="tel" placeholder="900 000 000"')}</div>`
    + `<div data-show="seguro itv impuesto otro">${F.num('precio', 'Precio (€)', d.precio)}</div>`
    + F.area('notas', 'Notas', d.notas)
    + (id ? `<button type="button" class="btn danger" data-a="delDoc" data-id="${id}">Eliminar documento</button>` : '');
  openSheet({
    body, title: id ? docName(d) : 'Nuevo documento',
    onRender: f => {
      const sel = $('select[name=tipo]', f);
      const upd = () => $$('[data-show]', f).forEach(el => el.classList.toggle('hide', !el.dataset.show.split(' ').includes(sel.value)));
      sel.addEventListener('change', upd); upd();
    },
    onSubmit: fd => {
      const o = id ? d : { id: uid(), vehicleId: d.vehicleId };
      Object.assign(o, { tipo: fd.tipo, nombre: fd.nombre, vence: fd.vence || null, compania: fd.compania, poliza: fd.poliza, telefono: fd.telefono, precio: num(fd.precio), notas: fd.notas });
      if (!id) D.docs.push(o); save(); toast('Guardado');
    }
  });
}
function formRenew(id) {
  const d = D.docs.find(x => x.id === id); const t = DOC_TYPES[d.tipo];
  const base = d.vence && d.vence > addDays(todayStr(), -90) ? d.vence : todayStr();
  const body = `<div class="hint" style="margin:0 4px 12px">Vencimiento actual: <b>${fDate(d.vence)}</b></div>`
    + F.date('vence', 'Nueva fecha de vencimiento', addMonths(base, t.renew))
    + (d.tipo === 'itv' ? F.hint('La ITV es anual o cada 2 años según la antigüedad del vehículo. Revisa la fecha de la pegatina.') : '')
    + F.num('importe', 'Importe pagado (€)', d.precio)
    + F.check('pagar', 'Apuntarlo en los gastos', true)
    + (d.tipo === 'seguro' ? F.row(F.text('compania', 'Compañía', d.compania), F.text('poliza', 'Nº de póliza', d.poliza)) : '');
  openSheet({
    body, title: 'Renovar ' + docName(d), submit: 'Renovar',
    onSubmit: fd => {
      if (!fd.vence) { toast('Pon la nueva fecha'); return false; }
      snapshot();
      (d.historial = d.historial || []).push({ fecha: todayStr(), venceAnterior: d.vence, importe: num(fd.importe) });
      d.vence = fd.vence; const imp = num(fd.importe); if (imp) d.precio = imp;
      if (d.tipo === 'seguro') { d.compania = fd.compania; d.poliza = fd.poliza; }
      if (fd.pagar && imp) D.pagos.push({ id: uid(), vehicleId: d.vehicleId || null, cat: t.cat, concepto: docName(d), importe: imp, fecha: todayStr() });
      save(); toast(`${docName(d)} renovado hasta ${fDate(d.vence)}`, true);
    }
  });
}

function formCasa(id, sug) {
  const t = id ? D.casa.find(x => x.id === id) : sug ? { emoji: sug[0], nombre: sug[1], cada: sug[2], unidad: sug[3] } : { emoji: '🏠', cada: 1, unidad: 'm' };
  const body = F.text('nombre', 'Tarea', t.nombre, 'placeholder="Limpiar filtro de la lavadora"')
    + `<div class="f"><span class="lbl">Icono</span><div class="tagsel emojis">${EMOJIS.map(e => `<label><input type="radio" name="emoji" value="${e}" ${e === t.emoji ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></div>`
    + F.row(F.text('cada', 'Cada', t.cada, 'inputmode="numeric"'), F.select('unidad', 'Unidad', [['d', 'Días'], ['s', 'Semanas'], ['m', 'Meses'], ['a', 'Años']], t.unidad))
    + F.date('ultima', 'Última vez que lo hiciste', t.ultima) + F.hint('Si no lo sabes, déjalo vacío y pulsa «Hecho» la próxima vez.')
    + F.area('notas', 'Notas', t.notas)
    + (id && t.historial?.length ? `<div class="hint">Historial: ${t.historial.slice(-8).reverse().map(x => fDate(x)).join(' · ')}</div>` : '')
    + (id ? `<button type="button" class="btn danger" data-a="delCasa" data-id="${id}">Eliminar tarea</button>` : '');
  openSheet({
    body, title: id ? 'Editar tarea' : 'Nueva tarea',
    onSubmit: fd => {
      if (!fd.nombre) { toast('Ponle un nombre'); return false; }
      const cada = intKm(fd.cada); if (!cada) { toast('Indica cada cuánto'); return false; }
      const o = id ? t : { id: uid(), historial: [] };
      if (fd.ultima && fd.ultima !== o.ultima && !o.historial.includes(fd.ultima)) o.historial.push(fd.ultima);
      Object.assign(o, { nombre: fd.nombre, emoji: fd.emoji || '🏠', cada, unidad: fd.unidad, ultima: fd.ultima || null, notas: fd.notas });
      if (!id) D.casa.push(o); save(); toast('Guardado');
    }
  });
}
function hecho(id) {
  const t = D.casa.find(x => x.id === id); snapshot();
  t.ultima = todayStr(); (t.historial = t.historial || []).push(t.ultima);
  save(); render(); toast(`✓ ${t.nombre} · próxima: ${fDate(casaNext(t))}`, true);
}

function openItem(kind, id) {
  if (kind === 'casa') {
    const t = D.casa.find(x => x.id === id); const st = casaStatus(t);
    openActions(`${esc(t.nombre)}<br>${esc(st.text)}`, [{ label: '✓ Hecho hoy', fn: () => hecho(id) }, { label: 'Editar', fn: () => formCasa(id) }]);
  } else if (kind === 'plan') {
    const p = D.plans.find(x => x.id === id); const st = planStatus(p);
    const recs = planRecords(p);
    const items = [{ label: '🔧 Registrar que se ha hecho', fn: () => formMto(p.vehicleId, null, id) }, { label: 'Editar intervalo y última vez', fn: () => formPlan(p.vehicleId, id) }];
    if (recs.length) items.push({ label: `Ver historial (${recs.length})`, fn: () => planHistory(p) });
    openActions(`${esc(p.nombre)} · ${esc(vName(veh(p.vehicleId)))}<br>${esc(st.text)}`, items);
  } else if (kind === 'doc') {
    const d = D.docs.find(x => x.id === id); const st = docStatus(d);
    const items = [];
    if (d.vence) items.push({ label: '🔄 Renovar', fn: () => formRenew(id) });
    items.push({ label: d.vence ? 'Editar' : 'Añadir fecha y datos', fn: () => formDoc(d.vehicleId, d.tipo, id) });
    if (d.telefono) items.push({ label: `📞 Llamar a asistencia (${d.telefono})`, fn: () => location.href = 'tel:' + d.telefono.replace(/\s/g, '') });
    const info = [d.compania, d.poliza ? 'Póliza ' + d.poliza : null].filter(Boolean).map(esc).join(' · ');
    openActions(`${esc(docName(d))}${d.vehicleId ? ' · ' + esc(vName(veh(d.vehicleId))) : ''}${info ? '<br>' + info : ''}<br>${esc(st.text)}`, items);
  }
}
function planHistory(p) {
  const recs = planRecords(p);
  openSheet({ title: p.nombre, submit: 'Cerrar', body: `<div class="card flush" style="margin:0">${recs.map(mtoRow).join('')}</div>`, onSubmit: () => { } });
}


/* ================= Datos de ejemplo ================= */
function loadDemo() {
  const t = todayStr(); const D2 = emptyData();
  const car = { id: uid(), tipo: 'coche', marca: 'Seat', modelo: 'León', matricula: '1234 KLM', anio: '2019', combustible: 'gasolina', km: 87450, kmFecha: t };
  const moto = { id: uid(), tipo: 'moto', marca: 'Honda', modelo: 'PCX 125', matricula: '5678 LBC', anio: '2021', combustible: 'gasolina', km: 14320, kmFecha: addDays(t, -9) };
  D2.vehicles.push(car, moto);
  const done = { 'Aceite y filtro de aceite': [-300, 73900], 'Filtro de aire': [-400, 60200], 'Filtro de habitáculo': [-300, 73900], 'Neumáticos': [-700, 52000], 'Pastillas de freno': [-500, 66000], 'Líquido de frenos': [-690, 55000], 'Batería': [-1300, 30000], 'Revisión general': [-300, 73900] };
  PRESET_PLANS.coche.forEach(([n, k, m]) => { const x = done[n]; D2.plans.push({ id: uid(), vehicleId: car.id, nombre: n, cadaKm: k, cadaMeses: m, ultimaFecha: x ? addDays(t, x[0]) : null, ultimoKm: x ? x[1] : null }); });
  PRESET_PLANS.moto.slice(0, 5).forEach(([n, k, m], i) => D2.plans.push({ id: uid(), vehicleId: moto.id, nombre: n, cadaKm: k, cadaMeses: m, ultimaFecha: addDays(t, -[200, 10, 300, 400, 250][i]), ultimoKm: [9000, 13700, 4000, 6000, 8000][i] }));
  D2.docs.push({ id: uid(), vehicleId: car.id, tipo: 'itv', vence: addDays(t, 9), precio: 45.3 },
    { id: uid(), vehicleId: car.id, tipo: 'seguro', vence: addDays(t, 38), compania: 'Mutua Ejemplo', poliza: 'AB-123456', telefono: '900 000 000', precio: 412 },
    { id: uid(), vehicleId: car.id, tipo: 'impuesto', vence: addDays(t, 150), precio: 98.5 },
    { id: uid(), vehicleId: moto.id, tipo: 'seguro', vence: addDays(t, 210), compania: 'Seguros Ejemplo', precio: 180 },
    { id: uid(), vehicleId: null, tipo: 'carnet', vence: addDays(t, 2100) },
    { id: uid(), vehicleId: null, tipo: 'dni', vence: addDays(t, 60) });
  let km = car.km - 13200; let mk = moto.km - 3800;
  for (let d = -330; d <= -2; d += 11 + Math.floor(Math.random() * 6)) {
    km += 380 + Math.floor(Math.random() * 120); const l = 30 + Math.random() * 6; const pr = 1.55 + Math.random() * .15;
    D2.fuels.push({ id: uid(), vehicleId: car.id, fecha: addDays(t, d), km, litros: +l.toFixed(2), total: +(l * pr).toFixed(2), gasolinera: ['Repsol Av. Libertad', 'Cepsa Polígono', 'Ballenoil'][Math.floor(Math.random() * 3)], lleno: true });
    if (d % 2 === 0) { mk += 280; const ml = 5 + Math.random(); D2.fuels.push({ id: uid(), vehicleId: moto.id, fecha: addDays(t, d + 1), km: mk, litros: +ml.toFixed(2), total: +(ml * 1.62).toFixed(2), gasolinera: 'Repsol Av. Libertad', lleno: true }); }
  }
  for (const v of [car, moto]) { const fs = D2.fuels.filter(f => f.vehicleId === v.id); const shift = v.km - 250 - Math.max(...fs.map(f => f.km)); fs.forEach(f => f.km += shift); }
  const pid = n => D2.plans.find(p => p.vehicleId === car.id && p.nombre === n).id;
  D2.mtos.push({ id: uid(), vehicleId: car.id, planIds: [pid('Aceite y filtro de aceite'), pid('Filtro de habitáculo'), pid('Revisión general')], nombre: 'Aceite y filtro de aceite, Filtro de habitáculo, Revisión general', fecha: addDays(t, -300), km: 73900, taller: 'Talleres García', precio: 189.9, notas: 'Aceite 5W30' },
    { id: uid(), vehicleId: car.id, planIds: [pid('Pastillas de freno')], nombre: 'Pastillas de freno', fecha: addDays(t, -500), km: 66000, taller: 'Talleres García', precio: 95 });
  D2.pagos.push({ id: uid(), vehicleId: car.id, cat: 'seguro', concepto: 'Seguro', importe: 412, fecha: addDays(t, -327) },
    { id: uid(), vehicleId: car.id, cat: 'impuesto', concepto: 'Impuesto de circulación', importe: 98.5, fecha: addDays(t, -215) },
    { id: uid(), vehicleId: car.id, cat: 'otros', concepto: 'Lavado', importe: 12, fecha: addDays(t, -6) },
    { id: uid(), vehicleId: car.id, cat: 'otros', concepto: 'Parking centro', importe: 8.4, fecha: addDays(t, -3) });
  D2.kmlog.push({ id: uid(), vehicleId: car.id, fecha: t, km: car.km }, { id: uid(), vehicleId: moto.id, fecha: moto.kmFecha, km: moto.km });
  [[0, -33], [1, -20], [3, -350], [4, -380], [5, -100], [8, -40]].forEach(([i, d]) => { const s = CASA_SUG[i]; D2.casa.push({ id: uid(), emoji: s[0], nombre: s[1], cada: s[2], unidad: s[3], ultima: addDays(t, d), historial: [addDays(t, d)] }); });
  D2.settings = { demo: true };
  return D2;
}

/* ================= Exportar / importar ================= */
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return true;
}
async function exportFull() {
  const photos = await idb.all('photos');
  const blob = new Blob([JSON.stringify({ app: 'aldia', version: APP_VERSION, exportado: new Date().toISOString(), data: D, photos })], { type: 'application/json' });
  if (await shareOrDownload(blob, `aldia-copia-${todayStr()}.json`)) { D.settings.lastBackup = todayStr(); save(); render(); toast('Copia descargada'); }
}
function importFull() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const j = JSON.parse(await inp.files[0].text());
      if (j.app !== 'aldia' || !j.data) throw new Error('El archivo no es una copia de Al Día');
      const d = j.data;
      if (!confirm(`Copia del ${new Date(j.exportado).toLocaleDateString('es-ES')}: ${d.vehicles?.length || 0} vehículos, ${d.mtos?.length || 0} mantenimientos, ${d.fuels?.length || 0} repostajes, ${d.casa?.length || 0} tareas.\n\nSe reemplazarán los datos actuales. ¿Continuar?`)) return;
      const keep = { ntfyTopic: D.settings.ntfyTopic, ntfyOn: D.settings.ntfyOn };
      D = normalize(d); if (!D.settings.ntfyTopic && keep.ntfyTopic) Object.assign(D.settings, keep);
      await idb.clear('photos'); for (const k in photoCache) delete photoCache[k];
      for (const [k, v] of Object.entries(j.photos || {})) await idb.put('photos', k, v);
      await save(); S.vehicleId = null; render(); toast('Copia importada');
    } catch (e) { alert('No se pudo importar: ' + e.message); }
  };
  inp.click();
}
function exportCsv() {
  const rows = [['Fecha', 'Vehículo', 'Tipo', 'Concepto', 'Km', 'Litros', 'Importe (€)', 'Taller / gasolinera', 'Notas']];
  const vn = id => id ? vName(veh(id)) : 'Personal';
  D.mtos.forEach(m => rows.push([m.fecha, vn(m.vehicleId), 'Mantenimiento', m.nombre, m.km ?? '', '', m.precio ?? '', m.taller || '', m.notas || '']));
  D.fuels.forEach(f => rows.push([f.fecha, vn(f.vehicleId), 'Repostaje', f.lleno === false ? 'Repostaje parcial' : 'Repostaje (lleno)', f.km, f.litros, f.total, f.gasolinera || '', '']));
  D.pagos.forEach(p => rows.push([p.fecha, vn(p.vehicleId), CATS[p.cat]?.n || p.cat, p.concepto || '', '', '', p.importe, '', p.notas || '']));
  D.kmlog.forEach(k => rows.push([k.fecha, vn(k.vehicleId), 'Km', 'Actualización de km', k.km, '', '', '', '']));
  D.casa.forEach(t => (t.historial || []).forEach(h => rows.push([h, 'Casa', 'Tarea de casa', t.nombre, '', '', '', '', ''])));
  const head = rows.shift(); rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const cell = v => { if (typeof v === 'number') v = String(v).replace('.', ','); v = String(v ?? ''); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  shareOrDownload(new Blob([csv], { type: 'text/csv' }), `aldia-registros-${todayStr()}.csv`);
}

/* ================= Avisos (ntfy) ================= */
async function ntfyPost(body) {
  const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: D.settings.ntfyTopic, ...body }) });
  if (!r.ok) throw new Error('ntfy respondió ' + r.status);
}
function ntfyMessage(ref) {
  const it = upcoming(ref).filter(i => i.st.level === 'red');
  if (!it.length) return null;
  return { title: it.length === 1 ? `Al Día: ${it[0].title}` : `Al Día: ${it.length} cosas pendientes`, message: it.slice(0, 8).map(i => `• ${i.title} (${i.sub}): ${i.st.short || i.st.text}`).join('\n') + (it.length > 8 ? `\n…y ${it.length - 8} más` : '') };
}
async function ntfySchedule() {
  const s = D.settings; if (!s.ntfyOn || !s.ntfyTopic || !navigator.onLine) return;
  let sent = {}; try { sent = JSON.parse(localStorage.getItem('aldia-ntfy') || '{}'); } catch { }
  const now = Date.now(); const t = todayStr();
  for (let d = 0; d <= 3; d++) {
    const day = addDays(t, d); if (sent[day]) continue;
    const at = toDate(day); at.setHours(9, 0, 0, 0);
    if (at.getTime() < now + 60000) continue;
    const msg = ntfyMessage(day); if (!msg) continue;
    try { await ntfyPost({ ...msg, tags: ['wrench'], delay: String(Math.floor(at.getTime() / 1000)) }); sent[day] = 1; } catch (e) { console.warn(e); break; }
  }
  for (const k in sent) if (k < t) delete sent[k];
  try { localStorage.setItem('aldia-ntfy', JSON.stringify(sent)); } catch { }
}

/* ================= Acciones ================= */
const A = {
  tab: d => { S.tab = d.tab; S.vehicleId = null; closeSheet(); render(); scrollTo(0, 0); },
  closeSheet: () => closeSheet(),
  sheetAct: d => { const it = sheetActions?.[+d.i]; closeSheet(); if (it) setTimeout(it.fn, 260); },
  undo: () => undo(),
  closeViewer: () => $('#viewer').classList.remove('open'),
  item: d => openItem(d.kind, d.id),
  hecho: d => hecho(d.id),
  toggleAll: () => { S.showAll = !S.showAll; render(); },
  filter: d => { S.filter = d.id; render(); },
  period: d => { S.period = d.p; render(); },
  hfilter: d => { S.hfilter = d.f; render(); },
  mbar: (d, el) => {
    const ch = document.getElementById(d.chart); $$('.col', ch).forEach(c => c.classList.toggle('sel', c === el));
    const [y, m] = d.k.split('-'); $('.chart-cap', ch).innerHTML = `${MESES_L[+m - 1].replace(/^./, c => c.toUpperCase())} ${y}: <b>${fEur(+d.t)}</b>`;
  },
  km: d => formKm(d.id),
  editKm: d => formEditKm(d.id),
  delKm: d => { if (!confirm('¿Eliminar este registro de km?')) return; D.kmlog = D.kmlog.filter(k => k.id !== d.id); save(); closeSheet(); render(); },
  addVehicle: () => formVehicle(),
  editVehicle: d => formVehicle(d.id),
  openVehicle: d => { S.vehicleId = d.id; S.vtab = 'mto'; S.hfilter = 'all'; render(); scrollTo(0, 0); },
  backVehicles: () => { S.vehicleId = null; render(); },
  vtab: d => { S.vtab = d.t; render(); },
  delVehicle: async d => {
    const v = veh(d.id); if (!confirm(`¿Eliminar ${vName(v)} y todos sus registros (mantenimientos, repostajes, gastos y papeles)? No se puede deshacer.`)) return;
    const photos = [v.fotoId, ...D.mtos.filter(m => m.vehicleId === d.id).map(m => m.fotoId)].filter(Boolean);
    for (const p of photos) await delPhoto(p);
    D.vehicles = D.vehicles.filter(x => x.id !== d.id);
    for (const k of ['plans', 'mtos', 'fuels', 'pagos', 'docs', 'kmlog']) D[k] = D[k].filter(x => x.vehicleId !== d.id);
    S.vehicleId = null; save(); closeSheet(); render(); toast('Vehículo eliminado');
  },
  addPlan: d => formPlan(d.v),
  delPlan: d => { if (!confirm('¿Eliminar este tipo de mantenimiento? Los registros ya hechos se conservan.')) return; D.plans = D.plans.filter(p => p.id !== d.id); save(); closeSheet(); render(); },
  addMto: d => formMto(d.v),
  editMto: d => formMto(null, d.id),
  delMto: async d => { if (!confirm('¿Eliminar este mantenimiento?')) return; const m = D.mtos.find(x => x.id === d.id); await delPhoto(m.fotoId); D.mtos = D.mtos.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  addFuel: d => formFuel(d.v),
  editFuel: d => formFuel(null, d.id),
  delFuel: d => { if (!confirm('¿Eliminar este repostaje?')) return; D.fuels = D.fuels.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  addPago: d => formPago(d.v),
  editPago: d => formPago(null, d.id),
  delPago: d => { if (!confirm('¿Eliminar este gasto?')) return; D.pagos = D.pagos.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  addDoc: d => formDoc(d.v || null, d.t),
  delDoc: d => { if (!confirm('¿Eliminar este documento?')) return; D.docs = D.docs.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  addCasa: () => formCasa(),
  addSug: d => formCasa(null, CASA_SUG[+d.i]),
  delCasa: d => { if (!confirm('¿Eliminar esta tarea?')) return; D.casa = D.casa.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  demo: () => { D = loadDemo(); save(); render(); toast('Datos de ejemplo cargados'); },
  wipeDemo: async () => { if (!confirm('¿Borrar los datos de ejemplo y empezar de cero?')) return; D = emptyData(); await idb.clear('photos'); await save(); render(); },
  exportFull: () => exportFull(),
  importFull: () => importFull(),
  exportCsv: () => exportCsv(),
  ntfyOn: () => {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; let t = 'aldia-';
    crypto.getRandomValues(new Uint8Array(12)).forEach(b => t += abc[b % abc.length]);
    D.settings.ntfyTopic = D.settings.ntfyTopic || t; D.settings.ntfyOn = true; save(); render(); ntfySchedule();
  },
  ntfyOff: () => { D.settings.ntfyOn = false; save(); render(); },
  ntfyTest: async () => {
    try { await ntfyPost({ title: 'Al Día', message: 'Aviso de prueba: ¡funciona! 👍', tags: ['white_check_mark'] }); toast('Aviso enviado'); }
    catch (e) { toast('No se pudo enviar: ' + e.message); }
  },
  wipe: async () => {
    if (!confirm('¿Borrar TODOS los datos de la app? Descarga antes una copia si la quieres conservar.')) return;
    if (!confirm('¿Seguro? No se puede deshacer.')) return;
    D = emptyData(); await idb.clear('photos'); await save(); S.vehicleId = null; S.tab = 'inicio'; render();
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  e.preventDefault(); fn(el.dataset, el, e);
});
document.addEventListener('click', e => {
  const th = e.target.closest('.thumb[data-foto], .hero .img[data-foto]'); if (!th) return;
  e.stopPropagation(); e.preventDefault();
  getPhoto(th.dataset.foto).then(p => { if (!p) return; const v = $('#viewer'); v.innerHTML = `<img src="${p}">`; v.classList.add('open'); });
}, true);

/* ================= Inicio ================= */
(async function init() {
  try {
    await idb.open();
    const d = await idb.get('kv', 'data'); if (d) D = normalize(d);
  } catch (e) { $('#main').innerHTML = `<div class="card empty" style="margin-top:40px"><b>No se puede guardar</b>${esc(e.message)}</div>`; return; }
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  ntfySchedule();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); ntfySchedule(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
