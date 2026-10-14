/* Kørselsrute på telefonen. Ruten kommer i linket (#…) fra Ruteplanlæggeren og gemmes på telefonen.
   Ingen login. Afkrydsninger gemmes kun på denne telefon. */
(function () {
'use strict';
var app = document.getElementById('app');
// nyt link åbnet i samme fane: læs ruten forfra
window.addEventListener('hashchange', function () { location.reload(); });
var store = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function t1(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }

/* ---------- hent ruten: fra linket, ellers den der er gemt på telefonen */
var P = null, err = '';
var stamp = function (p) { return p && p.id ? parseInt(String(p.id).slice(1), 36) || 0 : 0; };
var hash = location.hash.replace(/^#/, ''), fromLink = null, saved = null;
if (hash) { try { fromLink = PlanLink.decode(hash); } catch (e) { err = 'Linket er ikke helt. Det sker, hvis kun en del af linket kom med i beskeden. Bed om at få det sendt igen.'; } }
try { var sv = store.get('tel-plan', null); if (sv) saved = PlanLink.decode(sv); } catch (e) { }
// den nyeste rute vinder (et gammelt bogmærke må ikke erstatte en ny rute)
if (fromLink && (!saved || stamp(fromLink) >= stamp(saved))) { P = fromLink; store.set('tel-plan', hash); } else P = saved || fromLink;

if (!P) {
  app.innerHTML = '<div class="empty"><h1>Ingen rute endnu</h1>' + (err ? '<div class="note">' + esc(err) + '</div>' : '') +
    '<p class="muted">Åbn det link, du har fået i en SMS eller mail. Så kommer ruten frem her og bliver gemt på telefonen.</p></div>';
  return;
}

// stop-objekter: [dag, adresse, hus-id, område, aftalt, note, bredde, længde]
var STOPS = P.s.map(function (r, i) { return { n: i + 1, d: r[0], a: r[1] || '', id: r[2] || '', o: r[3] || '', af: r[4] || '', no: r[5] || '', lat: r[6], lon: r[7], v: String(r[1] || '').split(',')[0] }; });
var DAYS = P.d.map(function (r, i) { return { i: i, name: r[0], km: r[1], min: r[2] }; });
var KEY = 'tel-done-' + P.id;
var done = new Set(store.get(KEY, []));
var isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
var nav = store.get('tel-nav', null) || (isApple ? 'apple' : 'google');
var view = { name: 'home' };

function save() { store.set(KEY, Array.from(done)); }
function stopsIn(d) { return STOPS.filter(function (s) { return s.d === d; }); }
function navQuery(s) { return (s.lat != null && s.lon != null) ? (s.lat + ',' + s.lon) : s.a; }
function navUrl(s) {
  var q = encodeURIComponent(navQuery(s));
  return nav === 'apple' ? 'https://maps.apple.com/?dirflg=d&daddr=' + q : 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + q;
}
// hele dagen i Google Maps: hjem → huse → hjem, højst 10 punkter pr. link
function dayParts(d) {
  var home = { q: P.h, home: true }, list = stopsIn(d).filter(function (s) { return !done.has(s.n); }).map(function (s) { return { q: navQuery(s) }; });
  if (!list.length) return [];
  var pts = [home].concat(list, [home]), out = [];
  for (var s = 0, e = 1; s < pts.length - 1; s += 9, e++) {
    var w = pts.slice(s, s + 10); if (!w.slice(1).some(function (p) { return !p.home; })) break;
    out.push({ e: e, url: 'https://www.google.com/maps/dir/' + w.map(function (p) { return encodeURIComponent(p.q).replace(/%2C/g, ','); }).join('/') + '/data=!4m2!4m1!3e0' });
  }
  return out;
}
function nextUndone(d) {
  var list = d == null ? STOPS : stopsIn(d);
  for (var i = 0; i < list.length; i++) if (!done.has(list[i].n)) return list[i];
  return null;
}
function go(v) { view = v; render(); window.scrollTo(0, 0); }
function render() {
  if (view.name === 'stop') return renderStop();
  if (view.name === 'list') return renderList();
  if (view.name === 'daydone') return renderDayDone();
  renderHome();
}

function renderHome() {
  var total = STOPS.length, n = STOPS.filter(function (s) { return done.has(s.n); }).length, next = nextUndone(null);
  var h = (err ? '<div class="note">' + esc(err) + ' Du ser den rute, der var gemt i forvejen.</div>' : '') +
    '<h1>' + esc(P.t) + '</h1><p class="muted">' + total + ' huse på ' + DAYS.length + (DAYS.length === 1 ? ' dag' : ' dage') + ' · lavet ' + esc(P.m) + '</p>';
  h += '<div class="progress" aria-hidden="true"><i style="width:' + (total ? Math.round(n / total * 100) : 0) + '%"></i></div><p><b>' + n + ' af ' + total + '</b> huse er færdige.</p>';
  if (next) h += '<button class="btn go" id="cont">Fortsæt: ' + esc(next.v) + '</button>';
  else h += '<div class="card"><div class="celebrate">✓</div><h2>Alle huse er færdige</h2></div>';
  h += '<h2 style="margin-top:22px">Vælg dag</h2>';
  DAYS.forEach(function (d) {
    var list = stopsIn(d.i), dn = list.filter(function (s) { return done.has(s.n); }).length, all = dn === list.length;
    h += '<button class="blk' + (all ? ' complete' : '') + '" data-d="' + d.i + '"><b>' + esc(d.name) + '</b><div class="muted">' + (all ? '✓ Færdig · ' : '') + dn + ' af ' + list.length + ' huse' +
      (d.km ? ' · ca. ' + Math.round(d.km) + ' km, ' + t1(d.min / 60) + ' t kørsel' : '') + '</div></button>';
  });
  h += '<div class="card"><h2>Navigation åbner i</h2><div class="seg"><button aria-pressed="' + (nav === 'google') + '" data-nav="google">Google Maps</button><button aria-pressed="' + (nav === 'apple') + '" data-nav="apple">Apple Maps</button></div></div>';
  h += '<div class="card tip"><h2>Gem ruten på hjemmeskærmen</h2>' + (isApple
    ? '<ol><li>Tryk på <b>Del</b>-knappen (firkant med pil op) nederst i Safari.</li><li>Vælg <b>Føj til hjemmeskærm</b>.</li></ol>'
    : '<ol><li>Tryk på <b>⋮</b> øverst til højre i Chrome.</li><li>Vælg <b>Føj til startskærm</b>.</li></ol>') +
    '<p class="small muted" style="margin-top:8px">Så har du et ikon, der åbner ruten. Får du et nyt link med en ny rute, så tryk på det' + (isApple ? ' og gem det på hjemmeskærmen igen' : '') + ' – den gamle rute bliver erstattet.</p></div>';
  app.innerHTML = h;
  var c = document.getElementById('cont'); if (c) c.onclick = function () { go({ name: 'stop', n: next.n }); };
  app.querySelectorAll('.blk').forEach(function (el) { el.onclick = function () { go({ name: 'list', d: +el.getAttribute('data-d') }); }; });
  app.querySelectorAll('[data-nav]').forEach(function (el) { el.onclick = function () { nav = el.getAttribute('data-nav'); store.set('tel-nav', nav); render(); }; });
}

function renderList() {
  var d = DAYS[view.d], list = stopsIn(view.d), next = nextUndone(view.d), parts = dayParts(view.d);
  var h = '<div class="top"><button class="btn plain" id="home">← Alle dage</button></div><h1 style="margin-top:14px">' + esc(d.name) + '</h1>';
  h += '<p class="muted">' + list.filter(function (s) { return done.has(s.n); }).length + ' af ' + list.length + ' færdige' + (d.km ? ' · ca. ' + Math.round(d.km) + ' km' : '') + '</p>';
  if (next) h += '<button class="btn go" id="start">' + (list.some(function (s) { return done.has(s.n); }) ? 'Fortsæt: ' : 'Start: ') + esc(next.v) + '</button>';
  if (parts.length) h += '<div class="card"><h2>Hele dagen i Google Maps</h2><p class="small muted">Starter og slutter hjemme. ' + (parts.length > 1 ? 'Google Maps kan højst tage 9 huse ad gangen, så dagen er delt op. Kør delene i rækkefølge.' : '') + '</p><div class="parts">' +
    parts.map(function (p) { return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + (parts.length > 1 ? 'Del ' + p.e : 'Åbn ruten') + '</a>'; }).join('') + '</div></div>';
  h += '<h2>Husene</h2>';
  list.forEach(function (s, i) { var dn = done.has(s.n); h += '<button class="row' + (dn ? ' isdone' : '') + '" data-n="' + s.n + '"><span class="n">' + (i + 1) + '.</span><span class="t">' + esc(s.v) + '<br><span class="small muted">' + esc(s.o || '') + '</span></span>' + (dn ? '<span class="ok">✓</span>' : '') + '</button>'; });
  app.innerHTML = h;
  document.getElementById('home').onclick = function () { go({ name: 'home' }); };
  var st = document.getElementById('start'); if (st) st.onclick = function () { go({ name: 'stop', n: next.n }); };
  app.querySelectorAll('.row').forEach(function (el) { el.onclick = function () { go({ name: 'stop', n: +el.getAttribute('data-n') }); }; });
}

function renderStop() {
  var s = STOPS[view.n - 1]; if (!s) return go({ name: 'home' });
  var list = stopsIn(s.d), idx = list.indexOf(s), isDone = done.has(s.n);
  var h = '<div class="top"><button class="btn plain" id="home">← Alle dage</button><button class="btn plain" id="list">Dagens liste</button></div>';
  h += '<p class="muted" style="margin-top:14px">' + esc(DAYS[s.d].name) + '</p>';
  h += '<p><span class="chip">Hus ' + (idx + 1) + ' af ' + list.length + '</span> ' + (isDone ? '<span class="chip" style="background:var(--done-soft)">✓ Færdig</span>' : '') + '</p>';
  h += '<div class="big">' + esc(s.v) + '</div><p style="font-size:21px">' + esc(s.a.split(',').slice(1).join(',').trim()) + (s.o ? ' · ' + esc(s.o) : '') + '</p>';
  var facts = '';
  if (s.id) facts += '<div>Hus-nr.: <b>' + esc(s.id) + '</b></div>';
  if (s.af) facts += '<div>Aftalt: ' + esc(s.af) + '</div>';
  if (facts) h += '<div class="facts">' + facts + '</div>';
  if (s.no) h += '<div class="note">' + esc(s.no) + '</div>';
  h += '<a class="btn go" id="drive" href="' + esc(navUrl(s)) + '" target="_blank" rel="noopener">Kør hertil</a>';
  if (!isDone) h += '<button class="btn done" id="done">✓ Færdig</button>';
  else h += '<button class="btn plain" id="undo">Fortryd: ikke færdig</button>';
  h += '<div class="pair"><button class="btn plain" id="prev"' + (idx === 0 ? ' disabled' : '') + '>← Forrige</button><button class="btn plain" id="skip">Spring over →</button></div>';
  app.innerHTML = h;
  document.getElementById('home').onclick = function () { go({ name: 'home' }); };
  document.getElementById('list').onclick = function () { go({ name: 'list', d: s.d }); };
  var d = document.getElementById('done'); if (d) d.onclick = function () {
    done.add(s.n); save();
    var nx = list.filter(function (x) { return x.n > s.n && !done.has(x.n); })[0] || list.filter(function (x) { return !done.has(x.n); })[0];
    go(nx ? { name: 'stop', n: nx.n } : { name: 'daydone', d: s.d });
  };
  var u = document.getElementById('undo'); if (u) u.onclick = function () { done.delete(s.n); save(); render(); };
  document.getElementById('prev').onclick = function () { if (idx > 0) go({ name: 'stop', n: list[idx - 1].n }); };
  document.getElementById('skip').onclick = function () { var nx = list[idx + 1]; go(nx ? { name: 'stop', n: nx.n } : { name: 'list', d: s.d }); };
}

function renderDayDone() {
  var nextD = DAYS.slice(view.d + 1).concat(DAYS.slice(0, view.d)).filter(function (d) { return stopsIn(d.i).some(function (s) { return !done.has(s.n); }); })[0];
  var h = '<div class="card" style="text-align:center"><div class="celebrate">✓</div><h1>Dagen er færdig</h1><p class="muted">' + esc(DAYS[view.d].name) + '</p></div>';
  if (nextD) h += '<button class="btn go" id="nd">Næste dag: ' + esc(nextD.name) + '</button>';
  h += '<button class="btn plain" id="home">Til oversigten</button>';
  app.innerHTML = h;
  document.getElementById('home').onclick = function () { go({ name: 'home' }); };
  var nd = document.getElementById('nd'); if (nd) nd.onclick = function () { go({ name: 'list', d: nextD.i }); };
}

render();
})();
