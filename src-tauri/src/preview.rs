use crate::tools;
use base64::Engine;
use serde_json::{json,Value};
use std::{collections::HashMap,sync::{OnceLock,Mutex},time::{Instant,Duration}};
#[derive(Clone)]struct Source{url:String,headers:String,duration:f64}
static SOURCES:OnceLock<Mutex<HashMap<String,(Instant,Source)>>>=OnceLock::new();
static PREVIEWS:OnceLock<Mutex<HashMap<String,(Instant,Value)>>>=OnceLock::new();
fn source_from_data(data:&Value)->Option<Source>{
    let selected=data["formats"].as_array().and_then(|formats|formats.iter()
        .filter(|f|f["vcodec"].as_str().is_some_and(|codec|codec!="none")&&f["url"].as_str().is_some_and(|url|tools::validate_url(url).is_ok()))
        .min_by_key(|f|{let height=f["height"].as_u64().unwrap_or(360);if height<=360{360-height}else{10000+height}}));
    let selected=selected.unwrap_or(data);
    let url=selected["url"].as_str()?;tools::validate_url(url).ok()?;
    let values=selected["http_headers"].as_object().or_else(||data["http_headers"].as_object());
    let mut headers=String::new();if let Some(values)=values{for(key,value)in values{if key.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'){if let Some(value)=value.as_str(){headers.push_str(&format!("{key}: {}\r\n",value.replace(['\r','\n'],"")));}}}}
    Some(Source{url:url.into(),headers,duration:data["duration"].as_f64().unwrap_or(0.)})
}
pub fn remember_source(url:&str,data:&Value){
    if let Some(source)=source_from_data(data){let cache=SOURCES.get_or_init(||Mutex::new(HashMap::new()));if let Ok(mut entries)=cache.lock(){if entries.len()>=8{entries.clear();}entries.insert(url.into(),(Instant::now(),source));}}
}
async fn source(app:&tauri::AppHandle,url:&str)->Result<Source,String>{
    tools::validate_url(url)?;
    let cache=SOURCES.get_or_init(||Mutex::new(HashMap::new()));
    let cached=cache.lock().ok().and_then(|entries|entries.get(url).filter(|(time,_)|time.elapsed()<Duration::from_secs(600)).map(|(_,source)|source.clone()));
    let mut source=if let Some(source)=cached{source}else{
    let mut command=tools::command(app,"yt-dlp");command.args(["--ignore-config","--dump-single-json","--skip-download","--no-playlist","--no-warnings","-f","worstvideo[height<=360]/worst","--",url]);
    let output=tokio::time::timeout(Duration::from_secs(60),command.output()).await.map_err(|_|"Источник слишком долго отвечает")?.map_err(|e|e.to_string())?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(500).collect())}
    let data:Value=serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())?;
    source_from_data(&data).ok_or("Не удалось получить видеопоток для превью")?};
    if source.duration<=0.{let mut probe=tools::command(app,"ffmpeg");probe.args(["-hide_banner","-nostdin","-rw_timeout","10000000"]);if !source.headers.is_empty(){probe.arg("-headers").arg(&source.headers);}probe.arg("-i").arg(&source.url);
        let output=tokio::time::timeout(Duration::from_secs(15),probe.output()).await.map_err(|_|"Не удалось определить длительность")?.map_err(|e|e.to_string())?;
        let stderr=String::from_utf8_lossy(&output.stderr);source.duration=stderr.lines().find_map(|line|line.split_once("Duration: ").and_then(|(_,value)|parse_duration(value.split(',').next().unwrap_or("")))).unwrap_or(0.);
    }
    if !source.duration.is_finite()||source.duration<=0.{return Err("Для прямого эфира выбор фрагмента пока недоступен".into())}
    if let Ok(mut entries)=cache.lock(){entries.retain(|_,(time,_)|time.elapsed()<Duration::from_secs(600));if entries.len()>=8{entries.clear();}entries.insert(url.into(),(Instant::now(),source.clone()));}Ok(source)
}
fn parse_duration(value:&str)->Option<f64>{let parts:Vec<f64>=value.trim().split(':').map(str::parse).collect::<Result<_,_>>().ok()?;if parts.len()!=3{return None}Some(parts[0]*3600.+parts[1]*60.+parts[2])}
async fn frame(app:&tauri::AppHandle,source:&Source,time:f64)->Result<Value,String>{
    let time=time.clamp(0.,(source.duration-0.1).max(0.));
    let mut command=tools::command(app,"ffmpeg");command.args(["-hide_banner","-loglevel","error","-nostdin","-rw_timeout","10000000","-threads","1","-ss"]).arg(time.to_string());
    if !source.headers.is_empty(){command.arg("-headers").arg(&source.headers);}
    command.arg("-i").arg(&source.url).args(["-an","-frames:v","1","-vf","scale=192:-2","-threads","1","-q:v","5","-f","image2pipe","-vcodec","mjpeg","pipe:1"]);
    let output=tokio::time::timeout(Duration::from_secs(15),command.output()).await.map_err(|_|"Кадр не успел загрузиться")?.map_err(|e|e.to_string())?;
    if !output.status.success()||output.stdout.is_empty(){return Err("Не удалось получить кадр видео".into())}
    Ok(json!({"time":time,"image":format!("data:image/jpeg;base64,{}",base64::engine::general_purpose::STANDARD.encode(output.stdout))}))
}
#[tauri::command]
pub async fn preview_video(app:tauri::AppHandle,url:String)->Result<Value,String>{
    tools::validate_url(&url)?;
    let cache=PREVIEWS.get_or_init(||Mutex::new(HashMap::new()));
    if let Ok(entries)=cache.lock(){if let Some((time,value))=entries.get(&url){if time.elapsed()<Duration::from_secs(120){return Ok(value.clone())}}}
    let source=source(&app,&url).await?;let mut frames=Vec::new();
    // One parallel batch for a quick initial strip; hover fetches precise frames.
    let results=tokio::join!(frame(&app,&source,0.),frame(&app,&source,source.duration/3.),frame(&app,&source,source.duration*2./3.));
    for result in [results.0,results.1,results.2]{if let Ok(value)=result{frames.push(value)}}
    if frames.is_empty(){return Err("Источник не позволил получить кадры".into())}
    let value=json!({"duration":source.duration,"frames":frames});
    if let Ok(mut entries)=cache.lock(){entries.retain(|_,(time,_)|time.elapsed()<Duration::from_secs(120));if entries.len()>=8{entries.clear();}entries.insert(url,(Instant::now(),value.clone()));}Ok(value)
}
#[tauri::command]
pub async fn preview_frame(app:tauri::AppHandle,url:String,time:f64)->Result<Value,String>{if !time.is_finite(){return Err("Некорректное время".into())}let source=source(&app,&url).await?;frame(&app,&source,time).await}
#[tauri::command]
pub fn project_folder()->Result<String,String>{if !cfg!(debug_assertions){return Err("Папка проекта доступна в режиме разработки".into())}Ok(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_string_lossy().into_owned())}
#[cfg(test)]mod tests{use super::*;
#[test]fn duration_parser(){assert_eq!(parse_duration("00:10:05.50"),Some(605.5));assert_eq!(parse_duration("N/A"),None);}
#[test]fn preview_reuses_small_video_stream_and_safe_headers(){let source=source_from_data(&json!({"duration":30,"http_headers":{"User-Agent":"test\r\ninjected"},"formats":[{"height":1080,"vcodec":"h264","url":"https://example.com/large"},{"height":360,"vcodec":"h264","url":"https://example.com/small"},{"vcodec":"none","url":"https://example.com/audio"}]})).unwrap();assert_eq!(source.url,"https://example.com/small");assert_eq!(source.duration,30.);assert_eq!(source.headers,"User-Agent: testinjected\r\n");}
#[test]fn direct_video_can_be_reused_without_known_duration(){let source=source_from_data(&json!({"url":"https://example.com/video.mp4"})).unwrap();assert_eq!(source.duration,0.);assert!(source_from_data(&json!({"url":"file:///secret"})).is_none());}
}
