const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const engine = require('../dist/engine.js');

const EPS = 1e-9;
const perms = (xs) => {
  const out = [];
  for (const a of xs) for (const b of xs) for (const c of xs) {
    if (a !== b && a !== c && b !== c) out.push([a, b, c]);
  }
  return out;
};
const combos = (xs) => {
  const out = [];
  for (let i = 0; i < xs.length - 2; i++) for (let j = i + 1; j < xs.length - 1; j++) {
    for (let k = j + 1; k < xs.length; k++) out.push([xs[i], xs[j], xs[k]]);
  }
  return out;
};
const lineups = (n, banned, pairing) => {
  const left = Array.from({ length: n }, (_, i) => i).filter((i) => i !== banned);
  return pairing === 'ordered' ? perms(left) : combos(left);
};
const F = (x, y, z) => x * y + x * z + y * z - 2 * x * y * z;
const matchings = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const matchup = (matrix, s, t, pairing) => {
  if (pairing === 'ordered') return F(matrix[s[0]][t[0]], matrix[s[1]][t[1]], matrix[s[2]][t[2]]);
  return matchings.reduce((sum, p) => sum + F(matrix[s[0]][t[p[0]]], matrix[s[1]][t[p[1]]], matrix[s[2]][t[p[2]]]), 0) / 6;
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < EPS, `${message}: ${actual} != ${expected}`);

function bruteRobust(rates, pairing) {
  return Array.from({ length: rates[0].length }, (_, b) => {
    const branches = Array.from({ length: rates.length }, (_, a) => {
      const ss = lineups(rates.length, a, pairing);
      const ts = lineups(rates[0].length, b, pairing);
      let picked = null;
      ss.forEach((s) => {
        let worst = Infinity;
        let worstOrder;
        ts.forEach((t) => {
          const value = matchup(rates, s, t, pairing);
          if (value < worst - 1e-10) { worst = value; worstOrder = t; }
        });
        if (!picked || worst > picked.score + 1e-10) picked = { score: worst, ourOrder: s, worstOpponentOrder: worstOrder };
      });
      return picked;
    });
    return { b, score: Math.min(...branches.map((x) => x.score)), branches };
  }).sort((x, y) => Math.abs(y.score - x.score) <= 1e-10 ? x.b - y.b : y.score - x.score).slice(0, 5);
}

function brutePredictive(rates, q, pairing) {
  const cells = Array.from({ length: rates.length }, () => Array(rates[0].length));
  for (let a = 0; a < rates.length; a++) for (let b = 0; b < rates[0].length; b++) {
    const ss = lineups(rates.length, a, pairing), ts = lineups(rates[0].length, b, pairing);
    const values = ts.map((t) => Math.min(...ss.map((s) => matchup(q, s, t, pairing))));
    const value = Math.max(...values);
    cells[a][b] = { ss, ts, value, tied: values.map((v, i) => Math.abs(v - value) <= 1e-10 ? i : -1).filter((i) => i >= 0) };
  }
  const z = cells.map((row) => Math.min(...row.map((x) => x.value)));
  const maxZ = Math.max(...z), A = z.map((v, i) => Math.abs(v - maxZ) <= 1e-10 ? i : -1).filter((i) => i >= 0);
  const probabilities = z.map((_, i) => A.includes(i) ? 1 / A.length : 0);
  const rows = Array.from({ length: rates[0].length }, (_, b) => {
    const branches = cells.map((row, a) => {
      const cell = row[b];
      const expected = cell.ss.map((s) => cell.tied.reduce((sum, t) => sum + matchup(rates, s, cell.ts[t], pairing), 0) / cell.tied.length);
      let best = 0;
      for (let s = 1; s < expected.length; s++) if (expected[s] > expected[best] + 1e-10) best = s;
      return { score: expected[best], ourOrder: cell.ss[best], orders: cell.tied.map((t) => cell.ts[t]) };
    });
    return { b, score: branches.reduce((sum, branch, a) => sum + probabilities[a] * branch.score, 0), branches };
  });
  rows.sort((x, y) => Math.abs(y.score - x.score) <= 1e-10 ? x.b - y.b : y.score - x.score);
  return { probabilities, rows: rows.slice(0, 5) };
}

function matrix(rows, cols) {
  const choices = [0, 0.5, 1, 0.2, 0.8, 0.35, 0.65];
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => choices[(i * 3 + j * 5 + i * j) % choices.length]));
}

function validateBranches(result, rows, cols) {
  assert.equal(result.strategies.length, Math.min(5, cols));
  for (const strategy of result.strategies) {
    assert.equal(strategy.branches.length, rows);
    for (const branch of strategy.branches) {
      assert.equal(branch.ourOrder.length, 3);
      assert.equal(new Set(branch.ourOrder).size, 3);
      assert.ok(!branch.ourOrder.includes(branch.bannedOurIndex));
      const opponentOrders = branch.worstOpponentOrder ? [branch.worstOpponentOrder] : branch.predictedOpponentOrders.map((x) => x.order);
      for (const order of opponentOrders) {
        assert.equal(order.length, 3);
        assert.equal(new Set(order).size, 3);
        assert.ok(!order.includes(strategy.banOpponentIndex));
      }
    }
  }
}

test('F matches a brute-force sum over all eight independent outcomes', () => {
  for (const triple of [[0,0,0],[0,0,1],[0,1,0],[1,0,0],[0,1,1],[1,0,1],[1,1,0],[1,1,1],[0.2,0.5,0.8]]) {
    let brute = 0;
    for (let mask = 0; mask < 8; mask++) {
      const wins = [0,1,2].map((i) => Boolean(mask & (1 << i)));
      let p = 1;
      for (let i = 0; i < 3; i++) p *= wins[i] ? triple[i] : 1 - triple[i];
      if (wins.filter(Boolean).length >= 2) brute += p;
    }
    close(F(...triple), brute, `F(${triple})`);
  }
});

test('production engine returns exact endpoints for all-0, all-1, and all-0.5 matrices', () => {
  for (const [rate, expected] of [[0, 0], [1, 1], [0.5, 0.5]]) {
    const rates = Array.from({ length: 4 }, () => Array(4).fill(rate));
    for (const pairing of ['ordered', 'random']) {
      const result = engine.solve({ rates, mode: 'robust', pairing });
      assert.equal(result.strategies.length, 4);
      result.strategies.forEach((strategy) => {
        assert.equal(strategy.score, expected);
        strategy.branches.forEach((branch) => assert.equal(branch.score, expected));
      });
    }
  }
});

for (const [rows, cols] of [[4,4],[5,6],[6,5]]) {
  test(`robust ordered agrees with independent enumeration for ${rows}x${cols}`, () => {
    const rates = matrix(rows, cols);
    const actual = engine.solve({ rates, pairing: 'ordered', mode: 'robust' });
    const expected = bruteRobust(rates, 'ordered');
    validateBranches(actual, rows, cols);
    actual.strategies.forEach((strategy, i) => {
      assert.equal(strategy.banOpponentIndex, expected[i].b);
      close(strategy.score, expected[i].score, 'strategy score');
      strategy.branches.forEach((branch, a) => {
        close(branch.score, expected[i].branches[a].score, 'branch score');
        assert.deepEqual(branch.ourOrder, expected[i].branches[a].ourOrder);
        assert.deepEqual(branch.worstOpponentOrder, expected[i].branches[a].worstOpponentOrder);
      });
    });
  });
}

test('random pairing averages exactly the six possible matchings', () => {
  const rates = matrix(4, 4);
  const actual = engine.solve({ rates, pairing: 'random', mode: 'robust' });
  const expected = bruteRobust(rates, 'random');
  actual.strategies.forEach((strategy, i) => {
    assert.equal(strategy.banOpponentIndex, expected[i].b);
    close(strategy.score, expected[i].score, 'random strategy score');
    strategy.branches.forEach((branch, a) => close(branch.score, expected[i].branches[a].score, 'random branch score'));
  });
});

test('predictive opponent choices, ban distribution, and our responses match independent logic', () => {
  const rates = matrix(5, 4);
  const q = matrix(5, 4).map((row, i) => row.map((v, j) => (v + (i + j) * 0.07) % 1));
  const actual = engine.solve({ rates, opponentRates: q, mode: 'predictive', pairing: 'ordered' });
  const expected = brutePredictive(rates, q, 'ordered');
  actual.opponentBanProbabilities.forEach((v, i) => close(v, expected.probabilities[i], 'ban probability'));
  actual.strategies.forEach((strategy, i) => {
    assert.equal(strategy.banOpponentIndex, expected.rows[i].b);
    close(strategy.score, expected.rows[i].score, 'predictive score');
    strategy.branches.forEach((branch, a) => {
      close(branch.score, expected.rows[i].branches[a].score, 'predictive branch');
      assert.deepEqual(branch.ourOrder, expected.rows[i].branches[a].ourOrder);
      assert.deepEqual(branch.predictedOpponentOrders.map((x) => x.order), expected.rows[i].branches[a].orders);
      close(branch.predictedOpponentOrders.reduce((sum, x) => sum + x.probability, 0), 1, 'tie probabilities');
    });
  });
});

test('predictive random pairing agrees with independent six-matching enumeration', () => {
  const rates = matrix(5, 5);
  const q = matrix(5, 5).map((row, i) => row.map((v, j) => (v + i * 0.11 + j * 0.03) % 1));
  const actual = engine.solve({ rates, opponentRates: q, mode: 'predictive', pairing: 'random' });
  const expected = brutePredictive(rates, q, 'random');
  actual.opponentBanProbabilities.forEach((v, i) => close(v, expected.probabilities[i], 'random ban probability'));
  actual.strategies.forEach((strategy, i) => {
    assert.equal(strategy.banOpponentIndex, expected.rows[i].b);
    close(strategy.score, expected.rows[i].score, 'random predictive score');
    strategy.branches.forEach((branch, a) => {
      close(branch.score, expected.rows[i].branches[a].score, 'random predictive branch');
      assert.deepEqual(branch.ourOrder, expected.rows[i].branches[a].ourOrder);
      assert.deepEqual(branch.predictedOpponentOrders.map((x) => x.order), expected.rows[i].branches[a].orders);
    });
  });
});

test('fully tied predictive model distributes bans and ordered lineups uniformly', () => {
  const rates = Array.from({ length: 4 }, () => Array(4).fill(0.5));
  const result = engine.solve({ rates, opponentRates: rates, mode: 'predictive', pairing: 'ordered' });
  assert.deepEqual(result.opponentBanProbabilities, [0.25, 0.25, 0.25, 0.25]);
  result.strategies.forEach((strategy) => {
    assert.equal(strategy.score, 0.5);
    strategy.branches.forEach((branch) => {
      assert.equal(branch.predictedOpponentOrders.length, 6);
      branch.predictedOpponentOrders.forEach((prediction) => close(prediction.probability, 1 / 6, 'ordered tie probability'));
      close(branch.predictedOpponentOrders.reduce((sum, prediction) => sum + prediction.probability, 0), 1, 'ordered tie sum');
    });
  });
});

test('explicit q=0 is retained while blanks use the confidence correction', () => {
  const rates = matrix(4, 4);
  const supplied = Array.from({ length: 4 }, () => Array(4).fill(null));
  supplied[0][0] = 0;
  const q = rates.map((row, i) => row.map((p, j) => i === 0 && j === 0 ? 0 : Math.min(1, 1 - p + 0.35)));
  const actual = engine.solve({ rates, opponentRates: supplied, correction: 0.35, mode: 'predictive' });
  const expected = brutePredictive(rates, q, 'ordered');
  actual.opponentBanProbabilities.forEach((v, i) => close(v, expected.probabilities[i], 'corrected ban probability'));
  assert.ok(actual.assumptions.some((text) => text.includes('15 个空值')));
  assert.ok(actual.assumptions.some((text) => text.includes('0.35')));
});

test('does not mutate input and rejects malformed values, blanks, and name counts', () => {
  const input = { rates: matrix(4, 4), opponentRates: Array.from({ length: 4 }, () => Array(4).fill('')), ourNames: ['A','B','C','D'] };
  const before = structuredClone(input);
  engine.solve(input);
  assert.deepEqual(input, before);
  assert.throws(() => engine.solve({ rates: [[0.5]] }), /4 到 6/);
  assert.throws(() => engine.solve({ rates: matrix(4, 4).map((r, i) => i ? r : [0.1, null, 0.2, 0.3]) }), /rates\[0\]\[1\]/);
  assert.throws(() => engine.solve({ rates: matrix(4, 4), opponentRates: matrix(4, 4).map((r, i) => i ? r : [0, 1.1, 0.5, 1]) }), /opponentRates\[0\]\[1\]/);
  assert.throws(() => engine.solve({ rates: matrix(4, 4), opponentNames: ['a'] }), /名称数量/);
  assert.throws(() => engine.solve({ rates: matrix(4, 4), ourNames: ['A', ' B ', 'B', 'D'] }), /名称不能重复/);
  assert.throws(() => engine.solve({ rates: matrix(4, 4), opponentNames: ['A', 'B', '   ', 'D'] }), /不能为空/);
});

test('6x6 worst-case modes finish promptly and retain legal complete branches', () => {
  const rates = matrix(6, 6);
  const start = performance.now();
  const robust = engine.solve({ rates, mode: 'robust', pairing: 'ordered' });
  const predictive = engine.solve({ rates, opponentRates: matrix(6, 6), mode: 'predictive', pairing: 'ordered' });
  const elapsed = performance.now() - start;
  validateBranches(robust, 6, 6);
  validateBranches(predictive, 6, 6);
  assert.ok(elapsed < 5000, `6x6 took ${elapsed.toFixed(0)}ms`);
});
