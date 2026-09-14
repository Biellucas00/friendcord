use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let Ok(updater) = handle.updater() else { return };
                let Ok(Some(update)) = updater.check().await else { return };
                if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                    handle.restart();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Discordo");
}
