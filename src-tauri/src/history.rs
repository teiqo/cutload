use serde::{Serialize,Deserialize};
use std::path::Path;
use tauri::Manager;
use base64::Engine;
use std::sync::{Mutex,OnceLock};
static THUMBS:OnceLock<Mutex<std::collections::HashMap<String,String>>>=OnceLock::new();
#[tauri::command]
pub async fn download_thumbnail(app:tauri::AppHandle,id:String)->Result<Option<String>,String>{
    let cache=THUMBS.get_or_init(||Mutex::new(std::collections::HashMap::new()));if let Some(value)=cache.lock().ok().and_then(|entries|entries.get(&id).cloned()){return Ok(Some(value))}
    let entries=recent_downloads(app.clone()).await?;let entry=entries.iter().find(|e|e.id==id).ok_or("Нет файла в истории")?;
    let path=std::path::PathBuf::from(&entry.path);if !path.is_file(){return Ok(None)}
    let mut command=crate::tools::command(&app,"ffmpeg");command.args(["-hide_banner","-loglevel","error","-nostdin","-i"]).arg(path).args(["-an","-frames:v","1","-vf","scale=128:-2","-threads","1","-f","image2pipe","-vcodec","mjpeg","pipe:1"]);command.kill_on_drop(true);
    let result=tokio::time::timeout(std::time::Duration::from_secs(6),command.output()).await;
    let Some(bytes)=result.ok().and_then(Result::ok).filter(|o|o.status.success()&&!o.stdout.is_empty()).map(|o|o.stdout)else{return Ok(None)};
    let value=format!("data:image/jpeg;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes));if let Ok(mut entries)=cache.lock(){if entries.len()>=50{entries.clear()}entries.insert(id,value.clone());}Ok(Some(value))
}

#[derive(Serialize,Deserialize,Clone)]
pub struct Entry{pub id:String,pub title:String,pub path:String,pub created:u64,#[serde(default)]pub thumbnail:Option<String>}
fn storage(app:&tauri::AppHandle)->Result<std::path::PathBuf,String>{Ok(app.path().app_data_dir().map_err(|e|e.to_string())?.join("downloads.json"))}
#[tauri::command]
pub async fn recent_downloads(app:tauri::AppHandle)->Result<Vec<Entry>,String>{
    let file=storage(&app)?;
    match tokio::fs::read(file).await{Ok(data)=>serde_json::from_slice(&data).map_err(|e|e.to_string()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(Vec::new()),Err(e)=>Err(e.to_string())}
}
pub async fn record(app:&tauri::AppHandle,id:&str,title:&str,path:&Path,thumbnail:Option<&str>)->Result<(),String>{
    let mut entries=recent_downloads(app.clone()).await?;
    entries.retain(|entry|entry.id!=id);
    entries.insert(0,Entry{id:id.into(),title:title.into(),path:path.to_string_lossy().into_owned(),thumbnail:thumbnail.filter(|url|crate::tools::validate_url(url).is_ok()).map(String::from),created:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()});entries.truncate(50);
    let file=storage(app)?;tokio::fs::create_dir_all(file.parent().unwrap()).await.map_err(|e|e.to_string())?;
    // One download runs at a time; publish the small history file atomically.
    let temp=file.with_extension("tmp");tokio::fs::write(&temp,serde_json::to_vec(&entries).map_err(|e|e.to_string())?).await.map_err(|e|e.to_string())?;
    tokio::fs::rename(temp,file).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn open_download(app:tauri::AppHandle,id:String,reveal:bool)->Result<(),String>{
    let entries=recent_downloads(app).await?;
    let entry=entries.iter().find(|entry|entry.id==id).ok_or("Загрузка не найдена в истории")?;
    let path=std::path::PathBuf::from(&entry.path);
    if !path.is_file(){return Err("Файл перемещён или удалён".into())}
    let extension=path.extension().and_then(|value|value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(),"mp4"|"webm"|"mp3"|"m4a"|"opus"|"flac"|"wav"|"jpg"|"jpeg"|"png"|"webp"){return Err("Этот тип файла нельзя открыть из истории".into())}
    #[cfg(windows)]{
        let mut command=std::process::Command::new("explorer.exe");
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        if reveal{command.arg("/select,");}
        command.arg(path).spawn().map_err(|e|e.to_string())?;Ok(())
    }
    #[cfg(not(windows))]{let _=reveal;Err("Открытие файла пока доступно только в Windows".into())}
}
