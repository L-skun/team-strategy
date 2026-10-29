(function (root) {
  "use strict";

  var UTF8 = new TextDecoder("utf-8");

  function cleanName(value) {
    return value == null ? "" : String(value).replace(/[\u00a0\s]+/g, " ").trim();
  }

  function nameKey(value) {
    return cleanName(value).toLocaleLowerCase();
  }

  function parseRate(value, cellLabel) {
    if (value == null || value === "") return null;
    var text = String(value).trim();
    var percent = /%$/.test(text);
    var number = Number(percent ? text.slice(0, -1) : text);
    if (!Number.isFinite(number)) {
      throw new Error(cellLabel + " 的胜率不是有效数字：" + text);
    }
    if (percent || number > 1) number /= 100;
    if (number < 0 || number > 1) {
      throw new Error(cellLabel + " 的胜率必须在 0% 到 100% 之间。");
    }
    return number;
  }

  function findEndOfCentralDirectory(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var lowerBound = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= lowerBound; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error("这不是有效的 XLSX/ZIP 文件。");
  }

  function readZipDirectory(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = findEndOfCentralDirectory(bytes);
    var entryCount = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var entries = new Map();

    for (var i = 0; i < entryCount; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("XLSX 的 ZIP 目录已损坏。");
      }
      var flags = view.getUint16(offset + 8, true);
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      if(view.getUint32(offset+24,true)>25*1024*1024)throw new Error("XLSX 单个数据项超过 25 MB，请缩小文件。");
      var nameLength = view.getUint16(offset + 28, true);
      var extraLength = view.getUint16(offset + 30, true);
      var commentLength = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = UTF8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/");
      if (flags & 1) throw new Error("暂不支持加密的 XLSX 文件。");
      entries.set(name.replace(/^\//, ""), {
        method: method,
        compressedSize: compressedSize,
        localOffset: localOffset
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function unzipEntry(bytes, entry) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var offset = entry.localOffset;
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("XLSX 中的 ZIP 项已损坏。");
    var nameLength = view.getUint16(offset + 26, true);
    var extraLength = view.getUint16(offset + 28, true);
    var start = offset + 30 + nameLength + extraLength;
    var compressed = bytes.subarray(start, start + entry.compressedSize);
    if(entry.method===8&&root.fflate)return root.fflate.inflateSync(compressed);
    if(entry.method===8&&root.AndroidBridge){var chunks=[];for(var n=0;n<compressed.length;n+=8192)chunks.push(String.fromCharCode.apply(null,compressed.subarray(n,n+8192)));var result=JSON.parse(root.AndroidBridge.inflateRaw(btoa(chunks.join(''))));if(result.error)throw new Error(result.error);var decoded=atob(result.base64);return Uint8Array.from(decoded,function(c){return c.charCodeAt(0);});}
    if (entry.method === 0) return compressed;
    if (entry.method !== 8) throw new Error("XLSX 使用了不支持的 ZIP 压缩方式。");
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器无法解压 XLSX，请升级到较新的 Chrome、Edge 或 Safari。");
    }
    var stream;
    try {
      stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch (error) {
      throw new Error("当前浏览器不支持 XLSX 所需的 deflate-raw 解压。");
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function normalizePath(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    var parts = (base + "/" + target).split("/");
    var result = [];
    parts.forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") result.pop();
      else result.push(part);
    });
    return result.join("/");
  }

  function parseXml(text, label) {
    var documentNode = new DOMParser().parseFromString(text, "application/xml");
    if (documentNode.getElementsByTagNameNS("*", "parsererror").length) {
      throw new Error("无法解析 XLSX 中的 " + label + "。");
    }
    return documentNode;
  }

  function columnIndex(reference) {
    var match = /^([A-Z]+)/i.exec(reference || "");
    if (!match) return 0;
    var index = 0;
    for (var i = 0; i < match[1].length; i += 1) {
      index = index * 26 + match[1].toUpperCase().charCodeAt(i) - 64;
    }
    return index - 1;
  }

  function rowIndex(reference) {
    var match = /(\d+)$/.exec(reference || "");
    return match ? Number(match[1]) - 1 : 0;
  }

  function columnName(index) {
    var name = "";
    for (var value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    return Array.from(xml.getElementsByTagNameNS("*", "si")).map(function (item) {
      return item.textContent || "";
    });
  }

  function parseSheet(xml, sharedStrings) {
    var rows = [];
    Array.from(xml.getElementsByTagNameNS("*", "c")).forEach(function (cell) {
      var reference = cell.getAttribute("r") || "A1";
      var row = rowIndex(reference);
      var column = columnIndex(reference);
      var type = cell.getAttribute("t") || "n";
      var valueNode = cell.getElementsByTagNameNS("*", "v")[0];
      var value = valueNode ? valueNode.textContent : null;
      if (type === "s") value = sharedStrings[Number(value)] == null ? "" : sharedStrings[Number(value)];
      else if (type === "inlineStr") {
        var inlineNode = cell.getElementsByTagNameNS("*", "is")[0];
        value = inlineNode ? inlineNode.textContent : "";
      } else if (type === "b") value = value === "1";
      else if ((type === "n" || !type) && value !== null && value !== "") value = Number(value);
      if (!rows[row]) rows[row] = [];
      rows[row][column] = value;
    });
    return rows;
  }

  function matrixFromRows(rows) {
    var header = rows[0] || [];
    var columnNames = Array.from({ length: Math.max(0, header.length - 1) }, function (_, index) {
      return cleanName(header[index + 1]);
    });
    var rowNames = Array.from({ length: Math.max(0, rows.length - 1) }, function (_, index) {
      return cleanName((rows[index + 1] || [])[0]);
    });
    while (columnNames.length && !columnNames[columnNames.length - 1]) columnNames.pop();
    while (rowNames.length && !rowNames[rowNames.length - 1]) rowNames.pop();
    var values = rowNames.map(function (_, row) {
      return columnNames.map(function (_, column) {
        return parseRate((rows[row + 1] || [])[column + 1], columnName(column + 1) + (row + 2));
      });
    });
    return { rowNames: rowNames, columnNames: columnNames, values: values, corner: cleanName(header[0]) };
  }

  function overlap(names, expected) {
    var keys = new Set(expected.map(nameKey));
    return names.reduce(function (score, name) { return score + (keys.has(nameKey(name)) ? 1 : 0); }, 0);
  }

  function indexByName(names) {
    var map = new Map();
    names.forEach(function (name, index) {
      var key = nameKey(name);
      if (key && !map.has(key)) map.set(key, index);
    });
    return map;
  }

  function assertUniqueLabels(names, axisLabel) {
    var seen = new Set();
    names.forEach(function (name) {
      var key = nameKey(name);
      if (!key) throw new Error(axisLabel + "中间存在空白名称，请补全或删除该行/列。");
      if (seen.has(key)) throw new Error(axisLabel + "存在重复名称：" + cleanName(name));
      seen.add(key);
    });
  }

  function labelsFit(names, expected) {
    var expectedKeys = new Set(expected.map(nameKey));
    return names.every(function (name) { return expectedKeys.has(nameKey(name)); });
  }

  function mapOpponentRates(matrix, ourDecks, opponentDecks) {
    assertUniqueLabels(matrix.rowNames, "第二页行标题");
    assertUniqueLabels(matrix.columnNames, "第二页列标题");
    var normalScore = overlap(matrix.rowNames, ourDecks) + overlap(matrix.columnNames, opponentDecks);
    var transposedScore = overlap(matrix.rowNames, opponentDecks) + overlap(matrix.columnNames, ourDecks);
    var normalValid = labelsFit(matrix.rowNames, ourDecks) && labelsFit(matrix.columnNames, opponentDecks);
    var transposedValid = labelsFit(matrix.rowNames, opponentDecks) && labelsFit(matrix.columnNames, ourDecks);
    if (!normalValid && !transposedValid) {
      throw new Error("第二页包含未知卡组名称，或行列标题与第一页无法对应。");
    }
    var direction = (matrix.corner || "").replace(/\s/g, "");
    if (normalValid && transposedValid && normalScore === transposedScore && direction !== "对手/我方" && direction !== "我方/对手") {
      throw new Error("第二页方向不明确，请确保行、列至少包含一个能区分我方与对手的卡组名称。");
    }
    var transposed = transposedValid && (!normalValid || transposedScore > normalScore || (normalScore === transposedScore && direction === "对手/我方"));
    var rowMap = indexByName(matrix.rowNames);
    var columnMap = indexByName(matrix.columnNames);
    return ourDecks.map(function (ourName) {
      return opponentDecks.map(function (opponentName) {
        var row = rowMap.get(nameKey(transposed ? opponentName : ourName));
        var column = columnMap.get(nameKey(transposed ? ourName : opponentName));
        return row == null || column == null ? null : matrix.values[row][column];
      });
    });
  }

  async function importMatchupWorkbook(arrayBuffer) {
    var input = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    var bytes = new Uint8Array(input.byteLength);
    bytes.set(input);
    var entries = readZipDirectory(bytes);

    async function readText(path, optional) {
      var entry = entries.get(path);
      if (!entry) {
        if (optional) return null;
        throw new Error("XLSX 缺少必要文件：" + path);
      }
      return UTF8.decode(await unzipEntry(bytes, entry));
    }

    var workbookXml = parseXml(await readText("xl/workbook.xml"), "工作簿");
    var relationshipsXml = parseXml(await readText("xl/_rels/workbook.xml.rels"), "工作簿关系");
    var sharedText = await readText("xl/sharedStrings.xml", true);
    var sharedStrings = parseSharedStrings(sharedText ? parseXml(sharedText, "共享文本") : null);
    var relationshipTargets = new Map();
    Array.from(relationshipsXml.getElementsByTagNameNS("*", "Relationship")).forEach(function (relationship) {
      relationshipTargets.set(relationship.getAttribute("Id"), relationship.getAttribute("Target"));
    });

    var sheetNodes = Array.from(workbookXml.getElementsByTagNameNS("*", "sheet"));
    if (!sheetNodes.length) throw new Error("工作簿中没有工作表。");
    var sheets = [];
    for (var i = 0; i < Math.min(sheetNodes.length, 2); i += 1) {
      var relationshipId = sheetNodes[i].getAttribute("r:id") || sheetNodes[i].getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      var target = relationshipTargets.get(relationshipId);
      if (!target) throw new Error("无法找到第 " + (i + 1) + " 个工作表。");
      var path = normalizePath("xl", target);
      sheets.push(parseSheet(parseXml(await readText(path), "工作表"), sharedStrings));
    }

    var primary = matrixFromRows(sheets[0]);
    var ourDecks = primary.rowNames;
    var opponentDecks = primary.columnNames;
    if (!ourDecks.length || !opponentDecks.length) {
      throw new Error("第一页应从 A2 向下填写我方卡组，并从 B1 向右填写对手卡组。");
    }
    assertUniqueLabels(ourDecks, "第一页我方卡组");
    assertUniqueLabels(opponentDecks, "第一页对手卡组");
    var rates = ourDecks.map(function (_, row) {
      return opponentDecks.map(function (_, column) {
        return primary.values[row][column];
      });
    });
    var opponentRates = sheets[1]
      ? mapOpponentRates(matrixFromRows(sheets[1]), ourDecks, opponentDecks)
      : ourDecks.map(function () { return opponentDecks.map(function () { return null; }); });

    return {
      ourDecks: ourDecks,
      opponentDecks: opponentDecks,
      rates: rates,
      opponentRates: opponentRates,
      demo: false
    };
  }

  root.importMatchupWorkbook = importMatchupWorkbook;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = importMatchupWorkbook;
  }
})(typeof window !== "undefined" ? window : globalThis);
