use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: u64 = 1;
pub const MAX_PHOTO_BYTES: usize = 20 * 1024 * 1024;
const ALLOWED_EXTS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
static TMP_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
    pub date: String,
    pub has_pdf: bool,
    pub photo_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchDayResult {
    pub date: String,
    pub has_pdf: bool,
    pub photo_count: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoData {
    pub filename: String,
    pub ext: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    data_dir: String,
}

/// YYYY-MM-DD 형식 및 실제 달력 날짜 유효성 검증
pub fn validate_date(date: &str) -> Result<(), String> {
    let bytes = date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[0..4].iter().all(|b| b.is_ascii_digit())
        || !bytes[5..7].iter().all(|b| b.is_ascii_digit())
        || !bytes[8..10].iter().all(|b| b.is_ascii_digit())
    {
        return Err(format!("잘못된 날짜 형식입니다 (YYYY-MM-DD 필요): {}", date));
    }
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| format!("유효하지 않은 날짜입니다: {}", date))
}

/// 사진 슬롯 번호(1~6) 검증
pub fn validate_idx(idx: u8) -> Result<(), String> {
    if !(1..=6).contains(&idx) {
        return Err(format!("사진 번호는 1~6 사이여야 합니다: {}", idx));
    }
    Ok(())
}

/// 사진 확장자 화이트리스트 검증 (jpg/jpeg/png/webp)
pub fn validate_ext(ext: &str) -> Result<String, String> {
    let clean = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if ALLOWED_EXTS.contains(&clean.as_str()) {
        Ok(clean)
    } else {
        Err(format!("허용되지 않는 사진 확장자입니다: {}", ext))
    }
}

pub fn default_data_dir() -> PathBuf {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("일일서류")
}

pub fn resolve_data_dir(config_dir: &Path) -> Result<PathBuf, String> {
    let cfg_path = config_dir.join("app_config.json");
    if cfg_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&cfg_path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&raw) {
                let candidate = PathBuf::from(cfg.data_dir.trim());
                if !cfg.data_dir.trim().is_empty() && candidate.is_dir() {
                    return Ok(candidate);
                }
            }
        }
    }
    let fallback = default_data_dir();
    fs::create_dir_all(&fallback)
        .map_err(|e| format!("기본 데이터 폴더 생성 실패 ({}): {}", fallback.display(), e))?;
    Ok(fallback)
}

pub fn save_configured_data_dir(config_dir: &Path, new_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(new_dir)
        .map_err(|e| format!("선택한 폴더에 접근할 수 없습니다 ({}): {}", new_dir.display(), e))?;
    let dir_str = new_dir.to_string_lossy().to_string();
    let cfg = AppConfig {
        data_dir: dir_str.clone(),
    };
    let json_val = serde_json::to_value(cfg).map_err(|e| format!("설정 직렬화 실패: {}", e))?;
    atomic_write_json(&config_dir.join("app_config.json"), &json_val)?;
    Ok(dir_str)
}

pub fn day_dir(data_dir: &Path, date: &str) -> Result<PathBuf, String> {
    validate_date(date)?;
    let year = &date[0..4];
    let month = &date[5..7];
    Ok(data_dir.join("days").join(year).join(month).join(date))
}

pub fn photos_dir(data_dir: &Path, date: &str) -> Result<PathBuf, String> {
    Ok(day_dir(data_dir, date)?.join("photos"))
}

/// 임시 파일 생성 → sync_all → rename 으로 원자적 저장
pub fn atomic_write_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("상위 경로가 없습니다: {}", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("디렉터리 생성 실패 ({}): {}", parent.display(), e))?;

    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_path = parent.join(format!(".{}.tmp.{}.{}", file_name, nanos, seq));

    let write_res = (|| -> Result<(), String> {
        let mut file = File::create(&tmp_path)
            .map_err(|e| format!("임시 파일 생성 실패 ({}): {}", tmp_path.display(), e))?;
        file.write_all(bytes)
            .map_err(|e| format!("파일 쓰기 실패 ({}): {}", tmp_path.display(), e))?;
        file.sync_all()
            .map_err(|e| format!("디스크 동기화 실패 ({}): {}", tmp_path.display(), e))?;
        Ok(())
    })();

    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Err(e) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "원자적 파일 교체 실패 ({} -> {}): {}",
            tmp_path.display(),
            target.display(),
            e
        ));
    }
    Ok(())
}

pub fn atomic_write_json(target: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("JSON 직렬화 실패: {}", e))?;
    atomic_write_bytes(target, text.as_bytes())
}

fn backup_corrupt_file(path: &Path) -> Result<PathBuf, String> {
    let base_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("data.json");
    let parent = path
        .parent()
        .ok_or_else(|| format!("상위 경로가 없습니다: {}", path.display()))?;
    let mut corrupt_path = parent.join(format!("{}.corrupt", base_name));
    if corrupt_path.exists() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        corrupt_path = parent.join(format!("{}.corrupt.{}", base_name, millis));
    }
    fs::rename(path, &corrupt_path).map_err(|e| {
        format!(
            "손상 파일 백업 실패 ({} -> {}): {}",
            path.display(),
            corrupt_path.display(),
            e
        )
    })?;
    Ok(corrupt_path)
}

fn read_json_object_or_default(path: &Path, default_obj: Value) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_obj);
    }
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("파일 읽기 실패 ({}): {}", path.display(), e))?;
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(mut map)) => {
            if !map.contains_key("schemaVersion") {
                map.insert("schemaVersion".to_string(), json!(SCHEMA_VERSION));
            }
            Ok(Value::Object(map))
        }
        Ok(_) | Err(_) => {
            backup_corrupt_file(path)?;
            Ok(default_obj)
        }
    }
}

pub fn load_settings(data_dir: &Path) -> Result<Value, String> {
    let path = data_dir.join("settings.json");
    read_json_object_or_default(&path, json!({ "schemaVersion": SCHEMA_VERSION }))
}

pub fn save_settings(data_dir: &Path, mut settings: Value) -> Result<(), String> {
    let map = settings
        .as_object_mut()
        .ok_or_else(|| "설정은 JSON 객체여야 합니다.".to_string())?;
    if !map.contains_key("schemaVersion") {
        map.insert("schemaVersion".to_string(), json!(SCHEMA_VERSION));
    }
    atomic_write_json(&data_dir.join("settings.json"), &settings)
}

const RISK_LIB_MAX_ENTRIES: usize = 5000;
const RISK_LIB_MAX_BYTES: usize = 5 * 1024 * 1024;

pub fn load_risk_library(data_dir: &Path) -> Result<Value, String> {
    let path = data_dir.join("risk_library.json");
    let mut obj = read_json_object_or_default(
        &path,
        json!({ "schemaVersion": SCHEMA_VERSION, "entries": [] }),
    )?;
    if let Some(map) = obj.as_object_mut() {
        if !map.get("entries").map(Value::is_array).unwrap_or(false) {
            map.insert("entries".to_string(), json!([]));
        }
    }
    Ok(obj)
}

fn check_str_field(obj: &serde_json::Map<String, Value>, key: &str, max_chars: usize, required_nonempty: bool) -> Result<(), String> {
    let val = obj
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("위험성평가 항목에 문자열 '{}' 필드가 없습니다.", key))?;
    let trimmed = val.trim();
    if required_nonempty && trimmed.is_empty() {
        return Err(format!("위험성평가 항목 '{}' 필드는 비어 있을 수 없습니다.", key));
    }
    if val.chars().count() > max_chars {
        return Err(format!("위험성평가 항목 '{}' 필드가 {}자를 초과했습니다.", key, max_chars));
    }
    Ok(())
}

pub fn save_risk_library(data_dir: &Path, mut library: Value) -> Result<(), String> {
    let map = library
        .as_object_mut()
        .ok_or_else(|| "위험성평가 라이브러리는 JSON 객체여야 합니다.".to_string())?;
    if !map.contains_key("schemaVersion") {
        map.insert("schemaVersion".to_string(), json!(SCHEMA_VERSION));
    }
    let entries = map
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "위험성평가 라이브러리에 entries 배열이 필요합니다.".to_string())?;
    if entries.len() > RISK_LIB_MAX_ENTRIES {
        return Err(format!(
            "위험성평가 라이브러리는 최대 {}건까지 저장할 수 있습니다.",
            RISK_LIB_MAX_ENTRIES
        ));
    }

    for entry in entries {
        let obj = entry
            .as_object()
            .ok_or_else(|| "각 위험성평가 항목은 JSON 객체여야 합니다.".to_string())?;
        check_str_field(obj, "id", 64, true)?;
        check_str_field(obj, "category", 30, true)?;
        check_str_field(obj, "item", 60, true)?;
        check_str_field(obj, "hazard", 200, true)?;
        check_str_field(obj, "type", 30, false)?;
        check_str_field(obj, "level", 10, true)?;
        check_str_field(obj, "measure", 300, true)?;
    }

    let serialized = serde_json::to_string_pretty(&library)
        .map_err(|e| format!("JSON 직렬화 실패: {}", e))?;
    if serialized.len() > RISK_LIB_MAX_BYTES {
        return Err("위험성평가 라이브러리 파일 크기가 5MB를 초과했습니다.".to_string());
    }
    atomic_write_bytes(&data_dir.join("risk_library.json"), serialized.as_bytes())
}

pub fn load_day(data_dir: &Path, date: &str) -> Result<Value, String> {
    let dir = day_dir(data_dir, date)?;
    let path = dir.join("data.json");
    read_json_object_or_default(
        &path,
        json!({
            "schemaVersion": SCHEMA_VERSION,
            "date": date
        }),
    )
}

pub fn save_day(data_dir: &Path, date: &str, mut data: Value) -> Result<(), String> {
    let dir = day_dir(data_dir, date)?;
    let map = data
        .as_object_mut()
        .ok_or_else(|| "일자 데이터는 JSON 객체여야 합니다.".to_string())?;
    if !map.contains_key("schemaVersion") {
        map.insert("schemaVersion".to_string(), json!(SCHEMA_VERSION));
    }
    map.insert("date".to_string(), json!(date));
    atomic_write_json(&dir.join("data.json"), &data)
}

fn count_slot_photos(photos_path: &Path) -> usize {
    if !photos_path.is_dir() {
        return 0;
    }
    let mut count = 0;
    for idx in 1..=6u8 {
        let exists = ALLOWED_EXTS
            .iter()
            .any(|ext| photos_path.join(format!("{:02}.{}", idx, ext)).is_file());
        if exists {
            count += 1;
        }
    }
    count
}

pub fn list_days(data_dir: &Path) -> Result<Vec<DaySummary>, String> {
    let days_root = data_dir.join("days");
    if !days_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    let years = fs::read_dir(&days_root)
        .map_err(|e| format!("days 폴더 읽기 실패: {}", e))?;

    for year_entry in years.flatten() {
        let year_path = year_entry.path();
        if !year_path.is_dir() {
            continue;
        }
        let Ok(months) = fs::read_dir(&year_path) else {
            continue;
        };
        for month_entry in months.flatten() {
            let month_path = month_entry.path();
            if !month_path.is_dir() {
                continue;
            }
            let Ok(days) = fs::read_dir(&month_path) else {
                continue;
            };
            for day_entry in days.flatten() {
                let day_path = day_entry.path();
                if !day_path.is_dir() {
                    continue;
                }
                let Some(date_str) = day_path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if validate_date(date_str).is_err() {
                    continue;
                }
                let has_data = day_path.join("data.json").is_file();
                let has_pdf = day_path
                    .join(format!("일일서류_{}.pdf", date_str))
                    .is_file();
                let photo_count = count_slot_photos(&day_path.join("photos"));
                if has_data || has_pdf || photo_count > 0 {
                    result.push(DaySummary {
                        date: date_str.to_string(),
                        has_pdf,
                        photo_count,
                    });
                }
            }
        }
    }

    result.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(result)
}

fn decode_base64_payload(bytes_b64: &str) -> Result<Vec<u8>, String> {
    let trimmed = bytes_b64.trim();
    let payload = if let Some(pos) = trimmed.find(";base64,") {
        if trimmed.starts_with("data:") {
            &trimmed[pos + 8..]
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    STANDARD
        .decode(payload)
        .map_err(|e| format!("Base64 디코딩 실패: {}", e))
}

pub fn save_photo(
    data_dir: &Path,
    date: &str,
    idx: u8,
    bytes_b64: &str,
    ext: &str,
) -> Result<String, String> {
    validate_date(date)?;
    validate_idx(idx)?;
    let clean_ext = validate_ext(ext)?;
    let bytes = decode_base64_payload(bytes_b64)?;
    if bytes.is_empty() {
        return Err("빈 사진 파일은 저장할 수 없습니다.".to_string());
    }
    if bytes.len() > MAX_PHOTO_BYTES {
        return Err("사진 크기는 20MB를 초과할 수 없습니다.".to_string());
    }

    let p_dir = photos_dir(data_dir, date)?;
    fs::create_dir_all(&p_dir)
        .map_err(|e| format!("사진 폴더 생성 실패 ({}): {}", p_dir.display(), e))?;

    let filename = format!("{:02}.{}", idx, clean_ext);
    let target = p_dir.join(&filename);

    // 같은 슬롯의 다른 확장자 기존 파일 제거
    for old_ext in ALLOWED_EXTS {
        if old_ext != clean_ext {
            let old_path = p_dir.join(format!("{:02}.{}", idx, old_ext));
            if old_path.is_file() {
                let _ = fs::remove_file(&old_path);
            }
        }
    }

    atomic_write_bytes(&target, &bytes)?;
    Ok(filename)
}

pub fn read_photo(data_dir: &Path, date: &str, idx: u8) -> Result<Option<PhotoData>, String> {
    validate_date(date)?;
    validate_idx(idx)?;
    let p_dir = photos_dir(data_dir, date)?;
    if !p_dir.is_dir() {
        return Ok(None);
    }

    for ext in ALLOWED_EXTS {
        let filename = format!("{:02}.{}", idx, ext);
        let path = p_dir.join(&filename);
        if path.is_file() {
            let bytes = fs::read(&path)
                .map_err(|e| format!("사진 읽기 실패 ({}): {}", path.display(), e))?;
            return Ok(Some(PhotoData {
                filename,
                ext: ext.to_string(),
                base64: STANDARD.encode(&bytes),
            }));
        }
    }
    Ok(None)
}

pub fn delete_photo(data_dir: &Path, date: &str, idx: u8) -> Result<bool, String> {
    validate_date(date)?;
    validate_idx(idx)?;
    let p_dir = photos_dir(data_dir, date)?;
    if !p_dir.is_dir() {
        return Ok(false);
    }

    let mut deleted = false;
    for ext in ALLOWED_EXTS {
        let path = p_dir.join(format!("{:02}.{}", idx, ext));
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("사진 삭제 실패 ({}): {}", path.display(), e))?;
            deleted = true;
        }
    }
    Ok(deleted)
}

fn query_reg_msedge(key: &str) -> Option<PathBuf> {
    let out = Command::new("reg")
        .args(["query", key, "/ve"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(pos) = line.find("REG_SZ") {
            let val = line[pos + 6..].trim().trim_matches('"');
            let p = PathBuf::from(val);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub fn find_msedge() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("Microsoft")
                .join("Edge")
                .join("Application")
                .join("msedge.exe"),
        );
    }
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }
    query_reg_msedge(r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe")
        .or_else(|| {
            query_reg_msedge(r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe")
        })
}

pub fn export_pdf(data_dir: &Path, date: &str, html: &str) -> Result<String, String> {
    validate_date(date)?;
    let msedge = find_msedge()
        .ok_or_else(|| "Microsoft Edge를 찾을 수 없습니다. 시스템 인쇄를 이용해 주세요.".to_string())?;

    let d_dir = day_dir(data_dir, date)?;
    fs::create_dir_all(&d_dir)
        .map_err(|e| format!("일자 폴더 생성 실패 ({}): {}", d_dir.display(), e))?;

    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let tmp_html = d_dir.join(format!(".tmp_print_{}_{}.html", nanos, seq));
    let tmp_pdf = d_dir.join(format!(".tmp_out_{}_{}.pdf", nanos, seq));
    let tmp_profile = std::env::temp_dir().join(format!("dayrep_edge_{}_{}", nanos, seq));
    let target_pdf = d_dir.join(format!("일일서류_{}.pdf", date));

    atomic_write_bytes(&tmp_html, html.as_bytes())?;

    let html_url = format!(
        "file:///{}",
        tmp_html.to_string_lossy().replace('\\', "/")
    );
    let mut child = Command::new(&msedge)
        .arg("--headless")
        .arg("--disable-gpu")
        .arg(format!("--user-data-dir={}", tmp_profile.display()))
        .arg("--no-pdf-header-footer")
        .arg(format!("--print-to-pdf={}", tmp_pdf.display()))
        .arg(&html_url)
        .spawn()
        .map_err(|e| {
            let _ = fs::remove_file(&tmp_html);
            format!("Edge 실행 실패: {}", e)
        })?;

    let start = Instant::now();
    let timeout = Duration::from_secs(30);
    let wait_res = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("PDF 생성 시간이 30초를 초과했습니다.".to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => break Err(format!("Edge 상태 확인 실패: {}", e)),
        }
    };

    let _ = fs::remove_file(&tmp_html);
    let _ = fs::remove_dir_all(&tmp_profile);

    let status = wait_res?;
    if !status.success() || !tmp_pdf.is_file() {
        let _ = fs::remove_file(&tmp_pdf);
        return Err(format!("Edge PDF 출력 실패 (종료 코드: {:?})", status.code()));
    }
    let meta = fs::metadata(&tmp_pdf).map_err(|e| format!("PDF 메타 확인 실패: {}", e))?;
    if meta.len() == 0 {
        let _ = fs::remove_file(&tmp_pdf);
        return Err("생성된 PDF 파일이 비어 있습니다.".to_string());
    }

    fs::rename(&tmp_pdf, &target_pdf).map_err(|e| {
        let _ = fs::remove_file(&tmp_pdf);
        format!("PDF 저장 교체 실패: {}", e)
    })?;

    Ok(target_pdf.to_string_lossy().to_string())
}

pub fn pdf_file_path(data_dir: &Path, date: &str) -> Result<PathBuf, String> {
    let d_dir = day_dir(data_dir, date)?;
    Ok(d_dir.join(format!("일일서류_{}.pdf", date)))
}

pub fn backup_day_to_dir(
    data_dir: &Path,
    date: &str,
    backup_root: &Path,
) -> Result<String, String> {
    validate_date(date)?;
    if backup_root.as_os_str().is_empty() {
        return Err("백업 폴더 경로가 비어 있습니다.".to_string());
    }
    let src_dir = day_dir(data_dir, date)?;
    if !src_dir.is_dir() {
        return Err(format!("백업할 일자 폴더가 없습니다: {}", date));
    }

    let year = &date[0..4];
    let month = &date[5..7];
    let dst_dir = backup_root.join(year).join(month).join(date);
    fs::create_dir_all(&dst_dir)
        .map_err(|e| format!("백업 대상 폴더 생성 실패 ({}): {}", dst_dir.display(), e))?;

    let mut copied = 0usize;
    let data_json = src_dir.join("data.json");
    if data_json.is_file() {
        fs::copy(&data_json, dst_dir.join("data.json"))
            .map_err(|e| format!("data.json 백업 실패: {}", e))?;
        copied += 1;
    }

    let pdf_name = format!("일일서류_{}.pdf", date);
    let pdf_src = src_dir.join(&pdf_name);
    if pdf_src.is_file() {
        fs::copy(&pdf_src, dst_dir.join(&pdf_name))
            .map_err(|e| format!("PDF 백업 실패: {}", e))?;
        copied += 1;
    }

    let photos_src = src_dir.join("photos");
    if photos_src.is_dir() {
        let photos_dst = dst_dir.join("photos");
        fs::create_dir_all(&photos_dst)
            .map_err(|e| format!("백업 사진 폴더 생성 실패: {}", e))?;
        if let Ok(entries) = fs::read_dir(&photos_src) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(fname) = p.file_name() {
                        fs::copy(&p, photos_dst.join(fname))
                            .map_err(|e| format!("사진 백업 실패: {}", e))?;
                        copied += 1;
                    }
                }
            }
        }
    }

    if copied == 0 {
        return Err("백업할 파일(data.json/PDF/사진)이 없습니다.".to_string());
    }

    Ok(dst_dir.to_string_lossy().to_string())
}

fn collect_json_strings(val: &Value, out: &mut Vec<String>) {
    match val {
        Value::String(s) => {
            if !s.trim().is_empty() {
                out.push(s.clone());
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect_json_strings(item, out);
            }
        }
        Value::Object(map) => {
            for (_, v) in map {
                collect_json_strings(v, out);
            }
        }
        _ => {}
    }
}

pub fn search_days(data_dir: &Path, keyword: &str) -> Result<Vec<SearchDayResult>, String> {
    let days = list_days(data_dir)?;
    let kw = keyword.trim().to_lowercase();
    let mut results = Vec::new();

    for d in days {
        if results.len() >= 200 {
            break;
        }
        if kw.is_empty() {
            results.push(SearchDayResult {
                date: d.date,
                has_pdf: d.has_pdf,
                photo_count: d.photo_count,
                snippet: String::new(),
            });
            continue;
        }

        let mut matched_snippet: Option<String> = None;
        if d.date.to_lowercase().contains(&kw) {
            matched_snippet = Some(d.date.clone());
        } else if let Ok(day_path) = day_dir(data_dir, &d.date) {
            let json_path = day_path.join("data.json");
            if json_path.is_file() {
                if let Ok(raw) = fs::read_to_string(&json_path) {
                    if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                        let mut strings = Vec::new();
                        collect_json_strings(&val, &mut strings);
                        for s in strings {
                            if s.to_lowercase().contains(&kw) {
                                let preview: String = s.chars().take(60).collect();
                                matched_snippet = Some(preview);
                                break;
                            }
                        }
                    }
                }
            }
        }

        if let Some(snippet) = matched_snippet {
            results.push(SearchDayResult {
                date: d.date,
                has_pdf: d.has_pdf,
                photo_count: d.photo_count,
                snippet,
            });
        }
    }

    Ok(results)
}

const ALLOWED_AI_ENGINES: [&str; 7] = [
    "hermes",
    "opencode",
    "deepseek",
    "gemini",
    "openrouter",
    "ollama",
    "lmstudio",
];

pub fn validate_ai_engine(engine: &str) -> Result<String, String> {
    let clean = engine.trim().to_ascii_lowercase();
    if ALLOWED_AI_ENGINES.contains(&clean.as_str()) {
        Ok(clean)
    } else {
        Err(format!("지원하지 않는 AI 엔진입니다: {}", engine))
    }
}

pub fn mask_secret(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 6 {
        return "*".repeat(chars.len());
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 2..].iter().collect();
    format!("{}…{}", head, tail)
}

pub fn redact_secrets(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets {
        let trimmed = s.trim();
        if trimmed.len() >= 4 {
            out = out.replace(trimmed, "***");
        }
    }
    out
}

pub fn load_secrets_raw(data_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let path = data_dir.join("secrets.json");
    if !path.is_file() {
        return Ok(BTreeMap::new());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("secrets.json 읽기 실패: {}", e))?;
    match serde_json::from_str::<BTreeMap<String, String>>(&raw) {
        Ok(map) => Ok(map),
        Err(_) => {
            backup_corrupt_file(&path)?;
            Ok(BTreeMap::new())
        }
    }
}

pub fn load_secrets_masked(data_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let raw_map = load_secrets_raw(data_dir)?;
    let mut masked = BTreeMap::new();
    for (k, v) in raw_map {
        if !v.trim().is_empty() {
            masked.insert(k, mask_secret(&v));
        }
    }
    Ok(masked)
}

pub fn save_secret(data_dir: &Path, engine: &str, api_key: &str) -> Result<String, String> {
    let clean_engine = validate_ai_engine(engine)?;
    let mut map = load_secrets_raw(data_dir)?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        map.remove(&clean_engine);
    } else {
        map.insert(clean_engine, trimmed.to_string());
    }
    let val = serde_json::to_value(&map).map_err(|e| format!("secrets 직렬화 실패: {}", e))?;
    atomic_write_json(&data_dir.join("secrets.json"), &val)?;
    Ok(mask_secret(trimmed))
}

pub fn delete_secret(data_dir: &Path, engine: &str) -> Result<bool, String> {
    let clean_engine = validate_ai_engine(engine)?;
    let mut map = load_secrets_raw(data_dir)?;
    let removed = map.remove(&clean_engine).is_some();
    if removed {
        let val = serde_json::to_value(&map).map_err(|e| format!("secrets 직렬화 실패: {}", e))?;
        atomic_write_json(&data_dir.join("secrets.json"), &val)?;
    }
    Ok(removed)
}

/// 도장 슬롯 이름 검증 (영소문자/숫자/_/- 만 허용, 경로 이탈 방지)
pub fn validate_stamp_slot(slot: &str) -> Result<String, String> {
    let clean = slot.trim().to_ascii_lowercase();
    if clean.is_empty()
        || clean.len() > 32
        || !clean
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
    {
        return Err(format!("잘못된 도장 슬롯 이름입니다: {}", slot));
    }
    Ok(clean)
}

pub fn save_stamp(
    data_dir: &Path,
    slot: &str,
    bytes_b64: &str,
    ext: &str,
) -> Result<String, String> {
    let clean_slot = validate_stamp_slot(slot)?;
    let clean_ext = validate_ext(ext)?;
    let bytes = decode_base64_payload(bytes_b64)?;
    if bytes.is_empty() {
        return Err("빈 도장 파일은 저장할 수 없습니다.".to_string());
    }
    if bytes.len() > MAX_PHOTO_BYTES {
        return Err("도장 파일 크기는 20MB를 초과할 수 없습니다.".to_string());
    }

    let stamps_dir = data_dir.join("stamps");
    fs::create_dir_all(&stamps_dir)
        .map_err(|e| format!("도장 폴더 생성 실패 ({}): {}", stamps_dir.display(), e))?;

    let filename = format!("{}.{}", clean_slot, clean_ext);
    let target = stamps_dir.join(&filename);

    for old_ext in ALLOWED_EXTS {
        if old_ext != clean_ext {
            let old_path = stamps_dir.join(format!("{}.{}", clean_slot, old_ext));
            if old_path.is_file() {
                let _ = fs::remove_file(&old_path);
            }
        }
    }

    atomic_write_bytes(&target, &bytes)?;
    Ok(filename)
}

pub fn read_stamp(data_dir: &Path, slot: &str) -> Result<Option<PhotoData>, String> {
    let clean_slot = validate_stamp_slot(slot)?;
    let stamps_dir = data_dir.join("stamps");
    if !stamps_dir.is_dir() {
        return Ok(None);
    }

    for ext in ALLOWED_EXTS {
        let filename = format!("{}.{}", clean_slot, ext);
        let path = stamps_dir.join(&filename);
        if path.is_file() {
            let bytes = fs::read(&path)
                .map_err(|e| format!("도장 읽기 실패 ({}): {}", path.display(), e))?;
            return Ok(Some(PhotoData {
                filename,
                ext: ext.to_string(),
                base64: STANDARD.encode(&bytes),
            }));
        }
    }
    Ok(None)
}

pub fn delete_stamp(data_dir: &Path, slot: &str) -> Result<bool, String> {
    let clean_slot = validate_stamp_slot(slot)?;
    let stamps_dir = data_dir.join("stamps");
    if !stamps_dir.is_dir() {
        return Ok(false);
    }

    let mut deleted = false;
    for ext in ALLOWED_EXTS {
        let path = stamps_dir.join(format!("{}.{}", clean_slot, ext));
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("도장 삭제 실패 ({}): {}", path.display(), e))?;
            deleted = true;
        }
    }
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("dayrep_test_{}_{}_{}", label, nanos, seq));
            fs::create_dir_all(&path).expect("create temp test dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_validate_date_valid_and_invalid() {
        assert!(validate_date("2026-11-18").is_ok());
        assert!(validate_date("2024-02-29").is_ok());

        assert!(validate_date("2026-02-29").is_err());
        assert!(validate_date("2026-13-01").is_err());
        assert!(validate_date("2026/11/18").is_err());
        assert!(validate_date("2026-1-1").is_err());
        assert!(validate_date("../2026-11-18").is_err());
        assert!(validate_date("abcd-ef-gh").is_err());
    }

    #[test]
    fn test_settings_roundtrip_and_corrupt_recovery() {
        let tmp = TempDir::new("settings");
        let initial = load_settings(&tmp.path).unwrap();
        assert_eq!(initial["schemaVersion"], json!(1));

        save_settings(&tmp.path, json!({ "siteName": "수택1동 현장" })).unwrap();
        let loaded = load_settings(&tmp.path).unwrap();
        assert_eq!(loaded["siteName"], json!("수택1동 현장"));
        assert_eq!(loaded["schemaVersion"], json!(1));

        // 손상된 JSON 쓰기 → .corrupt 백업 후 기본값 복구
        fs::write(tmp.path.join("settings.json"), "{ invalid json").unwrap();
        let recovered = load_settings(&tmp.path).unwrap();
        assert_eq!(recovered, json!({ "schemaVersion": 1 }));
        assert!(tmp.path.join("settings.json.corrupt").is_file());
    }

    #[test]
    fn test_day_roundtrip_corrupt_and_list_days() {
        let tmp = TempDir::new("days");

        let day_val = json!({
            "siteName": "테스트 현장",
            "weather": "맑음"
        });
        save_day(&tmp.path, "2026-11-18", day_val).unwrap();
        let loaded = load_day(&tmp.path, "2026-11-18").unwrap();
        assert_eq!(loaded["schemaVersion"], json!(1));
        assert_eq!(loaded["date"], json!("2026-11-18"));
        assert_eq!(loaded["weather"], json!("맑음"));

        // 잘못된 날짜 거부
        assert!(load_day(&tmp.path, "2026-02-30").is_err());
        assert!(save_day(&tmp.path, "../evil", json!({})).is_err());

        // PDF 더미 파일 및 사진 추가 후 list_days 검증
        let d_dir = day_dir(&tmp.path, "2026-11-18").unwrap();
        fs::write(d_dir.join("일일서류_2026-11-18.pdf"), b"%PDF-1.4").unwrap();
        let b64 = STANDARD.encode(b"fake-png-bytes");
        save_photo(&tmp.path, "2026-11-18", 1, &b64, "PNG").unwrap();

        save_day(&tmp.path, "2026-11-17", json!({ "weather": "흐림" })).unwrap();
        let list = list_days(&tmp.path).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].date, "2026-11-18");
        assert!(list[0].has_pdf);
        assert_eq!(list[0].photo_count, 1);
        assert_eq!(list[1].date, "2026-11-17");
        assert!(!list[1].has_pdf);
        assert_eq!(list[1].photo_count, 0);

        // 손상된 data.json 처리
        fs::write(d_dir.join("data.json"), "").unwrap();
        let recovered = load_day(&tmp.path, "2026-11-18").unwrap();
        assert_eq!(recovered["schemaVersion"], json!(1));
        assert_eq!(recovered["date"], json!("2026-11-18"));
        assert!(d_dir.join("data.json.corrupt").is_file());
    }

    #[test]
    fn test_photo_crud_and_validation() {
        let tmp = TempDir::new("photos");
        let payload = STANDARD.encode(b"hello-image-data");

        // 잘못된 idx / ext / date 거부
        assert!(save_photo(&tmp.path, "2026-11-18", 0, &payload, "jpg").is_err());
        assert!(save_photo(&tmp.path, "2026-11-18", 7, &payload, "jpg").is_err());
        assert!(save_photo(&tmp.path, "2026-11-18", 1, &payload, "exe").is_err());
        assert!(save_photo(&tmp.path, "2026-11-18", 1, &payload, "../png").is_err());
        assert!(save_photo(&tmp.path, "bad-date", 1, &payload, "jpg").is_err());

        // 저장 및 읽기
        let fname = save_photo(&tmp.path, "2026-11-18", 2, &payload, ".JPEG").unwrap();
        assert_eq!(fname, "02.jpeg");
        let read_back = read_photo(&tmp.path, "2026-11-18", 2).unwrap().unwrap();
        assert_eq!(read_back.filename, "02.jpeg");
        assert_eq!(read_back.ext, "jpeg");
        assert_eq!(read_back.base64, payload);

        // 같은 슬롯에 다른 확장자로 덮어쓰면 기존 파일 제거
        let fname2 = save_photo(&tmp.path, "2026-11-18", 2, &payload, "webp").unwrap();
        assert_eq!(fname2, "02.webp");
        let p_dir = photos_dir(&tmp.path, "2026-11-18").unwrap();
        assert!(!p_dir.join("02.jpeg").exists());
        assert!(p_dir.join("02.webp").is_file());

        // 삭제
        assert!(delete_photo(&tmp.path, "2026-11-18", 2).unwrap());
        assert!(!delete_photo(&tmp.path, "2026-11-18", 2).unwrap());
        assert!(read_photo(&tmp.path, "2026-11-18", 2).unwrap().is_none());
    }

    #[test]
    fn test_resolve_data_dir_fallback_on_missing_path() {
        let cfg_tmp = TempDir::new("cfg");
        let valid_tmp = TempDir::new("valid_data");

        save_configured_data_dir(&cfg_tmp.path, &valid_tmp.path).unwrap();
        let resolved = resolve_data_dir(&cfg_tmp.path).unwrap();
        assert_eq!(resolved, valid_tmp.path);

        // 존재하지 않는 경로 기록 시 기본값으로 복귀
        atomic_write_json(
            &cfg_tmp.path.join("app_config.json"),
            &json!({ "dataDir": "Z:\\definitely_missing_dayrep_dir_12345" }),
        )
        .unwrap();
        let fallback = resolve_data_dir(&cfg_tmp.path).unwrap();
        assert_eq!(fallback, default_data_dir());
    }

    #[test]
    fn test_stamp_crud_and_validation() {
        let tmp = TempDir::new("stamps");
        let payload = STANDARD.encode(b"fake-stamp-png");

        assert!(save_stamp(&tmp.path, "../evil", &payload, "png").is_err());
        assert!(save_stamp(&tmp.path, "", &payload, "png").is_err());
        assert!(save_stamp(&tmp.path, "director", &payload, "svg").is_err());

        let fname = save_stamp(&tmp.path, "director", &payload, "PNG").unwrap();
        assert_eq!(fname, "director.png");

        let read_back = read_stamp(&tmp.path, "director").unwrap().unwrap();
        assert_eq!(read_back.filename, "director.png");
        assert_eq!(read_back.ext, "png");
        assert_eq!(read_back.base64, payload);

        let fname2 = save_stamp(&tmp.path, "director", &payload, "webp").unwrap();
        assert_eq!(fname2, "director.webp");
        assert!(!tmp.path.join("stamps").join("director.png").exists());
        assert!(tmp.path.join("stamps").join("director.webp").is_file());

        assert!(delete_stamp(&tmp.path, "director").unwrap());
        assert!(!delete_stamp(&tmp.path, "director").unwrap());
        assert!(read_stamp(&tmp.path, "director").unwrap().is_none());
    }

    #[test]
    fn test_search_days_and_backup_copy() {
        let data_tmp = TempDir::new("search_data");
        let backup_tmp = TempDir::new("backup_target");

        save_day(
            &data_tmp.path,
            "2026-11-17",
            json!({
                "eduLog": { "contents": "1. 추락 방지 교육", "workType": "철근작업" },
                "patrol": { "notes": "안전난간 점검 완료" },
                "tbmLog": { "workSection": "A구역 기초" }
            }),
        )
        .unwrap();
        save_day(
            &data_tmp.path,
            "2026-11-18",
            json!({
                "eduLog": { "contents": "1. 굴착기 유도자 배치", "workType": "토공사" },
                "patrol": { "notes": "특이사항 없음" },
                "tbmLog": { "workSection": "B구역" }
            }),
        )
        .unwrap();

        let d17 = day_dir(&data_tmp.path, "2026-11-17").unwrap();
        fs::write(d17.join("일일서류_2026-11-17.pdf"), b"%PDF-1.4").unwrap();
        let b64 = STANDARD.encode(b"img-bytes");
        save_photo(&data_tmp.path, "2026-11-17", 1, &b64, "png").unwrap();

        // 날짜·키워드 검색 검증
        let res_all = search_days(&data_tmp.path, "").unwrap();
        assert_eq!(res_all.len(), 2);

        let res_kw = search_days(&data_tmp.path, "안전난간").unwrap();
        assert_eq!(res_kw.len(), 1);
        assert_eq!(res_kw[0].date, "2026-11-17");

        let res_date = search_days(&data_tmp.path, "11-18").unwrap();
        assert_eq!(res_date.len(), 1);
        assert_eq!(res_date[0].date, "2026-11-18");

        // 백업 복사 검증 (YYYY/MM/YYYY-MM-DD/ 아래 data.json + PDF + photos)
        backup_day_to_dir(&data_tmp.path, "2026-11-17", &backup_tmp.path).unwrap();
        let dst = backup_tmp.path.join("2026").join("11").join("2026-11-17");
        assert!(dst.join("data.json").is_file());
        assert!(dst.join("일일서류_2026-11-17.pdf").is_file());
        assert!(dst.join("photos").join("01.png").is_file());

        // 잘못된 날짜 거부
        assert!(export_pdf(&data_tmp.path, "../bad", "<html></html>").is_err());
        assert!(backup_day_to_dir(&data_tmp.path, "bad-date", &backup_tmp.path).is_err());
    }

    #[test]
    fn test_secrets_masking_and_crud() {
        let tmp = TempDir::new("secrets");
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("12345"), "*****");
        assert_eq!(mask_secret("sk-or-v1-abcdef99"), "sk-o…99");

        // 저장 시 마스킹 반환, load_secrets_masked 도 평문 미반환
        let m = save_secret(&tmp.path, "openrouter", "sk-secret-key-12345").unwrap();
        assert_eq!(m, "sk-s…45");
        assert!(!m.contains("secret-key"));

        let masked_map = load_secrets_masked(&tmp.path).unwrap();
        assert_eq!(masked_map.get("openrouter").unwrap(), "sk-s…45");

        let raw_map = load_secrets_raw(&tmp.path).unwrap();
        assert_eq!(raw_map.get("openrouter").unwrap(), "sk-secret-key-12345");

        // redact_secrets 확인
        let redacted = redact_secrets("error with sk-secret-key-12345 inside", &["sk-secret-key-12345"]);
        assert!(!redacted.contains("sk-secret-key-12345"));
        assert!(redacted.contains("***"));

        // 삭제 및 잘못된 엔진 거부
        assert!(save_secret(&tmp.path, "../evil", "abc").is_err());
        assert!(delete_secret(&tmp.path, "openrouter").unwrap());
        assert!(!delete_secret(&tmp.path, "openrouter").unwrap());
    }

    #[test]
    fn test_risk_library_roundtrip_corrupt_and_validation() {
        let tmp = TempDir::new("risklib");

        // 1. 파일 없음 -> 빈 라이브러리
        let empty = load_risk_library(&tmp.path).unwrap();
        assert_eq!(empty["schemaVersion"], 1);
        assert_eq!(empty["entries"].as_array().unwrap().len(), 0);

        // 2. 정상 라운드트립
        let valid = json!({
            "schemaVersion": 1,
            "entries": [{
                "id": "rl_1",
                "category": "철근공사",
                "item": "크레인",
                "hazard": "인양물 낙하",
                "type": "낙하",
                "level": "상",
                "measure": "하부 출입통제",
                "source": "ai",
                "useCount": 2,
                "createdAt": "2026-11-18T00:00:00Z",
                "lastUsedAt": "2026-11-18T00:00:00Z"
            }]
        });
        save_risk_library(&tmp.path, valid).unwrap();
        let loaded = load_risk_library(&tmp.path).unwrap();
        assert_eq!(loaded["entries"].as_array().unwrap().len(), 1);
        assert_eq!(loaded["entries"][0]["item"], "크레인");

        // 3. 손상 파일 -> .corrupt 백업 후 빈 라이브러리
        fs::write(tmp.path.join("risk_library.json"), "{not-valid-json").unwrap();
        let recovered = load_risk_library(&tmp.path).unwrap();
        assert_eq!(recovered["entries"].as_array().unwrap().len(), 0);
        assert!(tmp.path.join("risk_library.json.corrupt").is_file());

        // 4. 검증 실패 (구조 오류, 필드 길이 초과, 5000건 초과)
        assert!(save_risk_library(&tmp.path, json!({ "entries": "not-array" })).is_err());
        assert!(save_risk_library(&tmp.path, json!({
            "entries": [{
                "id": "rl_2",
                "category": "일반",
                "item": "A".repeat(61),
                "hazard": "위험",
                "type": "",
                "level": "중",
                "measure": "대책"
            }]
        })).is_err());
        let too_many: Vec<Value> = (0..5001)
            .map(|i| json!({
                "id": format!("id_{}", i),
                "category": "일반",
                "item": "도구",
                "hazard": "위험",
                "type": "",
                "level": "중",
                "measure": "대책"
            }))
            .collect();
        assert!(save_risk_library(&tmp.path, json!({ "entries": too_many })).is_err());
    }
}
