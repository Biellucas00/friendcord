use tauri_plugin_updater::UpdaterExt;
use std::{fs::{create_dir_all, OpenOptions}, io::Write, panic, path::PathBuf, thread, time::{SystemTime, UNIX_EPOCH}};

const TELEMETRY_URL: &str = "https://friendcord-api.onrender.com/api/telemetry/client";

fn log_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("Discordo").join("logs").join("desktop.log")
}

fn write_log(level: &str, message: &str) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs()).unwrap_or_default();
        let _ = writeln!(file, "[{timestamp}] [{level}] {message}");
    }
}

fn report_error(source: &'static str, message: String) {
    write_log("ERROR", &format!("{source}: {message}"));
    thread::spawn(move || {
        let payload = serde_json::json!({
            "message": message,
            "context": {
                "source": source,
                "platform": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "version": env!("CARGO_PKG_VERSION")
            }
        });
        let _ = ureq::post(TELEMETRY_URL).timeout(std::time::Duration::from_secs(8)).send_json(payload);
    });
}

#[cfg(windows)]
fn show_startup_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let title: Vec<u16> = "Discordo - erro ao iniciar\0".encode_utf16().collect();
    let body: Vec<u16> = format!("{message}\n\nO diagnóstico foi salvo em:\n{}\0", log_path().display()).encode_utf16().collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR); }
}

#[cfg(not(windows))]
fn show_startup_error(_message: &str) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    write_log("INFO", "Processo do Discordo iniciado");
    panic::set_hook(Box::new(|panic_info| {
        report_error("desktop-panic", panic_info.to_string());
    }));

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            write_log("INFO", "Janela principal criada");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match handle.updater() {
                    Ok(updater) => match updater.check().await {
                        Ok(Some(update)) => match update.download_and_install(|_, _| {}, || {}).await {
                            Ok(()) => handle.restart(),
                            Err(error) => report_error("desktop-updater-install", error.to_string()),
                        },
                        Ok(None) => write_log("INFO", "Aplicativo atualizado"),
                        Err(error) => report_error("desktop-updater-check", error.to_string()),
                    },
                    Err(error) => report_error("desktop-updater-init", error.to_string()),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = error.to_string();
        report_error("desktop-runtime", message.clone());
        show_startup_error(&message);
    }
}
