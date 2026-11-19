use crate::storage::redact_secrets;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const CLAUDE_CLI_TIMEOUT_SECS: u64 = 120;

pub const DEFAULT_HERMES_ENDPOINT: &str = "http://127.0.0.1:7860/api/generate";
pub const DEFAULT_LMSTUDIO_BASE_URL: &str = "http://localhost:1234/v1";
pub const DEFAULT_OPENCODE_BASE_URL: &str = "https://opencode.ai/zen/v1";
pub const DEFAULT_DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
pub const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
pub const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOptions {
    pub endpoint: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub text: String,
    pub model: String,
}

fn validate_http_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(format!("유효한 HTTP(S) URL이 아닙니다: {}", trimmed));
    }
    Ok(trimmed.to_string())
}

pub fn build_hermes_request(endpoint: Option<&str>, prompt: &str) -> Result<(String, Value), String> {
    let ep = endpoint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_HERMES_ENDPOINT);
    let url = validate_http_url(ep)?;
    Ok((url, json!({ "prompt": prompt })))
}

pub fn build_openai_compat_request(
    base_url: Option<&str>,
    default_base: &str,
    model: Option<&str>,
    default_model: &str,
    prompt: &str,
    temperature: Option<f32>,
    api_key: Option<&str>,
) -> Result<(String, Value, String), String> {
    let base = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default_base);
    let clean_base = validate_http_url(base)?;
    let url = format!("{}/chat/completions", clean_base.trim_end_matches('/'));
    let model_name = model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default_model);
    let temp = temperature.unwrap_or(0.5);
    let body = json!({
        "model": model_name,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "temperature": temp
    });
    let bearer = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("lm-studio")
        .to_string();
    Ok((url, body, bearer))
}

pub fn build_gemini_request(
    base_url: Option<&str>,
    model: Option<&str>,
    prompt: &str,
    temperature: Option<f32>,
) -> Result<(String, Value, String), String> {
    let base = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GEMINI_BASE_URL);
    let clean_base = validate_http_url(base)?;
    let model_name = model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("gemini-2.0-flash");
    let url = format!(
        "{}/models/{}:generateContent",
        clean_base.trim_end_matches('/'),
        model_name
    );
    let temp = temperature.unwrap_or(0.5);
    let body = json!({
        "contents": [
            {
                "parts": [
                    { "text": prompt }
                ]
            }
        ],
        "generationConfig": {
            "temperature": temp
        }
    });
    Ok((url, body, model_name.to_string()))
}

pub fn build_ollama_request(
    endpoint: Option<&str>,
    model: Option<&str>,
    prompt: &str,
) -> Result<(String, Value, String), String> {
    let model_name = model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Ollama 모델명을 입력해 주세요. (예: llama3.1)".to_string())?;
    let base = endpoint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
    let clean_base = validate_http_url(base)?;
    let url = format!("{}/api/generate", clean_base.trim_end_matches('/'));
    let body = json!({
        "model": model_name,
        "prompt": prompt,
        "stream": false
    });
    Ok((url, body, model_name.to_string()))
}

fn require_secret<'a>(secrets: &'a BTreeMap<String, String>, engine: &str, label: &str) -> Result<&'a str, String> {
    secrets
        .get(engine)
        .map(String::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{} API 키가 등록되지 않았습니다. 설정에서 키를 저장해 주세요.", label))
}

fn truncate_redacted(raw: &str, secrets: &[&str]) -> String {
    let redacted = redact_secrets(raw, secrets);
    let chars: Vec<char> = redacted.chars().collect();
    if chars.len() > 300 {
        let s: String = chars[..300].iter().collect();
        format!("{}…", s)
    } else {
        redacted
    }
}

fn map_reqwest_error(server_label: &str, url: &str, err: reqwest::Error, secrets: &[&str]) -> String {
    if err.is_connect() {
        return format!(
            "{} 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요. ({})",
            server_label, url
        );
    }
    if err.is_timeout() {
        return format!("{} 응답 시간이 90초를 초과했습니다.", server_label);
    }
    truncate_redacted(&format!("{} 요청 오류: {}", server_label, err), secrets)
}

async fn call_hermes(
    client: &reqwest::Client,
    options: &AiOptions,
    prompt: &str,
) -> Result<AiResponse, String> {
    let (url, body) = build_hermes_request(options.endpoint.as_deref(), prompt)?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| map_reqwest_error("Hermes", &url, e, &[]))?;

    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| format!("Hermes 응답 읽기 실패: {}", e))?;

    if !status.is_success() {
        if let Ok(v) = serde_json::from_str::<Value>(&raw_text) {
            if let Some(err_msg) = v.get("error").and_then(|x| x.as_str()) {
                return Err(format!(
                    "Hermes 오류 ({}): {}",
                    status.as_u16(),
                    truncate_redacted(err_msg, &[])
                ));
            }
        }
        return Err(format!(
            "Hermes HTTP {}: {}",
            status.as_u16(),
            truncate_redacted(&raw_text, &[])
        ));
    }

    let val: Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Hermes JSON 파싱 실패: {}", e))?;
    if let Some(err_msg) = val.get("error").and_then(|x| x.as_str()) {
        return Err(format!("Hermes 오류: {}", truncate_redacted(err_msg, &[])));
    }
    let text = val
        .get("text")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Hermes 응답에 'text' 필드가 없습니다.".to_string())?;
    let model = val
        .get("model")
        .and_then(|x| x.as_str())
        .unwrap_or("hermes")
        .to_string();
    Ok(AiResponse { text, model })
}

async fn call_openai_compat(
    client: &reqwest::Client,
    label: &str,
    default_base: &str,
    default_model: &str,
    options: &AiOptions,
    prompt: &str,
    api_key: Option<&str>,
    extra_title_header: Option<&str>,
    deepseek_status_messages: bool,
) -> Result<AiResponse, String> {
    let (url, body, bearer) = build_openai_compat_request(
        options.base_url.as_deref(),
        default_base,
        options.model.as_deref(),
        default_model,
        prompt,
        options.temperature,
        api_key,
    )?;
    let secret_refs: Vec<&str> = api_key.into_iter().collect();

    let mut req = client.post(&url).bearer_auth(&bearer).json(&body);
    if let Some(title) = extra_title_header {
        req = req.header("X-Title", title);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| map_reqwest_error(label, &url, e, &secret_refs))?;

    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| truncate_redacted(&format!("{} 응답 읽기 실패: {}", label, e), &secret_refs))?;

    if !status.is_success() {
        let code = status.as_u16();
        let redacted_body = truncate_redacted(&raw_text, &secret_refs);
        if deepseek_status_messages {
            if code == 402 {
                return Err(format!("DeepSeek 잔액이 부족합니다. 계정을 확인해 주세요. (HTTP 402: {})", redacted_body));
            }
            if code == 401 {
                return Err(format!("DeepSeek API 키가 유효하지 않습니다. (HTTP 401: {})", redacted_body));
            }
            if code == 429 {
                return Err(format!("DeepSeek 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요. (HTTP 429: {})", redacted_body));
            }
        }
        return Err(format!("{} HTTP {}: {}", label, code, redacted_body));
    }

    let val: Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("{} JSON 파싱 실패: {}", label, e))?;
    let text = val
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("{} 응답에 'choices[0].message.content'가 없습니다.", label))?;

    let model = val
        .get("model")
        .and_then(|x| x.as_str())
        .or(options.model.as_deref())
        .unwrap_or(default_model)
        .to_string();

    Ok(AiResponse { text, model })
}

async fn call_gemini(
    client: &reqwest::Client,
    options: &AiOptions,
    prompt: &str,
    api_key: &str,
) -> Result<AiResponse, String> {
    let (url, body, model_name) = build_gemini_request(
        options.base_url.as_deref(),
        options.model.as_deref(),
        prompt,
        options.temperature,
    )?;
    let secret_refs = [api_key];

    let resp = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| map_reqwest_error("Gemini", &url, e, &secret_refs))?;

    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| truncate_redacted(&format!("Gemini 응답 읽기 실패: {}", e), &secret_refs))?;

    if !status.is_success() {
        return Err(format!(
            "Gemini HTTP {}: {}",
            status.as_u16(),
            truncate_redacted(&raw_text, &secret_refs)
        ));
    }

    let val: Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Gemini JSON 파싱 실패: {}", e))?;
    let text = val
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("content"))
        .and_then(|cnt| cnt.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p0| p0.get("text"))
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Gemini 응답에 'candidates[0].content.parts[0].text'가 없습니다.".to_string())?;

    Ok(AiResponse {
        text,
        model: model_name,
    })
}

async fn call_ollama(
    client: &reqwest::Client,
    options: &AiOptions,
    prompt: &str,
) -> Result<AiResponse, String> {
    let endpoint = options.base_url.as_deref().or(options.endpoint.as_deref());
    let (url, body, model_name) = build_ollama_request(endpoint, options.model.as_deref(), prompt)?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| map_reqwest_error("Ollama", &url, e, &[]))?;

    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| format!("Ollama 응답 읽기 실패: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Ollama HTTP {}: {}",
            status.as_u16(),
            truncate_redacted(&raw_text, &[])
        ));
    }

    let val: Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Ollama JSON 파싱 실패: {}", e))?;
    let text = val
        .get("response")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Ollama 응답에 'response' 필드가 없습니다.".to_string())?;

    Ok(AiResponse {
        text,
        model: val
            .get("model")
            .and_then(|x| x.as_str())
            .unwrap_or(&model_name)
            .to_string(),
    })
}

pub async fn ai_generate_with_secrets(
    engine: &str,
    prompt: &str,
    options: &AiOptions,
    secrets: &BTreeMap<String, String>,
) -> Result<AiResponse, String> {
    if prompt.trim().is_empty() {
        return Err("프롬프트가 비어 있습니다.".to_string());
    }
    let clean_engine = engine.trim().to_ascii_lowercase();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {}", e))?;

    match clean_engine.as_str() {
        "hermes" => call_hermes(&client, options, prompt).await,
        "lmstudio" => {
            let key = secrets.get("lmstudio").map(String::as_str);
            call_openai_compat(
                &client,
                "LM Studio",
                DEFAULT_LMSTUDIO_BASE_URL,
                "local-model",
                options,
                prompt,
                key,
                None,
                false,
            )
            .await
        }
        "opencode" => {
            let key = require_secret(secrets, "opencode", "OpenCode")?;
            call_openai_compat(
                &client,
                "OpenCode",
                DEFAULT_OPENCODE_BASE_URL,
                "gpt-4o-mini",
                options,
                prompt,
                Some(key),
                None,
                false,
            )
            .await
        }
        "deepseek" => {
            let key = require_secret(secrets, "deepseek", "DeepSeek")?;
            call_openai_compat(
                &client,
                "DeepSeek",
                DEFAULT_DEEPSEEK_BASE_URL,
                "deepseek-chat",
                options,
                prompt,
                Some(key),
                None,
                true,
            )
            .await
        }
        "openrouter" => {
            let key = require_secret(secrets, "openrouter", "OpenRouter")?;
            call_openai_compat(
                &client,
                "OpenRouter",
                DEFAULT_OPENROUTER_BASE_URL,
                "google/gemma-2-9b-it:free",
                options,
                prompt,
                Some(key),
                Some("dayrep"),
                false,
            )
            .await
        }
        "gemini" => {
            let key = require_secret(secrets, "gemini", "Gemini")?;
            call_gemini(&client, options, prompt, key).await
        }
        "ollama" => call_ollama(&client, options, prompt).await,
        "claude_cli" => call_claude_cli(options, prompt).await,
        "claude_mcp" => Err("Claude MCP 연결은 DR-10에서 활성화됩니다.".to_string()),
        _ => Err(format!("알 수 없는 AI 엔진입니다: {}", engine)),
    }
}

struct TempWorkDir {
    path: PathBuf,
}

impl TempWorkDir {
    fn create() -> Result<Self, String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("dayrep_cli_{}_{}", std::process::id(), nanos));
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("CLI 임시 작업 폴더 생성 실패: {}", e))?;
        Ok(Self { path: dir })
    }
}

impl Drop for TempWorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn has_forbidden_cli_chars(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '&' | '|' | '<' | '>' | '^' | '%' | '"' | '\0' | '\r' | '\n'))
}

fn validate_cli_executable(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.map(str::trim).unwrap_or("");
    let exe = if trimmed.is_empty() { "claude" } else { trimmed };
    if has_forbidden_cli_chars(exe) {
        return Err("실행 경로에 허용되지 않는 문자가 포함되어 있습니다.".to_string());
    }
    let p = Path::new(exe);
    if p.exists() && p.is_dir() {
        return Err("실행 파일 경로가 디렉터리입니다.".to_string());
    }
    Ok(exe.to_string())
}

fn validate_cli_model(raw: Option<&str>) -> Result<Option<String>, String> {
    let trimmed = raw.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(None);
    }
    if has_forbidden_cli_chars(trimmed) {
        return Err("모델 이름에 허용되지 않는 문자가 포함되어 있습니다.".to_string());
    }
    Ok(Some(trimmed.to_string()))
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push_str("...");
    }
    out
}

fn spawn_claude_process(exec_path: &str, args: &[String], work_dir: &Path) -> std::io::Result<(std::process::Child, bool)> {
    let mut cmd = Command::new(exec_path);
    cmd.args(args)
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(child) => Ok((child, false)),
        Err(err) => {
            #[cfg(windows)]
            {
                if err.kind() == std::io::ErrorKind::NotFound
                    || exec_path.to_ascii_lowercase().ends_with(".cmd")
                    || exec_path.to_ascii_lowercase().ends_with(".bat")
                {
                    let mut fallback = Command::new("cmd");
                    fallback
                        .arg("/C")
                        .arg(exec_path)
                        .args(args)
                        .current_dir(work_dir)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .creation_flags(CREATE_NO_WINDOW);
                    return fallback.spawn().map(|c| (c, true));
                }
            }
            Err(err)
        }
    }
}

fn run_claude_cli_sync(
    options: &AiOptions,
    prompt: &str,
    timeout: Duration,
    secrets: &[&str],
) -> Result<AiResponse, String> {
    let exec_path = validate_cli_executable(options.base_url.as_deref())?;
    let model_opt = validate_cli_model(options.model.as_deref())?;
    let work_dir = TempWorkDir::create()?;

    let mut args = vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "text".to_string(),
    ];
    if let Some(ref m) = model_opt {
        args.push("--model".to_string());
        args.push(m.clone());
    }

    let (mut child, used_cmd_fallback) = spawn_claude_process(&exec_path, &args, &work_dir.path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "claude 명령을 찾을 수 없습니다. Claude Code 를 설치하고 로그인한 뒤 실행 경로를 설정에서 확인하세요".to_string()
        } else {
            format!("Claude Code CLI 실행 실패: {}", redact_secrets(&e.to_string(), secrets))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
        drop(stdin);
    }

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = stdout_pipe {
            let _ = r.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).to_string()
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = stderr_pipe {
            let _ = r.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).to_string()
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "Claude Code CLI 실행 시간이 {}초를 초과하여 중단되었습니다.",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Claude Code CLI 상태 확인 실패: {}", e));
            }
        }
    };

    let stdout_str = out_handle.join().unwrap_or_default();
    let stderr_str = err_handle.join().unwrap_or_default();

    if !status.success() {
        let clean_err = redact_secrets(stderr_str.trim(), secrets);
        let cmd_not_found_quote = format!("'{}'", exec_path);
        if status.code() == Some(9009)
            || (used_cmd_fallback && clean_err.starts_with(&cmd_not_found_quote))
            || clean_err.contains("is not recognized")
            || clean_err.contains("not found")
            || clean_err.contains("찾을 수 없습니다")
            || clean_err.contains("지정된 파일을 찾을 수 없습니다")
        {
            return Err("claude 명령을 찾을 수 없습니다. Claude Code 를 설치하고 로그인한 뒤 실행 경로를 설정에서 확인하세요".to_string());
        }
        let msg = if clean_err.is_empty() {
            format!("Claude Code CLI가 오류 코드({:?})로 종료되었습니다.", status.code())
        } else {
            format!("Claude Code CLI 오류: {}", truncate_chars(&clean_err, 300))
        };
        return Err(msg);
    }

    let text = stdout_str.trim().to_string();
    if text.is_empty() {
        let clean_err = redact_secrets(stderr_str.trim(), secrets);
        if clean_err.contains("not found") || clean_err.contains("찾을 수 없습니다") || clean_err.contains("is not recognized") {
            return Err("claude 명령을 찾을 수 없습니다. Claude Code 를 설치하고 로그인한 뒤 실행 경로를 설정에서 확인하세요".to_string());
        }
        return Err("Claude Code CLI 응답이 비어 있습니다.".to_string());
    }

    Ok(AiResponse {
        text,
        model: model_opt.unwrap_or_else(|| "claude-cli".to_string()),
    })
}

async fn call_claude_cli(options: &AiOptions, prompt: &str) -> Result<AiResponse, String> {
    let opts = options.clone();
    let prompt_owned = prompt.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        run_claude_cli_sync(
            &opts,
            &prompt_owned,
            Duration::from_secs(CLAUDE_CLI_TIMEOUT_SECS),
            &[],
        )
    })
    .await
    .map_err(|e| format!("Claude Code CLI 작업 실행 오류: {}", e))?
}

pub async fn list_models_with_secrets(
    engine: &str,
    options: &AiOptions,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
    let clean_engine = engine.trim().to_ascii_lowercase();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {}", e))?;

    match clean_engine.as_str() {
        "lmstudio" | "openrouter" => {
            let default_base = if clean_engine == "openrouter" {
                DEFAULT_OPENROUTER_BASE_URL
            } else {
                DEFAULT_LMSTUDIO_BASE_URL
            };
            let base = options
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(default_base);
            let url = format!("{}/models", validate_http_url(base)?.trim_end_matches('/'));
            let mut req = client.get(&url);
            if let Some(k) = secrets.get(&clean_engine).map(String::as_str).filter(|s| !s.is_empty()) {
                req = req.bearer_auth(k);
            }
            let resp = req.send().await.map_err(|e| format!("모델 조회 실패: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("모델 조회 HTTP {}", resp.status().as_u16()));
            }
            let val: Value = resp.json().await.map_err(|e| format!("JSON 파싱 실패: {}", e))?;
            let mut out = Vec::new();
            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                for item in arr.iter().take(100) {
                    if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                        out.push(id.to_string());
                    }
                }
            }
            Ok(out)
        }
        "ollama" => {
            let base = options
                .base_url
                .as_deref()
                .or(options.endpoint.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
            let url = format!("{}/api/tags", validate_http_url(base)?.trim_end_matches('/'));
            let resp = client.get(&url).send().await.map_err(|e| format!("Ollama 모델 조회 실패: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("Ollama HTTP {}", resp.status().as_u16()));
            }
            let val: Value = resp.json().await.map_err(|e| format!("JSON 파싱 실패: {}", e))?;
            let mut out = Vec::new();
            if let Some(arr) = val.get("models").and_then(|m| m.as_array()) {
                for item in arr.iter().take(100) {
                    if let Some(name) = item.get("name").and_then(|x| x.as_str()) {
                        out.push(name.to_string());
                    }
                }
            }
            Ok(out)
        }
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_mock_http_server(status_line: &str, body: &str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().unwrap();
        let status = status_line.to_string();
        let resp_body = body.to_string();

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                resp_body.len(),
                resp_body
            );
            stream.write_all(resp.as_bytes()).unwrap();
            let _ = stream.flush();
            req
        });
        (format!("http://{}", addr), handle)
    }

    #[test]
    fn test_request_builders() {
        let (h_url, h_body) = build_hermes_request(None, "테스트").unwrap();
        assert_eq!(h_url, DEFAULT_HERMES_ENDPOINT);
        assert_eq!(h_body, json!({ "prompt": "테스트" }));

        let (o_url, o_body, o_key) = build_openai_compat_request(
            Some("http://localhost:1234/v1/"),
            DEFAULT_LMSTUDIO_BASE_URL,
            Some("qwen2.5"),
            "local-model",
            "안녕",
            Some(0.3),
            None,
        )
        .unwrap();
        assert_eq!(o_url, "http://localhost:1234/v1/chat/completions");
        assert_eq!(o_body["model"], json!("qwen2.5"));
        assert_eq!(o_key, "lm-studio");

        let (g_url, g_body, g_model) =
            build_gemini_request(None, Some("gemini-2.0-flash"), "프롬프트", None).unwrap();
        assert_eq!(
            g_url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        );
        assert!(!g_url.contains("key="));
        assert_eq!(g_body["contents"][0]["parts"][0]["text"], json!("프롬프트"));
        assert_eq!(g_model, "gemini-2.0-flash");

        assert!(build_ollama_request(None, None, "x").is_err());
        let (ol_url, ol_body, _) = build_ollama_request(None, Some("llama3.1"), "hi").unwrap();
        assert_eq!(ol_url, "http://localhost:11434/api/generate");
        assert_eq!(ol_body["stream"], json!(false));
    }

    #[tokio::test]
    async fn test_hermes_mock_server_success_and_error() {
        let (base, handle) = spawn_mock_http_server(
            "200 OK",
            r#"{"text":"1. 안전모 착용 철저","model":"hermes-free"}"#,
        );
        let opts = AiOptions {
            endpoint: Some(format!("{}/api/generate", base)),
            ..Default::default()
        };
        let res = ai_generate_with_secrets("hermes", "프롬프트", &opts, &BTreeMap::new())
            .await
            .unwrap();
        assert_eq!(res.text, "1. 안전모 착용 철저");
        assert_eq!(res.model, "hermes-free");
        let raw_req = handle.join().unwrap();
        assert!(raw_req.contains("POST /api/generate"));

        let (base2, handle2) = spawn_mock_http_server("400 Bad Request", r#"{"error":"bad prompt"}"#);
        let opts2 = AiOptions {
            endpoint: Some(format!("{}/api/generate", base2)),
            ..Default::default()
        };
        let err = ai_generate_with_secrets("hermes", "프롬프트", &opts2, &BTreeMap::new())
            .await
            .unwrap_err();
        assert!(err.contains("400") && err.contains("bad prompt"));
        let _ = handle2.join();
    }

    #[tokio::test]
    async fn test_openai_compat_mock_server_and_redaction() {
        let (base, handle) = spawn_mock_http_server(
            "200 OK",
            r#"{"choices":[{"message":{"content":"1. 추락 방지"}}],"model":"qwen-local"}"#,
        );
        let opts = AiOptions {
            base_url: Some(format!("{}/v1", base)),
            model: Some("qwen-local".to_string()),
            ..Default::default()
        };
        let res = ai_generate_with_secrets("lmstudio", "테스트", &opts, &BTreeMap::new())
            .await
            .unwrap();
        assert_eq!(res.text, "1. 추락 방지");
        let raw_req = handle.join().unwrap();
        assert!(raw_req.to_ascii_lowercase().contains("authorization: bearer lm-studio"));

        let secret = "sk-very-secret-key-9999";
        let (base2, handle2) = spawn_mock_http_server(
            "401 Unauthorized",
            &format!(r#"{{"error":"invalid key {}"}}"#, secret),
        );
        let mut secrets = BTreeMap::new();
        secrets.insert("lmstudio".to_string(), secret.to_string());
        let opts2 = AiOptions {
            base_url: Some(format!("{}/v1", base2)),
            ..Default::default()
        };
        let err = ai_generate_with_secrets("lmstudio", "테스트", &opts2, &secrets)
            .await
            .unwrap_err();
        assert!(!err.contains(secret));
        assert!(err.contains("***"));
        let _ = handle2.join();
    }

    #[tokio::test]
    async fn test_openrouter_deepseek_opencode_and_missing_keys() {
        let empty = BTreeMap::new();
        for eng in ["opencode", "deepseek", "openrouter", "gemini"] {
            let err = ai_generate_with_secrets(eng, "테스트", &AiOptions::default(), &empty)
                .await
                .unwrap_err();
            assert!(err.contains("API 키가 등록되지 않았습니다"), "engine={}", eng);
        }

        // OpenRouter: X-Title: dayrep 헤더 확인
        let (or_base, or_handle) = spawn_mock_http_server(
            "200 OK",
            r#"{"choices":[{"message":{"content":"1. 안전수칙"}}],"model":"gemma-free"}"#,
        );
        let mut secrets = BTreeMap::new();
        secrets.insert("openrouter".to_string(), "sk-or-test-12345".to_string());
        let opts = AiOptions {
            base_url: Some(format!("{}/api/v1", or_base)),
            ..Default::default()
        };
        let res = ai_generate_with_secrets("openrouter", "테스트", &opts, &secrets)
            .await
            .unwrap();
        assert_eq!(res.text, "1. 안전수칙");
        let raw_or = or_handle.join().unwrap().to_ascii_lowercase();
        assert!(raw_or.contains("x-title: dayrep"));
        assert!(raw_or.contains("authorization: bearer sk-or-test-12345"));

        // DeepSeek 402 잔액부족 + 키 에코 redaction
        let ds_key = "sk-ds-secret-8888";
        secrets.insert("deepseek".to_string(), ds_key.to_string());
        let (ds_base, ds_handle) = spawn_mock_http_server(
            "402 Payment Required",
            &format!(r#"{{"error":"insufficient balance for {}"}}"#, ds_key),
        );
        let ds_opts = AiOptions {
            base_url: Some(ds_base),
            ..Default::default()
        };
        let ds_err = ai_generate_with_secrets("deepseek", "테스트", &ds_opts, &secrets)
            .await
            .unwrap_err();
        assert!(ds_err.contains("잔액이 부족합니다"));
        assert!(!ds_err.contains(ds_key));
        let _ = ds_handle.join();
    }

    #[tokio::test]
    async fn test_gemini_and_ollama_mock_servers() {
        let gem_key = "AIzaSy-secret-gemini-key-777";
        let mut secrets = BTreeMap::new();
        secrets.insert("gemini".to_string(), gem_key.to_string());

        let (g_base, g_handle) = spawn_mock_http_server(
            "200 OK",
            r#"{"candidates":[{"content":{"parts":[{"text":"1. 개인보호구 착용"}]}}]}"#,
        );
        let g_opts = AiOptions {
            base_url: Some(format!("{}/v1beta", g_base)),
            model: Some("gemini-2.0-flash".to_string()),
            ..Default::default()
        };
        let g_res = ai_generate_with_secrets("gemini", "테스트", &g_opts, &secrets)
            .await
            .unwrap();
        assert_eq!(g_res.text, "1. 개인보호구 착용");
        let raw_g = g_handle.join().unwrap();
        assert!(raw_g.contains("POST /v1beta/models/gemini-2.0-flash:generateContent"));
        assert!(!raw_g.lines().next().unwrap_or("").contains(gem_key));
        assert!(raw_g.to_ascii_lowercase().contains(&format!("x-goog-api-key: {}", gem_key.to_ascii_lowercase())));

        // Ollama
        let (ol_base, ol_handle) = spawn_mock_http_server(
            "200 OK",
            r#"{"model":"llama3.1","response":"1. 신호수 배치"}"#,
        );
        let ol_opts = AiOptions {
            base_url: Some(ol_base),
            model: Some("llama3.1".to_string()),
            ..Default::default()
        };
        let ol_res = ai_generate_with_secrets("ollama", "테스트", &ol_opts, &BTreeMap::new())
            .await
            .unwrap();
        assert_eq!(ol_res.text, "1. 신호수 배치");
        let raw_ol = ol_handle.join().unwrap();
        assert!(raw_ol.contains("POST /api/generate"));
        assert!(raw_ol.contains(r#""stream":false"#));
    }

    #[tokio::test]
    async fn test_connection_refused_friendly_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = listener.local_addr().unwrap().port();
        drop(listener);

        let opts = AiOptions {
            endpoint: Some(format!("http://127.0.0.1:{}/api/generate", closed_port)),
            ..Default::default()
        };
        let err = ai_generate_with_secrets("hermes", "테스트", &opts, &BTreeMap::new())
            .await
            .unwrap_err();
        assert!(err.contains("연결할 수 없습니다"));
    }

    fn write_mock_cli_script(dir: &Path, name: &str, win_body: &str, unix_body: &str) -> PathBuf {
        #[cfg(windows)]
        {
            let _ = unix_body;
            let p = dir.join(format!("{}.cmd", name));
            std::fs::write(&p, win_body).unwrap();
            p
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = win_body;
            let p = dir.join(format!("{}.sh", name));
            std::fs::write(&p, unix_body).unwrap();
            let mut perms = std::fs::metadata(&p).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&p, perms).unwrap();
            p
        }
    }

    #[tokio::test]
    async fn test_claude_cli_success_and_stdin() {
        let dir = TempWorkDir::create().unwrap();
        let script = write_mock_cli_script(
            &dir.path,
            "mock_ok",
            "@echo off\r\npowershell -NoProfile -Command \"$s=[Console]::In.ReadToEnd(); Write-Output ('LEN:' + $s.Length + ' OK')\"\r\n",
            "#!/bin/sh\ns=$(cat)\necho \"LEN:${#s} OK\"\n",
        );
        let opts = AiOptions {
            base_url: Some(script.to_string_lossy().to_string()),
            model: Some("claude-sonnet-4-5".to_string()),
            ..Default::default()
        };
        let res = ai_generate_with_secrets("claude_cli", "hello-stdin", &opts, &BTreeMap::new())
            .await
            .unwrap();
        assert_eq!(res.model, "claude-sonnet-4-5");
        assert!(res.text.contains("LEN:11 OK"), "unexpected text: {}", res.text);
    }

    #[test]
    fn test_claude_cli_nonzero_exit_and_truncate() {
        let dir = TempWorkDir::create().unwrap();
        let script = write_mock_cli_script(
            &dir.path,
            "mock_err",
            "@echo off\r\npowershell -NoProfile -Command \"[Console]::Error.WriteLine('E' * 350); exit 2\"\r\n",
            "#!/bin/sh\nprintf 'E%.0s' $(seq 1 350) >&2\nexit 2\n",
        );
        let opts = AiOptions {
            base_url: Some(script.to_string_lossy().to_string()),
            ..Default::default()
        };
        let err = run_claude_cli_sync(&opts, "hi", Duration::from_secs(10), &[]).unwrap_err();
        assert!(err.contains("Claude Code CLI 오류:"));
        assert!(err.ends_with("..."));
        assert!(err.chars().count() < 340);
    }

    #[test]
    fn test_claude_cli_timeout() {
        let dir = TempWorkDir::create().unwrap();
        let script = write_mock_cli_script(
            &dir.path,
            "mock_slow",
            "@echo off\r\nping -n 3 127.0.0.1 >nul\r\necho late\r\n",
            "#!/bin/sh\nsleep 2\necho late\n",
        );
        let opts = AiOptions {
            base_url: Some(script.to_string_lossy().to_string()),
            ..Default::default()
        };
        let err = run_claude_cli_sync(&opts, "hi", Duration::from_millis(150), &[]).unwrap_err();
        assert!(err.contains("초과하여 중단"), "unexpected err: {}", err);
    }

    #[tokio::test]
    async fn test_claude_cli_not_found_friendly_message() {
        let opts = AiOptions {
            base_url: Some("nonexistent_claude_cli_binary_xyz_999".to_string()),
            ..Default::default()
        };
        let err = ai_generate_with_secrets("claude_cli", "hi", &opts, &BTreeMap::new())
            .await
            .unwrap_err();
        assert!(err.contains("claude 명령을 찾을 수 없습니다"), "unexpected err: {}", err);
    }

    #[tokio::test]
    async fn test_claude_cli_rejects_injection_chars() {
        let opts = AiOptions {
            base_url: Some("claude & calc.exe".to_string()),
            ..Default::default()
        };
        let err = ai_generate_with_secrets("claude_cli", "hi", &opts, &BTreeMap::new())
            .await
            .unwrap_err();
        assert!(err.contains("허용되지 않는 문자"), "unexpected err: {}", err);

        let opts_model = AiOptions {
            base_url: Some("claude".to_string()),
            model: Some("sonnet|whoami".to_string()),
            ..Default::default()
        };
        let err2 = ai_generate_with_secrets("claude_cli", "hi", &opts_model, &BTreeMap::new())
            .await
            .unwrap_err();
        assert!(err2.contains("허용되지 않는 문자"), "unexpected err: {}", err2);
    }
}
