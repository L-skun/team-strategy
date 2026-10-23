(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StrategyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-10;

  function fail(message) {
    throw new Error('StrategyEngine: ' + message);
  }

  function probability(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      fail(label + ' 必须是 0 到 1 之间的有限数字');
    }
    return value;
  }

  function validateNames(names, length, label) {
    if (names == null) return Array.from({ length: length }, function (_, i) { return label + (i + 1); });
    if (!Array.isArray(names) || names.length !== length) fail(label + '名称数量必须为 ' + length);
    var normalized = names.map(function (name, i) {
      if (typeof name !== 'string' || name.trim() === '') fail(label + '名称第 ' + (i + 1) + ' 项不能为空');
      return name.trim();
    });
    if (new Set(normalized).size !== normalized.length) fail(label + '名称不能重复');
    return normalized;
  }

  function validateInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('输入必须是对象');
    if (!Array.isArray(input.rates) || input.rates.length < 4 || input.rates.length > 6) {
      fail('我方卡组数量必须为 4 到 6');
    }
    var rows = input.rates.length;
    if (!Array.isArray(input.rates[0]) || input.rates[0].length < 4 || input.rates[0].length > 6) {
      fail('对手卡组数量必须为 4 到 6');
    }
    var cols = input.rates[0].length;
    var rates = input.rates.map(function (row, i) {
      if (!Array.isArray(row) || row.length !== cols) fail('rates 必须是规则矩阵');
      return row.map(function (value, j) { return probability(value, 'rates[' + i + '][' + j + ']'); });
    });

    var correction = input.correction == null ? 0.2 : probability(input.correction, 'correction');
    var supplied = input.opponentRates;
    if (supplied != null && (!Array.isArray(supplied) || supplied.length !== rows)) {
      fail('opponentRates 行数必须与 rates 相同');
    }
    var fallbackCount = 0;
    var opponentRates = rates.map(function (row, i) {
      if (supplied != null && (!Array.isArray(supplied[i]) || supplied[i].length !== cols)) {
        fail('opponentRates 必须与 rates 尺寸相同');
      }
      return row.map(function (p, j) {
        var value = supplied == null ? null : supplied[i][j];
        if (value === null || value === undefined || value === '') {
          fallbackCount += 1;
          return Math.max(0, Math.min(1, 1 - p + correction));
        }
        return probability(value, 'opponentRates[' + i + '][' + j + ']');
      });
    });

    var pairing = input.pairing == null ? 'ordered' : input.pairing;
    var mode = input.mode == null ? 'robust' : input.mode;
    if (pairing !== 'ordered' && pairing !== 'random') fail("pairing 必须是 'ordered' 或 'random'");
    if (mode !== 'robust' && mode !== 'predictive') fail("mode 必须是 'robust' 或 'predictive'");

    return {
      rates: rates,
      opponentRates: opponentRates,
      correction: correction,
      pairing: pairing,
      mode: mode,
      ourNames: validateNames(input.ourNames, rows, '我方卡组'),
      opponentNames: validateNames(input.opponentNames, cols, '对手卡组'),
      fallbackCount: fallbackCount,
    };
  }

  function combinations(values) {
    var result = [];
    for (var i = 0; i < values.length - 2; i += 1) {
      for (var j = i + 1; j < values.length - 1; j += 1) {
        for (var k = j + 1; k < values.length; k += 1) result.push([values[i], values[j], values[k]]);
      }
    }
    return result;
  }

  function permutations3(values) {
    var result = [];
    for (var i = 0; i < values.length; i += 1) {
      for (var j = 0; j < values.length; j += 1) {
        if (j === i) continue;
        for (var k = 0; k < values.length; k += 1) {
          if (k !== i && k !== j) result.push([values[i], values[j], values[k]]);
        }
      }
    }
    return result;
  }

  function lineups(count, banned, pairing) {
    var remaining = [];
    for (var i = 0; i < count; i += 1) if (i !== banned) remaining.push(i);
    return pairing === 'ordered' ? permutations3(remaining) : combinations(remaining);
  }

  function teamWin(x, y, z) {
    return x * y + x * z + y * z - 2 * x * y * z;
  }

  var MATCHINGS = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  function matchup(matrix, ours, theirs, pairing) {
    if (pairing === 'ordered') {
      return teamWin(matrix[ours[0]][theirs[0]], matrix[ours[1]][theirs[1]], matrix[ours[2]][theirs[2]]);
    }
    var total = 0;
    for (var m = 0; m < MATCHINGS.length; m += 1) {
      var order = MATCHINGS[m];
      total += teamWin(
        matrix[ours[0]][theirs[order[0]]],
        matrix[ours[1]][theirs[order[1]]],
        matrix[ours[2]][theirs[order[2]]]
      );
    }
    return total / MATCHINGS.length;
  }

  function greater(value, best) { return value > best + EPS; }
  function tied(value, best) { return Math.abs(value - best) <= EPS; }

  function assumptions(data) {
    var list = [
      '三场 BO1 相互独立，团队至少赢两场即获胜。',
      data.pairing === 'ordered'
        ? '按给定出战顺序逐一配对；顺序不同视为不同纯策略。'
        : '双方各选三套卡组，六种一一配对等概率并取平均。',
      data.mode === 'robust'
        ? '稳健模式使用纯策略 maximin，不计算混合策略均衡。'
        : '预测模式用对手主观胜率预测其纯策略，并在并列最优策略间均匀分配；不计算混合策略均衡。',
    ];
    if (data.fallbackCount) {
      list.push('对手视角有 ' + data.fallbackCount + ' 个空值，按 clip(1 - 我方胜率 + ' + data.correction + ', 0, 1) 补全。');
    } else {
      list.push('对手视角胜率全部采用显式输入值。');
    }
    return list;
  }

  function buildGrid(data, ourLineups, opponentLineups, matrix) {
    return ourLineups.map(function (ours) {
      return opponentLineups.map(function (theirs) {
        return matchup(matrix, ours, theirs, data.pairing);
      });
    });
  }

  function robustSolve(data) {
    var strategyRows = [];
    for (var b = 0; b < data.opponentRates[0].length; b += 1) {
      var branches = [];
      for (var a = 0; a < data.rates.length; a += 1) {
        var ours = lineups(data.rates.length, a, data.pairing);
        var theirs = lineups(data.rates[0].length, b, data.pairing);
        var grid = buildGrid(data, ours, theirs, data.rates);
        var bestScore = -Infinity;
        var bestS = 0;
        var bestT = 0;
        for (var s = 0; s < ours.length; s += 1) {
          var worst = Infinity;
          var worstT = 0;
          for (var t = 0; t < theirs.length; t += 1) {
            if (grid[s][t] < worst - EPS) { worst = grid[s][t]; worstT = t; }
          }
          if (greater(worst, bestScore)) { bestScore = worst; bestS = s; bestT = worstT; }
        }
        branches.push({
          bannedOurIndex: a,
          ourOrder: ours[bestS].slice(),
          score: bestScore,
          worstOpponentOrder: theirs[bestT].slice(),
        });
      }
      var overall = Infinity;
      for (var i = 0; i < branches.length; i += 1) overall = Math.min(overall, branches[i].score);
      strategyRows.push({ banOpponentIndex: b, score: overall, branches: branches });
    }
    return { probabilities: [], strategies: strategyRows };
  }

  function predictiveAnalysis(data) {
    var analysis = [];
    for (var a = 0; a < data.rates.length; a += 1) {
      analysis[a] = [];
      for (var b = 0; b < data.rates[0].length; b += 1) {
        var ours = lineups(data.rates.length, a, data.pairing);
        var theirs = lineups(data.rates[0].length, b, data.pairing);
        var h = buildGrid(data, ours, theirs, data.opponentRates);
        var values = [];
        var best = -Infinity;
        for (var t = 0; t < theirs.length; t += 1) {
          var guaranteed = Infinity;
          for (var s = 0; s < ours.length; s += 1) guaranteed = Math.min(guaranteed, h[s][t]);
          values.push(guaranteed);
          if (guaranteed > best) best = guaranteed;
        }
        var tiedT = [];
        for (var ti = 0; ti < values.length; ti += 1) if (tied(values[ti], best)) tiedT.push(ti);
        analysis[a][b] = { ours: ours, theirs: theirs, tIndexes: tiedT, value: best };
      }
    }
    return analysis;
  }

  function predictiveSolve(data) {
    var analysis = predictiveAnalysis(data);
    var banValues = [];
    var bestBanValue = -Infinity;
    for (var a = 0; a < data.rates.length; a += 1) {
      var value = Infinity;
      for (var b = 0; b < data.rates[0].length; b += 1) value = Math.min(value, analysis[a][b].value);
      banValues[a] = value;
      if (value > bestBanValue) bestBanValue = value;
    }
    var bestBans = [];
    for (var ai = 0; ai < banValues.length; ai += 1) if (tied(banValues[ai], bestBanValue)) bestBans.push(ai);
    var probabilities = banValues.map(function (_, i) { return bestBans.indexOf(i) >= 0 ? 1 / bestBans.length : 0; });

    var strategyRows = [];
    for (var b = 0; b < data.rates[0].length; b += 1) {
      var branches = [];
      for (var a = 0; a < data.rates.length; a += 1) {
        var item = analysis[a][b];
        var g = buildGrid(data, item.ours, item.theirs, data.rates);
        var bestScore = -Infinity;
        var bestS = 0;
        for (var s = 0; s < item.ours.length; s += 1) {
          var expected = 0;
          for (var x = 0; x < item.tIndexes.length; x += 1) expected += g[s][item.tIndexes[x]];
          expected /= item.tIndexes.length;
          if (greater(expected, bestScore)) { bestScore = expected; bestS = s; }
        }
        branches.push({
          bannedOurIndex: a,
          ourOrder: item.ours[bestS].slice(),
          score: bestScore,
          predictedOpponentOrders: item.tIndexes.map(function (t) {
            return { order: item.theirs[t].slice(), probability: 1 / item.tIndexes.length };
          }),
        });
      }
      var total = 0;
      for (var a2 = 0; a2 < branches.length; a2 += 1) total += probabilities[a2] * branches[a2].score;
      strategyRows.push({ banOpponentIndex: b, score: total, branches: branches });
    }
    return { probabilities: probabilities, strategies: strategyRows };
  }

  function solve(input) {
    var data = validateInput(input);
    var result = data.mode === 'robust' ? robustSolve(data) : predictiveSolve(data);
    result.strategies.sort(function (left, right) {
      if (Math.abs(right.score - left.score) <= EPS) return left.banOpponentIndex - right.banOpponentIndex;
      return right.score - left.score;
    });
    return {
      mode: data.mode,
      pairing: data.pairing,
      assumptions: assumptions(data),
      opponentBanProbabilities: result.probabilities,
      strategies: result.strategies.slice(0, Math.min(5, data.rates[0].length)),
    };
  }

  return { solve: solve };
});
