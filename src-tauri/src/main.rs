#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod tools;
mod media;
mod jobs;
mod browser;
mod history;
mod preview;
use tauri::Manager;

#[tauri::command]
async fn choose_folder()->Result<Option<String>,String>{
    tauri::async_runtime::spawn_blocking(||rfd::FileDialog::new().set_title("Папка сохранения").pick_folder().map(|p|p.to_string_lossy().into_owned())).await.map_err(|e|e.to_string())
}
#[tauri::command]
fn downloads_folder(app:tauri::AppHandle)->Result<String,String>{app.path().download_dir().map(|p|p.to_string_lossy().into_owned()).map_err(|e|e.to_string())}
#[tauri::command]
fn open_updates()->Result<(),String>{
    std::process::Command::new("explorer.exe").arg("https://github.com/teiqo/cutload/releases").spawn().map(|_|()).map_err(|e|e.to_string())
}
fn main(){
    let arguments:Vec<String>=std::env::args().collect();
    let browser_mode=cfg!(debug_assertions)&&arguments.get(1).map(String::as_str)==Some("--browser-backend");
    let smoke_cancel=arguments.get(1).map(String::as_str)==Some("--smoke-cancel");
    let smoke=smoke_cancel||arguments.get(1).map(String::as_str)==Some("--smoke-test");
    let mut context=tauri::generate_context!();
    if smoke||browser_mode {context.config_mut().app.windows.iter_mut().for_each(|window|window.visible=false);}
    tauri::Builder::default().manage(jobs::Jobs::default())
        .setup(move |app|{
            #[cfg(windows)]
            if let Some(window)=app.get_webview_window("main") {
                window.with_webview(|webview|unsafe {
                    if let Ok(core)=webview.controller().CoreWebView2() {
                        if let Ok(settings)=core.Settings() {
                            let _=settings.SetAreDefaultContextMenusEnabled(false);
                            let _=settings.SetIsStatusBarEnabled(false);
                            let _=settings.SetIsZoomControlEnabled(false);
                            let _=settings.SetAreDevToolsEnabled(false);
                        }
                    }
                })?;
            }
            if browser_mode {let handle=app.handle().clone();tauri::async_runtime::spawn(async move {if let Err(error)=browser::serve(handle.clone()).await{eprintln!("{error}");handle.exit(1);}});}
            if smoke {
                use tauri::Listener;
                let url=arguments.get(2).cloned().ok_or("Smoke test requires URL")?;
                let folder=arguments.get(3).cloned().ok_or("Smoke test requires output folder")?;
                let handle=app.handle().clone();let listener_handle=handle.clone();
                let cancellation_scheduled=std::sync::atomic::AtomicBool::new(false);
                app.listen("download-progress",move |event|{
                    println!("{}",event.payload());
                    if let Ok(value)=serde_json::from_str::<serde_json::Value>(event.payload()) {
                        if smoke_cancel&&value["stage"]=="downloading"&&!cancellation_scheduled.swap(true,std::sync::atomic::Ordering::Relaxed){
                            let handle=listener_handle.clone();let id=value["id"].as_str().unwrap().to_string();
                            tauri::async_runtime::spawn(async move {tokio::time::sleep(std::time::Duration::from_millis(200)).await;let _=jobs::cancel_download(handle.state::<jobs::Jobs>(),id);});
                        }
                        match value["stage"].as_str(){Some("complete")=>listener_handle.exit(if smoke_cancel{1}else{0}),Some("cancelled")=>listener_handle.exit(if smoke_cancel{0}else{1}),Some("error")=>listener_handle.exit(1),_=>()}
                    }
                });
                tauri::async_runtime::spawn(async move {
                    let result=async {
                        let media=media::analyze_media(handle.clone(),url.clone(),None).await?;
                        println!("metadata: {}",media);
                        let request=serde_json::from_value(serde_json::json!({"url":url,"title":media["title"],"folder":folder,"quality":"auto","codec":"h264","format":"mp4","audio":false,"start":0.,"end":5.})).map_err(|e|e.to_string())?;
                        jobs::start_download(handle.clone(),handle.state::<jobs::Jobs>(),request).await?;
                        Ok::<(),String>(())
                    }.await;
                    if let Err(error)=result{eprintln!("{error}");handle.exit(1);}
                });
            }
            Ok(())
        })
        .on_window_event(|window,event|{
            if let tauri::WindowEvent::CloseRequested { api,.. }=event {
                let jobs=window.state::<jobs::Jobs>().inner().clone();
                let active=jobs.0.lock().map(|registry|{for sender in registry.values(){let _=sender.send(true);}!registry.is_empty()}).unwrap_or(false);
                if active {api.prevent_close();let window=window.clone();tauri::async_runtime::spawn(async move {for _ in 0..50 {if jobs.0.lock().map(|r|r.is_empty()).unwrap_or(true){break}tokio::time::sleep(std::time::Duration::from_millis(100)).await;}let _=window.destroy();});}
            }
        })
        .invoke_handler(tauri::generate_handler![media::analyze_media,media::cancel_analysis,jobs::start_download,jobs::save_cover,jobs::cancel_download,choose_folder,downloads_folder,open_updates,history::recent_downloads,history::download_thumbnail,history::open_download,preview::preview_video,preview::preview_frame,preview::project_folder])
        .run(context).expect("Не удалось запустить cutload");
}
