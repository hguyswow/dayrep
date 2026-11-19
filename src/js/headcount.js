(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayrepHeadcount = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function toNonNegInt(val) {
    var n = Math.floor(Number(val));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function cloneState(state) {
    var src = state && typeof state === "object" ? state : {};
    var cats = Array.isArray(src.categories)
      ? src.categories.map(function (c) {
          return {
            name: String((c && c.name) || "").trim() || "구분",
            count: toNonNegInt(c && c.count)
          };
        })
      : [];
    var absorbIdx = Number.isInteger(src.absorbIdx) ? src.absorbIdx : 0;
    if (cats.length > 0 && (absorbIdx < 0 || absorbIdx >= cats.length)) {
      absorbIdx = cats.length - 1;
    }
    var mode = src.mode === "fixed" ? "fixed" : "sum";
    var sum = cats.reduce(function (acc, c) {
      return acc + c.count;
    }, 0);
    var performed = mode === "fixed" && src.performed !== undefined
      ? toNonNegInt(src.performed)
      : sum;

    return {
      categories: cats,
      mode: mode,
      absorbIdx: absorbIdx,
      performed: performed,
      femaleCount: toNonNegInt(src.femaleCount)
    };
  }

  function computeSummary(s) {
    var targetTotal = s.categories.reduce(function (acc, c) {
      return acc + c.count;
    }, 0);
    var performedTotal = s.mode === "sum" ? targetTotal : s.performed;
    var absentTotal = Math.max(0, targetTotal - performedTotal);

    var performedFemale = Math.min(s.femaleCount, performedTotal);
    var performedMale = performedTotal - performedFemale;

    var targetFemale = Math.min(s.femaleCount, targetTotal);
    var targetMale = targetTotal - targetFemale;

    var absentMale = Math.max(0, targetMale - performedMale);
    var absentFemale = Math.max(0, targetFemale - performedFemale);

    return {
      targetTotal: targetTotal,
      targetMale: targetMale,
      targetFemale: targetFemale,
      performedTotal: performedTotal,
      performedMale: performedMale,
      performedFemale: performedFemale,
      absentTotal: absentTotal,
      absentMale: absentMale,
      absentFemale: absentFemale
    };
  }

  /**
   * 안전교육일지 인원 계산 순수 함수
   * @param {object} state { categories, mode, absorbIdx, performed, femaleCount }
   * @param {object} action { type, ... }
   * @returns {{ ok: boolean, warning: string|null, state: object, summary: object }}
   */
  function calcHeadcount(state, action) {
    var s = cloneState(state);
    var act = action && typeof action === "object" ? action : { type: "init" };
    var warning = null;
    var ok = true;

    if (act.type === "updateCategory") {
      var idx = act.index;
      var nextVal = toNonNegInt(act.count);
      if (idx >= 0 && idx < s.categories.length) {
        if (s.mode === "sum") {
          s.categories[idx].count = nextVal;
          s.performed = s.categories.reduce(function (acc, c) {
            return acc + c.count;
          }, 0);
        } else if (idx === s.absorbIdx) {
          s.categories[idx].count = nextVal;
        } else {
          var otherSum = 0;
          for (var i = 0; i < s.categories.length; i++) {
            if (i === s.absorbIdx) continue;
            otherSum += i === idx ? nextVal : s.categories[i].count;
          }
          var remain = s.performed - otherSum;
          if (remain < 0) {
            var currentOther = otherSum - nextVal;
            var maxAllowed = Math.max(0, s.performed - currentOther);
            var absorbName = s.categories[s.absorbIdx] ? s.categories[s.absorbIdx].name : "나머지";
            ok = false;
            warning = absorbName + " 인원이 0 미만이 될 수 없습니다. (" + s.categories[idx].name + "은(는) " + maxAllowed + "명까지만 허용)";
          } else {
            s.categories[idx].count = nextVal;
            if (s.categories[s.absorbIdx]) {
              s.categories[s.absorbIdx].count = remain;
            }
          }
        }
      }
    } else if (act.type === "setTargetTotal") {
      var targetTotal = toNonNegInt(act.value);
      if (s.mode === "fixed" && targetTotal < s.performed) {
        ok = false;
        warning = "교육대상 인원(" + targetTotal + "명)은 고정된 실시인원(" + s.performed + "명)보다 작을 수 없습니다.";
      } else if (s.categories.length > 0 && s.categories[s.absorbIdx]) {
        var nonAbsorbSum = 0;
        for (var k = 0; k < s.categories.length; k++) {
          if (k !== s.absorbIdx) nonAbsorbSum += s.categories[k].count;
        }
        var absorbedTarget = targetTotal - nonAbsorbSum;
        if (absorbedTarget < 0) {
          var absName = s.categories[s.absorbIdx].name || "나머지";
          ok = false;
          warning = absName + " 인원이 0 미만이 될 수 없습니다. (최소 " + nonAbsorbSum + "명 이상 필요)";
        } else {
          s.categories[s.absorbIdx].count = absorbedTarget;
          if (s.mode === "sum") {
            s.performed = targetTotal;
          }
        }
      }
    } else if (act.type === "setPerformed") {
      var target = toNonNegInt(act.value);
      s.mode = "fixed";
      s.performed = target;
      if (s.categories.length > 0 && s.categories[s.absorbIdx]) {
        var fixedOther = 0;
        for (var j = 0; j < s.categories.length; j++) {
          if (j !== s.absorbIdx) fixedOther += s.categories[j].count;
        }
        var absorbed = target - fixedOther;
        if (absorbed >= 0) {
          s.categories[s.absorbIdx].count = absorbed;
        } else {
          s.categories[s.absorbIdx].count = 0;
          warning = "나머지 구분 합계가 실시인원보다 큽니다. 구분별 인원을 조정해 주세요.";
        }
      }
    } else if (act.type === "revertToSum") {
      s.mode = "sum";
      s.performed = s.categories.reduce(function (acc, c) {
        return acc + c.count;
      }, 0);
    } else if (act.type === "deleteCategory") {
      var delIdx = act.index;
      if (s.categories.length <= 1) {
        ok = false;
        warning = "최소 1개의 교육대상 구분이 필요합니다.";
      } else if (delIdx >= 0 && delIdx < s.categories.length) {
        s.categories.splice(delIdx, 1);
        if (delIdx === s.absorbIdx) {
          s.absorbIdx = s.categories.length - 1;
        } else if (delIdx < s.absorbIdx) {
          s.absorbIdx -= 1;
        }
        if (s.mode === "sum") {
          s.performed = s.categories.reduce(function (acc, c) {
            return acc + c.count;
          }, 0);
        }
      }
    } else if (act.type === "setFemaleCount") {
      var fem = toNonNegInt(act.value);
      var cap = s.mode === "sum"
        ? s.categories.reduce(function (acc, c) { return acc + c.count; }, 0)
        : s.performed;
      if (fem > cap) {
        fem = cap;
        warning = "여 인원이 전체 계(" + cap + "명)를 초과할 수 없습니다.";
      }
      s.femaleCount = fem;
    } else {
      // init
      if (s.mode === "sum") {
        s.performed = s.categories.reduce(function (acc, c) {
          return acc + c.count;
        }, 0);
      }
    }

    return {
      ok: ok,
      warning: warning,
      state: s,
      summary: computeSummary(s)
    };
  }

  /**
   * 순회점검 작업인원 계산 순수 함수 (직원/직영/근로자, 계 고정)
   */
  function calcPatrolHeadcount(state, action) {
    var src = state && typeof state === "object" ? state : {};
    var total = toNonNegInt(src.total);
    var staff = toNonNegInt(src.staff);
    var direct = toNonNegInt(src.direct);
    var worker = toNonNegInt(src.worker);
    var act = action && typeof action === "object" ? action : { type: "init" };
    var ok = true;
    var warning = null;

    if (act.type === "setDirect") {
      var nextDirect = toNonNegInt(act.value);
      var nextWorker = total - staff - nextDirect;
      if (nextWorker < 0) {
        ok = false;
        warning = "근로자 인원이 0 미만이 될 수 없습니다. (직영 최대 " + Math.max(0, total - staff) + "명)";
      } else {
        direct = nextDirect;
        worker = nextWorker;
      }
    } else if (act.type === "setWorker") {
      var nextW = toNonNegInt(act.value);
      var nextD = total - staff - nextW;
      if (nextD < 0) {
        ok = false;
        warning = "직영 인원이 0 미만이 될 수 없습니다.";
      } else {
        worker = nextW;
        direct = nextD;
      }
    } else {
      var remain = total - staff - direct;
      if (remain >= 0) {
        worker = remain;
      } else {
        direct = Math.max(0, total - staff);
        worker = 0;
      }
    }

    return {
      ok: ok,
      warning: warning,
      state: {
        total: total,
        staff: staff,
        direct: direct,
        worker: worker
      }
    };
  }

  function calcAbsent(absentState, summary, action) {
    var src = absentState && typeof absentState === "object" ? absentState : {};
    var sum = summary && typeof summary === "object" ? summary : {};
    var manual = Boolean(src.manual);
    var total = manual ? toNonNegInt(src.total) : toNonNegInt(sum.absentTotal);
    var female = manual ? Math.min(toNonNegInt(src.female), total) : toNonNegInt(sum.absentFemale);
    var male = manual ? Math.max(0, total - female) : toNonNegInt(sum.absentMale);
    var act = action && typeof action === "object" ? action : { type: "init" };
    var ok = true;
    var warning = null;

    if (act.type === "setTotal") {
      var nextT = toNonNegInt(act.value);
      manual = true;
      total = nextT;
      female = Math.min(female, total);
      male = Math.max(0, total - female);
    } else if (act.type === "setFemale") {
      var nextF = toNonNegInt(act.value);
      manual = true;
      if (nextF > total) {
        ok = false;
        warning = "미실시 여 인원은 미실시 계(" + total + "명)를 초과할 수 없습니다.";
        nextF = total;
      }
      female = nextF;
      male = Math.max(0, total - female);
    } else if (act.type === "setMale") {
      var nextM = toNonNegInt(act.value);
      manual = true;
      if (nextM > total) {
        total = nextM;
        female = 0;
        male = nextM;
      } else {
        male = nextM;
        female = Math.max(0, total - male);
      }
    } else if (act.type === "resetAuto") {
      manual = false;
      total = toNonNegInt(sum.absentTotal);
      female = toNonNegInt(sum.absentFemale);
      male = toNonNegInt(sum.absentMale);
    }

    return {
      ok: ok,
      warning: warning,
      state: {
        total: total,
        male: male,
        female: female,
        manual: manual
      }
    };
  }

  return {
    calcHeadcount: calcHeadcount,
    calcPatrolHeadcount: calcPatrolHeadcount,
    calcAbsent: calcAbsent
  };
});
