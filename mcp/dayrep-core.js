"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const STANDARD_ACCIDENTS = [
  "협착", "추락", "낙하", "충돌", "전도", "감전",
  "붕괴", "넘어짐", "끼임", "절단", "질식", "화재"
];

function validateDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`잘못된 날짜 형식입니다 (YYYY-MM-DD 필요): ${date}`);
  }
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`유효하지 않은 날짜입니다: ${date}`);
  }
}

function resolveDataDir(env = process.env) {
  const fromEnv = (env.DAYREP_DATA_DIR || "").trim();
  if (fromEnv) {
    if (!fs.existsSync(fromEnv) || !fs.statSync(fromEnv).isDirectory()) {
      throw new Error(`DAYREP_DATA_DIR 폴더가 존재하지 않습니다: ${fromEnv}`);
    }
    return fromEnv;
  }

  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const cfgPath = path.join(appData, "com.dayrep.app", "app_config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const candidate = (cfg.dataDir || "").trim();
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch (_) {
      // ignore and fall back
    }
  }

  const docDefault = path.join(os.homedir(), "Documents", "일일서류");
  if (!fs.existsSync(docDefault) || !fs.statSync(docDefault).isDirectory()) {
    throw new Error(`기본 데이터 폴더를 찾을 수 없습니다: ${docDefault}`);
  }
  return docDefault;
}

function dayJsonPath(dataDir, date) {
  validateDate(date);
  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  return path.join(dataDir, "days", y, m, date, "data.json");
}

function readJsonStrict(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON 객체가 아닙니다.");
    }
    return parsed;
  } catch (err) {
    throw new Error(`손상된 JSON 파일(${path.basename(filePath)})이므로 덮어쓰지 않고 중단합니다: ${err.message}`);
  }
}

function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
    throw err;
  }
}

function listDays(dataDir) {
  const daysRoot = path.join(dataDir, "days");
  if (!fs.existsSync(daysRoot)) return [];

  const result = [];
  for (const yEntry of fs.readdirSync(daysRoot, { withFileTypes: true })) {
    if (!yEntry.isDirectory()) continue;
    const yPath = path.join(daysRoot, yEntry.name);
    for (const mEntry of fs.readdirSync(yPath, { withFileTypes: true })) {
      if (!mEntry.isDirectory()) continue;
      const mPath = path.join(yPath, mEntry.name);
      for (const dEntry of fs.readdirSync(mPath, { withFileTypes: true })) {
        if (!dEntry.isDirectory()) continue;
        const dateStr = dEntry.name;
        try {
          validateDate(dateStr);
        } catch (_) {
          continue;
        }
        const dayDir = path.join(mPath, dateStr);
        const hasData = fs.existsSync(path.join(dayDir, "data.json"));
        const hasPdf = fs.existsSync(path.join(dayDir, `일일서류_${dateStr}.pdf`));
        const photosDir = path.join(dayDir, "photos");
        let photoCount = 0;
        if (fs.existsSync(photosDir)) {
          for (const f of fs.readdirSync(photosDir)) {
            if (/^0[1-6]\.(jpg|jpeg|png|webp)$/i.test(f)) photoCount += 1;
          }
        }
        if (hasData || hasPdf || photoCount > 0) {
          result.push({ date: dateStr, hasPdf, photoCount });
        }
      }
    }
  }
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

function getSiteContext(dataDir, recentDays = 5) {
  const n = Math.min(30, Math.max(1, Math.floor(Number(recentDays) || 5)));
  const settingsPath = path.join(dataDir, "settings.json");
  const settings = readJsonStrict(settingsPath) || {};

  const days = listDays(dataDir).slice(0, n);
  const recentSummaries = [];
  for (const d of days) {
    let parsed = null;
    try {
      parsed = readJsonStrict(dayJsonPath(dataDir, d.date));
    } catch (_) {
      continue;
    }
    if (!parsed) continue;
    recentSummaries.push({
      date: d.date,
      workType: (parsed.eduLog && parsed.eduLog.workType) || "",
      eduContents: (parsed.eduLog && parsed.eduLog.contents) || "",
      workSection: (parsed.tbmLog && parsed.tbmLog.workSection) || ""
    });
  }

  return {
    siteName: settings.siteName || "",
    construction: settings.construction || {
      projectName: "",
      overview: "",
      processes: [],
      seasonWeatherMemo: ""
    },
    constructionStatusMemo: settings.constructionStatusMemo || "",
    schedule: settings.schedule || { items: [] },
    recentDays: recentSummaries
  };
}

function getDay(dataDir, date) {
  const filePath = dayJsonPath(dataDir, date);
  const parsed = readJsonStrict(filePath);
  if (!parsed) {
    return { exists: false, date, eduLog: null, patrol: null, tbmLog: null, siteContext: null };
  }
  const edu = parsed.eduLog && typeof parsed.eduLog === "object" ? parsed.eduLog : {};
  const patrol = parsed.patrol && typeof parsed.patrol === "object" ? parsed.patrol : {};
  const tbm = parsed.tbmLog && typeof parsed.tbmLog === "object" ? parsed.tbmLog : {};
  const sc = parsed.siteContext && typeof parsed.siteContext === "object" ? parsed.siteContext : {};

  return {
    exists: true,
    date,
    eduLog: {
      workType: edu.workType || "",
      contents: edu.contents || "",
      contentsBackup: edu.contentsBackup || ""
    },
    patrol: {
      weather: patrol.weather || "",
      weeklyFocus: patrol.weeklyFocus || ""
    },
    tbmLog: {
      workSection: tbm.workSection || "",
      riskRows: Array.isArray(tbm.riskRows) ? tbm.riskRows : []
    },
    siteContext: {
      dailyReportText: sc.dailyReportText || "",
      workEquipmentMemo: sc.workEquipmentMemo || ""
    }
  };
}

function loadOrInitDay(filePath, date) {
  const existing = readJsonStrict(filePath);
  if (existing) {
    if (!existing.schemaVersion) existing.schemaVersion = 1;
    if (!existing.date) existing.date = date;
    return existing;
  }
  return {
    schemaVersion: 1,
    date,
    eduLog: { contents: "", contentsBackup: "" },
    tbmLog: { workSection: "", riskRows: [], riskRowsBackup: null }
  };
}

function setEduContents(dataDir, date, text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("교육내용(text)은 비어 있을 수 없습니다.");
  }
  if (text.length > 3000) {
    throw new Error("교육내용(text)은 3000자를 초과할 수 없습니다.");
  }
  const filePath = dayJsonPath(dataDir, date);
  const data = loadOrInitDay(filePath, date);
  if (!data.eduLog || typeof data.eduLog !== "object") data.eduLog = {};

  data.eduLog.contentsBackup = typeof data.eduLog.contents === "string" ? data.eduLog.contents : "";
  data.eduLog.contents = text.trim();
  atomicWriteJson(filePath, data);
  return { ok: true, date, length: data.eduLog.contents.length };
}

function normalizeRiskLevel(val) {
  const v = String(val || "").trim().toLowerCase();
  if (v === "상" || v === "높음" || v === "h" || v === "high") return "상";
  if (v === "중" || v === "보통" || v === "m" || v === "medium" || v === "mid") return "중";
  if (v === "하" || v === "낮음" || v === "l" || v === "low") return "하";
  return "중";
}

function setRiskRows(dataDir, date, rows) {
  if (!Array.isArray(rows) || rows.length < 3 || rows.length > 8) {
    throw new Error("위험성평가 행(rows)은 3~8행이어야 합니다.");
  }
  const warnings = [];
  const mapped = rows.map((r, idx) => {
    const obj = r && typeof r === "object" ? r : {};
    const tool = String(obj.tool || "").trim().slice(0, 40);
    const hazard = String(obj.hazard || "").trim().slice(0, 120);
    const accident = String(obj.accident || "").trim().slice(0, 30);
    const measure = String(obj.measure || "").trim().slice(0, 160);
    const level = normalizeRiskLevel(obj.level);
    if (accident && !STANDARD_ACCIDENTS.includes(accident)) {
      warnings.push(`${idx + 1}행 재해형태('${accident}')가 표준 목록 외 값입니다.`);
    }
    return { item: tool, hazard, type: accident, level, measure };
  });

  const filePath = dayJsonPath(dataDir, date);
  const data = loadOrInitDay(filePath, date);
  if (!data.tbmLog || typeof data.tbmLog !== "object") data.tbmLog = {};

  data.tbmLog.riskRowsBackup = Array.isArray(data.tbmLog.riskRows) ? data.tbmLog.riskRows : [];
  data.tbmLog.riskRows = mapped;
  atomicWriteJson(filePath, data);
  return { ok: true, date, count: mapped.length, warnings };
}

function setWorkSection(dataDir, date, text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("작업구간(text)은 비어 있을 수 없습니다.");
  }
  if (text.length > 3000) {
    throw new Error("작업구간(text)은 3000자를 초과할 수 없습니다.");
  }
  const filePath = dayJsonPath(dataDir, date);
  const data = loadOrInitDay(filePath, date);
  if (!data.tbmLog || typeof data.tbmLog !== "object") data.tbmLog = {};

  data.tbmLog.workSection = text.trim();
  atomicWriteJson(filePath, data);
  return { ok: true, date, workSection: data.tbmLog.workSection };
}

module.exports = {
  STANDARD_ACCIDENTS,
  validateDate,
  resolveDataDir,
  dayJsonPath,
  readJsonStrict,
  atomicWriteJson,
  listDays,
  getSiteContext,
  getDay,
  setEduContents,
  setRiskRows,
  setWorkSection
};
