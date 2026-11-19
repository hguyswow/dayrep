(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayrepAiPrompts = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STANDARD_ACCIDENTS = [
    "협착", "추락", "낙하", "충돌", "전도", "감전",
    "붕괴", "넘어짐", "끼임", "절단", "질식", "화재"
  ];

  function cleanStr(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  /**
   * 공사현황 + 당일 작업정보 기반 안전교육 내용 생성 프롬프트 빌더.
   * 개인정보(근로자 명단·성명·도장) 및 API 키는 절대 포함하지 않는다.
   */
  function buildEduPrompt(settingsCtx, dayCtx) {
    var s = settingsCtx && typeof settingsCtx === "object" ? settingsCtx : {};
    var d = dayCtx && typeof dayCtx === "object" ? dayCtx : {};
    var c = s.construction && typeof s.construction === "object" ? s.construction : {};
    var sc = d.siteContext && typeof d.siteContext === "object" ? d.siteContext : {};

    var mode = d.mode === "improve" || d.mode === "append" ? d.mode : "generate";
    var useConstruction = d.useConstruction !== false;
    var useDailyContext = d.useDailyContext !== false;
    var useRecentEdu = d.useRecentEdu !== false;
    var aiNote = cleanStr(d.aiNote) || cleanStr(sc.aiNote);
    var currentContents = cleanStr(d.currentContents);

    var projectName = cleanStr(c.projectName) || cleanStr(s.siteName) || "(미지정 현장)";
    var overview = useConstruction ? cleanStr(c.overview) : "";
    var seasonMemo = useConstruction ? cleanStr(c.seasonWeatherMemo) : "";
    var freeMemo = useConstruction ? cleanStr(s.constructionStatusMemo) : "";

    var processLines = [];
    if (useConstruction && Array.isArray(c.processes)) {
      c.processes.forEach(function (p) {
        if (!p || !cleanStr(p.name)) return;
        var part = "- " + cleanStr(p.name);
        if (p.progress !== undefined && p.progress !== null && String(p.progress).trim() !== "") {
          part += " (공정률 " + String(p.progress).trim() + "%)";
        }
        if (cleanStr(p.equipment)) part += " / 주요장비: " + cleanStr(p.equipment);
        if (cleanStr(p.memo)) part += " / 비고: " + cleanStr(p.memo);
        processLines.push(part);
      });
    }

    var modeInstruction = "아래 현장 정보와 당일 작업 내용을 바탕으로 '일일 작업전 안전교육' 교육내용을 새로 작성해 주세요.";
    if (mode === "improve") {
      modeInstruction = "아래 '현재 교육내용'을 현장 상황과 위험요인에 맞게 더 구체적이고 실천 가능하도록 개선해 주세요.";
    } else if (mode === "append") {
      modeInstruction = "아래 '현재 교육내용' 뒤에 이어 붙일 새로운 안전교육 항목만 1~4줄 작성해 주세요. 기존 항목과 중복되지 않아야 합니다.";
    }

    var sections = [
      "당신은 건설현장 안전관리자입니다. " + modeInstruction,
      "",
      "[현장 및 작업 정보]",
      "- 공사명: " + projectName
    ];

    if (cleanStr(d.date)) sections.push("- 일자: " + cleanStr(d.date));
    if (cleanStr(d.weather)) sections.push("- 날씨: " + cleanStr(d.weather));
    if (overview) sections.push("- 공사 개요: " + overview);
    if (processLines.length > 0) {
      sections.push("- 진행 중인 공종:\n" + processLines.join("\n"));
    }
    if (useDailyContext) {
      if (cleanStr(d.workSection)) sections.push("- 금일 작업구간: " + cleanStr(d.workSection));
      if (cleanStr(d.workType)) sections.push("- 금일 투입공종: " + cleanStr(d.workType));
      if (cleanStr(sc.workEquipmentMemo)) {
        sections.push("- 금일 투입장비/작업 메모: " + cleanStr(sc.workEquipmentMemo));
      }
      if (cleanStr(sc.dailyReportText)) {
        sections.push("- 당일 작업일보 요약:\n" + cleanStr(sc.dailyReportText).slice(0, 1500));
      }
    }
    if (seasonMemo) sections.push("- 계절/기상 요인: " + seasonMemo);
    if (freeMemo) sections.push("- 기타 공사현황 메모: " + freeMemo);
    if (aiNote) sections.push("- [추가 지시 / 상세 정보]: " + aiNote);
    if ((mode === "improve" || mode === "append") && currentContents) {
      sections.push("- 현재 교육내용:\n" + currentContents.slice(0, 1500));
    }
    if (useRecentEdu && cleanStr(d.prevEduContents)) {
      sections.push("- 최근(전일) 교육내용 (동일 문구 반복 지양):\n" + cleanStr(d.prevEduContents).slice(0, 800));
    }

    sections.push("", "[출력 규칙 - 반드시 준수]");
    if (mode === "append") {
      sections.push(
        "1. 기존 교육내용과 중복되지 않는 새로운 안전교육 항목 1~4줄만 번호(1. ~)를 매겨 작성하세요.",
        "2. 기존 교육내용을 다시 출력하지 마세요."
      );
    } else if (mode === "improve") {
      sections.push(
        "1. 현재 교육내용의 줄 수(5~7줄)와 번호(1. ~) 형식을 유지하면서 현장 맞춤형으로 구체화하세요."
      );
    } else {
      sections.push(
        "1. 번호를 매긴 한국어 안전교육 내용 5~7줄만 작성하세요. (예: 1. ...)"
      );
    }
    sections.push(
      "2. 각 줄은 60자 내외로 간결하게 작성하세요.",
      "3. 공종·장비·기상 조건과 직접 관련된 구체적 위험요인과 예방수칙을 적고, 추상적·상투적 법령 문구는 피하세요.",
      "4. JSON, 마크다운 코드펜스(```), 머리말, 맺음말 없이 번호 매긴 줄 목록만 출력하세요."
    );

    return sections.join("\n");
  }

  function stripCodeFences(raw) {
    var text = String(raw || "").trim();
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n?/gm, "");
    text = text.replace(/\r?\n?```\s*$/gm, "");
    return text.trim();
  }

  function isPreambleLine(line) {
    return /^(다음은|아래는|안전교육\s*내용|일일\s*작업전|교육내용\s*:)/i.test(line) &&
      !/^\d+[.)]\s*/.test(line);
  }

  function parseEduResponse(text, mode) {
    var m = mode === "improve" || mode === "append" ? mode : "generate";
    var minLines = m === "append" ? 1 : 5;
    var maxLines = m === "append" ? 4 : 8;
    var cleaned = stripCodeFences(text);
    if (!cleaned) {
      return {
        ok: false,
        lines: [],
        formatted: "",
        warnings: ["AI 응답이 비어 있습니다."],
        retryHint: m === "append"
          ? "응답이 비어 있습니다. 추가할 안전교육 내용 1~4줄만 출력해 주세요."
          : "응답이 비어 있습니다. 번호(1. ~ 6.)를 매긴 안전교육 내용 5~7줄만 출력해 주세요.",
        raw: String(text || "")
      };
    }

    var rawLines = cleaned.split(/\r?\n/);
    var items = [];
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i].trim();
      if (!line) continue;
      if (items.length === 0 && isPreambleLine(line)) continue;
      if (items.length >= minLines && /^(위\s*내용|이상|참고|주의)/.test(line) && !/^\d+[.)]/.test(line)) {
        continue;
      }

      var body = line
        .replace(/^\d+\s*[.)]\s*/, "")
        .replace(/^[-*•]\s+/, "")
        .trim();
      if (body) {
        items.push(body);
      }
    }

    var warnings = [];
    if (items.length < minLines || items.length > maxLines) {
      return {
        ok: false,
        lines: items,
        formatted: items.map(function (b, idx) { return (idx + 1) + ". " + b; }).join("\n"),
        warnings: ["교육내용은 " + minLines + "~" + maxLines + "줄이어야 합니다. (현재 " + items.length + "줄)"],
        retryHint: m === "append"
          ? "반드시 1~4줄의 번호 매긴 목록만 출력해 주세요."
          : "반드시 5~7줄의 번호 매긴 목록(1. ~ 6.)으로만 다시 작성해 주세요.",
        raw: String(text || "")
      };
    }

    var formattedLines = items.map(function (b, idx) {
      if (b.length > 100) {
        warnings.push((idx + 1) + "번 줄이 깁니다 (" + b.length + "자).");
      }
      return (idx + 1) + ". " + b;
    });

    return {
      ok: true,
      lines: formattedLines,
      formatted: formattedLines.join("\n"),
      warnings: warnings,
      retryHint: null,
      raw: String(text || "")
    };
  }

  function mergeAppendEduContents(existingText, appendedLines) {
    var existing = String(existingText || "")
      .split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean);
    var additions = Array.isArray(appendedLines)
      ? appendedLines
      : String(appendedLines || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    var combined = existing.concat(additions);
    return combined
      .map(function (line, idx) {
        var body = line.replace(/^\d+\s*[.)]\s*/, "").trim();
        return (idx + 1) + ". " + body;
      })
      .join("\n");
  }

  /**
   * 공사현황 + 당일 작업구간·작업일보 기반 TBM 위험성평가 생성 프롬프트 빌더.
   * 개인정보(근로자 명단·성명·도장) 및 API 키는 절대 포함하지 않는다.
   */
  function buildLibraryExamplesBlock(libraryExamples) {
    if (!Array.isArray(libraryExamples) || libraryExamples.length === 0) return "";
    var header = "[이 현장에서 이전에 사용한 항목 — 같은 장비·작업이면 문구를 최대한 재사용하되 오늘 작업구간/날씨에 맞게 조정하세요. 맞지 않으면 무시하세요]";
    var lines = [header];
    var totalLen = header.length;
    var maxItems = Math.min(8, libraryExamples.length);
    for (var i = 0; i < maxItems; i++) {
      var ex = libraryExamples[i];
      if (!ex || typeof ex !== "object") continue;
      var item = cleanStr(ex.item).slice(0, 25);
      var hazard = cleanStr(ex.hazard).slice(0, 60);
      var type = cleanStr(ex.type).slice(0, 20);
      var level = cleanStr(ex.level).slice(0, 5);
      var measure = cleanStr(ex.measure).slice(0, 80);
      if (!item && !hazard && !measure) continue;
      var line = "- 장비: " + item + " | 유해위험: " + hazard + " | 재해: " + type + " | 등급: " + level + " | 대책: " + measure;
      if (totalLen + 1 + line.length > 2000) break;
      lines.push(line);
      totalLen += 1 + line.length;
    }
    return lines.length > 1 ? lines.join("\n") : "";
  }

  function normalizeRiskRowCount(val) {
    if (val === undefined || val === null || val === "" || val === "auto") return null;
    var n = Math.floor(Number(val));
    if (!Number.isFinite(n)) return null;
    if (n < 3) return 3;
    if (n > 8) return 8;
    return n;
  }

  function buildRiskPrompt(settingsCtx, dayCtx) {
    var s = settingsCtx && typeof settingsCtx === "object" ? settingsCtx : {};
    var d = dayCtx && typeof dayCtx === "object" ? dayCtx : {};
    var c = s.construction && typeof s.construction === "object" ? s.construction : {};
    var sc = d.siteContext && typeof d.siteContext === "object" ? d.siteContext : {};

    var projectName = cleanStr(c.projectName) || cleanStr(s.siteName) || "(미지정 현장)";
    var useConstruction = d.useConstruction !== false;
    var overview = useConstruction ? cleanStr(c.overview) : "";
    var seasonMemo = useConstruction ? cleanStr(c.seasonWeatherMemo) : "";
    var freeMemo = useConstruction ? cleanStr(s.constructionStatusMemo) : "";

    var processLines = [];
    if (useConstruction && Array.isArray(c.processes)) {
      c.processes.forEach(function (p) {
        if (!p || !cleanStr(p.name)) return;
        var part = "- " + cleanStr(p.name);
        if (p.progress !== undefined && p.progress !== null && String(p.progress).trim() !== "") {
          part += " (공정률 " + String(p.progress).trim() + "%)";
        }
        if (cleanStr(p.equipment)) part += " / 주요장비: " + cleanStr(p.equipment);
        if (cleanStr(p.memo)) part += " / 비고: " + cleanStr(p.memo);
        processLines.push(part);
      });
    }

    var sections = [
      "당신은 건설현장 안전관리자입니다. 아래 현장 정보와 금일 작업 내용을 바탕으로 T.B.M 일지의 '상시 위험성평가' 표를 작성해 주세요.",
      "",
      "[현장 및 작업 정보]",
      "- 공사명: " + projectName
    ];

    if (cleanStr(d.date)) sections.push("- 일자: " + cleanStr(d.date));
    if (cleanStr(d.weather)) sections.push("- 날씨: " + cleanStr(d.weather));
    if (overview) sections.push("- 공사 개요: " + overview);
    if (processLines.length > 0) {
      sections.push("- 진행 중인 공종:\n" + processLines.join("\n"));
    }
    if (cleanStr(d.workSection)) sections.push("- 금일 작업구간 및 내용: " + cleanStr(d.workSection));
    if (Array.isArray(d.scheduleItems) && d.scheduleItems.length > 0) {
      var schParts = d.scheduleItems
        .map(function (it) {
          var t = cleanStr(it && it.task);
          if (!t) return "";
          var eq = cleanStr(it && it.equipment);
          var mm = cleanStr(it && it.memo);
          var sPart = eq ? (t + "(" + eq + ")") : t;
          if (mm) sPart += " - " + mm;
          return sPart;
        })
        .filter(Boolean);
      if (schParts.length > 0) {
        sections.push("- 금일 공정표: " + schParts.join(", "));
      }
    }
    if (cleanStr(d.workType)) sections.push("- 금일 투입공종: " + cleanStr(d.workType));
    if (cleanStr(sc.workEquipmentMemo)) {
      sections.push("- 금일 투입장비/작업 메모: " + cleanStr(sc.workEquipmentMemo));
    }
    if (seasonMemo) sections.push("- 계절/기상 요인: " + seasonMemo);
    if (freeMemo) sections.push("- 기타 공사현황 메모: " + freeMemo);
    if (cleanStr(sc.dailyReportText)) {
      sections.push("- 당일 작업일보 요약:\n" + cleanStr(sc.dailyReportText).slice(0, 1500));
    }
    var libBlock = buildLibraryExamplesBlock(d.libraryExamples);
    if (libBlock) {
      sections.push("", libBlock);
    }

    var targetRowCount = normalizeRiskRowCount(d.rowCount);
    var countRule = targetRowCount
      ? ("1. 아래 키를 가진 JSON 배열을 정확히 " + targetRowCount + "행 출력하세요:")
      : "1. 아래 키를 가진 JSON 배열(3~6행)만 출력하세요:";

    sections.push(
      "",
      "[출력 규칙 - 반드시 준수]",
      countRule,
      '   [{"tool":"장비/도구","hazard":"유해위험요인","accident":"재해형태","level":"상|중|하","measure":"감소대책"}]',
      "2. accident(재해형태)는 반드시 다음 표준 용어 목록 중에서만 선택하세요: " + STANDARD_ACCIDENTS.join(", "),
      "3. level(위험성)은 반드시 \"상\", \"중\", \"하\" 중 하나만 사용하세요.",
      "4. 계절·기상 요인(한파·폭염·강우·강풍 등)이 있으면 최소 1행에 반드시 반영하세요.",
      "5. 원본 표 칸 폭에 맞게 간결하게 작성하세요: tool 12자 이하, hazard 30자 이하, measure 40자 이하.",
      "6. 마크다운 코드펜스(```), 머리말, 꼬리말 없이 순수 JSON 배열만 출력하세요."
    );

    return sections.join("\n");
  }

  function extractFirstJsonArray(raw) {
    var s = stripCodeFences(raw);
    var start = s.indexOf("[");
    if (start === -1) return null;

    var depth = 0;
    var inStr = false;
    var escaped = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inStr) {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          return s.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  function normalizeRiskLevel(val) {
    var v = String(val || "").trim().toLowerCase();
    if (v === "상" || v === "높음" || v === "h" || v === "high") return { level: "상", valid: true };
    if (v === "중" || v === "보통" || v === "m" || v === "medium" || v === "mid") return { level: "중", valid: true };
    if (v === "하" || v === "낮음" || v === "l" || v === "low") return { level: "하", valid: true };
    return { level: "중", valid: false };
  }

  function parseRiskResponse(text, opts) {
    var targetRowCount = normalizeRiskRowCount(opts && opts.rowCount);
    var rawStr = String(text || "");
    var arrJson = extractFirstJsonArray(rawStr);
    if (!arrJson) {
      return {
        ok: false,
        rows: [],
        warnings: ["JSON 배열을 찾을 수 없습니다."],
        retryHint: '반드시 [{"tool":"...","hazard":"...","accident":"...","level":"중","measure":"..."}] 형식의 순수 JSON 배열만 출력해 주세요.',
        raw: rawStr
      };
    }

    var parsed;
    try {
      parsed = JSON.parse(arrJson);
    } catch (e) {
      return {
        ok: false,
        rows: [],
        warnings: ["JSON 파싱에 실패했습니다."],
        retryHint: targetRowCount
          ? ("유효한 JSON 배열 형식으로 정확히 " + targetRowCount + "행만 다시 출력해 주세요.")
          : "유효한 JSON 배열 형식으로 3~6행만 다시 출력해 주세요.",
        raw: rawStr
      };
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        ok: false,
        rows: [],
        warnings: ["위험성평가 행이 비어 있습니다."],
        retryHint: targetRowCount
          ? ("정확히 " + targetRowCount + "행의 JSON 배열을 출력해 주세요.")
          : "최소 3행 이상의 JSON 배열을 출력해 주세요.",
        raw: rawStr
      };
    }

    var warnings = [];
    if (targetRowCount) {
      if (parsed.length > targetRowCount) {
        warnings.push("요청 행 수(" + targetRowCount + "행)보다 많아 " + targetRowCount + "행까지만 사용합니다 (" + parsed.length + "행 수신).");
        parsed = parsed.slice(0, targetRowCount);
      } else if (parsed.length < targetRowCount) {
        warnings.push("요청 행 수(" + targetRowCount + "행)와 다릅니다 (" + parsed.length + "행).");
      }
    } else if (parsed.length < 3 || parsed.length > 6) {
      warnings.push("권장 행 수(3~6행)와 다릅니다 (" + parsed.length + "행).");
    }

    var rows = parsed.map(function (item, idx) {
      var obj = item && typeof item === "object" ? item : {};
      var tool = String(obj.tool || obj.item || "").trim();
      var hazard = String(obj.hazard || "").trim();
      var accident = String(obj.accident || obj.type || "").trim();
      var measure = String(obj.measure || "").trim();
      var lvlRes = normalizeRiskLevel(obj.level);
      if (!lvlRes.valid && obj.level !== undefined && String(obj.level).trim() !== "") {
        warnings.push((idx + 1) + "행 위험성(" + obj.level + ")을 '중'으로 보정했습니다.");
      }
      if (accident && STANDARD_ACCIDENTS.indexOf(accident) === -1) {
        warnings.push((idx + 1) + "행 재해형태('" + accident + "')가 표준 목록 외 값입니다.");
      }
      return {
        tool: tool,
        hazard: hazard,
        accident: accident,
        level: lvlRes.level,
        measure: measure
      };
    });

    return {
      ok: true,
      rows: rows,
      warnings: warnings,
      retryHint: null,
      raw: rawStr
    };
  }

  /**
   * TBM 일지 장비/도구 셀 1개 제안 프롬프트 빌더 (개인정보 제외)
   */
  function buildToolPrompt(settingsCtx, dayCtx) {
    var s = settingsCtx && typeof settingsCtx === "object" ? settingsCtx : {};
    var d = dayCtx && typeof dayCtx === "object" ? dayCtx : {};
    var c = s.construction && typeof s.construction === "object" ? s.construction : {};
    var sc = d.siteContext && typeof d.siteContext === "object" ? d.siteContext : {};

    var projectName = cleanStr(c.projectName) || cleanStr(s.siteName) || "(미지정 현장)";
    var existingTools = Array.isArray(d.existingTools)
      ? d.existingTools.map(cleanStr).filter(Boolean)
      : [];

    var lines = [
      "건설현장 T.B.M 일지 위험성평가 표의 '주요사항 장비/도구' 칸에 들어갈 항목 1개만 제안해 주세요.",
      "- 공사명: " + projectName
    ];
    if (cleanStr(d.workSection)) lines.push("- 금일 작업구간: " + cleanStr(d.workSection));
    if (cleanStr(d.workType)) lines.push("- 투입공종: " + cleanStr(d.workType));
    if (cleanStr(sc.workEquipmentMemo)) lines.push("- 투입장비 메모: " + cleanStr(sc.workEquipmentMemo));
    if (cleanStr(c.overview)) lines.push("- 공사 개요: " + cleanStr(c.overview));
    if (existingTools.length > 0) {
      lines.push("- 이미 입력된 다른 행의 장비/도구 (중복 금지): " + existingTools.join(", "));
    }
    var libBlock = buildLibraryExamplesBlock(d.libraryExamples);
    if (libBlock) {
      lines.push("", libBlock);
    }
    lines.push(
      "",
      "[출력 규칙]",
      "1. 12자 이하의 한국어 장비/도구명 또는 '작업명/장비' 한 줄만 출력하세요.",
      "2. 번호, 따옴표, 설명, 마크다운 없이 이름 한 줄만 출력하세요."
    );
    return lines.join("\n");
  }

  function parseToolResponse(text) {
    var cleaned = stripCodeFences(text);
    if (!cleaned) {
      return {
        ok: false,
        tool: "",
        warnings: ["AI 응답이 비어 있습니다."],
        retryHint: "12자 이하의 장비/도구명 한 줄만 출력해 주세요.",
        raw: String(text || "")
      };
    }
    var firstLine = "";
    var lines = cleaned.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i]
        .trim()
        .replace(/^\d+\s*[.)]\s*/, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim();
      if (l) {
        firstLine = l;
        break;
      }
    }
    if (!firstLine) {
      return {
        ok: false,
        tool: "",
        warnings: ["유효한 장비/도구명이 없습니다."],
        retryHint: "장비/도구명 한 줄만 출력해 주세요.",
        raw: String(text || "")
      };
    }
    var warnings = [];
    if (firstLine.length > 15) {
      warnings.push("장비/도구명이 깁니다 (" + firstLine.length + "자).");
    }
    return {
      ok: true,
      tool: firstLine,
      warnings: warnings,
      retryHint: null,
      raw: String(text || "")
    };
  }

  /**
   * TBM 일지 특정 행의 장비/도구에 대응하는 유해위험요인·재해형태·위험성·감소대책 1행 생성 프롬프트
   */
  function buildRiskRowPrompt(settingsCtx, dayCtx) {
    var s = settingsCtx && typeof settingsCtx === "object" ? settingsCtx : {};
    var d = dayCtx && typeof dayCtx === "object" ? dayCtx : {};
    var c = s.construction && typeof s.construction === "object" ? s.construction : {};
    var sc = d.siteContext && typeof d.siteContext === "object" ? d.siteContext : {};
    var tool = cleanStr(d.tool);

    var projectName = cleanStr(c.projectName) || cleanStr(s.siteName) || "(미지정 현장)";
    var lines = [
      "당신은 건설현장 안전관리자입니다. 아래 장비/도구에 직접 대응하는 위험성평가 1행을 작성해 주세요.",
      "",
      "[대상 행 및 현장 정보]",
      "- 필수 대상 장비/도구: " + tool,
      "- 공사명: " + projectName
    ];
    if (cleanStr(d.weather)) lines.push("- 날씨: " + cleanStr(d.weather));
    if (cleanStr(c.seasonWeatherMemo)) lines.push("- 계절/기상 요인: " + cleanStr(c.seasonWeatherMemo));
    if (cleanStr(d.workSection)) lines.push("- 금일 작업구간: " + cleanStr(d.workSection));
    if (cleanStr(d.workType)) lines.push("- 투입공종: " + cleanStr(d.workType));
    if (cleanStr(sc.dailyReportText)) {
      lines.push("- 당일 작업일보 요약: " + cleanStr(sc.dailyReportText).slice(0, 600));
    }
    var libBlock = buildLibraryExamplesBlock(d.libraryExamples);
    if (libBlock) {
      lines.push("", libBlock);
    }
    lines.push(
      "",
      "[출력 규칙 - 반드시 준수]",
      '1. JSON 객체 1개만 출력하세요: {"hazard":"유해위험요인","accident":"재해형태","level":"상|중|하","measure":"감소대책"}',
      "2. hazard(유해위험요인)는 반드시 위 장비/도구('" + tool + "')와 직접 관련된 구체적 위험이어야 합니다.",
      "3. accident(재해형태)는 반드시 표준 용어 목록 중에서만 선택하세요: " + STANDARD_ACCIDENTS.join(", "),
      "4. level(위험성)은 반드시 \"상\", \"중\", \"하\" 중 하나만 사용하세요.",
      "5. 길이 제한: hazard 30자 이하, measure 40자 이하.",
      "6. 마크다운 코드펜스(```), 배열, 설명 없이 순수 JSON 객체 1개만 출력하세요."
    );
    return lines.join("\n");
  }

  function extractFirstJsonObject(raw) {
    var s = stripCodeFences(raw);
    var start = s.indexOf("{");
    if (start === -1) return null;

    var depth = 0;
    var inStr = false;
    var escaped = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inStr) {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return s.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  function parseRiskRowResponse(text) {
    var rawStr = String(text || "");
    var objJson = extractFirstJsonObject(rawStr);
    if (!objJson) {
      return {
        ok: false,
        row: null,
        warnings: ["JSON 객체를 찾을 수 없습니다."],
        retryHint: '반드시 {"hazard":"...","accident":"...","level":"중","measure":"..."} 형식의 순수 JSON 객체 1개만 출력해 주세요.',
        raw: rawStr
      };
    }

    var parsed;
    try {
      parsed = JSON.parse(objJson);
    } catch (e) {
      return {
        ok: false,
        row: null,
        warnings: ["JSON 파싱에 실패했습니다."],
        retryHint: "유효한 JSON 객체 1개만 다시 출력해 주세요.",
        raw: rawStr
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        row: null,
        warnings: ["JSON 객체 형식이 아닙니다."],
        retryHint: "배열이 아닌 JSON 객체 1개만 출력해 주세요.",
        raw: rawStr
      };
    }

    var warnings = [];
    var hazard = String(parsed.hazard || "").trim();
    var accident = String(parsed.accident || parsed.type || "").trim();
    var measure = String(parsed.measure || "").trim();
    var lvlRes = normalizeRiskLevel(parsed.level);
    if (!lvlRes.valid && parsed.level !== undefined && String(parsed.level).trim() !== "") {
      warnings.push("위험성(" + parsed.level + ")을 '중'으로 보정했습니다.");
    }
    if (accident && STANDARD_ACCIDENTS.indexOf(accident) === -1) {
      warnings.push("재해형태('" + accident + "')가 표준 목록 외 값입니다.");
    }

    return {
      ok: true,
      row: {
        hazard: hazard,
        accident: accident,
        level: lvlRes.level,
        measure: measure
      },
      warnings: warnings,
      retryHint: null,
      raw: rawStr
    };
  }

  /**
   * TBM 일지 '위험성 감소대책' 1칸 생성 프롬프트 빌더 (개인정보 제외)
   */
  function buildMeasurePrompt(settingsCtx, dayCtx) {
    var s = settingsCtx && typeof settingsCtx === "object" ? settingsCtx : {};
    var d = dayCtx && typeof dayCtx === "object" ? dayCtx : {};
    var c = s.construction && typeof s.construction === "object" ? s.construction : {};
    var projectName = cleanStr(c.projectName) || cleanStr(s.siteName) || "(미지정 현장)";

    var lines = [
      "당신은 건설현장 안전관리자입니다. 아래 위험요인에 대한 '위험성 감소대책' 1건만 작성해 주세요.",
      "- 공사명: " + projectName
    ];
    if (cleanStr(d.tool)) lines.push("- 장비/도구: " + cleanStr(d.tool));
    if (cleanStr(d.hazard)) lines.push("- 유해·위험요인: " + cleanStr(d.hazard));
    if (cleanStr(d.accident)) lines.push("- 재해형태: " + cleanStr(d.accident));
    if (cleanStr(d.level)) lines.push("- 위험성 등급: " + cleanStr(d.level));
    if (cleanStr(d.workSection)) lines.push("- 금일 작업구간: " + cleanStr(d.workSection));
    if (cleanStr(d.workType)) lines.push("- 투입공종: " + cleanStr(d.workType));
    if (cleanStr(d.weather)) lines.push("- 날씨: " + cleanStr(d.weather));
    if (cleanStr(c.seasonWeatherMemo)) lines.push("- 계절/기상 요인: " + cleanStr(c.seasonWeatherMemo));
    var libBlock = buildLibraryExamplesBlock(d.libraryExamples);
    if (libBlock) {
      lines.push("", libBlock);
    }

    lines.push(
      "",
      "[출력 규칙]",
      '1. JSON 객체 {"measure":"..."} 또는 감소대책 한 줄만 출력하세요.',
      "2. 60자 이하, 2문장 이하로 구체적이고 실천 가능하게 작성하세요."
    );
    if (cleanStr(d.level) === "상") {
      lines.push("3. 위험성이 '상'이므로 관리·감독 조치(작업지휘자 배치, 작업 전 승인 등)를 반드시 포함하세요.");
    }
    return lines.join("\n");
  }

  function parseMeasureResponse(text) {
    var rawStr = String(text || "");
    var objJson = extractFirstJsonObject(rawStr);
    var measure = "";

    if (objJson) {
      try {
        var parsed = JSON.parse(objJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          measure = String(parsed.measure || "").trim();
        }
      } catch (_) {}
    }

    if (!measure) {
      var cleaned = stripCodeFences(rawStr);
      var lines = cleaned.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i]
          .trim()
          .replace(/^\d+\s*[.)]\s*/, "")
          .replace(/^[-*•]\s+/, "")
          .replace(/^["'`]+|["'`]+$/g, "")
          .trim();
        if (l) {
          measure = l;
          break;
        }
      }
    }

    if (!measure) {
      return {
        ok: false,
        measure: "",
        warnings: ["AI 응답이 비어 있습니다."],
        retryHint: "60자 이하의 위험성 감소대책 한 줄만 출력해 주세요.",
        raw: rawStr
      };
    }

    var warnings = [];
    var retryHint = null;
    if (measure.length > 60) {
      warnings.push("감소대책이 60자를 초과했습니다 (" + measure.length + "자).");
      retryHint = "반드시 60자 이하의 짧은 감소대책으로 다시 작성해 주세요.";
    }

    return {
      ok: true,
      measure: measure,
      warnings: warnings,
      retryHint: retryHint,
      raw: rawStr
    };
  }

  return {
    STANDARD_ACCIDENTS: STANDARD_ACCIDENTS,
    buildEduPrompt: buildEduPrompt,
    parseEduResponse: parseEduResponse,
    mergeAppendEduContents: mergeAppendEduContents,
    buildRiskPrompt: buildRiskPrompt,
    parseRiskResponse: parseRiskResponse,
    buildToolPrompt: buildToolPrompt,
    parseToolResponse: parseToolResponse,
    buildRiskRowPrompt: buildRiskRowPrompt,
    parseRiskRowResponse: parseRiskRowResponse,
    buildMeasurePrompt: buildMeasurePrompt,
    parseMeasureResponse: parseMeasureResponse
  };
});
