(function (root) {
  "use strict";

  var ourDecks = ["多龙", "玛长", "沙奈朵", "猛雷鼓", "电电虫", "赛富豪"];
  var opponentDecks = [
    "锤龙", "自爆多龙", "1号玛长", "2号玛长", "1号沙奈朵", "2号沙奈朵",
    "白鼓", "纯鼓", "电电虫", "N索", "伊布", "赛富豪", "恶喷", "钛晶box",
    "竹兰的烈咬陆鲨", "祭典", "火箭队", "桥龙", "岩殿居蟹", "阿响的火暴兽",
    "草椪皮皮", "免疫box"
  ];

  function seededRate(ourName, opponentName, rowIndex, columnIndex) {
    var text = "team-strategy-v1|" + ourName + "|" + opponentName + "|" + rowIndex + "|" + columnIndex;
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.round((0.25 + ((hash >>> 0) % 501) / 1000) * 1000) / 1000;
  }

  var rates = ourDecks.map(function (ourName, rowIndex) {
    return opponentDecks.map(function (opponentName, columnIndex) {
      return seededRate(ourName, opponentName, rowIndex, columnIndex);
    });
  });

  var data = {
    ourDecks: ourDecks,
    opponentDecks: opponentDecks,
    rates: rates,
    opponentRates: ourDecks.map(function () {
      return opponentDecks.map(function () { return null; });
    }),
    demo: true
  };

  root.DEMO_DATA = data;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = data;
  }
})(typeof window !== "undefined" ? window : globalThis);
