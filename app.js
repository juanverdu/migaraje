'use strict';
/* Mi Garaje — vehículos, papeles y mantenimientos.
   Todos los datos se guardan solo en este dispositivo (IndexedDB). */

const APP_VERSION = '1.4.0';

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

const emptyData = () => ({ schema: 1, vehicles: [], docs: [], plans: [], mtos: [], fuels: [], pagos: [], casa: [], kmlog: [], garantias: [], guantera: [], settings: {} });
let D = emptyData();
function normalize(d) { const e = emptyData(); for (const k in e) if (d[k] == null) d[k] = e[k]; d.casa = d.casa.filter(t => t.vehicleId); return d; }
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
const EMOJIS = ['🏠', '🛞', '🛢️', '🚗', '📺', '🧾', '🧺', '🧼', '🍽️', '🔥', '♨️', '🌬️', '💧', '🍳', '☕', '🧊', '🚨', '🛏️', '🪴', '🧹', '🔌', '💡', '🐾', '🪪', '📄', '🦷', '💊', '🔑', '🛠️'];
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


/* ---- ITV según antigüedad (turismos: 4 años, luego cada 2; desde 10 años, anual) ---- */
function itvMonths(v, at) {
  if (!v?.matriculacion) return 12;
  const age = daysBetween(v.matriculacion, at) / 365.25;
  if (v.tipo === 'moto') return 24;
  if (v.tipo === 'furgo') return age < 6 ? 24 : age < 10 ? 12 : 6;
  return age < 10 ? 24 : 12;
}
function itvNext(v) {
  if (!v?.matriculacion) return null;
  let d = addMonths(v.matriculacion, v.tipo === 'furgo' ? 24 : 48); const t = todayStr(); let n = 0;
  while (d < t && n++ < 200) d = addMonths(d, itvMonths(v, d));
  return d;
}

/* ---- Garantías ---- */
const garEnd = g => g.fecha ? addMonths(g.fecha, Math.round((g.anios || 3) * 12)) : null;
function garStatus(g, ref = todayStr()) {
  const end = garEnd(g);
  if (!end) return { level: 'none', days: 1e9, text: 'Añade la fecha de compra', short: 'Sin fecha' };
  const days = daysBetween(ref, end);
  if (days < 0) return { level: 'none', expired: true, days: 1e9, text: `Garantía terminada el ${fDate(end)}`, short: 'Terminada' };
  const level = days <= 15 ? 'red' : days <= 60 ? 'yellow' : 'green';
  return { level, days, text: `Garantía hasta el ${fDate(end)} · ${dueText(days).toLowerCase()}`, short: dueText(days), end };
}

/* ---- Revisiones rápidas del vehículo ---- */
const VCHECKS = [['🛞', 'Presión de neumáticos', 1, 'm'], ['🛢️', 'Niveles: aceite, refrigerante y limpiaparabrisas', 1, 'm'], ['💡', 'Comprobar luces', 3, 'm']];
function addChecks(v, data = D) {
  VCHECKS.forEach(([e, n, c, u]) => { if (!data.casa.some(t => t.vehicleId === v.id && t.nombre === n)) data.casa.push({ id: uid(), vehicleId: v.id, emoji: e, nombre: n, cada: c, unidad: u, ultima: null, historial: [] }); });
}

/* ---- Calendario del iPhone (.ics) ---- */
function evDoc(d) {
  if (!d.vence) return null; const v = veh(d.vehicleId);
  return { uid: d.id + '-' + d.vence, date: d.vence, title: `${DOC_TYPES[d.tipo].e} ${docName(d)}${v ? ' · ' + vName(v) : ''}: caduca`,
    desc: [d.compania, d.poliza ? 'Póliza ' + d.poliza : '', d.telefono ? 'Asistencia ' + d.telefono : ''].filter(Boolean).join(' · '),
    alarms: DOC_TYPES[d.tipo].personal ? [60, 15] : [30, 7] };
}
function evPlan(p) {
  const st = planStatus(p); if (st.level === 'none') return null;
  let date = st.nextDate;
  if (st.kmLeft != null && st.rate) { const e = addDays(todayStr(), Math.max(0, Math.floor(st.kmLeft / st.rate))); if (!date || e < date) date = e; }
  if (!date) return null; if (date < todayStr()) date = todayStr();
  return { uid: p.id + '-' + date, date, title: `🔧 ${p.nombre} · ${vName(veh(p.vehicleId))}`, desc: st.text + (st.nextKm ? ` · toca a los ${fKm(st.nextKm)}` : ''), alarms: [7] };
}
function evCasa(t) {
  const n = casaNext(t); if (!n) return null; const date = n < todayStr() ? todayStr() : n;
  return { uid: t.id + '-' + date, date, title: `${t.emoji || '🏠'} ${t.nombre}${t.vehicleId ? ' · ' + vName(veh(t.vehicleId)) : ''}`, desc: freqText(t), alarms: [0] };
}
function evGar(g) {
  const e = garEnd(g); if (!e || e < todayStr()) return null;
  return { uid: g.id + '-' + e, date: e, title: `🧾 Fin de la garantía: ${g.nombre}`, desc: [g.tienda, g.fecha ? 'Comprado el ' + fDate(g.fecha) : ''].filter(Boolean).join(' · '), alarms: [30] };
}
function icsText(evs) {
  const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const ymd = s => s.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi Garaje//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mi Garaje'];
  for (const v of evs) {
    L.push('BEGIN:VEVENT', `UID:${v.uid}@migaraje`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(v.date)}`, `DTEND;VALUE=DATE:${ymd(addDays(v.date, 1))}`, `SUMMARY:${e(v.title)}`);
    if (v.desc) L.push(`DESCRIPTION:${e(v.desc)}`);
    L.push('TRANSP:TRANSPARENT');
    for (const n of v.alarms) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(v.title)}`, n > 0 ? `TRIGGER:-P${n - 1}DT15H` : 'TRIGGER:PT9H', 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
}
function addToCalendar(evs) {
  evs = evs.filter(Boolean);
  if (!evs.length) { toast('No hay fechas que añadir'); return; }
  const blob = new Blob([icsText(evs)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = evs.length === 1 ? 'migaraje-aviso.ics' : 'migaraje-calendario.ics';
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast(evs.length === 1 ? 'Abriendo el Calendario…' : `${evs.length} fechas para el Calendario`);
}

function upcoming(ref = todayStr()) {
  const it = [];
  D.docs.forEach(d => { const v = veh(d.vehicleId); it.push({ kind: 'doc', id: d.id, e: DOC_TYPES[d.tipo].e, title: docName(d), sub: d.vehicleId ? vName(v) : 'Personal', st: docStatus(d, ref) }); });
  D.plans.forEach(p => { const v = veh(p.vehicleId); if (!v) return; it.push({ kind: 'plan', id: p.id, e: planEmoji(p.nombre), title: p.nombre, sub: vName(v), st: planStatus(p, ref) }); });
  D.casa.forEach(t => { if (t.vehicleId && !veh(t.vehicleId)) return; it.push({ kind: 'casa', id: t.id, e: t.emoji || '🏠', title: t.nombre, sub: t.vehicleId ? vName(veh(t.vehicleId)) : 'Casa', st: casaStatus(t, ref) }); });
  D.garantias.forEach(g => { const st = garStatus(g, ref); if (!st.expired) it.push({ kind: 'gar', id: g.id, e: '🧾', title: 'Garantía: ' + g.nombre, sub: g.tienda || 'Personal', st }); });
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
  const fs = D.fuels.filter(f => f.vehicleId === vId && f.km && f.litros).sort((a, b) => a.km - b.km || a.fecha.localeCompare(b.fecha));
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
const XICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let lpDel = null;

let sheetSubmit = null, sheetActions = null;
function openSheet({ title, body, submit = 'Guardar', onSubmit, onRender }) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-a="closeSheet"></div><form class="sheet" novalidate autocomplete="off">
    <div class="grab"></div><div class="sheet-head"><span class="hl"><button type="button" class="xbtn" data-a="closeSheet" aria-label="Cerrar">${XICON}</button></span><h3>${esc(title)}</h3><button type="submit" class="link strong">${submit}</button></div>
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
  if (lpDel) { const { kind, id } = lpDel; lpDel = null; items = [...items, { label: 'Borrar', danger: true, fn: () => removeItem(kind, id) }]; }
  root.innerHTML = `<div class="backdrop" data-a="closeSheet"></div><div class="sheet"><div class="grab"></div>
    <div class="sheet-head"><span class="hl"><button type="button" class="xbtn" data-a="closeSheet" aria-label="Cerrar">${XICON}</button></span><div class="ttl">${title || ''}</div><span class="hl"></span></div>
    <div class="actions"><div class="group">${items.map((it, i) => `<button type="button" data-a="sheetAct" data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')}</div></div></div>`;
  sheetActions = items;
  requestAnimationFrame(() => root.classList.add('open'));
}
function closeSheet() {
  const root = $('#sheet-root'); const sh = $('.sheet', root); if (sh) { sh.style.transition = ''; sh.style.transform = ''; }
  root.classList.remove('open');
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


function lineChart(pts, o) {
  const W = 340, H = 130, T = 14, B = 18, L = 6, R = 6;
  const ys = pts.map(p => p.y); let mn = Math.min(...ys), mx = Math.max(...ys);
  if (o.avg != null) { mn = Math.min(mn, o.avg); mx = Math.max(mx, o.avg); }
  const pd = (mx - mn) * .15 || mx * .05 || 1; mn -= pd; mx += pd;
  const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  let g = `<path d="${path}L${x(pts.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z" fill="${o.color}" opacity=".12"/>`;
  if (o.avg != null) g += `<line class="grid" x1="0" x2="${W}" y1="${y(o.avg)}" y2="${y(o.avg)}"/><text x="${W}" y="${y(o.avg) - 4}" text-anchor="end">media ${o.fmt(o.avg)}</text>`;
  g += `<path d="${path}" fill="none" stroke="${o.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (pts.length <= 40) g += pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="2.6" fill="${o.color}"/>`).join('');
  const last = pts[pts.length - 1];
  g += `<text x="${L}" y="${H - 4}">${fDate(pts[0].d)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${fDate(last.d)}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${g}</svg><div class="chart-cap">Último: <b>${o.fmt(last.y)} ${o.unit}</b> · mín. ${o.fmt(Math.min(...ys))} · máx. ${o.fmt(Math.max(...ys))}</div></div>`;
}
function fuelCharts(v, fs) {
  const cons = fs.list.filter(f => fs.per[f.id]).map(f => ({ d: f.fecha, y: fs.per[f.id] }));
  const price = [...fs.list].sort((a, b) => a.fecha.localeCompare(b.fecha)).filter(f => f.litros && f.total).map(f => ({ d: f.fecha, y: f.total / f.litros }));
  let h = '';
  if (cons.length >= 5) {
    const last = cons.slice(-3), prev = cons.slice(0, -3);
    const a1 = last.reduce((s, p) => s + p.y, 0) / last.length, a0 = prev.reduce((s, p) => s + p.y, 0) / prev.length;
    const diff = (a1 - a0) / a0 * 100;
    if (diff > 8) h += `<div class="banner"><div><b>Tu consumo ha subido un ${fNum(diff, 0)}%</b>Últimos 3 depósitos: ${fNum(a1, 1)} L/100 km, frente a tu media de ${fNum(a0, 1)}. Si conduces igual que siempre, revisa la presión de los neumáticos y el filtro de aire.</div></div>`;
  }
  if (cons.length >= 2) h += `<div class="card"><div style="font-weight:700;margin-bottom:8px">Consumo por depósito (L/100 km)</div>${lineChart(cons, { fmt: y => fNum(y, 1), unit: 'L/100 km', color: 'var(--c2)', avg: fs.avg })}</div>`;
  if (price.length >= 2) h += `<div class="card"><div style="font-weight:700;margin-bottom:8px">Precio del litro</div>${lineChart(price, { fmt: y => fNum(y, 3), unit: '€/L', color: 'var(--c1)' })}</div>`;
  return h;
}

/* ================= Vistas ================= */
function render() {
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const v = { inicio: vInicio, vehiculos: S.vehicleId ? vVehiculo : vVehiculos, casa: vCasa, ajustes: vAjustes }[S.tab];
  $('#main').innerHTML = v();
  openRow = null; enhanceRows($('#main'));
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
  let h = `<header class="hdr"><div class="top"><div><h1>Mi Garaje</h1><div class="sub">${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase())}</div></div></div></header>`;
  if (!D.vehicles.length && !D.casa.length && !D.docs.length) {
    return h + `<div class="card empty"><div class="big">👋</div><b>Empieza aquí</b>Añade tu vehículo y sus papeles. La app te avisará de lo que toca, por colores.</div>
      <div class="btns"><button class="btn" data-a="addVehicle">🚗 Añadir vehículo</button></div>
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

  const stale = D.vehicles.filter(v => !v.kmFecha || daysBetween(v.kmFecha, todayStr()) > 14);
  if (stale.length) { const v = stale[0]; h += `<div class="banner"><div style="flex:1"><b>Actualiza los km · ${esc(vName(v))}</b>Hace ${spanText(daysBetween(v.kmFecha || todayStr(), todayStr()))} que no los pones. Así los avisos por km son más exactos.</div><button class="btn" data-a="km" data-id="${v.id}">Poner km</button></div>`; }
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
  let h = `<header class="hdr"><div class="top"><h1>Vehículos</h1><button class="iconbtn" data-a="addVehicle" aria-label="Añadir vehículo">+</button></div></header>`;
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
  let h = `<header class="hdr"><div class="navbar"><button class="back" data-a="backVehicles">${BACK}Vehículos</button><b class="navttl">${esc(vName(v))}</b><button class="link navr" data-a="editVehicle" data-id="${v.id}">Editar</button></div></header>`;
  h += `<div class="hero"><div class="img" ${v.fotoId ? `data-foto="${v.fotoId}"` : ''}>${vEmoji(v)}</div><div class="info">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div style="min-width:0"><h3>${esc(vName(v))}</h3>
    <div style="margin-top:6px">${v.matricula ? `<span class="plate"><span>${esc(v.matricula)}</span></span>` : ''}</div></div></div>
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
  const qc = D.casa.filter(t => t.vehicleId === v.id).map(t => ({ t, st: casaStatus(t) })).sort((a, b) => a.st.days - b.st.days);
  h += `<h2 class="sec">Revisiones rápidas</h2>`;
  h += qc.length ? `<div class="card flush">${qc.map(({ t, st }) => casaRow(t, st)).join('')}</div>` : `<div class="card empty">Comprobaciones que haces tú: presión de neumáticos, niveles, luces…</div>`;
  h += `<div class="btns">${qc.length ? '' : `<button class="btn ghost" data-a="addChecks" data-v="${v.id}">+ Añadir las habituales</button>`}<button class="btn ghost" data-a="addCheck" data-v="${v.id}">+ Nueva revisión</button></div>`;
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
  return `<div class="btns"><button class="btn danger" data-a="accident" data-v="${v.id}">🚨 He tenido un accidente</button></div>` + vtDocs0(v) + glovebox(v);
}
const GLOVE = ['Permiso de circulación', 'Ficha técnica', 'Póliza del seguro', 'Carta verde', 'Tarjeta ITV'];
function glovebox(v) {
  const items = D.guantera.filter(g => g.vehicleId === v.id);
  const missing = GLOVE.filter(n => !items.some(g => g.nombre === n));
  return `<h2 class="sec">Guantera</h2><div class="note">Fotos de los papeles del vehículo, a mano aunque no tengas conexión.</div>
    <div class="glove">${items.map(g => `<button class="gtile" data-a="gloveOpen" data-id="${g.id}"><div class="gimg" data-foto="${g.fotoId}"></div><span>${esc(g.nombre)}</span></button>`).join('')}
    ${missing.map(n => `<button class="gtile add" data-a="gloveAdd" data-v="${v.id}" data-n="${esc(n)}"><div class="gimg">＋</div><span>${esc(n)}</span></button>`).join('')}
    <button class="gtile add" data-a="gloveAdd" data-v="${v.id}" data-n=""><div class="gimg">＋</div><span>Otro</span></button></div>`;
}
function vtDocs0(v) {
  const ds = D.docs.filter(d => d.vehicleId === v.id).sort((a, b) => docStatus(a).days - docStatus(b).days);
  let h = ds.length ? `<div class="card flush">${ds.map(docRow).join('')}</div>` : `<div class="card empty">Sin documentos.</div>`;
  const missing = ['itv', 'seguro', 'impuesto'].filter(t => !ds.some(d => d.tipo === t));
  h += `<div class="btns">${missing.map(t => `<button class="btn ghost" data-a="addDoc" data-v="${v.id}" data-t="${t}">+ ${DOC_TYPES[t].n.split(' ')[0]}</button>`).join('')}<button class="btn ghost" data-a="addDoc" data-v="${v.id}" data-t="otro">+ Otro</button></div>`;
  h += `<div class="note">🟢 más de 45 días · 🟡 menos de 45 días · 🔴 menos de 15 días o caducado. El carnet de conducir está en la pestaña Personal.</div>`;
  return h;
}

function vtFuel(v) {
  const fs = fuelStats(v.id);
  const list = D.fuels.filter(f => f.vehicleId === v.id);
  let h = `<div class="btns"><button class="btn" data-a="addFuel" data-v="${v.id}">⛽ Añadir repostaje</button></div>`
    + `<div class="btns"><button class="btn ghost" data-a="bankImport">🏦 Importar cobros del banco</button></div>`;
  if (!list.length) return h + `<div class="card empty"><div class="big">⛽</div><b>Sin repostajes</b>Apunta cada repostaje con los km del cuentakilómetros. A partir del segundo depósito lleno verás el consumo real.</div>`;
  const ym = todayStr().slice(0, 7);
  const mes = sum(list.filter(f => f.fecha.startsWith(ym)), f => f.total);
  const cut = addDays(todayStr(), -365); const yr = list.filter(f => f.fecha > cut);
  const first = yr.map(f => f.fecha).sort()[0];
  const months = first ? Math.min(12, Math.max(1, Math.round(daysBetween(first, todayStr()) / 30.44) + 1)) : 1;
  const withL = list.filter(f => f.litros); const litros = sum(withL, f => f.litros), totalL = sum(withL, f => f.total), total = sum(list, f => f.total);
  h += `<div class="stats">
    <div class="stat"><div class="l">Consumo real</div><div class="v">${fs.avg ? fNum(fs.avg, 1) + ' <small>L/100</small>' : '—'}</div><div class="d">${fs.km ? `en ${fKm(fs.km)}` : 'Necesita 2 llenos'}</div></div>
    <div class="stat"><div class="l">Coste por km</div><div class="v">${fs.costKm ? fNum(fs.costKm * 100, 1) + ' <small>cént.</small>' : '—'}</div><div class="d">${fs.costKm ? fEur(fs.costKm * 100) + ' cada 100 km' : 'Solo combustible'}</div></div>
    <div class="stat"><div class="l">Este mes</div><div class="v">${fEur0(mes)}</div><div class="d">en combustible</div></div>
    <div class="stat"><div class="l">Media mensual</div><div class="v">${fEur0(sum(yr, f => f.total) / months)}</div><div class="d">últimos ${months} ${months === 1 ? 'mes' : 'meses'}</div></div></div>`;
  h += `<div class="card"><div style="font-weight:700;margin-bottom:8px">Gasto en combustible</div>${monthChart(expenses(v.id).filter(e => e.cat === 'combustible'))}
    <div class="muted small" style="margin-top:8px">Total: ${fNum(litros, 0)} L · ${fEur(total)} · precio medio ${litros ? fEur(totalL / litros, 3) : '—'}/L</div></div>`;
  h += fuelCharts(v, fs);
  const sorted = [...list].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.km || 0) - (a.km || 0));
  h += `<h2 class="sec">Repostajes</h2><div class="card flush">${sorted.map(f => `<button class="row" data-a="editFuel" data-id="${f.id}"><div class="ico">⛽</div>
    <div class="txt"><div class="t">${f.litros ? `${fNum(f.litros, 2)} L · ${fEur(f.total / f.litros, 3)}/L` : (f.banco ? 'Cobro del banco 🏦' : 'Repostaje')}</div><div class="s">${fDate(f.fecha)}${f.km ? ' · ' + fKm(f.km) : ''}${f.gasolinera ? ' · ' + esc(f.gasolinera) : ''}${f.lleno === false ? ' · parcial' : ''}${!f.litros || !f.km ? ' · <span class="link">añadir litros y km</span>' : ''}</div></div>
    <div class="end"><div style="font-weight:650">${fEur(f.total)}</div>${fs.per[f.id] ? `<div class="s muted">${fNum(fs.per[f.id], 1)} L/100</div>` : ''}</div></button>`).join('')}</div>`;
  return h;
}

function histEvents(vId) {
  const ev = [];
  D.mtos.filter(m => m.vehicleId === vId).forEach(m => ev.push({ t: 'mto', fecha: m.fecha, km: m.km, html: mtoRow(m) }));
  D.fuels.filter(f => f.vehicleId === vId).forEach(f => ev.push({ t: 'fuel', fecha: f.fecha, km: f.km, html: `<button class="row" data-a="editFuel" data-id="${f.id}"><div class="ico">⛽</div><div class="txt"><div class="t">Repostaje${f.litros ? ' · ' + fNum(f.litros, 1) + ' L' : f.banco ? ' 🏦' : ''}</div><div class="s">${fDate(f.fecha)}${f.km ? ' · ' + fKm(f.km) : ''}${f.gasolinera ? ' · ' + esc(f.gasolinera) : ''}</div></div><div class="end">${fEur(f.total)}</div></button>` }));
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

function casaRow(t, st) {
  return `<div class="row lvl-${st.level}"><div class="ico">${t.emoji || '🏠'}</div>
      <button class="txt" style="text-align:left" data-a="item" data-kind="casa" data-id="${t.id}"><div class="t">${esc(t.nombre)}</div>
      <div class="s"><span class="st ${st.level}">${esc(st.text)}</span></div><div class="s small">${freqText(t)}${t.ultima ? ' · Última: ' + fDate(t.ultima) : ''}</div></button>
      <button class="done-btn" data-a="hecho" data-id="${t.id}">✓ Hecho</button></div>`;
}
function vCasa() {
  let h = `<header class="hdr"><div class="top"><h1>Personal</h1></div></header>`;
  const pd = D.docs.filter(d => !d.vehicleId).sort((a, b) => docStatus(a).days - docStatus(b).days);
  h += `<h2 class="sec" style="margin-top:4px">Documentos personales</h2>`;
  h += pd.length ? `<div class="card flush">${pd.map(docRow).join('')}</div>` : `<div class="card empty">Apunta cuándo caducan tu DNI, pasaporte y carnet de conducir.</div>`;
  const miss = ['carnet', 'dni', 'pasaporte'].filter(t => !pd.some(d => d.tipo === t));
  h += `<div class="btns" style="flex-wrap:wrap">${miss.map(t => `<button class="btn ghost" data-a="addDoc" data-v="" data-t="${t}">+ ${t === 'carnet' ? 'Carnet' : DOC_TYPES[t].n}</button>`).join('')}<button class="btn ghost" data-a="addDoc" data-v="" data-t="otro">+ Otro</button></div>`;
  const gs = D.garantias.map(g => ({ g, st: garStatus(g) })).sort((a, b) => (!!a.st.expired - !!b.st.expired) || a.st.days - b.st.days);
  h += `<h2 class="sec">Garantías</h2>`;
  h += gs.length ? `<div class="card flush">${gs.map(({ g, st }) => `<button class="row lvl-${st.level}" data-a="item" data-kind="gar" data-id="${g.id}" ${st.expired ? 'style="opacity:.55"' : ''}><div class="ico">🧾</div>
    <div class="txt"><div class="t">${esc(g.nombre)}</div><div class="s">${g.tienda ? esc(g.tienda) + ' · ' : ''}<span class="st ${st.level}">${esc(st.text)}</span></div></div>
    ${g.fotoId ? `<div class="thumb" data-foto="${g.fotoId}"></div>` : ''}${CHEV}</button>`).join('')}</div>` : `<div class="card empty">Guarda la factura de tus electrodomésticos y aparatos para saber hasta cuándo tienen garantía.</div>`;
  h += `<div class="btns"><button class="btn ghost" data-a="addGar">+ Añadir garantía</button></div>`;
  return h;
}

function vAjustes() {
  const s = D.settings;
  let h = `<header class="hdr"><div class="top"><h1>Ajustes</h1></div></header>`;
  h += `<h2 class="sec" style="margin-top:4px">Copia de seguridad</h2><div class="card">
    <p style="margin:0 0 12px" class="muted small">Tus datos solo están en este iPhone. Descarga una copia cada semana o cada dos y guárdala en iCloud Drive (Archivos).${s.lastBackup ? ` Última copia: <b>${fDateRel(s.lastBackup)}</b>.` : ''}</p>
    <button class="btn" data-a="exportFull">Descargar copia completa</button>
    <button class="btn sec" style="margin-top:10px" data-a="importFull">Importar copia</button></div>`;
  h += `<h2 class="sec">Calendario del iPhone</h2><div class="card">
    <p style="margin:0 0 12px" class="muted small">Añade las fechas importantes a tu Calendario, con aviso unos días antes. Son avisos del propio iPhone: llegan aunque no abras la app.</p>
    <button class="btn" data-a="calAll">📅 Añadir fechas al Calendario</button></div>`;
  h += `<h2 class="sec">Gasolina del banco</h2><div class="card">
    <p style="margin:0 0 12px" class="muted small">Importa los cobros de Repsol (u otra gasolinera) desde el Excel de movimientos de Santander. ${D.vehicles.length > 1 ? `Los de más de ${fEur0(bankRule().limit)} van al ${esc(vName(veh(bankRule().big)))} y el resto al ${esc(vName(veh(bankRule().small)))}.` : ''}</p>
    <button class="btn" data-a="bankImport">🏦 Importar cobros del banco</button></div>`;
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
  h += `<h2 class="sec">Datos</h2><div class="card"><div class="muted small" style="margin-bottom:12px">${D.vehicles.length} vehículos · ${D.mtos.length} mantenimientos · ${D.fuels.length} repostajes · ${D.pagos.length} gastos · ${D.casa.length} revisiones · ${D.docs.length} documentos · ${D.garantias.length} garantías</div>
    <button class="btn danger" data-a="wipe">Borrar todos los datos</button></div>`;
  h += `<div class="version">Mi Garaje · versión ${APP_VERSION}</div>`;
  return h;
}

/* ================= Formularios ================= */
function formVehicle(id) {
  const v = id ? veh(id) : { tipo: 'coche', combustible: 'gasolina' };
  let body = F.select('tipo', 'Tipo', Object.entries(VTYPES).map(([k, x]) => [k, `${x[1]} ${x[0]}`]), v.tipo)
    + F.row(F.text('marca', 'Marca', v.marca, 'placeholder="Seat" autocapitalize="words"'), F.text('modelo', 'Modelo', v.modelo, 'placeholder="León"'))
    + F.row(F.text('matricula', 'Matrícula', v.matricula, 'placeholder="1234 ABC" autocapitalize="characters"'), F.text('anio', 'Año', v.anio, 'inputmode="numeric" placeholder="2019"'))
    + F.row(F.km('km', 'Km actuales', v.km), F.select('combustible', 'Combustible', FUELS, v.combustible))
    + F.date('matriculacion', 'Fecha de matriculación', v.matriculacion) + F.hint('Está en el permiso de circulación. Sirve para calcular cuándo toca la ITV.')
    + F.photo('foto', 'Foto', v.fotoId);
  if (id) body += `<button type="button" class="btn danger" data-a="delVehicle" data-id="${id}" style="margin-top:8px">Eliminar vehículo</button>`;
  else body += F.check('presetPlans', 'Añadir mantenimientos recomendados', true) + F.check('presetDocs', 'Añadir ITV, seguro e impuesto', true) + F.check('presetChecks', 'Añadir revisiones rápidas (presión, niveles, luces)', true)
    + F.hint('Después podrás indicar cuándo se hizo cada cosa por última vez y ajustar los intervalos.');
  openSheet({
    body, title: id ? 'Editar vehículo' : 'Nuevo vehículo', submit: id ? 'Guardar' : 'Añadir',
    onSubmit: async (fd, form) => {
      if (!fd.marca && !fd.modelo && !fd.matricula) { toast('Escribe al menos la marca, el modelo o la matrícula'); return false; }
      const km = intKm(fd.km) ?? 0;
      const o = id ? v : { id: uid(), creado: todayStr() };
      Object.assign(o, { tipo: fd.tipo, marca: fd.marca, modelo: fd.modelo, matricula: fd.matricula.toUpperCase(), anio: fd.anio || (fd.matriculacion ? fd.matriculacion.slice(0, 4) : ''), combustible: fd.combustible, matriculacion: fd.matriculacion || null });
      o.fotoId = await takePhoto(form, 'foto', o.fotoId);
      if (!id) {
        o.km = km; o.kmFecha = todayStr(); D.vehicles.push(o);
        D.kmlog.push({ id: uid(), vehicleId: o.id, fecha: todayStr(), km });
        if (fd.presetPlans) (PRESET_PLANS[o.tipo] || PRESET_PLANS.coche).forEach(([n, k, m]) => D.plans.push({ id: uid(), vehicleId: o.id, nombre: n, cadaKm: k, cadaMeses: m, ultimaFecha: null, ultimoKm: null }));
        if (fd.presetDocs) ['itv', 'seguro', 'impuesto'].forEach(t => D.docs.push({ id: uid(), vehicleId: o.id, tipo: t, vence: t === 'itv' ? itvNext(o) : null }));
        if (fd.presetChecks) addChecks(o);
        S.tab = 'vehiculos'; S.vehicleId = o.id; S.vtab = 'mto';
      } else {
        if (km !== v.km) setKm(o, km, todayStr(), true);
        const itv = D.docs.find(x => x.vehicleId === o.id && x.tipo === 'itv' && !x.vence); if (itv && o.matriculacion) itv.vence = itvNext(o);
      }
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
      if (!total) { toast('Pon el precio total'); return false; }
      if (!f0.banco && !litros) { toast('Pon los litros'); return false; }
      if (!f0.banco && !km) { toast('Pon los km del cuentakilómetros'); return false; }
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
    + F.date('vence', 'Fecha de vencimiento / renovación', d.vence || (d.tipo === 'itv' ? itvNext(veh(d.vehicleId)) : ''))
    + `<div data-show="seguro">${F.row(F.text('compania', 'Compañía', d.compania), F.text('poliza', 'Nº de póliza', d.poliza))}${F.text('telefono', 'Teléfono de asistencia', d.telefono, 'inputmode="tel" placeholder="900 000 000"')}</div>`
    + `<div data-show="seguro itv impuesto otro">${F.num('precio', 'Precio (€)', d.precio)}</div>`
    + F.photo('foto', 'Foto del documento', d.fotoId)
    + F.area('notas', 'Notas', d.notas)
    + (id ? `<button type="button" class="btn danger" data-a="delDoc" data-id="${id}">Eliminar documento</button>` : '');
  openSheet({
    body, title: id ? docName(d) : 'Nuevo documento',
    onRender: f => {
      const sel = $('select[name=tipo]', f);
      const upd = () => $$('[data-show]', f).forEach(el => el.classList.toggle('hide', !el.dataset.show.split(' ').includes(sel.value)));
      sel.addEventListener('change', upd); upd();
    },
    onSubmit: async (fd, form) => {
      const o = id ? d : { id: uid(), vehicleId: d.vehicleId };
      o.fotoId = await takePhoto(form, 'foto', o.fotoId);
      Object.assign(o, { tipo: fd.tipo, nombre: fd.nombre, vence: fd.vence || null, compania: fd.compania, poliza: fd.poliza, telefono: fd.telefono, precio: num(fd.precio), notas: fd.notas });
      if (!id) D.docs.push(o); save(); toast('Guardado');
    }
  });
}
function formRenew(id) {
  const d = D.docs.find(x => x.id === id); const t = DOC_TYPES[d.tipo];
  const base = d.vence && d.vence > addDays(todayStr(), -90) ? d.vence : todayStr();
  const body = `<div class="hint" style="margin:0 4px 12px">Vencimiento actual: <b>${fDate(d.vence)}</b></div>`
    + F.date('vence', 'Nueva fecha de vencimiento', addMonths(base, d.tipo === 'itv' && veh(d.vehicleId)?.matriculacion ? itvMonths(veh(d.vehicleId), base) : t.renew))
    + (d.tipo === 'itv' ? F.hint(veh(d.vehicleId)?.matriculacion ? 'Calculada según la antigüedad del vehículo. Comprueba que coincide con la pegatina.' : 'Si pones la fecha de matriculación en la ficha del vehículo, la calculo yo. Comprueba la pegatina.') : '')
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

function formCasa(id, sug, vehicleId) {
  const t = id ? D.casa.find(x => x.id === id) : sug ? { emoji: sug[0], nombre: sug[1], cada: sug[2], unidad: sug[3] } : { emoji: '🏠', cada: 1, unidad: 'm' };
  const body = F.text('nombre', 'Revisión', t.nombre, 'placeholder="Presión de neumáticos"')
    + `<div class="f"><span class="lbl">Icono</span><div class="tagsel emojis">${EMOJIS.map(e => `<label><input type="radio" name="emoji" value="${e}" ${e === t.emoji ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></div>`
    + F.row(F.text('cada', 'Cada', t.cada, 'inputmode="numeric"'), F.select('unidad', 'Unidad', [['d', 'Días'], ['s', 'Semanas'], ['m', 'Meses'], ['a', 'Años']], t.unidad))
    + F.date('ultima', 'Última vez que lo hiciste', t.ultima) + F.hint('Si no lo sabes, déjalo vacío y pulsa «Hecho» la próxima vez.')
    + F.area('notas', 'Notas', t.notas)
    + (id && t.historial?.length ? `<div class="hint">Historial: ${t.historial.slice(-8).reverse().map(x => fDate(x)).join(' · ')}</div>` : '')
    + (id ? `<button type="button" class="btn danger" data-a="delCasa" data-id="${id}">Eliminar revisión</button>` : '');
  openSheet({
    body, title: id ? 'Editar revisión' : 'Nueva revisión',
    onSubmit: fd => {
      if (!fd.nombre) { toast('Ponle un nombre'); return false; }
      const cada = intKm(fd.cada); if (!cada) { toast('Indica cada cuánto'); return false; }
      const o = id ? t : { id: uid(), historial: [], vehicleId: vehicleId || null };
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


function formGar(id) {
  const g = id ? D.garantias.find(x => x.id === id) : { anios: 3, fecha: todayStr() };
  const body = F.text('nombre', 'Producto', g.nombre, 'placeholder="Lavadora, televisor, móvil…"')
    + F.row(F.text('tienda', 'Tienda', g.tienda), F.num('precio', 'Precio (€)', g.precio))
    + F.row(F.date('fecha', 'Fecha de compra', g.fecha), F.num('anios', 'Años de garantía', g.anios))
    + F.hint('En España, los productos nuevos comprados desde 2022 tienen 3 años de garantía legal.')
    + F.photo('foto', 'Foto de la factura o el ticket', g.fotoId) + F.area('notas', 'Notas', g.notas)
    + (id ? `<button type="button" class="btn danger" data-a="delGar" data-id="${id}">Eliminar garantía</button>` : '');
  openSheet({
    body, title: id ? 'Garantía' : 'Nueva garantía',
    onSubmit: async (fd, form) => {
      if (!fd.nombre) { toast('Escribe qué producto es'); return false; }
      const o = id ? g : { id: uid() };
      Object.assign(o, { nombre: fd.nombre, tienda: fd.tienda, precio: num(fd.precio), fecha: fd.fecha || null, anios: num(fd.anios) || 3, notas: fd.notas });
      o.fotoId = await takePhoto(form, 'foto', o.fotoId);
      if (!id) D.garantias.push(o); save(); toast('Garantía guardada');
    }
  });
}
function accident(vId) {
  const v = veh(vId); const seg = D.docs.find(d => d.vehicleId === vId && d.tipo === 'seguro');
  const tel = (seg?.telefono || '').replace(/[^\d+]/g, '');
  const body = `<div class="card" style="margin:0 0 12px"><b>${esc(vName(v))}</b>${v.matricula ? ` <span class="plate"><span>${esc(v.matricula)}</span></span>` : ''}
    <div class="muted small" style="margin-top:6px">${seg ? `Seguro: <b>${esc(seg.compania || '—')}</b>${seg.poliza ? ` · Póliza <b>${esc(seg.poliza)}</b>` : ''}` : 'No hay seguro apuntado en Papeles.'}</div></div>
    <div class="btns" style="margin:0 0 14px"><a class="btn danger" href="tel:112">📞 112</a>${tel ? `<a class="btn" href="tel:${tel}">📞 Asistencia</a>` : ''}</div>
    <ol class="steps">
      <li><b>Ponte a salvo.</b> Enciende las luces de emergencia y ponte el chaleco antes de bajar.</li>
      <li><b>Señaliza</b> con la baliza V16 en el techo.</li>
      <li><b>Si hay heridos, llama al 112</b> y no los muevas salvo que haya peligro.</li>
      <li><b>Haz fotos</b> de los daños de los dos vehículos, de cómo han quedado, de las matrículas y de la zona.</li>
      <li><b>Rellena el parte amistoso</b> con el otro conductor: datos de los dos, matrículas, aseguradora y nº de póliza, las casillas de lo que ha pasado y el croquis. Firmadlo los dos y quedaos una copia cada uno. Si no estás de acuerdo, no firmes.</li>
      <li><b>Avisa a tu seguro</b> como muy tarde en 7 días.</li>
    </ol>
    ${D.guantera.some(g => g.vehicleId === vId) ? `<button type="button" class="btn sec" data-a="accGlove" data-v="${vId}">Ver los papeles de la guantera</button>` : ''}`;
  openSheet({ body, title: 'Accidente', submit: 'Cerrar', onSubmit: () => { } });
}
function formCalendar() {
  const n = { doc: D.docs.map(evDoc).filter(Boolean).length, gar: D.garantias.map(evGar).filter(Boolean).length, plan: D.plans.filter(p => veh(p.vehicleId)).map(evPlan).filter(Boolean).length, casa: D.casa.map(evCasa).filter(Boolean).length };
  const body = F.hint('Elige qué fechas quieres en el Calendario del iPhone. Cada una lleva su aviso: los papeles, 30 y 7 días antes; los mantenimientos, 7 días antes; las garantías, 30 días antes; y las revisiones rápidas, ese mismo día a las 9:00.')
    + F.check('doc', `📄 Papeles y documentos (${n.doc})`, true) + F.check('plan', `🔧 Mantenimientos del vehículo (${n.plan})`, true)
    + F.check('gar', `🧾 Fin de garantías (${n.gar})`, true) + F.check('casa', `🛞 Revisiones rápidas (${n.casa})`, false)
    + F.hint('Si después renuevas algo o cambian las fechas, vuelve a añadirlo. Las fechas de mantenimiento por km son una estimación según los km que haces.');
  openSheet({
    body, title: 'Añadir al Calendario', submit: 'Añadir',
    onSubmit: fd => {
      const ev = [...(fd.doc ? D.docs.map(evDoc) : []), ...(fd.plan ? D.plans.filter(p => veh(p.vehicleId)).map(evPlan) : []), ...(fd.gar ? D.garantias.map(evGar) : []), ...(fd.casa ? D.casa.map(evCasa) : [])];
      addToCalendar(ev);
    }
  });
}
function pickPhoto() {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none'; document.body.append(i);
    i.onchange = async () => { const f = i.files[0]; i.remove(); if (!f) return res(null); try { res(await resizeImage(f, 1800, .82)); } catch (e) { toast(e.message); res(null); } };
    i.click();
  });
}
const vz = { s: 1, base: 1, x: 0, y: 0, px: 0, py: 0, lastTap: 0 };
function applyVz(x = vz.x, y = vz.y, anim = true) { const im = $('#viewer img'); if (!im) return; im.style.transition = anim ? '' : 'none'; im.style.transform = `translate(${x}px, ${y}px) scale(${vz.s})`; }
async function showPhoto(id) { const p = await getPhoto(id); if (!p) return; const v = $('#viewer'); Object.assign(vz, { s: 1, x: 0, y: 0 }); v.style.background = ''; v.innerHTML = `<button class="xbtn vx" data-a="closeViewer" aria-label="Cerrar">${XICON}</button><img src="${p}" alt="">`; v.classList.add('open'); }
function closeViewer() { const v = $('#viewer'); v.classList.remove('open'); v.style.background = ''; }


/* ================= Importar cobros del banco ================= */
let xlsxLoading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return xlsxLoading || (xlsxLoading = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = res; sc.onerror = () => { xlsxLoading = null; sc.remove(); rej(new Error('Para leer el Excel hace falta conexión a internet.')); };
    document.head.append(sc);
  }));
}
function cellDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return toStr(v);
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const t = String(v).trim(); let m;
  if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) { let y = +m[3]; if (y < 100) y += 2000; if (+m[2] > 12) return null; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function cellNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return null;
  const t = String(v).trim(); if (!/^[+\-−]?\s*[\d.,]+\s*(€|eur)?$/i.test(t)) return null;
  return num(t.replace('−', '-').replace(/\s|€|eur/gi, ''));
}
const isText = c => typeof c === 'string' && /[a-záéíóúñ]{3,}/i.test(c);
function parseBank(rows) {
  rows = rows.map(r => (r || []).map(c => c == null ? '' : c));
  let hi = -1, cD = -1, cC = -1, cA = -1, cCargo = -1, cAbono = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim());
    let d = r.findIndex(c => /^fecha/.test(c) && !/valor/.test(c)); if (d < 0) d = r.findIndex(c => /fecha/.test(c));
    const a = r.findIndex(c => /^importe|^cantidad/.test(c));
    const cg = r.findIndex(c => /^cargo|^debe/.test(c));
    if (d >= 0 && (a >= 0 || cg >= 0)) {
      hi = i; cD = d; cA = a; cCargo = cg; cAbono = r.findIndex(c => /^abono|^haber/.test(c));
      cC = r.findIndex(c => /concepto|descrip|movimiento|detalle|comercio/.test(c)); break;
    }
  }
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; let fecha, concepto, imp;
    if (hi >= 0) {
      fecha = cellDate(r[cD]);
      concepto = cC >= 0 ? String(r[cC]) : (r.filter(isText).sort((a, b) => b.length - a.length)[0] || '');
      if (cA >= 0) imp = cellNum(r[cA]);
      else { const cg = cellNum(r[cCargo]), ab = cAbono >= 0 ? cellNum(r[cAbono]) : null; imp = cg ? -Math.abs(cg) : ab; }
    } else {
      fecha = r.map(cellDate).find(Boolean);
      concepto = r.filter(isText).sort((a, b) => b.length - a.length)[0] || '';
      const ci = r.indexOf(concepto); imp = r.slice(ci + 1).map(cellNum).find(x => x != null);
    }
    concepto = String(concepto || '').trim().replace(/\s+/g, ' ');
    if (fecha && imp != null && imp !== 0 && concepto) out.push({ fecha, concepto, importe: imp });
  }
  return out;
}
function parseCsv(t) {
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  const sample = lines.slice(0, 30).join('\n');
  const d = [';', '\t', ','].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map(l => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === d) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim()); return out;
  });
}
async function readBankFile(file) {
  const buf = await file.arrayBuffer(); let out = [];
  if (/\.(csv|txt)$/i.test(file.name)) {
    let txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { txt = new TextDecoder('windows-1252').decode(buf); }
    out = parseBank(parseCsv(txt));
  } else {
    await loadXLSX();
    const wb = XLSX.read(buf, { type: 'array' });
    for (const n of wb.SheetNames) out.push(...parseBank(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })));
  }
  if (!out.length) throw new Error('No he encontrado movimientos en el archivo. ¿Es el Excel de movimientos del banco?');
  return out;
}
function stationName(c, kw) {
  let t = c; const i = t.toLowerCase().indexOf(kw); if (i > 0) t = t.slice(i);
  t = t.replace(/\s\d{4,}.*$/, '').replace(/\s(fecha|tarj|tarjeta)\b.*$/i, '').trim();
  t = t.toLowerCase().replace(/(^|[\s.])\S/g, x => x.toUpperCase());
  return t.slice(0, 40) || kw;
}
function bankRule() {
  const r = D.settings.bankRule || {};
  const motos = D.vehicles.filter(v => v.tipo === 'moto'), otros = D.vehicles.filter(v => v.tipo !== 'moto');
  const big = veh(r.big) ? r.big : (otros[0] || D.vehicles[0])?.id;
  const small = veh(r.small) ? r.small : (motos[0] || D.vehicles[D.vehicles.length - 1])?.id;
  return { limit: r.limit ?? 40, big, small };
}
function bankRows(form) {
  const kwRaw = ($('input[name=kw]', form).value || 'repsol').toLowerCase();
  const kws = kwRaw.split(/[,;]/).map(x => x.trim()).filter(Boolean);
  let m = form._all.filter(r => kws.some(k => r.concepto.toLowerCase().includes(k)));
  const neg = m.filter(r => r.importe < 0); m = neg.length ? neg : m;
  const lim = num($('input[name=limit]', form)?.value) ?? 40;
  const big = $('select[name=big]', form)?.value, small = $('select[name=small]', form)?.value;
  const seen = {};
  return m.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => {
    const total = Math.round(Math.abs(r.importe) * 100) / 100;
    const base = `${r.fecha}|${total.toFixed(2)}|${r.concepto.toLowerCase()}`; seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] > 1 ? `${base}|${seen[base]}` : base;
    const kw = kws.find(k => r.concepto.toLowerCase().includes(k));
    let dup = '';
    if (D.fuels.some(f => f.banco === key)) dup = 'ya importado';
    else if (D.fuels.some(f => !f.banco && Math.abs((f.total || 0) - total) < .015 && Math.abs(daysBetween(f.fecha, r.fecha)) <= 3)) dup = 'ya apuntado a mano';
    const shop = !dup && (total < 5 || /tienda|shop/i.test(r.concepto));
    return { ...r, total, key, dup, shop, station: stationName(r.concepto, kw), vehicleId: D.vehicles.length > 1 ? (total > lim ? big : small) : D.vehicles[0]?.id };
  });
}
function renderBankPreview(form) {
  const box = $('#bankPreview', form); if (!form._all) return;
  const rows = form._rows = bankRows(form);
  const kw = $('input[name=kw]', form).value || 'repsol';
  if (!rows.length) { box.innerHTML = `<div class="card empty" style="margin:0 0 12px">No hay cobros con «${esc(kw)}» entre los ${form._all.length} movimientos del archivo.</div>`; return; }
  const multi = D.vehicles.length > 1;
  const nNew = rows.filter(r => !r.dup).length;
  box.innerHTML = `<div class="hint">${rows.length} cobros encontrados${nNew < rows.length ? `, ${rows.length - nNew} ya estaban en la app (desmarcados)` : ''}. Desmarca los que no sean de combustible, por ejemplo compras en la tienda.</div>
    <div class="card flush" style="margin:0 0 12px">${rows.map((r, i) => `<div class="row bankrow"><input type="checkbox" name="imp_${i}" ${r.dup || r.shop ? '' : 'checked'}>
      <div class="txt"><div class="t">${fEur(r.total)} <span class="muted" style="font-weight:500">· ${fDate(r.fecha)}</span></div><div class="s">${esc(r.station)}${r.dup ? ` · <span class="st yellow">${r.dup}</span>` : r.shop ? ' · <span class="st yellow">¿compra en la tienda?</span>' : ''}</div></div>
      ${multi ? `<select name="veh_${i}" class="vsel">${D.vehicles.map(v => `<option value="${v.id}" ${v.id === r.vehicleId ? 'selected' : ''}>${vEmoji(v)}</option>`).join('')}</select>` : ''}</div>`).join('')}</div>`;
}
function formBank() {
  if (!D.vehicles.length) { toast('Primero añade un vehículo'); return; }
  const r = bankRule(); const multi = D.vehicles.length > 1;
  const opts = D.vehicles.map(v => [v.id, `${vEmoji(v)} ${vName(v)}`]);
  const body = `<div class="hint" style="margin:0 4px 12px"><b>Cómo sacar el archivo de Santander:</b> en la web de Santander (mejor desde el ordenador o en Safari), entra en tu cuenta → <b>Movimientos</b>, elige las fechas y pulsa <b>Descargar / Exportar en Excel</b>. Si pagas con tarjeta de crédito, los cobros salen en los movimientos de la <b>tarjeta</b>, no en los de la cuenta. Guarda el archivo en Archivos o en iCloud Drive.</div>`
    + `<label class="photo-in"><input type="file" name="bankfile" accept=".xlsx,.xls,.csv,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden><div class="photo-prev" id="bankName">📄 Elegir el archivo del banco</div></label><div style="height:12px"></div>`
    + F.text('kw', 'Buscar en el concepto', D.settings.bankKw || 'repsol', 'autocapitalize="off"')
    + F.hint('Puedes poner varias separadas por comas, por ejemplo: repsol, cepsa')
    + (multi ? `<div class="f"><span class="lbl">Asignar cada cobro automáticamente</span></div>`
      + F.row(F.num('limit', 'Si es más de (€)', r.limit), F.select('big', 'va a', opts, r.big))
      + F.select('small', 'Si es igual o menos, va a', opts, r.small)
      + F.hint('Puedes cambiar el vehículo de cada cobro en la lista.') : '')
    + `<div id="bankPreview"></div>`
    + F.hint('Del banco solo llegan la fecha y el importe: cuentan como gasto en combustible. Para el consumo, toca el repostaje después y añade los litros y los km.');
  openSheet({
    body, title: 'Importar del banco', submit: 'Importar',
    onRender: f => {
      const inp = $('input[name=bankfile]', f);
      inp.addEventListener('change', async () => {
        const file = inp.files[0]; if (!file) return;
        $('#bankName', f).textContent = '📄 ' + file.name;
        const box = $('#bankPreview', f); box.innerHTML = '<div class="hint">Leyendo el archivo…</div>';
        try { f._all = await readBankFile(file); renderBankPreview(f); }
        catch (e) { f._all = null; box.innerHTML = `<div class="hint" style="color:var(--red)">${esc(e.message)}</div>`; }
      });
      $$('input[name=kw], input[name=limit]', f).forEach(i => i.addEventListener('input', () => renderBankPreview(f)));
      $$('select[name=big], select[name=small]', f).forEach(i => i.addEventListener('change', () => renderBankPreview(f)));
    },
    onSubmit: (fd, form) => {
      if (!form._rows) { toast('Elige primero el archivo del banco'); return false; }
      const pick = form._rows.map((r, i) => ({ ...r, vehicleId: fd['veh_' + i] || r.vehicleId, on: !!fd['imp_' + i] })).filter(r => r.on);
      if (!pick.length) { toast('No hay ningún cobro marcado'); return false; }
      pick.forEach(r => D.fuels.push({ id: uid(), vehicleId: r.vehicleId, fecha: r.fecha, total: r.total, litros: null, km: null, gasolinera: r.station, lleno: true, banco: r.key }));
      D.settings.bankKw = fd.kw || 'repsol';
      if (multi) D.settings.bankRule = { limit: num(fd.limit) ?? 40, big: fd.big, small: fd.small };
      save();
      const per = D.vehicles.map(v => [v, pick.filter(r => r.vehicleId === v.id)]).filter(([, l]) => l.length);
      toast(`Importados: ${per.map(([v, l]) => `${l.length} ${vName(v)}`).join(' · ')}`);
    }
  });
}

function openItem(kind, id) {
  if (kind === 'gar') return openGar(id);
  if (kind === 'casa') {
    const t = D.casa.find(x => x.id === id); const st = casaStatus(t);
    const it = [{ label: '✓ Hecho hoy', fn: () => hecho(id) }, { label: 'Editar', fn: () => formCasa(id) }];
    if (evCasa(t)) it.push({ label: '📅 Añadir al Calendario', now: true, fn: () => addToCalendar([evCasa(t)]) });
    openActions(`${esc(t.nombre)}<br>${esc(st.text)}`, it);
  } else if (kind === 'plan') {
    const p = D.plans.find(x => x.id === id); const st = planStatus(p);
    const recs = planRecords(p);
    const items = [{ label: '🔧 Registrar que se ha hecho', fn: () => formMto(p.vehicleId, null, id) }, { label: 'Editar intervalo y última vez', fn: () => formPlan(p.vehicleId, id) }];
    if (recs.length) items.push({ label: `Ver historial (${recs.length})`, fn: () => planHistory(p) });
    if (evPlan(p)) items.push({ label: '📅 Añadir al Calendario', now: true, fn: () => addToCalendar([evPlan(p)]) });
    openActions(`${esc(p.nombre)} · ${esc(vName(veh(p.vehicleId)))}<br>${esc(st.text)}`, items);
  } else if (kind === 'doc') {
    const d = D.docs.find(x => x.id === id); const st = docStatus(d);
    const items = [];
    if (d.vence) items.push({ label: '🔄 Renovar', fn: () => formRenew(id) });
    items.push({ label: d.vence ? 'Editar' : 'Añadir fecha y datos', fn: () => formDoc(d.vehicleId, d.tipo, id) });
    if (d.fotoId) items.push({ label: '🖼️ Ver foto', now: true, fn: () => showPhoto(d.fotoId) });
    if (d.vence) items.push({ label: '📅 Añadir al Calendario', now: true, fn: () => addToCalendar([evDoc(d)]) });
    if (d.telefono) items.push({ label: `📞 Llamar a asistencia (${d.telefono})`, fn: () => location.href = 'tel:' + d.telefono.replace(/\s/g, '') });
    const info = [d.compania, d.poliza ? 'Póliza ' + d.poliza : null].filter(Boolean).map(esc).join(' · ');
    openActions(`${esc(docName(d))}${d.vehicleId ? ' · ' + esc(vName(veh(d.vehicleId))) : ''}${info ? '<br>' + info : ''}<br>${esc(st.text)}`, items);
  }
}
function openGar(id) {
  const g = D.garantias.find(x => x.id === id); const st = garStatus(g); const items = [];
  if (g.fotoId) items.push({ label: '🧾 Ver factura', now: true, fn: () => showPhoto(g.fotoId) });
  items.push({ label: 'Editar', fn: () => formGar(id) });
  if (evGar(g)) items.push({ label: '📅 Añadir al Calendario', now: true, fn: () => addToCalendar([evGar(g)]) });
  openActions(`${esc(g.nombre)}${g.tienda ? ' · ' + esc(g.tienda) : ''}<br>${esc(st.text)}`, items);
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
  car.matriculacion = '2019-03-14';
  D2.garantias.push({ id: uid(), nombre: 'Lavadora', tienda: 'MediaMarkt', fecha: addMonths(addDays(t, 40), -36), anios: 3, precio: 449 },
    { id: uid(), nombre: 'Televisor', tienda: 'El Corte Inglés', fecha: addDays(t, -400), anios: 3, precio: 699 });
  addChecks(car, D2); D2.casa.filter(x => x.vehicleId === car.id).forEach((x, i) => { x.ultima = addDays(t, [-35, -20, -40][i]); x.historial = [x.ultima]; });
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
  if (await shareOrDownload(blob, `migaraje-copia-${todayStr()}.json`)) { D.settings.lastBackup = todayStr(); save(); render(); toast('Copia descargada'); }
}
function importFull() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const j = JSON.parse(await inp.files[0].text());
      if (j.app !== 'aldia' || !j.data) throw new Error('El archivo no es una copia de Mi Garaje');
      const d = j.data;
      if (!confirm(`Copia del ${new Date(j.exportado).toLocaleDateString('es-ES')}: ${d.vehicles?.length || 0} vehículos, ${d.mtos?.length || 0} mantenimientos, ${d.fuels?.length || 0} repostajes, ${d.casa?.length || 0} revisiones.\n\nSe reemplazarán los datos actuales. ¿Continuar?`)) return;
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
  D.casa.forEach(t => (t.historial || []).forEach(h => rows.push([h, vn(t.vehicleId), 'Revisión rápida', t.nombre, '', '', '', '', ''])));
  const head = rows.shift(); rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const cell = v => { if (typeof v === 'number') v = String(v).replace('.', ','); v = String(v ?? ''); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  shareOrDownload(new Blob([csv], { type: 'text/csv' }), `migaraje-registros-${todayStr()}.csv`);
}

/* ================= Avisos (ntfy) ================= */
async function ntfyPost(body) {
  const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: D.settings.ntfyTopic, ...body }) });
  if (!r.ok) throw new Error('ntfy respondió ' + r.status);
}
function ntfyMessage(ref) {
  const it = upcoming(ref).filter(i => i.st.level === 'red');
  if (!it.length) return null;
  return { title: it.length === 1 ? `Mi Garaje: ${it[0].title}` : `Mi Garaje: ${it.length} cosas pendientes`, message: it.slice(0, 8).map(i => `• ${i.title} (${i.sub}): ${i.st.short || i.st.text}`).join('\n') + (it.length > 8 ? `\n…y ${it.length - 8} más` : '') };
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
  tab: d => { if (S.tab === d.tab && !S.vehicleId) { $('#main').scrollTop = 0; return; } pushNav(); S.tab = d.tab; S.vehicleId = null; closeSheet(); render(); $('#main').scrollTop = 0; },
  closeSheet: () => closeSheet(),
  sheetAct: d => { const it = sheetActions?.[+d.i]; closeSheet(); if (it) { if (it.now) it.fn(); else setTimeout(it.fn, 260); } },
  undo: () => undo(),
  closeViewer: () => closeViewer(),
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
  openVehicle: d => { pushNav(); S.tab = 'vehiculos'; S.vehicleId = d.id; S.vtab = 'mto'; S.hfilter = 'all'; render(); $('#main').scrollTop = 0; },
  backVehicles: () => goBack(),
  swEdit: (d, el) => { const w = el.closest('.sw'); closeRow(); KINDS[w.dataset.kind][1](w.dataset.id); },
  swDel: (d, el) => { const w = el.closest('.sw'); removeItem(w.dataset.kind, w.dataset.id); },
  vtab: d => { S.vtab = d.t; render(); },
  delVehicle: async d => {
    const v = veh(d.id); if (!confirm(`¿Eliminar ${vName(v)} y todos sus registros (mantenimientos, repostajes, gastos y papeles)? No se puede deshacer.`)) return;
    const photos = [v.fotoId, ...D.mtos.filter(m => m.vehicleId === d.id).map(m => m.fotoId)].filter(Boolean);
    for (const p of photos) await delPhoto(p);
    D.vehicles = D.vehicles.filter(x => x.id !== d.id);
    for (const g of D.guantera.filter(x => x.vehicleId === d.id)) await delPhoto(g.fotoId);
    for (const k of ['plans', 'mtos', 'fuels', 'pagos', 'docs', 'kmlog', 'casa', 'guantera']) D[k] = D[k].filter(x => x.vehicleId !== d.id);
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
  delCasa: d => { if (!confirm('¿Eliminar esta revisión?')) return; D.casa = D.casa.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  demo: () => { D = loadDemo(); save(); render(); toast('Datos de ejemplo cargados'); },
  wipeDemo: async () => { if (!confirm('¿Borrar los datos de ejemplo y empezar de cero?')) return; D = emptyData(); await idb.clear('photos'); await save(); render(); },
  addGar: () => formGar(),
  delGar: async d => { if (!confirm('¿Eliminar esta garantía?')) return; const g = D.garantias.find(x => x.id === d.id); await delPhoto(g.fotoId); D.garantias = D.garantias.filter(x => x.id !== d.id); save(); closeSheet(); render(); },
  addChecks: d => { addChecks(veh(d.v)); save(); render(); toast('Revisiones añadidas'); },
  addCheck: d => formCasa(null, null, d.v),
  accident: d => accident(d.v),
  accGlove: d => { const gs = D.guantera.filter(g => g.vehicleId === d.v); closeSheet(); setTimeout(() => openActions('Papeles de la guantera', gs.map(g => ({ label: g.nombre, now: true, fn: () => showPhoto(g.fotoId) }))), 260); },
  gloveAdd: async d => {
    const url = await pickPhoto(); if (!url) return;
    const nombre = d.n || prompt('¿Qué documento es?', '') || 'Documento';
    D.guantera.push({ id: uid(), vehicleId: d.v, nombre, fotoId: await savePhoto(url) }); save(); render(); toast('Foto guardada en la guantera');
  },
  gloveOpen: d => {
    const g = D.guantera.find(x => x.id === d.id);
    openActions(esc(g.nombre), [{ label: '🖼️ Ver', now: true, fn: () => showPhoto(g.fotoId) }, { label: 'Eliminar', danger: true, fn: async () => { if (!confirm(`¿Eliminar la foto de «${g.nombre}»?`)) return; await delPhoto(g.fotoId); D.guantera = D.guantera.filter(x => x.id !== g.id); save(); render(); } }]);
  },
  calAll: () => formCalendar(),
  bankImport: () => formBank(),
  exportFull: () => exportFull(),
  importFull: () => importFull(),
  exportCsv: () => exportCsv(),
  ntfyOn: () => {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; let t = 'migaraje-';
    crypto.getRandomValues(new Uint8Array(12)).forEach(b => t += abc[b % abc.length]);
    D.settings.ntfyTopic = D.settings.ntfyTopic || t; D.settings.ntfyOn = true; save(); render(); ntfySchedule();
  },
  ntfyOff: () => { D.settings.ntfyOn = false; save(); render(); },
  ntfyTest: async () => {
    try { await ntfyPost({ title: 'Mi Garaje', message: 'Aviso de prueba: ¡funciona! 👍', tags: ['white_check_mark'] }); toast('Aviso enviado'); }
    catch (e) { toast('No se pudo enviar: ' + e.message); }
  },
  wipe: async () => {
    if (!confirm('¿Borrar TODOS los datos de la app? Descarga antes una copia si la quieres conservar.')) return;
    if (!confirm('¿Seguro? No se puede deshacer.')) return;
    D = emptyData(); await idb.clear('photos'); await save(); S.vehicleId = null; S.tab = 'inicio'; render();
  }
};

/* ================= Gestos (como una app del iPhone) ================= */
const NAV = [];
function pushNav() { NAV.push({ tab: S.tab, vehicleId: S.vehicleId, vtab: S.vtab, top: $('#main').scrollTop }); if (NAV.length > 30) NAV.shift(); }
const isOpen = sel => $(sel).classList.contains('open');
function canGoBack() { return isOpen('#viewer') || isOpen('#sheet-root') || NAV.length > 0 || !!S.vehicleId || S.tab !== 'inicio'; }
function goBack() {
  if (isOpen('#viewer')) return closeViewer();
  if (isOpen('#sheet-root')) return closeSheet();
  const p = NAV.pop();
  if (p) { Object.assign(S, { tab: p.tab, vehicleId: p.vehicleId && veh(p.vehicleId) ? p.vehicleId : null, vtab: p.vtab }); render(); $('#main').scrollTop = p.top || 0; return; }
  if (S.vehicleId) S.vehicleId = null; else S.tab = 'inicio';
  render(); $('#main').scrollTop = 0;
}

/* Filas que se deslizan a la izquierda para ver Editar / Borrar */
const KINDS = {
  fuel: ['fuels', id => formFuel(null, id)], mto: ['mtos', id => formMto(null, id)], pago: ['pagos', id => formPago(null, id)], km: ['kmlog', id => formEditKm(id)],
  doc: ['docs', id => { const d = D.docs.find(x => x.id === id); formDoc(d.vehicleId, d.tipo, id); }], gar: ['garantias', id => formGar(id)],
  plan: ['plans', id => formPlan(D.plans.find(x => x.id === id).vehicleId, id)], casa: ['casa', id => formCasa(id)]
};
function removeItem(kind, id) {
  const store = KINDS[kind][0]; const it = D[store].find(x => x.id === id); if (!it) return;
  snapshot(); D[store] = D[store].filter(x => x.id !== id); save(); render(); toast('Borrado', true);
  if (it.fotoId) setTimeout(() => { if (!D[store].some(x => x.id === id)) delPhoto(it.fotoId); }, 6000);
}
const ROWKIND = { editFuel: 'fuel', editMto: 'mto', editPago: 'pago', editKm: 'km' };
function enhanceRows(root) {
  if (S.tab === 'inicio') return;
  $$('.row', root).forEach(r => {
    if (r.closest('.sw')) return;
    let kind = ROWKIND[r.dataset.a], id = r.dataset.id;
    if (!kind && r.dataset.a === 'item' && ['plan', 'doc', 'gar'].includes(r.dataset.kind)) kind = r.dataset.kind;
    if (!kind) { const h = $('[data-a="hecho"]', r); if (h) { kind = 'casa'; id = h.dataset.id; } }
    if (!kind) return;
    const w = document.createElement('div'); w.className = 'sw'; w.dataset.kind = kind; w.dataset.id = id;
    w.innerHTML = '<div class="sw-acts"><button class="sw-edit" data-a="swEdit">Editar</button><button class="sw-del" data-a="swDel">Borrar</button></div>';
    r.replaceWith(w); w.append(r);
  });
}
let openRow = null;
function setRow(w, x, anim = true) { const r = w.lastElementChild; r.style.transition = anim ? '' : 'none'; r.style.transform = x ? `translateX(${x}px)` : ''; }
function closeRow() { if (openRow) { setRow(openRow, 0); openRow = null; } }

function longPress(el) {
  try { navigator.vibrate?.(10); } catch { }
  if (el.classList.contains('sw')) {
    const k = el.dataset.kind, id = el.dataset.id;
    if (['plan', 'doc', 'gar', 'casa'].includes(k)) { lpDel = { kind: k, id }; return openItem(k, id); }
    return openActions('', [{ label: 'Editar', fn: () => KINDS[k][1](id) }, { label: 'Borrar', danger: true, fn: () => removeItem(k, id) }]);
  }
  if (el.dataset.a === 'item') return openItem(el.dataset.kind, el.dataset.id);
  if (el.dataset.a === 'openVehicle') { const id = el.dataset.id; return openActions(`<b>${esc(vName(veh(id)))}</b>`, [{ label: 'Abrir', fn: () => A.openVehicle({ id }) }, { label: 'Actualizar km', fn: () => formKm(id) }, { label: 'Editar', fn: () => formVehicle(id) }]); }
  if (el.dataset.a === 'gloveOpen') return A.gloveOpen(el.dataset);
}

const T = { on: false };
let suppressClick = 0;
document.addEventListener('touchstart', e => {
  clearTimeout(T.lp);
  if (e.touches.length > 1) { T.on = false; return; }
  const t = e.touches[0], tg = e.target;
  Object.assign(T, { on: true, x0: t.clientX, y0: t.clientY, t0: Date.now(), dx: 0, dy: 0, mode: null, cand: [], lpFired: false, sw: null });
  if (isOpen('#viewer')) { T.cand = ['viewer']; return; }
  if (isOpen('#sheet-root')) {
    const sh = $('#sheet-root .sheet'), body = $('#sheet-root .sheet-body'); T.sheet = sh;
    if (!sh) return;
    if (!sh.contains(tg) || !body || !body.contains(tg) || body.scrollTop <= 0) T.cand = ['sheet'];
    return;
  }
  if (T.x0 < 24 && canGoBack()) T.cand.push('edge');
  const sw = tg.closest('.sw');
  if (sw && !tg.closest('.sw-acts')) { T.cand.push('row'); T.sw = sw; T.base = sw === openRow ? -sw.firstElementChild.offsetWidth : 0; }
  if (S.tab === 'inicio' && $('#main').scrollTop <= 0) T.cand.push('ptr');
  const lpEl = tg.closest('.sw, [data-a="item"], [data-a="openVehicle"], [data-a="gloveOpen"]');
  if (lpEl && !tg.closest('.sw-acts, [data-a="hecho"]')) T.lp = setTimeout(() => { if (!T.on || T.mode) return; T.lpFired = true; T.on = false; suppressClick = Date.now(); longPress(lpEl); }, 520);
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!T.on || e.touches.length > 1) return;
  const t = e.touches[0]; T.dx = t.clientX - T.x0; T.dy = t.clientY - T.y0;
  const ax = Math.abs(T.dx), ay = Math.abs(T.dy);
  if (ax > 8 || ay > 8) clearTimeout(T.lp);
  if (!T.mode) {
    if (ax < 6 && ay < 6) return;
    const c = T.cand;
    if (c.includes('viewer')) T.mode = vz.s > 1 ? 'pan' : (T.dy > 0 && ay > ax ? 'viewer' : 'none');
    else if (c.includes('sheet')) T.mode = T.dy > 0 && ay > ax ? 'sheet' : 'none';
    else if (c.includes('edge') && T.dx > 0 && ax > ay) T.mode = 'edge';
    else if (c.includes('row') && ax > ay) { T.mode = 'row'; if (openRow && openRow !== T.sw) closeRow(); }
    else if (c.includes('ptr') && T.dy > 0 && ay > ax) T.mode = 'ptr';
    else T.mode = 'none';
    if (T.mode !== 'none') suppressClick = Date.now();
  }
  if (T.mode === 'none') return;
  if (e.cancelable) e.preventDefault();
  const m = $('#main');
  if (T.mode === 'edge') { m.style.transition = 'none'; m.style.transform = `translateX(${Math.max(0, T.dx)}px)`; }
  else if (T.mode === 'sheet') { T.sheet.style.transition = 'none'; T.sheet.style.transform = `translateY(${Math.max(0, T.dy)}px)`; }
  else if (T.mode === 'viewer') { const im = $('#viewer img'); if (im) { im.style.transition = 'none'; im.style.transform = `translateY(${T.dy}px)`; } $('#viewer').style.background = `rgba(0,0,0,${Math.max(.3, .92 - T.dy / 500)})`; }
  else if (T.mode === 'pan') { vz.px = vz.x + T.dx; vz.py = vz.y + T.dy; applyVz(vz.px, vz.py, false); }
  else if (T.mode === 'row') { const w = T.sw.firstElementChild.offsetWidth; let x = Math.min(0, T.base + T.dx); if (x < -w) x = -w - (-w - x) * .3; T.x = x; setRow(T.sw, x, false); }
  else if (T.mode === 'ptr') {
    const d = Math.min(110, T.dy * .5); T.pull = d; m.style.transition = 'none'; m.style.transform = `translateY(${d}px)`;
    const pt = $('#ptr'); pt.style.transition = 'none'; pt.style.opacity = Math.min(1, d / 60); pt.style.transform = `translateY(${d - 46}px) rotate(${d * 5}deg)`;
  }
}, { passive: false });

function endTouch() {
  clearTimeout(T.lp);
  if (!T.on) return; T.on = false;
  const dt = Math.max(1, Date.now() - T.t0), m = $('#main');
  if (T.mode === 'edge') {
    if (T.dx > 90 || (T.dx > 40 && T.dx / dt > .5)) { m.style.transition = 'transform .18s ease-out'; m.style.transform = 'translateX(100%)'; setTimeout(() => { goBack(); m.style.transition = 'none'; m.style.transform = ''; }, 180); }
    else { m.style.transition = 'transform .2s'; m.style.transform = ''; }
  } else if (T.mode === 'sheet') {
    if (T.dy > 120 || (T.dy > 40 && T.dy / dt > .5)) closeSheet(); else { T.sheet.style.transition = ''; T.sheet.style.transform = ''; }
  } else if (T.mode === 'viewer') {
    if (T.dy > 120 || (T.dy > 40 && T.dy / dt > .5)) closeViewer(); else { applyVz(0, 0, true); $('#viewer').style.background = ''; }
  } else if (T.mode === 'pan') { vz.x = vz.px; vz.y = vz.py; }
  else if (T.mode === 'row') {
    const w = T.sw.firstElementChild.offsetWidth;
    if (T.x < -w / 2 || (T.dx < -30 && -T.dx / dt > .4)) { setRow(T.sw, -w); openRow = T.sw; } else { setRow(T.sw, 0); if (openRow === T.sw) openRow = null; }
  } else if (T.mode === 'ptr') {
    const pt = $('#ptr'); m.style.transition = 'transform .25s'; pt.style.transition = 'transform .25s, opacity .25s';
    const reset = () => { m.style.transform = ''; pt.style.opacity = 0; pt.style.transform = 'translateY(-46px)'; pt.classList.remove('spin'); };
    if (T.pull > 60) { m.style.transform = 'translateY(56px)'; pt.style.transform = 'translateY(12px)'; pt.classList.add('spin'); setTimeout(() => { render(); ntfySchedule(); reset(); toast('Actualizado'); }, 650); }
    else reset();
  } else if (!T.mode && T.cand.includes('viewer')) {
    const now = Date.now();
    if (now - vz.lastTap < 300) { vz.s = vz.s > 1 ? 1 : 2.5; vz.x = vz.y = 0; applyVz(0, 0, true); vz.lastTap = 0; suppressClick = now; } else vz.lastTap = now;
  }
}
document.addEventListener('touchend', endTouch);
document.addEventListener('touchcancel', endTouch);

/* Sin zoom de página (solo en el visor de fotos), sin menú del sistema al mantener pulsado */
document.addEventListener('gesturestart', e => { e.preventDefault(); vz.base = vz.s; });
document.addEventListener('gesturechange', e => { e.preventDefault(); if (!isOpen('#viewer')) return; vz.s = Math.min(5, Math.max(1, vz.base * e.scale)); if (vz.s === 1) { vz.x = vz.y = 0; } applyVz(vz.x, vz.y, false); });
document.addEventListener('gestureend', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
document.addEventListener('click', e => {
  if (Date.now() - suppressClick < 450) { e.preventDefault(); e.stopPropagation(); return; }
  if (openRow && !e.target.closest('.sw-acts')) { e.preventDefault(); e.stopPropagation(); closeRow(); return; }
  if (e.target.id === 'viewer') { e.preventDefault(); closeViewer(); }
}, true);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  e.preventDefault(); fn(el.dataset, el, e);
});
document.addEventListener('click', e => {
  const th = e.target.closest('.thumb[data-foto], .hero .img[data-foto]'); if (!th) return;
  e.stopPropagation(); e.preventDefault();
  showPhoto(th.dataset.foto);
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
