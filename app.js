'use strict';
/* ============================================================ Ruteplanlægger 2
   Læser Excel/CSV, finder adresser (Nominatim/Photon), henter køretider og km ad vejene (OSRM),
   fordeler husene på arbejdsdage fra hjemadressen (solver.js – færrest km eller kortest tid),
   og skriver Excel-ruteplan + CSV. Ingen fugleflugt i planlægningen. */
const VERSION = '3.0.1';
const $ = s => document.querySelector(s);
const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } for (const c of kids) if (c != null) e.append(c); return e; };
const sleep = ms => new Promise(r => setTimeout(r, window.__fast ? 0 : ms));
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
const nh = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lowkey = s => norm(s).toLowerCase().replace(/[^a-zæøåäöü0-9]/g, '');
function km(a, b) { const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dp = (b[0] - a[0]) * r; const q = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dl / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); }
function bigrams(s) { s = lowkey(s); const o = []; for (let k = 0; k < s.length - 1; k++) o.push(s.slice(k, k + 2)); return o; }
function sim(a, b) { const x = bigrams(a), y = bigrams(b); if (!x.length || !y.length) return lowkey(a) === lowkey(b) ? 1 : 0; let m = 0; const yy = [...y]; for (const t of x) { const j = yy.indexOf(t); if (j >= 0) { m++; yy.splice(j, 1); } } return 2 * m / (x.length + y.length); }
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

const POSTNAVN = { '6700': 'Esbjerg', '6705': 'Esbjerg Ø', '6710': 'Esbjerg V', '6715': 'Esbjerg N', '6720': 'Fanø', '6731': 'Tjæreborg', '6740': 'Bramming', '6792': 'Rømø', '6818': 'Årre', '6830': 'Nørre Nebel', '6840': 'Oksbøl', '6851': 'Janderup', '6852': 'Billum', '6853': 'Vejers Strand', '6854': 'Henne', '6855': 'Outrup', '6857': 'Blåvand', '6862': 'Tistrup', '6870': 'Ølgod', '6880': 'Tarm', '6893': 'Hemmet', '6900': 'Skjern', '6920': 'Videbæk', '6933': 'Kibæk', '6950': 'Ringkøbing', '6960': 'Hvide Sande', '6971': 'Spjald', '6973': 'Ørnhøj', '6980': 'Tim', '6990': 'Ulfborg', '7620': 'Lemvig', '7673': 'Harboøre', '7680': 'Thyborøn', '6520': 'Toftlund', '6270': 'Tønder', '6261': 'Bredebro', '6280': 'Højer', '6760': 'Ribe', '6800': 'Varde', '6823': 'Ansager', '6650': 'Brørup', '6000': 'Kolding', '7000': 'Fredericia', '7100': 'Vejle', '8000': 'Aarhus C', '5000': 'Odense C', '9000': 'Aalborg', '7400': 'Herning', '7500': 'Holstebro', '1000': 'København K' };
const BLOCKCOL = [['#1F77B4', 'E3EEF7'], ['#D9822B', 'FCEEDD'], ['#2E8B57', 'E2F2E8'], ['#8E5BB5', 'EFE6F6'], ['#C0392B', 'F9E1DE'], ['#5D6D7E', 'E9ECEF'], ['#16A0A0', 'DDF3F3'], ['#B8860B', 'F8F0D8'], ['#D6488A', 'FAE3EE'], ['#4A6FD1', 'E4EAFA'], ['#7A8B1E', 'EEF2DA'], ['#A0522D', 'F5E7DE']];
const PREC = { h: ['Præcis', 'ok'], n: ['Andet bogstav', 'warn'], s: ['Kun vejen', 'warn'], a: ['Omtrentlig', 'warn'], x: ['Ikke fundet', 'bad'] };

const S = { file: null, sheets: [], items: [], info: [], removed: [], skipped: [], blocks: [], order: [], legs: [], stop: false, startPt: null, routeNote: '' };
const DEF_PHONE = 'https://claude.ai/artifact/3yXMzN42nxJo89gErGtswe';
const oldSet = LS.get('rp-settings', {});
const settings = Object.assign({ min: 15, home: 'Torvet, 6700 Esbjerg', hours: 8, stops: '', goal: 'km', mail: '', phone: DEF_PHONE }, oldSet);
if (oldSet.start && !oldSet.home) settings.home = oldSet.start;
if (!settings.phone) settings.phone = DEF_PHONE;
const t1 = v => (+v).toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const t0d = v => Math.round(+v).toLocaleString('da-DK');
const fmtH = h => String(h).replace('.', ',');
const goalTxt = () => settings.goal === 'km' ? 'færrest km' : 'kortest køretid';
const SET_IDS = { optHome: 'home', optStops: 'stops', optHours: 'hours', optMin: 'min', optGoal: 'goal', optMail: 'mail' };
const byStops = () => +settings.stops > 0; // planlæg efter antal huse pr. dag – timerne er så kun vejledende
const limitTxt = () => byStops() ? `højst ${settings.stops} huse pr. dag (timerne er vejledende)` : `højst ${fmtH(settings.hours)} timer pr. dag`;
function showSettings() {
  for (const [id, k] of Object.entries(SET_IDS)) $('#' + id).value = settings[k];
  $('#setSum').textContent = `start og slut ${settings.home || '(ikke sat)'} · ${settings.min} min pr. hus · ${goalTxt()}`;
  $('#qHint').textContent = byStops() ? `Hver dag får højst ${settings.stops} huse. ${fmtH(settings.hours)} timer er kun vejledende.` : `Tomt felt: dagene fyldes op til ${fmtH(settings.hours)} timer (kørsel + arbejde). Skriv et tal i "Huse pr. dag" for at styre efter antal huse.`;
}
for (const [id, k] of Object.entries(SET_IDS)) $('#' + id).addEventListener('change', () => {
  const v = String($('#' + id).value).trim();
  settings[k] = (k === 'min' || k === 'hours') ? Math.max(0, +v.replace(',', '.') || 0) : k === 'stops' ? (Math.round(+v) > 0 ? String(Math.round(+v)) : '') : v;
  if (k === 'hours' && settings.hours < 1) settings.hours = 8;
  if (k === 'phone' && !settings.phone) settings.phone = DEF_PHONE;
  LS.set('rp-settings', settings); showSettings();
});
showSettings();

function step(n) { for (let i = 1; i <= 5; i++) $('#s' + i).hidden = i !== n; const cur = n <= 2 ? 1 : n <= 4 ? 3 : 5; document.querySelectorAll('#steps li').forEach(li => { const s = +li.dataset.s; li.className = s === cur ? 'on' : s < cur ? 'done' : ''; }); window.scrollTo({ top: 0 }); }

/* ------------------------------------------------------------ fil-indlæsning */
async function readXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const wb = await xml('xl/workbook.xml'); if (!wb) throw new Error('Filen ligner ikke en Excel-fil (.xlsx).');
  const rels = await xml('xl/_rels/workbook.xml.rels'); const relMap = {};
  for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const ss = []; const sst = await xml('xl/sharedStrings.xml');
  if (sst) for (const si of sst.getElementsByTagName('si')) { let t = ''; for (const n of si.childNodes) { if (n.nodeName === 't') t += n.textContent; else if (n.nodeName === 'r') for (const tt of n.getElementsByTagName('t')) t += tt.textContent; } ss.push(t); }
  const out = [];
  for (const sh of wb.getElementsByTagName('sheet')) {
    const name = sh.getAttribute('name'); const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const doc = await xml(target); if (!doc) continue;
    const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const ri = (+row.getAttribute('r') || rows.length + 1) - 1; if (ri > 5000) break;
      const arr = rows[ri] = rows[ri] || [];
      let ci = 0;
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r'); if (ref) { const L = ref.replace(/\d+/g, ''); ci = 0; for (const ch of L) ci = ci * 26 + ch.charCodeAt(0) - 64; ci--; }
        if (ci > 60) break;
        const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]; let val = '';
        if (t === 's') val = v ? ss[+v.textContent] || '' : '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (v) { val = v.textContent; if (t !== 'str' && t !== 'b' && t !== 'e' && /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(val)) { const num = +val; val = Number.isInteger(num) ? String(num) : String(Math.round(num * 1e6) / 1e6); } }
        arr[ci] = norm(val); ci++;
      }
    }
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
    out.push({ name: norm(name), rows });
  }
  return out;
}
function readCsv(text) {
  const first = text.split(/\r?\n/)[0] || ''; const d = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === d) { row.push(norm(cur)); cur = ''; } else if (ch === '\n') { row.push(norm(cur)); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch; }
  if (cur || row.length) { row.push(norm(cur)); rows.push(row); }
  return [{ name: 'CSV', rows }];
}

/* ------------------------------------------------------------ kolonnegenkendelse */
const ROLES = [['addr', 'Adresse (vej + nr.)'], ['street', 'Vejnavn'], ['num', 'Husnummer'], ['pc', 'Postnummer'], ['city', 'By'], ['area', 'Område'], ['id', 'Hus-ID / sagsnr.'], ['agreed', 'Aftalt med']];
const RX = {
  addrFull: /^[A-Za-zÆØÅæøåÄÖÜäöüé][^\d,]{1,40}?\s\d+\s*[A-Za-zÆØÅæøå]?\b/,
  pc: /^\d{4}$/, pcIn: /\b\d{4}\s+[A-Za-zÆØÅæøå]/, numOnly: /^\d{1,4}\s*[A-Za-zÆØÅæøå]?$/, alpha: /^[^\d]+$/,
};
const HK = {
  addr: /adresse|address|beliggenhed|lokalitet|ejendom\b/, street: /^(vej|vejnavn|gade|gadenavn|street)/, num: /^(nr|husnr|hus ?nr|nummer|husnummer|no)\.?:?$/,
  pc: /post ?n|postnummer|zip|^pnr/, city: /^(by|bynavn|postdistrikt|city|postby)\b/, area: /omr|lokation|afdeling|distrikt|zone|rute|kvarter|landsby|sommerhusomr/,
  id: /\bid\b|husnummer|hus-?id|sag|ejd|ejendomsnr|kunde|ref|nr\.?:?$|nummer/, agreed: /aftalt|kontakt|varslet|aftale/,
};
function analyzeSheet(sh, forced) {
  const rows = sh.rows; const KEY = /adresse|vej|husn|nr|post|by|omr|id|aftalt|note|bem|kunde|sag|ejendom|navn|lokation/;
  let hdr = -1, best = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) { const r = rows[i] || []; const txt = r.filter(c => c && !/\d{2,}/.test(c)); const sc = txt.filter(c => KEY.test(c.toLowerCase()) && c.length < 40).length; if (sc > best && sc >= 1 && r.filter(Boolean).length >= 2) { best = sc; hdr = i; } }
  if (forced != null) hdr = forced;
  const ncol = Math.max(0, ...rows.map(r => r.length));
  const data = rows.slice(hdr + 1).filter(r => r.some(Boolean));
  const head = hdr >= 0 ? rows[hdr] : [];
  const st = []; for (let j = 0; j < ncol; j++) { const v = data.map(r => r[j] || '').filter(Boolean); const f = rx => v.length ? v.filter(x => rx.test(x)).length / v.length : 0;
    st.push({ j, n: v.length, h: (head[j] || '').toLowerCase().replace(/[:]/g, '').trim(), addr: f(RX.addrFull), pc: f(RX.pc), pcIn: f(RX.pcIn), num: f(RX.numOnly), alpha: f(RX.alpha), uniq: new Set(v).size }); }
  const map = {}; const used = new Set();
  const take = (role, j) => { if (j != null && j >= 0 && !used.has(j)) { map[role] = j; used.add(j); } };
  const byH = (role, ok = () => true) => st.find(s => s.n && !used.has(s.j) && HK[role].test(s.h) && ok(s));
  // adresse: overskrift + indhold, ellers bedste indhold
  const addrHead = st.some(s => HK.addr.test(s.h));
  let a = byH('addr', s => s.addr > .3) || (addrHead ? null : [...st].filter(s => s.addr >= .5 && s.uniq / s.n > .5 && !used.has(s.j)).sort((x, y) => y.addr - x.addr)[0]); if (a) take('addr', a.j);
  if (!a) { const s1 = byH('street', s => s.alpha > .6); if (s1) take('street', s1.j); const n1 = byH('num', s => s.num > .6) || st.find(s => !used.has(s.j) && s.num > .8 && s.n > 2 && map.street != null && s.j === map.street + 1); if (n1) take('num', n1.j); }
  const p = byH('pc', s => s.pc > .5) || st.find(s => !used.has(s.j) && s.pc > .85 && s.n > 2); if (p) take('pc', p.j);
  const c = byH('city', s => s.alpha > .7); if (c) take('city', c.j);
  const ar = byH('area', s => s.alpha > .6); if (ar) take('area', ar.j);
  const ag = byH('agreed'); if (ag) take('agreed', ag.j);
  const id = byH('id', s => s.addr < .3); if (id) take('id', id.j);
  else { const f0 = st.find(s => !used.has(s.j) && s.n > 2 && s.uniq / s.n > .9 && s.addr < .2 && s.alpha < .5); if (f0 && f0.j < (map.addr ?? 99)) take('id', f0.j); }
  return { hdr, map, ncol, head };
}
function headLabel(sh, j) { const h = sh.det.hdr >= 0 ? sh.rows[sh.det.hdr][j] : ''; return colName(j) + (h ? ': ' + h : ''); }

/* ------------------------------------------------------------ adresse-parsning */
const ADDR = /^\s*(.*?\D)\s*(\d+)\s*(?:([A-Za-zÆØÅæøå])(?=[\s,.\-]|$))?\s*(.*?)\s*$/;
function parseAddress(raw) {
  let s = norm(raw), pc = '', city = '';
  const m2 = s.match(/,?\s*(?:DK-?)?(\d{4})\s+([A-Za-zÆØÅæøåé .\-]+?)\s*$/); // ", 6950 Ringkøbing"
  if (m2 && m2.index > 3) { pc = m2[1]; city = norm(m2[2]); s = s.slice(0, m2.index); }
  s = s.replace(/,\s*$/, '');
  const m = s.match(ADDR); if (!m) return { street: s, num: '', rest: '', pc, city };
  let street = norm(m[1]).replace(/[ ,]+$/, ''); let rest = norm(m[4]).replace(/^[-,\s]+|[-,\s]+$/g, '');
  return { street, num: m[2] + (m[3] || '').toUpperCase(), rest, pc, city };
}
function buildItems() {
  const items = [], info = new Set(), skipped = [];
  for (const sh of S.sheets) { if (!sh.use) continue; const { hdr, map } = sh.det;
    for (let i = hdr + 1; i < sh.rows.length; i++) { const r = sh.rows[i]; if (!r || !r.some(Boolean)) continue;
      const g = k => map[k] != null ? norm(r[map[k]]) : '';
      let raw = map.addr != null ? g('addr') : norm(g('street') + ' ' + g('num'));
      if (!raw || !/\d/.test(raw) || !/[A-Za-zÆØÅæøå]{2}/.test(raw)) { const t = r.filter(Boolean).join(' '); if (t.length > 14) info.add(t); else if (t) skipped.push(`${sh.name} r${i + 1}: ${t}`); continue; }
      const p = parseAddress(raw);
      if (p.street.length > 45 || /,/.test(p.street)) { info.add(r.filter(Boolean).join(' ')); continue; }
      if (!p.num) { skipped.push(`${sh.name} r${i + 1}: ${raw} (intet husnummer)`); continue; }
      const notes = []; if (p.rest) notes.push('Fra adressefeltet: ' + p.rest);
      r.forEach((v, j) => { if (!v || Object.values(map).includes(j)) return; notes.push((sh.det.hdr >= 0 && sh.rows[sh.det.hdr][j] ? norm(sh.rows[sh.det.hdr][j]).replace(/:$/, '') : 'Kol. ' + colName(j)) + ': ' + v); });
      let id = g('id'); if (/^[-–—]$/.test(id)) id = '';
      const pcv = (g('pc').match(/\d{4}/) || [p.pc])[0] || '';
      items.push({ sheet: sh.name, row: i + 1, id, raw, street: p.street, num: p.num, pc: pcv, city: g('city') || p.city, area: g('area'), agreed: g('agreed'), notes });
    } }
  // dubletter på vej+nr
  const keep = [], seen = new Map(), removed = [];
  for (const x of items) { const k = lowkey(x.street) + '#' + nh(x.num) + '#' + (x.pc || ''); const y = seen.get(k);
    if (y) { if (!x.id) { removed.push(`${x.sheet} r${x.row}: ${x.raw} (findes også i ${y.sheet} r${y.row})`); continue; }
      if (!y.id) { keep.splice(keep.indexOf(y), 1); removed.push(`${y.sheet} r${y.row}: ${y.raw} (findes også i ${x.sheet} r${x.row})`); seen.set(k, x); keep.push(x); continue; }
      x.notes.push(`OBS: samme adresse som ${y.sheet} r${y.row}`); }
    seen.set(k, x); keep.push(x); }
  keep.forEach((x, i) => x.i = i);
  S.items = keep; S.info = [...info]; S.removed = removed; S.skipped = skipped;
}

/* ------------------------------------------------------------ trin 1 → 2 */
const drop = $('#drop'), fileIn = $('#file');
drop.addEventListener('click', () => fileIn.click()); drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
fileIn.addEventListener('change', () => fileIn.files[0] && loadFile(fileIn.files[0]));
async function loadFile(f) {
  $('#s1err').innerHTML = '';
  try {
    if (/\.xls$/i.test(f.name)) throw new Error('Gamle .xls-filer kan ikke læses. Åbn filen i Excel/Numbers og gem den som .xlsx.');
    const sheets = /\.(csv|txt)$/i.test(f.name) ? readCsv(await f.text()) : await readXlsx(await f.arrayBuffer());
    S.file = f.name; S.sheets = sheets.filter(s => s.rows.some(r => r.some(Boolean)));
    for (const sh of S.sheets) { sh.det = analyzeSheet(sh); sh.use = sh.det.map.addr != null || (sh.det.map.street != null && sh.det.map.num != null); }
    if (!S.sheets.length) throw new Error('Filen er tom.');
    if (!S.sheets.some(s => s.use)) { S.sheets.forEach(s => s.use = true); renderSheets(); step(2); $('#s2lead').textContent = 'Jeg kunne ikke selv finde adresserne. Klik på fanen herunder og vælg, hvilken kolonne adressen står i.'; return; }
    renderSheets();
    const used = S.sheets.filter(s => s.use);
    const okAll = used.length && used.every(s => s.det.map.addr != null || (s.det.map.street != null && s.det.map.num != null));
    const dataRows = used.reduce((n, sh) => n + sh.rows.slice(sh.det.hdr + 1).filter(r => r.some(Boolean)).length, 0);
    if (okAll && S.items.length && S.items.length >= dataRows * .6) startGeocode(); else step(2);
  } catch (e) { $('#s1err').append(el('div', { class: 'err', text: e.message || String(e) })); }
}
function renderSheets() {
  const box = $('#sheets'); box.innerHTML = '';
  for (const sh of S.sheets) {
    const det = sh.det; const body = el('div', { class: 'body' });
    const hdrSel = el('select', { id: 'hdr-' + sh.name });
    hdrSel.append(el('option', { value: -1, text: 'Ingen overskrift' }));
    for (let i = 0; i < Math.min(15, sh.rows.length); i++) hdrSel.append(el('option', { value: i, text: `Række ${i + 1}: ${sh.rows[i].filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}` }));
    hdrSel.value = det.hdr; hdrSel.addEventListener('change', () => { sh.det = analyzeSheet(sh, +hdrSel.value); renderSheets(); });
    const maps = el('div', { class: 'maps' });
    for (const [role, label] of ROLES) { const s = el('select', { 'data-role': role }); s.append(el('option', { value: '', text: '—' }));
      for (let j = 0; j < det.ncol; j++) s.append(el('option', { value: j, text: headLabel(sh, j).slice(0, 40) }));
      s.value = det.map[role] ?? ''; s.addEventListener('change', () => { if (s.value === '') delete det.map[role]; else det.map[role] = +s.value; refresh(); });
      maps.append(el('label', { class: 'f' }, label, s)); }
    const use = el('input', { type: 'checkbox' }); use.checked = sh.use; use.addEventListener('change', () => { sh.use = use.checked; refresh(); });
    const sumTxt = el('span', { class: 'muted' }); const prev = el('div', { class: 'tablewrap', style: 'margin-top:8px' });
    body.append(el('label', { class: 'f', style: 'max-width:420px' }, 'Overskriftsrække', hdrSel), maps, el('div', { class: 'muted', style: 'font-size:12.5px', text: 'Alle andre kolonner kommer med som noter.' }), prev);
    const d = el('details', { class: 'sheet' }, el('summary', {}, el('label', { onclick: e => e.stopPropagation() }, use), el('b', { text: sh.name }), sumTxt), body);
    box.append(d);
    function refresh() {
      const m = det.map; const parts = ROLES.filter(([r]) => m[r] != null).map(([r, l]) => `${l.split(' ')[0]} = ${colName(m[r])}`);
      const n = sh.rows.slice(det.hdr + 1).filter(r => { const a = m.addr != null ? r[m.addr] : (r[m.street] || '') + ' ' + (r[m.num] || ''); return a && /\d/.test(a) && /[A-Za-zÆØÅæøå]{2}/.test(a); }).length;
      const ok = m.addr != null || (m.street != null && m.num != null);
      sumTxt.textContent = !sh.use ? 'springes over' : ok ? `${n} adresser · ${parts.join(', ')}` : 'mangler adressekolonne – vælg den nedenfor';
      if (sh.use && !ok) d.open = true;
      prev.innerHTML = ''; const t = el('table'); const hr = el('tr'); for (let j = 0; j < Math.min(det.ncol, 10); j++) { const role = Object.entries(m).find(([, v]) => v === j); hr.append(el('th', { text: colName(j) + (role ? ' · ' + ROLES.find(r => r[0] === role[0])[1].split(' ')[0] : '') })); } t.append(hr);
      for (const r of sh.rows.slice(det.hdr + 1).filter(r => r.some(Boolean)).slice(0, 3)) { const tr = el('tr'); for (let j = 0; j < Math.min(det.ncol, 10); j++) tr.append(el('td', { text: (r[j] || '').slice(0, 40) })); t.append(tr); }
      prev.append(t); updateCount();
    }
    sh.refresh = refresh; refresh();
  }
  updateCount();
}
function updateCount() {
  buildItems(); const n = S.items.length;
  $('#s2lead').textContent = `${S.file}: ${n} adresser fundet på ${S.sheets.filter(s => s.use).length} fane(r)` + (S.removed.length ? `, ${S.removed.length} dubletter fjernet` : '') + '. Klik på en fane for at se eller rette kolonnerne.';
  $('#go2').disabled = n === 0;
}
$('#back1').addEventListener('click', () => { fileIn.value = ''; step(1); });

/* ------------------------------------------------------------ adresseopslag */
const NOM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=dk&limit=5';
const geoCache = LS.get('rp-geo-v1', {});
let lastNom = 0;
async function nom(q, extra = '') {
  const key = 'n|' + q + extra; if (geoCache[key]) return geoCache[key];
  for (let t = 0; t < 3; t++) {
    const wait = window.__fast ? 0 : 1100 - (Date.now() - lastNom); if (wait > 0) await sleep(wait); lastNom = Date.now();
    try { const r = await fetch(NOM + (settings.mail ? '&email=' + encodeURIComponent(settings.mail) : '') + '&q=' + encodeURIComponent(q) + extra); if (r.status === 429) { await sleep(5000); continue; } if (!r.ok) throw new Error(r.status);
      const j = (await r.json()).map(x => ({ lat: +x.lat, lon: +x.lon, road: (x.address || {}).road || x.name || '', hn: (x.address || {}).house_number || '', pc: (x.address || {}).postcode || '', town: (x.address || {}).town || (x.address || {}).city || (x.address || {}).village || (x.address || {}).hamlet || '' }));
      geoCache[key] = j; saveCache(); return j; } catch (e) { await sleep(2000); }
  }
  throw new Error('net');
}
async function photon(q, c) {
  const key = 'p|' + q + (c ? c.map(v => v.toFixed(2)).join() : ''); if (geoCache[key]) return geoCache[key];
  const r = await fetch('https://photon.komoot.io/api/?limit=8' + (c ? `&lat=${c[0]}&lon=${c[1]}` : '') + '&q=' + encodeURIComponent(q)); await sleep(400);
  const j = ((await r.json()).features || []).filter(f => f.properties.countrycode === 'DK').map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], road: f.properties.street || f.properties.name || '', hn: f.properties.housenumber || '', pc: f.properties.postcode || '', town: f.properties.city || '' }));
  geoCache[key] = j; saveCache(); return j;
}
let cacheT = 0; function saveCache() { clearTimeout(cacheT); cacheT = setTimeout(() => { const keys = Object.keys(geoCache); if (keys.length > 4000) keys.slice(0, keys.length - 4000).forEach(k => delete geoCache[k]); LS.set('rp-geo-v1', geoCache); }, 500); }
function pick(res, num, street) { let best = null, lvl = 9; for (const x of res) { const h = nh(x.hn); let l; if (h && h === nh(num)) l = 0; else if (h && h.replace(/[A-Z]+$/, '') === nh(num).replace(/[A-Z]+$/, '')) l = 1; else if (x.road) l = 2; else l = 3; if (street && x.road && sim(x.road, street) < .5) l = Math.max(l, 2); if (l < lvl) { lvl = l; best = x; } } return best ? { ...best, acc: 'hnsa'[lvl] } : null; }
function setGeo(x, g, how) { Object.assign(x, { lat: g.lat, lon: g.lon, gRoad: g.road, gHn: g.hn, gPc: g.pc, gTown: g.town, acc: g.acc, how }); }
function log(t) { const l = $('#log'); l.textContent += t + '\n'; l.scrollTop = 1e9; }

$('#go2').addEventListener('click', () => startGeocode());
async function startGeocode() {
  buildItems(); S.stop = false; S.fixing = false; step(3); $('#s3title').textContent = 'Finder adresserne på kortet …'; $('#s3lead').textContent = 'Lad vinduet være åbent. Det tager et par sekunder pr. adresse første gang.'; $('#fix').hidden = false; $('#stop').hidden = false; $('#log').textContent = ''; const items = S.items; const N = items.length;
  const t0 = Date.now(); let done = 0;
  const progress = (txt) => { const p = done / N; $('#bar').style.width = (p * 100).toFixed(1) + '%'; const el2 = (Date.now() - t0) / 1000; const rest = done ? el2 / done * (N - done) : N * 2.5; $('#prog').textContent = `${txt} ${done} af ${N}` + (done < N ? ` · ca. ${Math.max(1, Math.round(rest / 60))} min tilbage` : ''); };
  try {
    // runde 1: vej nr, postnr by / område
    for (const x of items) { if (S.stop) break;
      const ctx = x.pc ? `${x.pc} ${x.city || POSTNAVN[x.pc] || ''}`.trim() : (x.city || x.area || x.sheet);
      const r = pick(await nom(`${x.street} ${x.num}, ${ctx}`), x.num, x.street); if (r) setGeo(x, r, 1); else x.acc = 'x';
      done++; progress('Slår op:'); }
    // ramme og postnumre pr. fane ud fra sikre fund
    const box = {}, pcs = {}, towns = {};
    for (const x of items) if (x.acc === 'h') { const b = box[x.sheet] = box[x.sheet] || [99, 99, -99, -99]; b[0] = Math.min(b[0], x.lon); b[1] = Math.min(b[1], x.lat); b[2] = Math.max(b[2], x.lon); b[3] = Math.max(b[3], x.lat); (pcs[x.sheet] = pcs[x.sheet] || new Set()).add(x.gPc); if (x.gTown) (towns[x.sheet] = towns[x.sheet] || new Set()).add(x.gTown); }
    const hard = items.filter(x => x.acc !== 'h'); let k2 = 0;
    for (const x of hard) { if (S.stop) break; k2++; $('#prog').textContent = `Prøver igen med usikre adresser: ${k2} af ${hard.length}`;
      const b = box[x.sheet]; let p = null;
      if (b) { p = pick(await nom(`${x.street} ${x.num}`, `&viewbox=${b[0] - .12},${b[3] + .12},${b[2] + .12},${b[1] - .12}&bounded=1`), x.num, x.street); if (p && p.acc === 'h') { setGeo(x, p, 2); continue; } }
      for (const pc of [...(pcs[x.sheet] || [])].slice(0, 4)) { if (!pc) continue; const q = pick(await nom(`${x.street} ${x.num}, ${pc}`), x.num, x.street); if (q && q.acc === 'h') { p = q; break; } }
      if (p && p.acc === 'h') { setGeo(x, p, 3); continue; }
      const c = b ? [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2] : null; let approx = null, hit = null;
      try { for (const q of [`${x.street} ${x.num} ${x.city || x.area || x.sheet}`, ...[...(towns[x.sheet] || [])].slice(0, 3).map(t => `${x.street} ${x.num} ${t}`), `${x.street} ${x.num}`, `${x.street} ${x.area || x.sheet}`]) {
          for (const f of await photon(q, c)) { if (c && km(c, [f.lat, f.lon]) > 40) continue;
            if (nh(f.hn) === nh(x.num) && sim(f.road, x.street) >= .6) { hit = { ...f, acc: 'h' }; break; }
            if (!approx && c) approx = { ...f, acc: 'a' }; }
          if (hit) break; } } catch (e) { }
      if (hit) setGeo(x, hit, 4); else if (p && (x.acc === 'x' || 'hnsax'.indexOf(p.acc) < 'hnsax'.indexOf(x.acc))) setGeo(x, p, 2); else if (x.acc === 'x' && approx) setGeo(x, approx, 4);
    }
    if (S.fixing) { step(2); return; }
  } catch (e) { $('#log').textContent = ''; log('Kunne ikke kontakte adressetjenesten. Tjek internetforbindelsen og prøv igen.'); $('#prog').textContent = 'Stoppet'; $('#log').after(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'primary', text: 'Prøv igen', onclick: e => { e.target.parentNode.remove(); step(2); $('#go2').click(); } }))); return; }
  finishGeo();
}
$('#stop').addEventListener('click', () => { S.stop = true; });
$('#fix').addEventListener('click', () => { S.fixing = true; S.stop = true; });

function finishGeo() {
  const items = S.items; const townsByPc = {};
  for (const x of items) if (x.gPc && x.gTown) { const c = townsByPc[x.gPc] = townsByPc[x.gPc] || {}; c[x.gTown] = (c[x.gTown] || 0) + 1; }
  for (const x of items) {
    x.flags = [];
    if (x.acc === 'x' || x.lat == null) { x.acc = 'x'; continue; }
    x.postnr = x.gPc || x.pc; x.by = (x.pc === x.postnr && x.city) || POSTNAVN[x.postnr] || (townsByPc[x.postnr] ? Object.entries(townsByPc[x.postnr]).sort((a, b) => b[1] - a[1])[0][0] : '') || x.gTown || x.city;
    x.vej = x.acc === 'h' && x.gRoad ? x.gRoad : x.street;
    if (x.acc === 'h' && x.gRoad && lowkey(x.gRoad) !== lowkey(x.street)) x.flags.push(`Stavet "${x.street}" i arket`);
    if (x.acc === 'n') x.flags.push(`OBS: kun fundet som ${x.gRoad} ${x.gHn} – tjek husnummeret`);
    if (x.acc === 's' || x.acc === 'a') x.flags.push('OBS: præcis adresse ikke fundet – kortnålen er omtrentlig');
  }
  // langt fra resten af fanen
  for (const sh of new Set(items.map(x => x.sheet))) { const pts = items.filter(x => x.sheet === sh && x.acc !== 'x'); if (pts.length < 3) continue; const m = [median(pts.map(p => p.lat)), median(pts.map(p => p.lon))];
    for (const p of pts) if (km(m, [p.lat, p.lon]) > 25 && Math.min(...pts.filter(q => q !== p).map(q => km([q.lat, q.lon], [p.lat, p.lon]))) > 15) { p.far = true; p.flags.push('OBS: ligger langt fra de øvrige på samme fane – tjek byen'); } }
  // dubletter efter placering + husnr
  const keep = [];
  for (const x of items) { if (x.acc === 'x') { keep.push(x); continue; }
    const d = keep.find(y => y.acc !== 'x' && nh(y.num) === nh(x.num) && km([x.lat, x.lon], [y.lat, y.lon]) < .02);
    if (d && (!x.id || !d.id)) { const [drop, kept] = !x.id ? [x, d] : [d, x]; S.removed.push(`${drop.sheet} r${drop.row}: ${drop.raw} (samme hus som ${kept.sheet} r${kept.row})`); if (drop === d) { keep.splice(keep.indexOf(d), 1); keep.push(x); } continue; }
    keep.push(x); }
  S.items = keep;
  renderIssues();
}

/* ------------------------------------------------------------ trin 4: tjek */
function renderIssues() {
  const box = $('#issues'); box.innerHTML = '';
  const iss = S.items.filter(x => x.acc !== 'h' || x.far);
  const ok = S.items.filter(x => x.acc === 'h').length;
  if (!iss.length) { routeAndShow(); return; }
  $('#s4title').textContent = iss.length === 1 ? '1 adresse er usikker' : `${iss.length} adresser er usikre`;
  $('#s4lead').textContent = `${ok} af ${S.items.length} adresser blev fundet præcist. De usikre herunder kan du rette og søge igen, eller udelade. Du kan også bare trykke Fortsæt – så kommer de med som de er og står på fanen Bemærkninger i Excel-filen.`;
  for (const x of iss) {
    const chip = () => { const [t, c] = x.excluded ? ['Udeladt', 'mut'] : x.approved ? ['Godkendt', 'ok'] : x.far && x.acc === 'h' ? ['Langt væk', 'warn'] : PREC[x.acc]; return el('span', { class: 'chip ' + c, text: t }); };
    const found = () => x.acc === 'x' ? 'Ikke fundet' : `Fundet: ${x.gRoad || '?'} ${x.gHn || ''}, ${x.gPc || ''} ${x.gTown || ''}`;
    const inp = el('input', { type: 'text', value: `${x.street} ${x.num}, ${x.pc || x.postnr || ''} ${x.city || x.by || x.area || ''}`.replace(/\s+,/, ',').trim(), 'aria-label': 'Adresse' });
    const status = el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:4px', text: found() });
    const chipBox = el('span', {}, chip());
    const search = el('button', { class: 'small', text: 'Søg igen' }); const appr = el('button', { class: 'small', text: 'Godkend' }); const excl = el('button', { class: 'small', text: 'Udelad' });
    const upd = () => { chipBox.replaceChildren(chip()); status.textContent = found(); excl.textContent = x.excluded ? 'Tag med igen' : 'Udelad'; appr.disabled = x.acc === 'x'; };
    search.addEventListener('click', async () => { search.disabled = true; search.textContent = 'Søger…';
      try { const p = parseAddress(inp.value); const q = inp.value; const num = p.num || x.num, street = p.street || x.street;
        let r = pick(await nom(q), num, street); if (!r || r.acc !== 'h') { const c = x.lat != null ? [x.lat, x.lon] : null; const ph = await photon(q, c); const f = ph.find(f => nh(f.hn) === nh(num) && sim(f.road, street) >= .6); if (f) r = { ...f, acc: 'h' }; else if (!r && ph[0]) r = { ...ph[0], acc: 'a' }; }
        if (r) { setGeo(x, r, 5); x.street = street; x.num = num; if (p.pc) { x.pc = p.pc; x.city = p.city; } x.far = false; x.approved = r.acc === 'h'; } else status.textContent = 'Intet fundet – prøv en anden stavning.';
        finishOne(x); } catch (e) { status.textContent = 'Kunne ikke søge (internet?).'; }
      search.disabled = false; search.textContent = 'Søg igen'; upd(); });
    appr.addEventListener('click', () => { x.approved = true; x.excluded = false; upd(); });
    excl.addEventListener('click', () => { x.excluded = !x.excluded; upd(); });
    box.append(el('div', { class: 'issue' }, el('div', { class: 'what' }, el('b', { text: x.raw }), el('div', { class: 'muted', text: `${x.sheet}, række ${x.row}${x.id ? ' · ' + x.id : ''}` }), chipBox), el('div', {}, inp, status), el('div', { class: 'acts' }, search, appr, excl)));
    upd();
  }
  step(4);
}
function finishOne(x) { // opdater afledte felter efter manuel søgning
  x.postnr = x.gPc || x.pc; x.by = POSTNAVN[x.postnr] || x.gTown || x.city; x.vej = x.acc === 'h' && x.gRoad ? x.gRoad : x.street;
  x.flags = x.flags.filter(f => !f.startsWith('OBS'));
  if (x.acc === 'n') x.flags.push(`OBS: kun fundet som ${x.gRoad} ${x.gHn} – tjek husnummeret`);
  if (x.acc === 's' || x.acc === 'a') x.flags.push('OBS: præcis adresse ikke fundet – kortnålen er omtrentlig');
}

/* ------------------------------------------------------------ dage ad vejene */
const OSRM = 'https://router.project-osrm.org';
async function osrm(path) { for (let t = 0; t < 3; t++) { try { const r = await fetch(OSRM + path); if (r.status === 429) { await sleep(3000); continue; } const j = await r.json(); await sleep(400); if (j.code === 'Ok') return j; return null; } catch (e) { await sleep(1500); } } return null; }
function prog(txt, frac) { $('#prog').textContent = txt; if (frac != null) $('#bar').style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; }

/* Køretid (sek.) og afstand (m) mellem alle punkter ad vejnettet. OSRM tillader ca. 100 punkter pr. kald,
   så tabellen hentes i firkanter på 45 × 45. Mangler et svar, anslås afstanden og det noteres. */
async function roadMatrix(pts, onp) {
  const n = pts.length, B = 45;
  const dur = [...Array(n)].map(() => new Array(n).fill(0)), dist = [...Array(n)].map(() => new Array(n).fill(0));
  const ch = []; for (let s = 0; s < n; s += B) ch.push([...Array(Math.min(B, n - s)).keys()].map(k => s + k));
  const jobs = []; for (const I of ch) for (const J of ch) jobs.push([I, J]);
  let k = 0, est = 0;
  for (const [I, J] of jobs) {
    onp && onp(++k, jobs.length);
    const same = I === J, ids = same ? I : I.concat(J);
    const q = ids.map(i => pts[i].lon.toFixed(5) + ',' + pts[i].lat.toFixed(5)).join(';');
    const j = await osrm(`/table/v1/driving/${q}?annotations=duration,distance` + (same ? '' : `&sources=${I.map((_, a) => a).join(';')}&destinations=${J.map((_, b) => I.length + b).join(';')}`));
    I.forEach((i, a) => J.forEach((jj, b) => {
      if (i === jj) return;
      const d = j && j.durations && j.durations[a] ? j.durations[a][b] : null, m = j && j.distances && j.distances[a] ? j.distances[a][b] : null;
      if (d != null && m != null) { dur[i][jj] = d; dist[i][jj] = m; }
      else { const kk = km([pts[i].lat, pts[i].lon], [pts[jj].lat, pts[jj].lon]) * 1300; dist[i][jj] = kk; dur[i][jj] = kk / 13.9 + 60; est++; }
    }));
  }
  return { dur, dist, est };
}

/* Kører solveVRP i små bidder i selve siden (solveVRPAsync), så vinduet ikke fryser.
   (Version 2.0–2.2 brugte en baggrundstråd; den fik siden til at gå ned i nogle browsere.) */
async function runSolver(C, T, opt, onTick) {
  const r = await solveVRPAsync(C, Object.assign({}, opt, { time: T }), onTick);
  return { routes: r.routes, tooLong: r.tooLong, log: r.log };
}

async function planDays() {
  const items = S.items.filter(x => !x.excluded && x.acc !== 'x');
  if (!items.length) throw new Error('Der er ingen fundne adresser at planlægge.');
  for (const x of items) if (x.lat == null) throw new Error('mangler placering for ' + x.raw);
  S.routeNote = '';
  // hjem: start og slut hver dag
  prog('Finder hjemadressen …', 0.02);
  let home = null;
  if (settings.home) { const r = await nom(settings.home).catch(() => []); if (r[0]) home = { lat: r[0].lat, lon: r[0].lon, gq: settings.home, hjem: true }; }
  if (!home) throw new Error(settings.home ? `Hjemadressen "${settings.home}" blev ikke fundet. Ret den under Indstillinger øverst på forsiden.` : 'Skriv din hjemadresse under Indstillinger – hver dag starter og slutter der.');
  S.home = home;
  const pts = [home, ...items];
  // 1) køretider og km ad vejene mellem alle huse
  // afstandene gemmes på computeren, så en ny beregning med de samme huse ikke skal hente dem igen
  const mKey = pts.map(p => p.lat.toFixed(5) + ',' + p.lon.toFixed(5)).join(';');
  let M = null; try { const c = JSON.parse(localStorage.getItem('rp-mx-v1') || 'null'); if (c && c.key === mKey) { M = { dur: c.dur, dist: c.dist, est: c.est || 0 }; prog('Bruger gemte køretider og km …', 0.4); } } catch (e) { }
  if (!M) {
    M = await roadMatrix(pts, (k, n) => prog(`Henter køretider og km ad vejene … ${k} af ${n}`, 0.04 + 0.36 * k / n));
    if (!M.est) try { const r = a => a.map(row => row.map(v => Math.round(v))); localStorage.setItem('rp-mx-v1', JSON.stringify({ key: mKey, dur: r(M.dur), dist: r(M.dist) })); } catch (e) { }
  }
  if (M.est) S.routeNote += `${M.est} af ${pts.length * (pts.length - 1)} afstande kunne ikke hentes fra ruteserveren og er anslået. `;
  // 2) fordel på dage
  const timeMs = Math.round(Math.min(3000, 1000 + items.length * 10)); // målt: længere søgning giver under 0,2 % mindre kørsel // forbedringen flader ud efter få sekunder (målt: 176 huse er færdige efter ca. 5 sek.)
  const tick = el => { const f = Math.min(1, el / timeMs); prog(`Fordeler ${items.length} huse på dage (${goalTxt()}) … ca. ${Math.max(1, Math.ceil((timeMs - el) / 1000))} sek.`, 0.4 + 0.45 * f); };
  tick(0);
  let res;
  try { res = await runSolver(settings.goal === 'km' ? M.dist : M.dur, M.dur, { service: settings.min * 60, limit: byStops() ? null : settings.hours * 3600, maxStops: byStops() ? +settings.stops : null, softLimit: byStops() ? settings.hours * 3600 : null, softWeight: byStops() ? (settings.goal === 'km' ? 8 : 2) : 0, dayCost: byStops() ? (settings.goal === 'km' ? 100000 : 5400) : 0, timeMs, maxIter: 1e6, seed: 7, lambdas: [0.8, 1.0, 1.2] }, tick); }
  catch (e) { throw new Error('Beregningen af dagene fejlede (' + (e.message || e) + ').'); }
  S.solverLog = res.log;
  // 3) dagene i rækkefølge nord → syd, og hver dags vej hentes for at få kort og præcise etaper
  const days = res.routes.map(r => ({ idx: r, items: r.map(i => pts[i]) }));
  days.forEach(d => { d.c = d.items.reduce((s, p) => s + p.lat, 0) / d.items.length; });
  days.sort((a, b) => b.c - a.c);
  const all = [];
  for (let k = 0; k < days.length; k++) {
    const d = days[k]; d.n = k + 1; d.code = 'D' + d.n; d.col = BLOCKCOL[k % BLOCKCOL.length];
    prog(`Tegner dag ${d.n} af ${days.length} …`, 0.85 + 0.15 * k / days.length);
    const seq = [home, ...d.items, home];
    const j = await osrm(`/route/v1/driving/${seq.map(p => p.lon.toFixed(5) + ',' + p.lat.toFixed(5)).join(';')}?overview=simplified&geometries=geojson&continue_straight=false`);
    let legs;
    if (j && j.routes && j.routes[0].legs.length === seq.length - 1) { legs = j.routes[0].legs.map(l => [l.distance / 1000, l.duration / 60]); d.geom = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); }
    else { const ix = [0, ...d.idx, 0]; legs = ix.slice(1).map((b, i) => [M.dist[ix[i]][b] / 1000, M.dur[ix[i]][b] / 60]); d.geom = null; }
    const r1 = v => Math.round(v * 10) / 10;
    d.items.forEach((x, i) => { x.day = d.code; x.dayNo = i + 1; x.first = i === 0; x.leg = [r1(legs[i][0]), r1(legs[i][1])]; all.push(x); });
    const last = legs[legs.length - 1]; d.back = [r1(last[0]), r1(last[1])];
    d.km = legs.reduce((s, l) => s + l[0], 0); d.drive = legs.reduce((s, l) => s + l[1], 0);
    d.work = d.items.length * settings.min; d.total = d.drive + d.work; d.over = d.total > settings.hours * 60 + 1;
    const names = []; for (const x of d.items) { const nm = x.area || x.by || x.sheet; if (nm && !names.some(m => sim(m, nm) >= .72)) names.push(nm); }
    d.areas = names.slice(0, 4).join(' · ') + (names.length > 4 ? ' …' : ''); d.name = `Dag ${d.n} · ${d.areas}`;
  }
  all.forEach((x, i) => { x.stop = i + 1; x.fuld = `${x.vej} ${x.num}, ${x.postnr} ${x.by}`.replace(/\s+,/, ',').trim(); x.gq = (x.acc === 'h' || x.acc === 'n') ? x.fuld : `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`; x.note = [...x.flags.filter(f => !f.startsWith('OBS') || !x.approved), ...x.notes].join(' · '); });
  if (res.tooLong && res.tooLong.length) S.routeNote += `${res.tooLong.length} hus(e) ligger så langt væk, at turen alene tager mere end ${fmtH(settings.hours)} timer – de har fået deres egen dag. `;
  S.days = days; S.order = all;
  // Google Maps: hjem → huse → hjem, højst 10 punkter pr. link (Googles grænse)
  S.etaper = [];
  for (const d of days) {
    const P = [home, ...d.items, home];
    for (let s = 0, e = 1; s < P.length - 1; s += 9, e++) {
      const w = P.slice(s, s + 10); const ch = w.slice(1).filter(p => !p.hjem);
      if (!ch.length) break; // kun turen hjem tilbage – den behøver ikke sit eget link
      S.etaper.push({ d, e, from: w[0], to: w[w.length - 1], ch, url: 'https://www.google.com/maps/dir/' + w.map(p => encodeURIComponent(p.gq).replace(/%2C/g, ',')).join('/') + '/data=!4m2!4m1!3e0' });
    }
  }
}
async function routeAndShow() {
  const btns = [$('#go4'), $('#go4top')]; btns.forEach(b => { b.disabled = true; b.textContent = 'Planlægger …'; });
  step(3); $('#s3title').textContent = 'Planlægger dagene ad vejene …'; $('#s3lead').textContent = 'Lad vinduet være åbent. Det tager typisk under 1 minut. Går siden ned, så tryk Genindlæs og vælg filen igen – adresser og afstande er gemt, så anden gang går hurtigt.'; $('#fix').hidden = true; $('#stop').hidden = true; $('#log').textContent = ''; prog('Starter …', 0);
  try { await planDays(); step(5); renderResult(); } // kortet skal tegnes, mens siden er synlig
  catch (e) { console.error(e); step(4); if (!$('#issues').children.length) { $('#s4title').textContent = 'Ruten kunne ikke beregnes'; $('#s4lead').textContent = ''; } $('#issues').prepend(el('div', { class: 'err', text: (e.message || String(e)) })); }
  btns.forEach(b => { b.disabled = false; }); $('#go4').textContent = 'Fortsæt'; $('#go4top').textContent = 'Fortsæt uden at rette';
}
$('#go4').addEventListener('click', routeAndShow); $('#go4top').addEventListener('click', routeAndShow);

/* ------------------------------------------------------------ send til telefonen
   Hele ruten pakkes ind i et link til telefon.html (plan-link.js). Ingen server og ingen login:
   den der trykker på linket, får ruten gemt på sin telefon. */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function planTitle() { return (S.planTitle || S.info[0] || stem()).slice(0, 80); }
function makePlanLink() {
  const days = S.days.map(d => [d.name, Math.round(d.km), Math.round(d.drive)]);
  const stops = S.order.map(x => { const approx = !(x.acc === 'h' || x.acc === 'n');
    const r = [S.days.findIndex(d => d.code === x.day), x.fuld, x.id || '', x.area || x.sheet || '', x.agreed || '', x.note || '', approx ? +x.lat.toFixed(5) : null, approx ? +x.lon.toFixed(5) : null];
    while (r.length > 2 && (r[r.length - 1] === '' || r[r.length - 1] == null)) r.pop(); return r; });
  const made = new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
  S.plan = { v: 1, id: 'p' + Date.now().toString(36), t: planTitle(), m: made, h: settings.home, u: 'dag', d: days, s: stops };
  S.link = new URL('telefon.html', location.href).href + '#' + PlanLink.encode(S.plan);
  LS.set('rp-last', { link: S.link, t: S.plan.t, m: made, n: stops.length, days: days.length, km: Math.round(S.days.reduce((a, d) => a + d.km, 0)) });
}
function shareBox(last) {
  const get = () => last ? last.link : S.link, title = () => last ? last.t : planTitle();
  const msg = el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:8px' });
  const text = () => `Hej! Her er din kørselsrute (${title()}). Tryk på linket – så ligger ruten på din telefon:\n${get()}`;
  const box = el('div', { class: 'share' });
  if (!last) {
    const inp = el('input', { type: 'text', value: planTitle(), 'aria-label': 'Navn på ruten' });
    inp.addEventListener('change', () => { S.planTitle = inp.value.trim() || ''; makePlanLink(); renderLastPlan(); msg.textContent = 'Navnet er rettet i linket.'; });
    box.append(el('label', { class: 'f', style: 'max-width:420px;margin-bottom:10px' }, 'Navn på ruten (står øverst på telefonen)', inp));
  }
  const btns = el('div', { class: 'row' });
  if (navigator.share) btns.append(el('button', { class: 'primary big', text: 'Send …', onclick: async () => { try { await navigator.share({ title: 'Kørselsrute', text: text().split('\n')[0], url: get() }); msg.textContent = 'Sendt.'; } catch (e) { } } }));
  btns.append(el('button', { class: navigator.share ? 'big' : 'primary big', text: 'Kopiér link', onclick: async () => {
    try { await navigator.clipboard.writeText(get()); msg.textContent = 'Linket er kopieret. Sæt det ind i en SMS, mail eller Messenger (Ctrl+V).'; }
    catch (e) { const ta = el('textarea', { style: 'width:100%;height:80px;margin-top:8px' }); ta.value = get(); msg.replaceChildren('Kopiér linket herunder (markér alt og Ctrl+C):', ta); ta.select(); } } }));
  if (isMobile) btns.append(el('a', { class: 'btnlink', href: 'sms:?&body=' + encodeURIComponent(text()), text: 'Send SMS' }));
  btns.append(el('a', { class: 'btnlink', href: 'mailto:?subject=' + encodeURIComponent('Kørselsrute: ' + title()) + '&body=' + encodeURIComponent(text()), text: 'Send mail' }));
  box.append(btns);
  box.append(el('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0' }, 'Virker på iPhone og Android. Linket er langt, fordi hele ruten er gemt i det – sørg for at hele linket kommer med. ', el('a', { href: get(), target: '_blank', rel: 'noopener', text: 'Se telefonvisningen' })));
  box.append(msg);
  return box;
}
function renderLastPlan() {
  const box = $('#lastPlan'); if (!box) return; const L = LS.get('rp-last', null); box.innerHTML = ''; if (!L || !L.link) return;
  const inner = el('div', { class: 'lastplan' }, el('div', {}, el('b', { text: 'Seneste rute: ' }), `${L.t} · ${L.n} huse på ${L.days} ${L.days === 1 ? 'dag' : 'dage'} · ca. ${L.km} km · lavet ${L.m}`));
  const panel = el('div', { hidden: true, style: 'margin-top:10px' });
  inner.append(el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'small', text: 'Send til telefonen igen', onclick: () => { panel.hidden = !panel.hidden; if (!panel.children.length) panel.append(shareBox(L)); } }), el('a', { href: L.link, target: '_blank', rel: 'noopener', text: 'Se telefonvisningen', style: 'font-size:13.5px' })), panel);
  box.append(inner);
}
renderLastPlan();

/* ------------------------------------------------------------ resultat */
function renderResult() {
  const D = S.days, n = S.order.length;
  const kmAll = D.reduce((s, d) => s + d.km, 0), drive = D.reduce((s, d) => s + d.drive, 0), work = n * settings.min;
  const excl = S.items.filter(x => x.excluded || x.acc === 'x').length;
  $('#s5lead').textContent = `${n} huse fordelt på ${D.length} ${D.length === 1 ? 'arbejdsdag' : 'arbejdsdage'}. Hver dag starter og slutter ved ${settings.home}. Planlagt efter ${goalTxt()} ad vejene, ${limitTxt()}.` + (excl ? ` ${excl} er ikke med (udeladt eller ikke fundet).` : '');
  const notes = $('#s5notes'); notes.innerHTML = '';
  if (S.routeNote) notes.append(el('div', { class: 'note', text: S.routeNote.trim() }));
  const over = D.filter(d => d.over);
  if (over.length) notes.append(el('div', { class: 'note', text: byStops() ? `Til orientering: ${over.map(d => 'dag ' + d.n).join(', ')} bliver længere end ${fmtH(settings.hours)} timer med ${settings.stops} huse.` : `OBS: ${over.map(d => 'dag ' + d.n).join(', ')} bliver længere end ${fmtH(settings.hours)} timer, fordi husene ligger langt væk.` }));
  const tile = (k, v) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }));
  $('#tiles').replaceChildren(tile('Huse', n), tile('Dage', D.length), tile('Km i alt', t0d(kmAll)), tile('Køretid', t1(drive / 60) + ' t'), tile(`Arbejde (${settings.min} min/hus)`, t1(work / 60) + ' t'), tile('Længste dag', t1(Math.max(...D.map(d => d.total)) / 60) + ' t'));
  const tb = $('#blocks'); tb.innerHTML = '';
  tb.append(el('tr', {}, el('th', { text: 'Dag' }), el('th', { text: 'Områder' }), el('th', { class: 'num', text: 'Huse' }), el('th', { class: 'num', text: 'Km' }), el('th', { class: 'num', text: 'Køretid' }), el('th', { class: 'num', text: 'Arbejde' }), el('th', { class: 'num', text: 'I alt' }), el('th', { text: 'Google Maps' })));
  for (const d of D) {
    const links = el('td', { class: 'glinks' });
    S.etaper.filter(e => e.d === d).forEach(e => links.append(el('a', { href: e.url, target: '_blank', rel: 'noopener', text: 'Del ' + e.e })));
    tb.append(el('tr', {}, el('td', {}, el('span', { class: 'dot', style: `background:${d.col[0]}` }), String(d.n)), el('td', { text: d.areas }), el('td', { class: 'num', text: d.items.length }), el('td', { class: 'num', text: t0d(d.km) }), el('td', { class: 'num', text: t1(d.drive / 60) + ' t' }), el('td', { class: 'num', text: t1(d.work / 60) + ' t' }), el('td', { class: 'num' + (d.over ? ' over' : ''), text: t1(d.total / 60) + ' t' }), links));
  }
  tb.append(el('tr', { class: 'sum' }, el('td', { text: 'I alt' }), el('td'), el('td', { class: 'num', text: n }), el('td', { class: 'num', text: t0d(kmAll) }), el('td', { class: 'num', text: t1(drive / 60) + ' t' }), el('td', { class: 'num', text: t1(work / 60) + ' t' }), el('td', { class: 'num', text: t1((drive + work) / 60) + ' t' }), el('td')));
  makePlanLink(); $('#shareBox').replaceChildren(shareBox()); renderLastPlan();
  drawMap();
}
let lmap = null;
function drawMap() {
  const box = $('#map'); const pts = [S.home, ...S.order];
  if (window.L && L.map) { try {
    if (lmap) { lmap.remove(); lmap = null; } box.innerHTML = '';
    lmap = L.map(box, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragydere' }).addTo(lmap);
    for (const d of S.days) {
      L.polyline(d.geom || [[S.home.lat, S.home.lon], ...d.items.map(x => [x.lat, x.lon]), [S.home.lat, S.home.lon]], { color: d.col[0], weight: 3, opacity: .75, dashArray: d.geom ? null : '4 6' }).bindTooltip(d.name).addTo(lmap);
      for (const x of d.items) L.circleMarker([x.lat, x.lon], { radius: 5, color: '#fff', weight: 1, fillColor: d.col[0], fillOpacity: 1 }).bindTooltip(`Dag ${d.n}, nr. ${x.dayNo}: ${x.fuld}${x.id ? ' (' + x.id + ')' : ''}`).addTo(lmap);
    }
    L.circleMarker([S.home.lat, S.home.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#152429', fillOpacity: 1 }).bindTooltip('Hjem: ' + settings.home).addTo(lmap);
    lmap.fitBounds(L.latLngBounds(pts.map(x => [x.lat, x.lon])).pad(.05)); return; } catch (e) { } }
  // reserve uden kortbaggrund
  const la = pts.map(p => p.lat), lo = pts.map(p => p.lon); const minLa = Math.min(...la), maxLa = Math.max(...la), minLo = Math.min(...lo), maxLo = Math.max(...lo);
  const W = 1000, H = 420, kx = Math.cos((minLa + maxLa) / 2 * Math.PI / 180); const sx = (maxLo - minLo) * kx || .01, sy = (maxLa - minLa) || .01; const sc = Math.min((W - 40) / sx, (H - 40) / sy);
  const ox = (W - sx * sc) / 2, oy = (H - sy * sc) / 2; const X = p => ox + (p[1] - minLo) * kx * sc, Y = p => H - oy - (p[0] - minLa) * sc;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const d of S.days) { const line = d.geom || [[S.home.lat, S.home.lon], ...d.items.map(x => [x.lat, x.lon]), [S.home.lat, S.home.lon]];
    svg += `<polyline fill="none" stroke="${d.col[0]}" stroke-width="1.5" opacity=".7" points="${line.map(p => X(p).toFixed(1) + ',' + Y(p).toFixed(1)).join(' ')}"/>`;
    for (const x of d.items) svg += `<circle cx="${X([x.lat, x.lon]).toFixed(1)}" cy="${Y([x.lat, x.lon]).toFixed(1)}" r="4" fill="${d.col[0]}"><title>Dag ${d.n}: ${escXml(x.fuld)}</title></circle>`; }
  svg += `<rect x="${(X([S.home.lat, S.home.lon]) - 6).toFixed(1)}" y="${(Y([S.home.lat, S.home.lon]) - 6).toFixed(1)}" width="12" height="12" fill="currentColor"><title>Hjem</title></rect>`;
  box.innerHTML = svg + '</svg>';
}


/* ------------------------------------------------------------ Excel-skrivning (egen, uden biblioteker ud over JSZip) */
const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
class Styles {
  constructor() { this.fonts = ['<font><sz val="10"/><name val="Arial"/></font>']; this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; this.borders = ['<border><left/><right/><bottom/><top/><diagonal/></border>']; this.numFmts = {}; this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']; this.memo = {}; }
  idx(arr, x) { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; }
  get(o = {}) { const key = JSON.stringify(o); if (key in this.memo) return this.memo[key];
    const f = this.idx(this.fonts, `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}${o.u ? '<u/>' : ''}<sz val="${o.sz || 10}"/><color rgb="FF${o.color || '000000'}"/><name val="Arial"/></font>`);
    const fi = o.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const bd = o.border ? this.idx(this.borders, `<border><left/><right/>${o.border.top ? `<top style="${o.border.top}"><color rgb="FF${o.border.topc || '1F4E5F'}"/></top>` : '<top/>'}${o.border.bottom ? `<bottom style="${o.border.bottom}"><color rgb="FF${o.border.bottomc || 'D0D0D0'}"/></bottom>` : '<bottom/>'}<diagonal/></border>`) : 0;
    let nf = 0; if (o.nf) { if (o.nf === '0') nf = 1; else { if (!this.numFmts[o.nf]) this.numFmts[o.nf] = 164 + Object.keys(this.numFmts).length; nf = this.numFmts[o.nf]; } }
    const al = (o.wrap || o.v || o.h) ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''}${o.v ? ` vertical="${o.v}"` : ''}${o.wrap ? ' wrapText="1"' : ''}/>` : '';
    this.xfs.push(`<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${bd}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${fi ? ' applyFill="1"' : ''}${bd ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`);
    return this.memo[key] = this.xfs.length - 1; }
  xml() { const nfs = Object.entries(this.numFmts); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nfs.length ? `<numFmts count="${nfs.length}">${nfs.map(([c, id]) => `<numFmt numFmtId="${id}" formatCode="${escXml(c)}"/>`).join('')}</numFmts>` : ''}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.cols = []; this.links = []; this.heights = {}; this.freeze = null; this.filter = null; }
  set(r, c, v, s, extra = {}) { (this.rows[r] = this.rows[r] || [])[c] = { v, s, ...extra }; if (extra.link) this.links.push({ ref: colName(c) + (r + 1), url: extra.link }); }
  xml() {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    x += '<sheetViews><sheetView workbookViewId="0"' + (this.first ? ' tabSelected="1"' : '') + '>';
    if (this.freeze) { const [c, r] = this.freeze; const tl = colName(c) + (r + 1); x += `<pane${c ? ` xSplit="${c}"` : ''}${r ? ` ySplit="${r}"` : ''} topLeftCell="${tl}" activePane="${c && r ? 'bottomRight' : r ? 'bottomLeft' : 'topRight'}" state="frozen"/>`; }
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="13"/>';
    if (this.cols.length) x += '<cols>' + this.cols.map((w, i) => w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '').join('') + '</cols>';
    x += '<sheetData>';
    this.rows.forEach((row, r) => { if (!row) return; x += `<row r="${r + 1}"${this.heights[r] ? ` ht="${this.heights[r]}" customHeight="1"` : ''}>`;
      row.forEach((c, j) => { if (!c) return; const ref = colName(j) + (r + 1); const s = c.s ? ` s="${c.s}"` : '';
        if (c.f) x += `<c r="${ref}"${s}${typeof c.v === 'string' ? ' t="str"' : ''}><f>${escXml(c.f)}</f>${c.v != null && c.v !== '' ? `<v>${escXml(c.v)}</v>` : ''}</c>`;
        else if (c.v == null || c.v === '') x += s ? `<c r="${ref}"${s}/>` : '';
        else if (typeof c.v === 'number' && isFinite(c.v)) x += `<c r="${ref}"${s}><v>${c.v}</v></c>`;
        else x += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(c.v)}</t></is></c>`; });
      x += '</row>'; });
    x += '</sheetData>';
    if (this.filter) x += `<autoFilter ref="${this.filter}"/>`;
    if (this.links.length) x += '<hyperlinks>' + this.links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('') + '</hyperlinks>';
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>'; return x; }
  rels() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.links.map((l, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`; }
}
async function workbookBlob(sheets, styles, defined) {
  const z = new JSZip(); sheets[0].first = true;
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  z.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Ruteplan</dc:title><dc:creator>Ruteplanlægger</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  sheets.forEach((s, i) => { z.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml()); if (s.links.length) z.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, s.rels()); });
  z.file('xl/styles.xml', styles.xml());
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
function buildExcel() {
  const st = new Styles(); const T = '1F4E5F';
  const H = st.get({ b: 1, color: 'FFFFFF', fill: T, wrap: 1, v: 'center' });
  const ord = S.order; const N = ord.length + 1; const D = S.days;
  const dayOf = x => D.find(d => d.code === x.day);
  // Ruteplan: ét hus pr. række i kørselsrækkefølge
  const rp = new Sheet('Ruteplan');
  const cols = ['Stop', 'Dag', 'Nr. på dagen', 'Område', 'Postnr', 'By', 'Vej', 'Husnr', 'Fuld adresse', 'Hus-ID', 'Aftalt med', 'Note', 'Km fra forrige', 'Min fra forrige', 'Google Maps', 'Apple Maps', 'Udført', 'Bredde', 'Længde', 'Fra ark (række)'];
  rp.cols = [6, 6, 7, 15, 8, 13, 22, 8, 36, 10, 20, 48, 9, 9, 12, 12, 8, 10, 10, 20];
  cols.forEach((c, j) => rp.set(0, j, c, H)); rp.heights[0] = 30; rp.freeze = [3, 1]; rp.filter = `A1:${colName(cols.length - 1)}${N}`;
  ord.forEach((x, i) => { const r = i + 1; const d = dayOf(x); const fill = d.col[1];
    const bord = x.first ? { top: 'medium', bottom: 'thin' } : { bottom: 'thin' };
    const sb = (o = {}) => st.get({ fill, border: bord, v: 'top', ...o });
    const idv = /^\d+$/.test(x.id) ? +x.id : x.id;
    const vals = [x.stop, x.day, x.dayNo, x.area || x.sheet, /^\d+$/.test(x.postnr) ? +x.postnr : x.postnr, x.by, x.vej, x.num, x.fuld, idv, x.agreed, x.note, x.leg[0], x.leg[1]];
    vals.forEach((v, j) => rp.set(r, j, v, sb(j === 12 ? { nf: '0.0' } : j === 13 ? { nf: '0' } : (j === 10 || j === 11) ? { wrap: 1 } : {})));
    rp.set(r, 14, 'Kør hertil', sb({ color: '0563C1', u: 1 }), { link: 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(x.gq) });
    rp.set(r, 15, 'Kør hertil', sb({ color: '0563C1', u: 1 }), { link: 'https://maps.apple.com/?dirflg=d&daddr=' + encodeURIComponent(x.gq) });
    rp.set(r, 16, null, sb()); rp.set(r, 17, +x.lat.toFixed(5), sb({ nf: '0.00000' })); rp.set(r, 18, +x.lon.toFixed(5), sb({ nf: '0.00000' })); rp.set(r, 19, `${x.sheet} (${x.row})`, sb()); });
  // Oversigt: én række pr. dag
  const ov = new Sheet('Oversigt'); const base = st.get({}); const bold = st.get({ b: 1 });
  ov.cols = [7, 44, 8, 40, 12, 10, 11, 10, 8, 9];
  ov.set(0, 0, 'Ruteplan – ' + (S.info[0] || S.file), st.get({ b: 1, sz: 14, color: T }));
  ov.set(1, 0, `${ord.length} ejendomme fordelt på ${D.length} ${D.length === 1 ? 'arbejdsdag' : 'arbejdsdage'}. Hver dag starter og slutter ved hjemadressen. Planlagt efter ${goalTxt()} ad vejene, ${byStops() ? limitTxt() : limitTxt() + ' (kørsel + arbejde)'}.`, st.get({ i: 1 }));
  ov.set(3, 1, 'Minutter arbejde pr. hus:', st.get({ b: 1, h: 'right' })); ov.set(3, 2, settings.min, st.get({ b: 1, color: '0000FF', fill: 'FFFF00' })); ov.set(3, 3, '← ret selv (bruges til tidsestimatet)', st.get({ i: 1, sz: 9, color: '666666' }));
  ov.set(4, 1, 'Hjemadresse:', st.get({ b: 1, h: 'right' })); ov.set(4, 2, settings.home, base);
  const r0 = 6; ['Dag', 'Områder', 'Huse', 'Postnumre', 'Km (inkl. til og fra hjem)', 'Køretid (min)', 'Arbejdstid (min)', 'I alt (timer)', 'Udført', 'Mangler'].forEach((c, j) => ov.set(r0, j, c, H)); ov.heights[r0] = 30;
  const RB = `Ruteplan!$B$2:$B$${N}`;
  D.forEach((d, k) => { const r = r0 + 1 + k, R = r + 1; const n = d.items.length; const fill = d.col[1];
    const s = (o = {}) => st.get({ fill, v: 'top', ...o });
    ov.set(r, 0, d.code, s()); ov.set(r, 1, d.name, s({ wrap: 1 })); ov.set(r, 2, n, s(), { f: `COUNTIF(${RB},A${R})` });
    ov.set(r, 3, [...new Set(d.items.map(x => `${x.postnr} ${x.by}`))].sort().join(', '), s({ wrap: 1 }));
    ov.set(r, 4, Math.round(d.km * 10) / 10, s({ nf: '0' })); ov.set(r, 5, Math.round(d.drive), s({ nf: '0' }));
    ov.set(r, 6, n * settings.min, s({ nf: '0' }), { f: `C${R}*$C$4` }); ov.set(r, 7, Math.round(d.total / 6) / 10, s({ nf: '0.0', b: d.over ? 1 : 0, color: d.over ? 'C00000' : '000000' }), { f: `(F${R}+G${R})/60` });
    ov.set(r, 8, 0, s(), { f: `COUNTIFS(${RB},A${R},Ruteplan!$Q$2:$Q$${N},"<>")` }); ov.set(r, 9, n, s(), { f: `C${R}-I${R}` }); });
  const tr = r0 + D.length + 1, TR = tr + 1; ov.set(tr, 0, 'I alt', bold);
  const tot = { 2: ord.length, 4: D.reduce((s, d) => s + d.km, 0), 5: D.reduce((s, d) => s + d.drive, 0), 6: ord.length * settings.min, 7: D.reduce((s, d) => s + d.total, 0) / 60, 8: 0, 9: ord.length };
  [[2, '0'], [4, '0'], [5, '0'], [6, '0'], [7, '0.0'], [8, '0'], [9, '0']].forEach(([j, nf]) => ov.set(tr, j, Math.round(tot[j] * 10) / 10, st.get({ b: 1, nf, border: { top: 'thin', topc: '000000' } }), { f: `SUM(${colName(j)}${r0 + 2}:${colName(j)}${TR - 1})` }));
  let rr = tr + 2; ov.set(rr, 0, 'Huse pr. postnummer', bold); rr++; ['Postnr', 'By', 'Antal'].forEach((t, j) => ov.set(rr, j, t, H)); rr++;
  const pcs = []; ord.forEach(x => { if (!pcs.some(p => p[0] === x.postnr)) pcs.push([x.postnr, x.by]); });
  for (const [pc, by] of pcs) { ov.set(rr, 0, /^\d+$/.test(pc) ? +pc : pc, base); ov.set(rr, 1, by, base); ov.set(rr, 2, ord.filter(x => x.postnr === pc).length, base, { f: `COUNTIF(Ruteplan!$E$2:$E$${N},A${rr + 1})` }); rr++; }
  rr++; ov.set(rr, 0, `Kilder: adresser fra ${S.file} · koordinater: OpenStreetMap (Nominatim/Photon) · køretider og km ad vejene: OSRM · lavet ${new Date().toLocaleDateString('da-DK')} med Ruteplanlægger ${VERSION}. Køretider er estimater uden trafik og færge-ventetid.`, st.get({ i: 1, sz: 8, color: '666666' }));
  // Google Maps pr. dag
  const gm = new Sheet('Google Maps pr. dag'); gm.cols = [6, 6, 26, 26, 8, 20];
  gm.set(0, 0, 'Google Maps-ruter pr. dag – hjem → huse → hjem (Google Maps tillader højst 10 punkter pr. rute, så lange dage er delt i flere dele)', st.get({ b: 1, sz: 12, color: T }));
  gm.set(1, 0, 'Kør delene i rækkefølge. Del 1 starter hjemme, sidste del slutter hjemme.', st.get({ i: 1 }));
  ['Dag', 'Del', 'Fra', 'Til', 'Huse', 'Åbn rute'].forEach((t, j) => gm.set(3, j, t, H)); gm.freeze = [0, 4];
  const lbl = p => p.hjem ? 'Hjem' : `${p.vej} ${p.num}`;
  S.etaper.forEach((e, i) => { const r = 4 + i; const s = st.get({ fill: e.d.col[1] });
    [e.d.code, e.e, lbl(e.from), lbl(e.to), e.ch.length].forEach((v, j) => gm.set(r, j, v, s));
    gm.set(r, 5, 'Åbn i Google Maps', st.get({ fill: e.d.col[1], color: '0563C1', u: 1 }), { link: e.url }); });
  // Bemærkninger
  const bm = new Sheet('Bemærkninger'); bm.cols = [24, 110]; let br = 0; const h2 = st.get({ b: 1, sz: 12, color: T }), lb = st.get({ b: 1, v: 'top' }), tx = st.get({ wrap: 1, v: 'top' });
  bm.set(br++, 0, 'Ændringer og ting at tjekke', h2);
  if (S.routeNote) { bm.set(br, 0, 'Ruteberegning', lb); bm.set(br++, 1, S.routeNote.trim(), tx); }
  for (const d of D.filter(d => d.over)) { bm.set(br, 0, `Dag ${d.n}`, lb); bm.set(br++, 1, byStops() ? `Dagen tager ca. ${t1(d.total / 60)} timer (mere end ${fmtH(settings.hours)} timer).` : `Dagen tager ca. ${t1(d.total / 60)} timer – mere end ${fmtH(settings.hours)} timer, fordi husene ligger langt væk.`, tx); }
  for (const s of S.removed) { bm.set(br, 0, 'Dublet fjernet', lb); bm.set(br++, 1, s, tx); }
  for (const x of ord) { const fl = x.flags.filter(f => f.startsWith('OBS') || f.startsWith('Stavet')); if (fl.length) { bm.set(br, 0, `Stop ${x.stop} (dag ${x.day.slice(1)})`, lb); bm.set(br++, 1, `${x.raw} → ${x.fuld}: ${fl.join(' · ')}${x.approved ? ' (godkendt)' : ''}`, tx); } }
  for (const x of S.items.filter(x => x.excluded || x.acc === 'x')) { bm.set(br, 0, x.acc === 'x' ? 'Ikke fundet' : 'Udeladt', lb); bm.set(br++, 1, `${x.sheet} r${x.row}: ${x.raw}${x.id ? ' (' + x.id + ')' : ''} – ikke med i ruten`, tx); }
  for (const s of S.skipped) { bm.set(br, 0, 'Sprunget over', lb); bm.set(br++, 1, s, tx); }
  if (br === 1) bm.set(br++, 1, 'Ingen – alle adresser blev fundet præcist.', tx);
  br++; bm.set(br++, 0, 'Sådan bruger du arket', h2);
  [['Oversigt', 'Én række pr. arbejdsdag med km, køretid og arbejdstid. Ret minutter pr. hus i den gule celle, så regnes tiderne om.'],
   ['Ruteplan', 'Alle huse i kørselsrækkefølge. Ved dagens første hus er km og minutter fra hjemadressen. Filtrér på Dag. "Kør hertil" åbner navigation i Google Maps eller Apple Maps. Skriv x i "Udført", så tæller Oversigt med.'],
   ['Google Maps pr. dag', 'Én klikbar rute pr. del af dagen (højst 10 punkter pr. Google-rute).'],
   ['Metode', `Alle køretider og km er hentet ad vejene (OSRM). Husene er fordelt på dage, så den samlede ${settings.goal === 'km' ? 'kørsel i km' : 'køretid'} bliver så lille som muligt, ${byStops() ? `med højst ${settings.stops} huse pr. dag. Timerne (kørsel + ${settings.min} min pr. hus) er kun vist til orientering.` : `uden at en dag (kørsel + ${settings.min} min pr. hus) overstiger ${fmtH(settings.hours)} timer.`} Rækkefølgen inden for hver dag er optimeret på samme måde.`]].forEach(([a, b]) => { bm.set(br, 0, a, lb); bm.set(br++, 1, b, tx); });
  const defined = `<definedName name="_xlnm._FilterDatabase" localSheetId="2" hidden="1">Ruteplan!$A$1:$${colName(cols.length - 1)}$${N}</definedName>`;
  return workbookBlob([ov, gm, rp, bm], st, defined);
}
function buildCsv() {
  const q = v => { v = String(v ?? ''); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [['Navn', 'Adresse', 'Breddegrad', 'Længdegrad', 'Dag', 'Område', 'Stop', 'Hus-ID', 'Note'].join(',')];
  for (const x of S.order) { const d = S.days.find(d => d.code === x.day); lines.push([`${String(x.stop).padStart(3, '0')} ${x.vej} ${x.num}`, x.fuld, x.lat.toFixed(6), x.lon.toFixed(6), d.name, x.area || x.sheet, x.stop, x.id, [x.agreed, x.note].filter(Boolean).join(' · ')].map(q).join(',')); }
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
const stem = () => (S.file || 'ruteplan').replace(/\.[^.]+$/, '').replace(/[^\wæøåÆØÅ\- ]+/g, '').trim() || 'ruteplan';
$('#dlx').addEventListener('click', async () => { const b = $('#dlx'); b.disabled = true; try { download(await buildExcel(), `Ruteplan_${stem()}.xlsx`); } catch (e) { alertBox('Excel-filen kunne ikke laves: ' + e.message); } b.disabled = false; });
$('#dlc').addEventListener('click', () => download(buildCsv(), `Ruteplan_${stem()}_MyMaps.csv`));
$('#restart').addEventListener('click', () => { fileIn.value = ''; step(1); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
function alertBox(t) { $('#s5lead').after(el('div', { class: 'err', text: t })); }

