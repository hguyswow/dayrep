(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayrepCarryover = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_EDU_TEMPLATE = [
    "1. 금일 휴일 작업으로 주의력 저하가 우려되므로 작업 전 컨디션 및 안전수칙 재확인",
    "2. 협소한 현장에 장비(굴착기·크레인 등) 다수 투입 → 장비 이동·선회 반경 내 근로자 출입 통제",
    "3. 신호수 배치 및 장비 운전원-작업자 간 수신호 체계 확립",
    "4. 장비 후방·사각지대 접근 금지, 이동 시 유도자 배치",
    "5. 협소 구간 통행 시 장비 정지 확인 후 이동",
    "6. 안전모·안전화 등 개인보호구 착용 철저"
  ].join("\n");

  var DEFAULT_PATROL_ITEMS = [
    "1. 작업장 정리 정돈 상태 점검",
    "2. 고소 작업자 안전 유.무 확인",
    "3. 근로자 보호구 착용 점검",
    "4. 슬링밸트 점검",
    "5. 유해 위험 기계.기구 점검",
    "6. 공도구 피복 상태 점검",
    "7. 고소 작업대 안전상태 점검",
    "8. 근로자 안전벨트 착용 및 안전고리 체결 확인",
    "9. 크레인 등 운반기계류의 와이어로프 및 적재함 상태 점검",
    "10. 전기용접시 자동전격방지장치 부착 점검",
    "11. 장비 작업시 반경내 신호수 배치 확인",
    "12. 위험개소의 안전표지판 부착 점검",
    "*거푸집동바리의 재료 및 구조 이상 유.무 점검",
    "*철근가공 운반 및 조립 안전준수사항 점검",
    "*비계다리,가설통로 난간 및 미끄럼방지시설 점검",
    "*거푸집의 존치기간,해체작업시 안전수칙 준수 여부",
    "*자재 적재상태는 적정 상태 점검",
    "*기계톱 사용에 따른 안전시설 설치 점검",
    "",
    ""
  ];

  var DEFAULT_EDU_EVENTS = [
    "* 아침조회 및 TBM 실시",
    "* 오후 일일안전교육 실시"
  ];

  var DEFAULT_RISK_ROW = {
    item: "철근작업",
    hazard: "철재 중량물 취급 작업 중 협착",
    type: "협착",
    level: "중",
    measure: "중량물 취급 작업에 대한 안전수칙 등 교육 후 작업"
  };

  function makeDefaultPatrolChecks(defaultResult) {
    var isBlank = defaultResult === "blank";
    return DEFAULT_PATROL_ITEMS.map(function (text, idx) {
      return {
        text: text,
        result: !isBlank && idx < 18 ? "good" : ""
      };
    });
  }

  function normalizePatrolDefaultResult(val) {
    return val === "blank" ? "blank" : "good";
  }

  function makeDefaultCraneChecks() {
    var arr = [];
    for (var i = 0; i < 20; i++) {
      arr.push({ result: "good", note: "" });
    }
    return arr;
  }

  function makeDefaultTbmWorkers() {
    var arr = [];
    for (var i = 0; i < 30; i++) {
      arr.push({ role: "", name: "", note: "" });
    }
    return arr;
  }

  var DEFAULT_CATEGORIES = [
    { name: "장비기사", defaultCount: 1 },
    { name: "기공", defaultCount: 4 },
    { name: "일반공", defaultCount: 1 },
    { name: "현장관리자", defaultCount: 9 }
  ];

  function cloneCategoriesFromSettings(categories) {
    var list = Array.isArray(categories) && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
    return list.map(function (c) {
      var count = Number(c && (c.defaultCount !== undefined ? c.defaultCount : c.count));
      return {
        name: String((c && c.name) || "").trim() || "구분",
        count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
      };
    });
  }

  function cloneCategoriesFromDay(categories, fallbackSettings) {
    if (!Array.isArray(categories) || categories.length === 0) {
      return cloneCategoriesFromSettings(fallbackSettings && fallbackSettings.categories);
    }
    return categories.map(function (c) {
      var count = Number(c && c.count);
      return {
        name: String((c && c.name) || "").trim() || "구분",
        count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
      };
    });
  }

  var DEFAULT_AI_ENDPOINTS = {
    lmstudio: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
    opencode: { baseUrl: "https://opencode.ai/zen/v1", model: "" },
    deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "" },
    ollama: { baseUrl: "http://localhost:11434", model: "llama3.1" },
    claude_cli: { baseUrl: "claude", model: "" }
  };

  function normalizeConstruction(raw) {
    var c = raw && typeof raw === "object" ? raw : {};
    return {
      projectName: typeof c.projectName === "string" ? c.projectName : "",
      overview: typeof c.overview === "string" ? c.overview : "",
      processes: Array.isArray(c.processes)
        ? c.processes.map(function (p) {
            return {
              name: String((p && p.name) || "").trim(),
              progress: p && p.progress !== undefined && p.progress !== null ? String(p.progress) : "",
              equipment: String((p && p.equipment) || "").trim(),
              memo: String((p && p.memo) || "").trim()
            };
          })
        : [],
      seasonWeatherMemo: typeof c.seasonWeatherMemo === "string" ? c.seasonWeatherMemo : ""
    };
  }

  function normalizePrintDocs(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var keys = ["doc1", "doc2", "doc3", "doc4", "doc5"];
    var out = {};
    var anyTrue = false;
    keys.forEach(function (k) {
      out[k] = typeof src[k] === "boolean" ? src[k] : true;
      if (out[k]) anyTrue = true;
    });
    if (!anyTrue) {
      keys.forEach(function (k) {
        out[k] = true;
      });
    }
    return out;
  }

  function normalizeAiSettings(raw) {
    var a = raw && typeof raw === "object" ? raw : {};
    var srcEps = a.endpoints && typeof a.endpoints === "object" ? a.endpoints : {};
    var endpoints = {};
    Object.keys(DEFAULT_AI_ENDPOINTS).forEach(function (k) {
      var def = DEFAULT_AI_ENDPOINTS[k];
      var cur = srcEps[k] && typeof srcEps[k] === "object" ? srcEps[k] : {};
      endpoints[k] = {
        baseUrl: typeof cur.baseUrl === "string" && cur.baseUrl.trim() ? cur.baseUrl : def.baseUrl,
        model: typeof cur.model === "string" ? cur.model : def.model
      };
    });
    return {
      engine: typeof a.engine === "string" && a.engine.trim() ? a.engine : "hermes",
      hermesEndpoint: typeof a.hermesEndpoint === "string" && a.hermesEndpoint.trim()
        ? a.hermesEndpoint
        : "http://127.0.0.1:7860/api/generate",
      endpoints: endpoints
    };
  }

  function createDefaultSettings(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var cats = Array.isArray(src.categories) && src.categories.length > 0
      ? src.categories.map(function (c) {
          var count = Number(c && c.defaultCount);
          return {
            name: String((c && c.name) || "").trim() || "구분",
            defaultCount: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
          };
        })
      : DEFAULT_CATEGORIES.map(function (c) {
          return { name: c.name, defaultCount: c.defaultCount };
        });

    var absorbIdx = Number(src.absorbIdx);
    if (!Number.isInteger(absorbIdx) || absorbIdx < 0 || absorbIdx >= cats.length) {
      absorbIdx = Math.min(2, cats.length - 1);
    }

    var targetHours = Number(src.zeroAccidentTarget);
    if (!Number.isFinite(targetHours) || targetHours < 0) {
      targetHours = 100000;
    }

    return {
      schemaVersion: 1,
      siteName: typeof src.siteName === "string" ? src.siteName : "",
      companyName: typeof src.companyName === "string" ? src.companyName : "",
      safetyOfficerName: typeof src.safetyOfficerName === "string" ? src.safetyOfficerName : "",
      safetyOfficerTitle: typeof src.safetyOfficerTitle === "string" && src.safetyOfficerTitle.trim()
        ? src.safetyOfficerTitle
        : "안전관리자",
      siteManager: typeof src.siteManager === "string" ? src.siteManager : "",
      generalManager: typeof src.generalManager === "string" ? src.generalManager : "",
      craneOperator: typeof src.craneOperator === "string" ? src.craneOperator : "",
      defaultEduPlace: typeof src.defaultEduPlace === "string" && src.defaultEduPlace.trim()
        ? src.defaultEduPlace
        : "현장",
      categories: cats,
      absorbIdx: absorbIdx,
      zeroAccidentEnabled: typeof src.zeroAccidentEnabled === "boolean" ? src.zeroAccidentEnabled : true,
      zeroAccidentTarget: targetHours,
      eduTemplate: typeof src.eduTemplate === "string" && src.eduTemplate.length > 0
        ? src.eduTemplate
        : DEFAULT_EDU_TEMPLATE,
      constructionStatusMemo: typeof src.constructionStatusMemo === "string" ? src.constructionStatusMemo : "",
      construction: normalizeConstruction(src.construction),
      schedule: (function () {
        var schMod = (typeof globalThis !== "undefined" && globalThis.DayrepSchedule)
          ? globalThis.DayrepSchedule
          : (typeof require === "function" ? require("./schedule") : null);
        if (schMod && typeof schMod.normalizeSchedule === "function") {
          return { items: schMod.normalizeSchedule(src.schedule).items };
        }
        return src.schedule && Array.isArray(src.schedule.items) ? { items: src.schedule.items.slice() } : { items: [] };
      })(),
      ai: normalizeAiSettings(src.ai),
      backupDir: typeof src.backupDir === "string" ? src.backupDir : "",
      workers: Array.isArray(src.workers)
        ? src.workers.map(function (w) {
            return {
              role: String((w && w.role) || "").trim(),
              name: String((w && w.name) || "").trim()
            };
          })
        : [],
      printDocs: normalizePrintDocs(src.printDocs),
      patrolDefaultResult: normalizePatrolDefaultResult(src.patrolDefaultResult),
      riskLibraryAssist: src.riskLibraryAssist !== false,
      stamps: src.stamps && typeof src.stamps === "object" ? Object.assign({}, src.stamps) : {}
    };
  }

  /**
   * availableDates 중 targetDate보다 이전인 가장 가까운 날짜를 반환. 없으면 null.
   * @param {string} targetDate YYYY-MM-DD
   * @param {Array<string|{date: string}>} availableDates
   * @returns {string|null}
   */
  function findNearestPreviousDate(targetDate, availableDates) {
    if (typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return null;
    }
    if (!Array.isArray(availableDates) || availableDates.length === 0) {
      return null;
    }
    var best = null;
    for (var i = 0; i < availableDates.length; i++) {
      var item = availableDates[i];
      var d = typeof item === "string" ? item : (item && item.date);
      if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        continue;
      }
      if (d < targetDate && (best === null || d > best)) {
        best = d;
      }
    }
    return best;
  }

  /**
   * 전일 data.json(prevDayData)과 settings를 바탕으로 새 날짜의 data.json 기본값 생성.
   * 이월: 인원·투입공종·교육내용·무재해 전일누계. 초기화: 사진·점검체크·서명·당일 메모.
   */
  function buildDayFromCarryover(targetDate, prevDayData, settings) {
    var cfg = createDefaultSettings(settings);
    var prev = prevDayData && typeof prevDayData === "object" ? prevDayData : null;
    var prevEdu = prev && prev.eduLog && typeof prev.eduLog === "object" ? prev.eduLog : null;
    var prevPatrol = prev && prev.patrol && typeof prev.patrol === "object" ? prev.patrol : null;
    var prevSiteCtx = prev && prev.siteContext && typeof prev.siteContext === "object" ? prev.siteContext : null;

    var categories = prevEdu
      ? cloneCategoriesFromDay(prevEdu.categories, cfg)
      : cloneCategoriesFromSettings(cfg.categories);

    var sumCount = categories.reduce(function (acc, c) {
      return acc + c.count;
    }, 0);

    var absorbIdx = prevEdu && Number.isInteger(prevEdu.absorbIdx)
      ? prevEdu.absorbIdx
      : cfg.absorbIdx;
    if (absorbIdx < 0 || absorbIdx >= categories.length) {
      absorbIdx = Math.max(0, categories.length - 1);
    }

    var mode = prevEdu && (prevEdu.mode === "fixed" || prevEdu.mode === "sum")
      ? prevEdu.mode
      : "sum";

    var performed = mode === "fixed" && prevEdu && Number.isFinite(Number(prevEdu.performed))
      ? Math.max(0, Math.floor(Number(prevEdu.performed)))
      : sumCount;

    var prevZeroPrev = prevPatrol && Number.isFinite(Number(prevPatrol.zeroAccidentPrev))
      ? Number(prevPatrol.zeroAccidentPrev)
      : 0;
    var prevZeroToday = prevPatrol && Number.isFinite(Number(prevPatrol.zeroAccidentToday))
      ? Number(prevPatrol.zeroAccidentToday)
      : 0;
    var carriedZeroPrev = prevPatrol ? prevZeroPrev + prevZeroToday : 0;

    return {
      schemaVersion: 1,
      date: targetDate,
      carriedFrom: prev && typeof prev.date === "string" ? prev.date : null,
      eduLog: {
        categories: categories,
        mode: mode,
        absorbIdx: absorbIdx,
        performed: performed,
        femaleCount: prevEdu && Number.isFinite(Number(prevEdu.femaleCount))
          ? Math.max(0, Math.floor(Number(prevEdu.femaleCount)))
          : 0,
        absent: { total: 0, male: 0, female: 0, manual: false },
        workType: prevEdu && typeof prevEdu.workType === "string" ? prevEdu.workType : "",
        contents: prevEdu && typeof prevEdu.contents === "string" && prevEdu.contents.length > 0
          ? prevEdu.contents
          : cfg.eduTemplate,
        contentsBackup: "",
        duration: prevEdu && typeof prevEdu.duration === "string" && prevEdu.duration
          ? prevEdu.duration
          : "20분",
        materials: prevEdu && typeof prevEdu.materials === "string" && prevEdu.materials
          ? prevEdu.materials
          : "-",
        place: prevEdu && typeof prevEdu.place === "string" && prevEdu.place
          ? prevEdu.place
          : cfg.defaultEduPlace,
        instructorRole: prevEdu && typeof prevEdu.instructorRole === "string" && prevEdu.instructorRole
          ? prevEdu.instructorRole
          : cfg.safetyOfficerTitle,
        instructorName: prevEdu && typeof prevEdu.instructorName === "string" && prevEdu.instructorName
          ? prevEdu.instructorName
          : cfg.safetyOfficerName,
        absentReason: "",
        extraEduCheck: "-"
      },
      tbmPhotos: {
        place: "현장내",
        photos: []
      },
      patrol: {
        weather: "맑음",
        weeklyFocus: prevPatrol && typeof prevPatrol.weeklyFocus === "string" ? prevPatrol.weeklyFocus : "",
        eduEvents: prevPatrol && Array.isArray(prevPatrol.eduEvents) && prevPatrol.eduEvents.length === 2
          ? prevPatrol.eduEvents.slice()
          : DEFAULT_EDU_EVENTS.slice(),
        direct: prevPatrol && Number.isFinite(Number(prevPatrol.direct))
          ? Math.max(0, Math.floor(Number(prevPatrol.direct)))
          : 1,
        worker: 0,
        checks: makeDefaultPatrolChecks(cfg.patrolDefaultResult),
        zeroAccidentPrev: carriedZeroPrev,
        zeroAccidentToday: 0,
        notes: ""
      },
      crane: {
        checks: makeDefaultCraneChecks(),
        actionNotes: ""
      },
      tbmLog: {
        companyWorkType: prevEdu && typeof prevEdu.workType === "string" ? prevEdu.workType : "",
        workSection: "",
        riskRows: [
          Object.assign({}, DEFAULT_RISK_ROW),
          { item: "", hazard: "", type: "", level: "", measure: "" },
          { item: "", hazard: "", type: "", level: "", measure: "" },
          { item: "", hazard: "", type: "", level: "", measure: "" }
        ],
        workers: makeDefaultTbmWorkers(),
        opinion: ""
      },
      siteContext: {
        dailyReportText: "",
        workEquipmentMemo: prevSiteCtx && typeof prevSiteCtx.workEquipmentMemo === "string"
          ? prevSiteCtx.workEquipmentMemo
          : "",
        aiNote: ""
      }
    };
  }

  return {
    DEFAULT_EDU_TEMPLATE: DEFAULT_EDU_TEMPLATE,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    DEFAULT_PATROL_ITEMS: DEFAULT_PATROL_ITEMS,
    DEFAULT_EDU_EVENTS: DEFAULT_EDU_EVENTS,
    DEFAULT_RISK_ROW: DEFAULT_RISK_ROW,
    makeDefaultPatrolChecks: makeDefaultPatrolChecks,
    makeDefaultCraneChecks: makeDefaultCraneChecks,
    makeDefaultTbmWorkers: makeDefaultTbmWorkers,
    createDefaultSettings: createDefaultSettings,
    normalizePrintDocs: normalizePrintDocs,
    findNearestPreviousDate: findNearestPreviousDate,
    buildDayFromCarryover: buildDayFromCarryover
  };
});
