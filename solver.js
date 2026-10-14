/* Ruteoptimering: daglige ture fra ét depot (indeks 0) med tidsgrænse pr. dag.
   D = n×n "pris" ad vejnettet: meter (færrest km) eller sekunder (kortest tid).
   opt.time = n×n køretider i sekunder (bruges altid til 8-timers-grænsen; standard = D).
   softLimit/softWeight = blød tidsgrænse (bruges når antal huse styrer), service = sek. pr. hus, limit = sek. pr. dag (Infinity = ingen), maxStops = højst antal huse pr. dag (valgfri).
   Metode: Clarke–Wright savings (flere λ) → lokal søgning (2-opt, Or-opt, flyt, byt, 2-opt*, fjern dag)
   → ruin & recreate med fast frø. Mål: mindst mulig samlet pris (km eller tid). */
function solveVRP(D, opt) {
  const n = D.length, S = opt.service, L = opt.limit == null ? Infinity : opt.limit, maxStops = opt.maxStops || Infinity, seed0 = opt.seed || 7, T = opt.time || D;
  const sumM = (M, r) => { if (!r.length) return 0; let t = M[0][r[0]]; for (let k = 1; k < r.length; k++) t += M[r[k - 1]][r[k]]; return t + M[r[r.length - 1]][0]; };
  const dur = r => sumM(T, r) + S * r.length;
  // blød grænse: tid over softLimit tæller med som en straf (softWeight pr. sekund), så lange dage undgås, når det kan betale sig
  const SL = opt.softLimit || Infinity, SW = opt.softWeight || 0;
  // dayCost: fast pris pr. dag, så programmet bruger så få dage som muligt (bruges når antal huse styrer)
  const DC = opt.dayCost || 0;
  const drive = r => r.length ? sumM(D, r) + DC + (SW ? SW * Math.max(0, dur(r) - SL) : 0) : 0;
  const ok = r => r.length <= maxStops && dur(r) <= L + 1e-6; // højst maxStops huse og højst L sekunder pr. dag
  const total = rs => rs.reduce((s, r) => s + drive(r), 0);
  const clone = rs => rs.map(r => r.slice());
  let rnd = seed0; const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

  function savings(lam) {
    const routes = []; const where = new Array(n).fill(-1);
    for (let i = 1; i < n; i++) { routes.push([i]); where[i] = routes.length - 1; }
    const list = [];
    for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) if (i !== j) list.push([D[i][0] + D[0][j] - lam * D[i][j], i, j]);
    list.sort((a, b) => b[0] - a[0]);
    for (const [sv, i, j] of list) {
      if (sv <= 0) break;
      const a = where[i], b = where[j]; if (a === b || a < 0 || b < 0) continue;
      const A = routes[a], B = routes[b];
      if (A[A.length - 1] !== i || B[0] !== j) continue;
      const M = A.concat(B); if (!ok(M)) continue;
      routes[a] = M; routes[b] = null; for (const c of B) where[c] = a;
    }
    return routes.filter(Boolean);
  }
  function intra(r) { // 2-opt + Or-opt inden for én dag
    let best = drive(r), imp = true;
    while (imp) { imp = false;
      for (let i = 0; i < r.length - 1 && !imp; i++) for (let j = i + 1; j < r.length && !imp; j++) {
        const t = r.slice(0, i).concat(r.slice(i, j + 1).reverse(), r.slice(j + 1)); const c = drive(t); if (c < best - 1e-6 && (ok(t) || !ok(r))) { r = t; best = c; imp = true; } }
      for (let len = 1; len <= 3 && !imp; len++) for (let i = 0; i + len <= r.length && !imp; i++) {
        const seg = r.slice(i, i + len), rest = r.slice(0, i).concat(r.slice(i + len));
        for (let p = 0; p <= rest.length && !imp; p++) { if (p === i) continue; for (const sg of len > 1 ? [seg, seg.slice().reverse()] : [seg]) {
          const t = rest.slice(0, p).concat(sg, rest.slice(p)); const c = drive(t); if (c < best - 1e-6 && (ok(t) || !ok(r))) { r = t; best = c; imp = true; break; } } } }
    }
    return r;
  }
  function bestInsert(r, c) { let bp = -1, bc = Infinity; for (let p = 0; p <= r.length; p++) { const t = r.slice(0, p).concat([c], r.slice(p)); if (!ok(t)) continue; const v = drive(t); if (v < bc) { bc = v; bp = p; } } return [bp, bc]; }
  function local(rs) {
    rs = rs.map(intra); let imp = true, guard = 0;
    while (imp && guard++ < 200) { imp = false;
      // flyt ét hus til en anden dag
      for (let a = 0; a < rs.length && !imp; a++) for (let k = 0; k < rs[a].length && !imp; k++) {
        const c = rs[a][k], A2 = rs[a].slice(0, k).concat(rs[a].slice(k + 1)), base = drive(rs[a]);
        for (let b = 0; b < rs.length && !imp; b++) { if (b === a) continue; const [p, v] = bestInsert(rs[b], c); if (p < 0) continue;
          const delta = drive(A2) + v - base - drive(rs[b]); if (delta < -1e-6 && ok(A2)) { rs[b] = intra(rs[b].slice(0, p).concat([c], rs[b].slice(p))); rs[a] = intra(A2); imp = true; } } }
      // byt to huse mellem dage
      for (let a = 0; a < rs.length && !imp; a++) for (let b = a + 1; b < rs.length && !imp; b++) for (let i = 0; i < rs[a].length && !imp; i++) for (let j = 0; j < rs[b].length && !imp; j++) {
        const A2 = rs[a].slice(), B2 = rs[b].slice(); [A2[i], B2[j]] = [B2[j], A2[i]]; if (!ok(A2) || !ok(B2)) continue;
        if (drive(A2) + drive(B2) < drive(rs[a]) + drive(rs[b]) - 1e-6) { rs[a] = intra(A2); rs[b] = intra(B2); imp = true; } }
      // 2-opt*: byt haler mellem to dage
      for (let a = 0; a < rs.length && !imp; a++) for (let b = 0; b < rs.length && !imp; b++) { if (a === b) continue;
        for (let i = 0; i <= rs[a].length && !imp; i++) for (let j = 0; j <= rs[b].length && !imp; j++) {
          const A2 = rs[a].slice(0, i).concat(rs[b].slice(j)), B2 = rs[b].slice(0, j).concat(rs[a].slice(i)); if (!ok(A2) || !ok(B2)) continue;
          if (drive(A2) + drive(B2) < drive(rs[a]) + drive(rs[b]) - 1e-6) { rs[a] = intra(A2); rs[b] = intra(B2); imp = true; } } }
      rs = rs.filter(r => r.length);
      // forsøg at fjerne den korteste dag helt
      if (!imp && rs.length > 1) { const order = rs.map((r, i) => [dur(r), i]).sort((x, y) => x[0] - y[0]);
        for (const [, ai] of order.slice(0, 2)) { const trial = clone(rs), victims = trial[ai]; trial.splice(ai, 1); let fine = true;
          for (const c of victims) { let bi = -1, bp = -1, bv = Infinity; trial.forEach((r, ri) => { const [p, v] = bestInsert(r, c); if (p >= 0 && v - drive(r) < bv) { bv = v - drive(r); bi = ri; bp = p; } }); if (bi < 0) { fine = false; break; } trial[bi].splice(bp, 0, c); }
          if (fine) { const t2 = trial.map(intra); if (total(t2) < total(rs) - 1e-6) { rs = t2; imp = true; break; } } } }
    }
    return rs;
  }
  function repair(rs) { const out = []; for (let r of rs) { r = r.slice(); while (r.length > 1 && !ok(r)) out.push([r.pop()]); if (r.length) out.push(r); } return out; }
  function ruinRecreate(rs, frac) {
    const all = rs.flat(); const k = Math.max(2, Math.round(all.length * frac));
    const seedC = all[Math.floor(rand() * all.length)];
    const near = all.slice().sort((x, y) => D[seedC][x] - D[seedC][y]).slice(0, k); // fjern en klynge af nabohuse (målt i køretid)
    let t = repair(rs.map(r => r.filter(c => !near.includes(c))).filter(r => r.length));
    for (const c of near.sort(() => rand() - .5)) { let bi = -1, bp = -1, bv = Infinity; t.forEach((r, ri) => { const [p, v] = bestInsert(r, c); if (p >= 0 && v - drive(r) < bv) { bv = v - drive(r); bi = ri; bp = p; } });
      if (bi < 0) t.push([c]); else t[bi].splice(bp, 0, c); }
    return local(t);
  }
  const t0 = Date.now(); const log = [];
  let best = null;
  for (const lam of opt.lambdas || [0.6, 0.8, 1.0, 1.2, 1.4]) { const s = local(repair(savings(lam))); log.push(['savings λ=' + lam, total(s), s.length]); if (!best || total(s) < total(best)) best = s; }
  const startBest = total(best);
  let cur = clone(best), iters = 0;
  while (Date.now() - t0 < (opt.timeMs || 20000) && iters < (opt.maxIter || 400)) { iters++;
    const cand = ruinRecreate(cur, 0.08 + rand() * 0.12);
    if (total(cand) < total(cur) - 1e-6) { cur = cand; if (total(cur) < total(best)) best = clone(cur); }
    else if (rand() < 0.05) cur = clone(best);
    if (opt.onProgress && iters % 5 === 0) opt.onProgress(iters, total(best), Date.now() - t0); }
  log.push(['ruin&recreate', total(best), best.length, iters]);
  if (best.some(r => r.length > 1 && !ok(r))) best = local(repair(best));
  const tooLong = []; for (const r of best) if (!ok(r)) { if (r.length > 1) throw new Error('infeasible'); tooLong.push(r[0]); } // et enkelt hus, der alene er over grænsen, får sin egen dag
  const seen = new Set(best.flat()); if (seen.size !== n - 1) throw new Error('missing');
  return { routes: best, tooLong, drive: total(best), days: best.length, startBest, log, ms: Date.now() - t0, drive_of: drive, dur_of: dur };
}
if (typeof module !== 'undefined') module.exports = { solveVRP };
