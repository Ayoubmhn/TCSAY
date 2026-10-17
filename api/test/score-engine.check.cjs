// Contrôle du moteur de score : 600 matchs simulés (3 formats) + cas précis. Lancer : npm run test:score
const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../src/matches/score-engine.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', js)(m, m.exports);
const { computeMatch, scoreLine, matchStats } = m.exports;
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let bad = 0, n = 0;
for (const f of [{ setsToWin: 2, games: 6, tiebreak: true, superTB: false, noAd: false }, { setsToWin: 2, games: 6, tiebreak: true, superTB: true, noAd: true }, { setsToWin: 3, games: 4, tiebreak: true, superTB: false, noAd: false }]) {
  for (let k = 0; k < 200; k++) {
    const pts = []; let st;
    for (let i = 0; i < 3000; i++) { st = computeMatch(f, k % 2, pts); if (st.winner !== null) break; const s = st.server; const firstIn = rnd() < 0.65; pts.push({ winner: rnd() < 0.58 ? s : 1 - s, firstIn, kind: 'NONE' }); }
    n++;
    const total = st.setsWon[st.winner];
    if (st.winner === null || total !== f.setsToWin) { bad++; continue; }
    for (let i = 0; i < st.sets.length; i++) {
      const s = st.sets[i]; const [a, b] = s.games; const mx = Math.max(a, b), mn = Math.min(a, b);
      const superSet = f.superTB && i === st.sets.length - 1 && st.setsWon[0] + st.setsWon[1] === 2 * f.setsToWin - 1 && s.tiebreak && mx === 1;
      if (!(superSet || (mx === f.games && mx - mn >= 2) || (mx === f.games + 1 && (mn === f.games - 1 || mn === f.games)))) { bad++; console.log(f, JSON.stringify(st.sets)); break; }
    }
  }
}
// cas précis : jeu blanc, deuce/avantage, point décisif, balle de break
const F = { setsToWin: 2, games: 6, tiebreak: true, superTB: false, noAd: false };
const P = (w, k = 'NONE') => ({ winner: w, firstIn: true, kind: k });
let s = computeMatch(F, 0, [P(1), P(1), P(1)]); console.log('0-40 balle de break:', s.point, s.breakPoint);
s = computeMatch(F, 0, [P(0), P(0), P(0), P(1), P(1), P(1), P(1)]); console.log('avantage receveur:', s.point, s.breakPoint);
s = computeMatch({ ...F, noAd: true }, 0, [P(0), P(0), P(0), P(1), P(1), P(1)]); console.log('point décisif:', s.point, s.decisivePoint, s.breakPoint);
s = computeMatch({ ...F, noAd: true }, 0, [P(0), P(0), P(0), P(1), P(1), P(1), P(1)]); console.log('après point décisif jeux:', s.sets[0].games, 'serveur', s.server);
const st = matchStats(s.points); console.log('pts gagnés', st[0].pointsWon, st[1].pointsWon, 'bp convertis B', st[1].breakPointsWon);
console.log('matches', n, 'erreurs', bad);
if (bad) process.exit(1);
