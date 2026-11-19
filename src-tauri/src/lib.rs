mod ai;
mod storage;

use ai::{AiOptions, AiResponse};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use storage::{DaySummary, PhotoData, SearchDayResult};
use tauri::Manager;

fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("앱 설정 폴더 경로 조회 실패: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("앱 설정 폴더 생성 실패 ({}): {}", dir.display(), e))?;
    Ok(dir)
}

fn current_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cfg_dir = app_config_dir(app)?;
    storage::resolve_data_dir(&cfg_dir)
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = current_data_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let cfg_dir = app_config_dir(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("일일서류 데이터 폴더 선택")
            .pick_folder()
    })
    .await
    .map_err(|e| format!("폴더 선택 대화상자 오류: {}", e))?;

    match picked {
        Some(folder) => {
            let saved = storage::save_configured_data_dir(&cfg_dir, &folder)?;
            Ok(Some(saved))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Value, String> {
    let data_dir = current_data_dir(&app)?;
    storage::load_settings(&data_dir)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_settings(&data_dir, settings)
}

#[tauri::command]
fn load_risk_library(app: tauri::AppHandle) -> Result<Value, String> {
    let data_dir = current_data_dir(&app)?;
    storage::load_risk_library(&data_dir)
}

#[tauri::command]
fn save_risk_library(app: tauri::AppHandle, library: Value) -> Result<(), String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_risk_library(&data_dir, library)
}

#[tauri::command]
fn load_day(app: tauri::AppHandle, date: String) -> Result<Value, String> {
    let data_dir = current_data_dir(&app)?;
    storage::load_day(&data_dir, &date)
}

#[tauri::command]
fn save_day(app: tauri::AppHandle, date: String, json: Value) -> Result<(), String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_day(&data_dir, &date, json)
}

#[tauri::command]
fn list_days(app: tauri::AppHandle) -> Result<Vec<DaySummary>, String> {
    let data_dir = current_data_dir(&app)?;
    storage::list_days(&data_dir)
}

#[tauri::command]
fn save_photo(
    app: tauri::AppHandle,
    date: String,
    idx: u8,
    bytes_b64: String,
    ext: String,
) -> Result<String, String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_photo(&data_dir, &date, idx, &bytes_b64, &ext)
}

#[tauri::command]
fn read_photo(app: tauri::AppHandle, date: String, idx: u8) -> Result<Option<PhotoData>, String> {
    let data_dir = current_data_dir(&app)?;
    storage::read_photo(&data_dir, &date, idx)
}

#[tauri::command]
fn delete_photo(app: tauri::AppHandle, date: String, idx: u8) -> Result<bool, String> {
    let data_dir = current_data_dir(&app)?;
    storage::delete_photo(&data_dir, &date, idx)
}

#[tauri::command]
fn save_stamp(
    app: tauri::AppHandle,
    slot: String,
    bytes_b64: String,
    ext: String,
) -> Result<String, String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_stamp(&data_dir, &slot, &bytes_b64, &ext)
}

#[tauri::command]
fn read_stamp(app: tauri::AppHandle, slot: String) -> Result<Option<PhotoData>, String> {
    let data_dir = current_data_dir(&app)?;
    storage::read_stamp(&data_dir, &slot)
}

#[tauri::command]
fn delete_stamp(app: tauri::AppHandle, slot: String) -> Result<bool, String> {
    let data_dir = current_data_dir(&app)?;
    storage::delete_stamp(&data_dir, &slot)
}

#[tauri::command]
async fn export_pdf(app: tauri::AppHandle, date: String, html: String) -> Result<String, String> {
    let data_dir = current_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::export_pdf(&data_dir, &date, &html))
        .await
        .map_err(|e| format!("PDF 생성 태스크 오류: {}", e))?
}

#[tauri::command]
fn open_pdf(app: tauri::AppHandle, date: String) -> Result<(), String> {
    let data_dir = current_data_dir(&app)?;
    let path = storage::pdf_file_path(&data_dir, &date)?;
    if !path.is_file() {
        return Err(format!("해당 날짜의 PDF가 아직 없습니다: {}", date));
    }
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("PDF 열기 실패: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn pick_backup_dir() -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("추가 백업 폴더 선택")
            .pick_folder()
    })
    .await
    .map_err(|e| format!("백업 폴더 선택 대화상자 오류: {}", e))?;

    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn backup_day(app: tauri::AppHandle, date: String, backup_dir: String) -> Result<String, String> {
    let data_dir = current_data_dir(&app)?;
    storage::backup_day_to_dir(&data_dir, &date, std::path::Path::new(backup_dir.trim()))
}

#[tauri::command]
fn search_days(app: tauri::AppHandle, keyword: String) -> Result<Vec<SearchDayResult>, String> {
    let data_dir = current_data_dir(&app)?;
    storage::search_days(&data_dir, &keyword)
}

#[tauri::command]
fn load_secrets_masked(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let data_dir = current_data_dir(&app)?;
    storage::load_secrets_masked(&data_dir)
}

#[tauri::command]
fn save_secret(app: tauri::AppHandle, engine: String, api_key: String) -> Result<String, String> {
    let data_dir = current_data_dir(&app)?;
    storage::save_secret(&data_dir, &engine, &api_key)
}

#[tauri::command]
fn delete_secret(app: tauri::AppHandle, engine: String) -> Result<bool, String> {
    let data_dir = current_data_dir(&app)?;
    storage::delete_secret(&data_dir, &engine)
}

#[tauri::command]
async fn ai_generate(
    app: tauri::AppHandle,
    engine: String,
    prompt: String,
    options: AiOptions,
) -> Result<AiResponse, String> {
    let data_dir = current_data_dir(&app)?;
    let secrets = storage::load_secrets_raw(&data_dir)?;
    ai::ai_generate_with_secrets(&engine, &prompt, &options, &secrets).await
}

#[tauri::command]
async fn ai_list_models(
    app: tauri::AppHandle,
    engine: String,
    options: AiOptions,
) -> Result<Vec<String>, String> {
    let data_dir = current_data_dir(&app)?;
    let secrets = storage::load_secrets_raw(&data_dir)?;
    ai::list_models_with_secrets(&engine, &options, &secrets).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            set_data_dir,
            load_settings,
            save_settings,
            load_risk_library,
            save_risk_library,
            load_day,
            save_day,
            list_days,
            save_photo,
            read_photo,
            delete_photo,
            save_stamp,
            read_stamp,
            delete_stamp,
            export_pdf,
            open_pdf,
            pick_backup_dir,
            backup_day,
            search_days,
            load_secrets_masked,
            save_secret,
            delete_secret,
            ai_generate,
            ai_list_models,
        ])
        .run(tauri::generate_context!())
        .expect("일일서류 애플리케이션 실행 중 오류 발생");
}
