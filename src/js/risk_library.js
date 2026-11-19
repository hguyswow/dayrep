(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayrepRiskLibrary = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_ENTRIES = 5000;
  var VALID_LEVELS = ["상", "중", "하"];

  function trimLimit(val, maxLen) {
    return String(val === undefined || val === null ? "" : val).trim().slice(0, maxLen);
  }

  function normalizeKeyPart(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s.,·•\-_/\\()[\]{}:;"'!?~`@#$%^&*+=|<>]+/g, "");
  }

  function makeKey(item, hazard) {
    return normalizeKeyPart(item) + "|" + normalizeKeyPart(hazard);
  }

  function normalizeLevel(lv) {
    var s = String(lv || "").trim();
    return VALID_LEVELS.indexOf(s) !== -1 ? s : "중";
  }

  function getRowItem(row) {
    if (!row || typeof row !== "object") return "";
    return trimLimit(row.item !== undefined ? row.item : row.tool, 60);
  }

  function getRowType(row) {
    if (!row || typeof row !== "object") return "";
    return trimLimit(row.type !== undefined ? row.type : row.accident, 30);
  }

  function isCompleteRow(row) {
    if (!row || typeof row !== "object") return false;
    var item = getRowItem(row);
    var hazard = trimLimit(row.hazard, 200);
    var measure = trimLimit(row.measure, 300);
    return Boolean(item && hazard && measure);
  }

  function genId(nowMs) {
    var ms = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
    var rnd = Math.floor(1000 + Math.random() * 9000);
    return "rl_" + ms + "_" + rnd;
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    var item = getRowItem(raw);
    var hazard = trimLimit(raw.hazard, 200);
    var measure = trimLimit(raw.measure, 300);
    if (!item || !hazard || !measure) return null;

    var category = trimLimit(raw.category, 30) || "미분류";
    var type = getRowType(raw);
    var level = normalizeLevel(raw.level);
    var source = raw.source === "manual" ? "manual" : "ai";
    var useCountNum = Number(raw.useCount);
    var useCount = Number.isFinite(useCountNum) && useCountNum >= 1 ? Math.floor(useCountNum) : 1;
    var nowIso = new Date().toISOString();
    var createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt.trim() : nowIso;
    var lastUsedAt = typeof raw.lastUsedAt === "string" && raw.lastUsedAt.trim() ? raw.lastUsedAt.trim() : createdAt;
    var id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 64) : genId();

    return {
      id: id,
      category: category,
      item: item,
      hazard: hazard,
      type: type,
      level: level,
      measure: measure,
      source: source,
      useCount: useCount,
      createdAt: createdAt,
      lastUsedAt: lastUsedAt
    };
  }

  function enforceLimit(entries) {
    if (entries.length <= MAX_ENTRIES) return entries;
    var sorted = entries.slice().sort(function (a, b) {
      if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt < b.lastUsedAt ? -1 : 1;
      return a.useCount - b.useCount;
    });
    var dropCount = entries.length - MAX_ENTRIES;
    var dropIds = new Set();
    for (var i = 0; i < dropCount; i++) {
      dropIds.add(sorted[i].id);
    }
    return entries.filter(function (e) {
      return !dropIds.has(e.id);
    });
  }

  function normalizeLibrary(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var arr = Array.isArray(src.entries) ? src.entries : [];
    var byKey = new Map();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var entry = normalizeEntry(arr[i]);
      if (!entry) continue;
      var k = makeKey(entry.item, entry.hazard);
      if (byKey.has(k)) {
        var existing = byKey.get(k);
        existing.useCount += entry.useCount;
        if (entry.lastUsedAt > existing.lastUsedAt) existing.lastUsedAt = entry.lastUsedAt;
      } else {
        byKey.set(k, entry);
        out.push(entry);
      }
    }
    return {
      schemaVersion: 1,
      entries: enforceLimit(out)
    };
  }

  function addRows(library, rows, meta) {
    var base = normalizeLibrary(library);
    var list = base.entries.slice();
    var m = meta && typeof meta === "object" ? meta : {};
    var category = trimLimit(m.category, 30) || "미분류";
    var source = m.source === "manual" ? "manual" : "ai";
    var nowIso = typeof m.now === "string" && m.now.trim() ? m.now.trim() : new Date().toISOString();
    var nowMs = Date.parse(nowIso);
    if (!Number.isFinite(nowMs)) nowMs = Date.now();

    var byKey = new Map();
    list.forEach(function (e) {
      byKey.set(makeKey(e.item, e.hazard), e);
    });

    var added = 0;
    var merged = 0;
    var inputRows = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < inputRows.length; i++) {
      var row = inputRows[i];
      if (!isCompleteRow(row)) continue;
      var item = getRowItem(row);
      var hazard = trimLimit(row.hazard, 200);
      var measure = trimLimit(row.measure, 300);
      var key = makeKey(item, hazard);

      if (byKey.has(key)) {
        var existing = byKey.get(key);
        existing.useCount += 1;
        existing.lastUsedAt = nowIso;
        if (!existing.measure && measure) existing.measure = measure;
        merged += 1;
      } else {
        var newEntry = {
          id: genId(nowMs + i),
          category: category,
          item: item,
          hazard: hazard,
          type: getRowType(row),
          level: normalizeLevel(row.level),
          measure: measure,
          source: source,
          useCount: 1,
          createdAt: nowIso,
          lastUsedAt: nowIso
        };
        byKey.set(key, newEntry);
        list.push(newEntry);
        added += 1;
      }
    }

    return {
      library: {
        schemaVersion: 1,
        entries: enforceLimit(list)
      },
      added: added,
      merged: merged
    };
  }

  function query(library, opts) {
    var base = normalizeLibrary(library);
    var o = opts && typeof opts === "object" ? opts : {};
    var cat = typeof o.category === "string" ? o.category.trim() : "";
    var q = typeof o.q === "string" ? o.q.trim().toLowerCase() : "";
    var itemHint = typeof o.item === "string" ? normalizeKeyPart(o.item) : "";
    var limit = Number.isFinite(Number(o.limit)) && Number(o.limit) > 0 ? Math.floor(Number(o.limit)) : 0;

    var filtered = base.entries.filter(function (e) {
      if (cat && cat !== "전체" && e.category !== cat) return false;
      if (q) {
        var hay = (e.category + " " + e.item + " " + e.hazard + " " + e.type + " " + e.measure).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    filtered.sort(function (a, b) {
      if (itemHint) {
        var aMatch = normalizeKeyPart(a.item).indexOf(itemHint) !== -1 ? 1 : 0;
        var bMatch = normalizeKeyPart(b.item).indexOf(itemHint) !== -1 ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      if (a.useCount !== b.useCount) return b.useCount - a.useCount;
      if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt > b.lastUsedAt ? -1 : 1;
      return 0;
    });

    return limit > 0 ? filtered.slice(0, limit) : filtered;
  }

  function listCategories(library) {
    var base = normalizeLibrary(library);
    var counts = {};
    base.entries.forEach(function (e) {
      var c = e.category || "미분류";
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (c) {
        return { category: c, count: counts[c] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.category < b.category ? -1 : (a.category > b.category ? 1 : 0);
      });
  }

  function updateEntry(library, id, patch) {
    var base = normalizeLibrary(library);
    var idx = base.entries.findIndex(function (e) {
      return e.id === id;
    });
    if (idx === -1) {
      return { ok: false, error: "항목을 찾을 수 없습니다.", library: base };
    }
    var cur = base.entries[idx];
    var mergedRaw = Object.assign({}, cur, patch || {}, { id: cur.id, createdAt: cur.createdAt });
    var nextEntry = normalizeEntry(mergedRaw);
    if (!nextEntry) {
      return { ok: false, error: "장비/도구, 유해·위험요인, 감소대책은 필수입니다.", library: base };
    }
    var nextKey = makeKey(nextEntry.item, nextEntry.hazard);
    var dup = base.entries.some(function (e, i) {
      return i !== idx && makeKey(e.item, e.hazard) === nextKey;
    });
    if (dup) {
      return { ok: false, error: "동일한 장비/도구와 유해·위험요인 조합이 이미 있습니다.", library: base };
    }
    var nextEntries = base.entries.slice();
    nextEntries[idx] = nextEntry;
    return {
      ok: true,
      library: { schemaVersion: 1, entries: nextEntries }
    };
  }

  function deleteEntry(library, id) {
    var base = normalizeLibrary(library);
    return {
      schemaVersion: 1,
      entries: base.entries.filter(function (e) {
        return e.id !== id;
      })
    };
  }

  function setCategory(library, ids, category) {
    var base = normalizeLibrary(library);
    var cat = trimLimit(category, 30) || "미분류";
    var idSet = new Set(Array.isArray(ids) ? ids : []);
    return {
      schemaVersion: 1,
      entries: base.entries.map(function (e) {
        if (!idSet.has(e.id)) return e;
        return Object.assign({}, e, { category: cat });
      })
    };
  }

  function bumpUsage(library, ids, now) {
    var base = normalizeLibrary(library);
    var idSet = new Set(Array.isArray(ids) ? ids : []);
    if (idSet.size === 0) return base;
    var nowIso = trimLimit(now, 40) || new Date().toISOString();
    return {
      schemaVersion: 1,
      entries: base.entries.map(function (e) {
        if (!idSet.has(e.id)) return e;
        return Object.assign({}, e, {
          useCount: (e.useCount || 0) + 1,
          lastUsedAt: nowIso
        });
      })
    };
  }

  function extractKeywords(text) {
    var raw = String(text || "").trim().toLowerCase();
    if (!raw) return [];
    var parts = raw.split(/[\s,·/|()\[\]\-]+/);
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.length >= 2 && !seen[p]) {
        seen[p] = true;
        out.push(p);
      }
    }
    return out;
  }

  function pickExamples(library, opts) {
    var base = normalizeLibrary(library);
    if (base.entries.length === 0) return [];
    var o = opts && typeof opts === "object" ? opts : {};
    var cat = trimLimit(o.category, 30);
    var toolNorm = normalizeKeyPart(o.tool);
    var wsKeys = extractKeywords(o.workSection);
    var rawLimit = Number(o.limit);
    var limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(8, Math.floor(rawLimit)) : 8;

    var scored = base.entries.map(function (e) {
      var score = 0;
      if (cat && e.category === cat) {
        score += 100;
      }
      if (toolNorm) {
        var eItem = normalizeKeyPart(e.item);
        if (eItem === toolNorm) {
          score += 60;
        } else if (eItem && (eItem.indexOf(toolNorm) !== -1 || toolNorm.indexOf(eItem) !== -1)) {
          score += 40;
        }
      }
      if (wsKeys.length > 0) {
        var hay = (e.item + " " + e.hazard + " " + e.measure).toLowerCase();
        var kwScore = 0;
        for (var i = 0; i < wsKeys.length; i++) {
          if (hay.indexOf(wsKeys[i]) !== -1) {
            kwScore += 10;
            if (kwScore >= 30) break;
          }
        }
        score += kwScore;
      }
      return { entry: e, score: score };
    });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.entry.useCount !== a.entry.useCount) return b.entry.useCount - a.entry.useCount;
      if (a.entry.lastUsedAt !== b.entry.lastUsedAt) return a.entry.lastUsedAt > b.entry.lastUsedAt ? -1 : 1;
      return 0;
    });

    return scored.slice(0, limit).map(function (s) {
      var e = s.entry;
      return {
        item: e.item,
        hazard: e.hazard,
        type: e.type,
        level: e.level,
        measure: e.measure
      };
    });
  }

  function rowSignature(row) {
    if (!isCompleteRow(row)) return "";
    return JSON.stringify([
      getRowItem(row),
      trimLimit(row.hazard, 200),
      getRowType(row),
      normalizeLevel(row.level),
      trimLimit(row.measure, 300)
    ]);
  }

  function collectCompleteSignatures(rows) {
    var set = new Set();
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var sig = rowSignature(list[i]);
      if (sig) set.add(sig);
    }
    return set;
  }

  function diffChangedCompleteRows(rows, baselineSet) {
    var base = baselineSet instanceof Set ? baselineSet : new Set();
    var changed = [];
    var seenInBatch = new Set();
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var sig = rowSignature(list[i]);
      if (!sig) continue;
      if (!base.has(sig) && !seenInBatch.has(sig)) {
        seenInBatch.add(sig);
        changed.push(list[i]);
      }
    }
    return {
      changedRows: changed,
      nextBaseline: collectCompleteSignatures(list)
    };
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    makeKey: makeKey,
    isCompleteRow: isCompleteRow,
    normalizeEntry: normalizeEntry,
    normalizeLibrary: normalizeLibrary,
    addRows: addRows,
    query: query,
    listCategories: listCategories,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    setCategory: setCategory,
    bumpUsage: bumpUsage,
    pickExamples: pickExamples,
    rowSignature: rowSignature,
    collectCompleteSignatures: collectCompleteSignatures,
    diffChangedCompleteRows: diffChangedCompleteRows
  };
});
