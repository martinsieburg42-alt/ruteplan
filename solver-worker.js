/* Kører solveVRP i baggrunden, så siden ikke fryser mens dagene beregnes. */
importScripts('solver.js');
onmessage = e => {
  const { C, T, opt } = e.data;
  try {
    const r = solveVRP(C, Object.assign({}, opt, { time: T }));
    postMessage({ type: 'done', res: { routes: r.routes, tooLong: r.tooLong, log: r.log } });
  } catch (err) {
    postMessage({ type: 'error', msg: String((err && err.message) || err) });
  }
};
