use crate::tools;
use std::{collections::HashMap,sync::{Mutex,OnceLock},time::{Instant,Duration}};
type MetadataCache=Mutex<HashMap<String,(Instant,serde_json::Value)>>;
static CACHE:OnceLock<MetadataCache>=OnceLock::new();
static SEARCHES:OnceLock<Mutex<HashMap<String,tokio::sync::watch::Sender<bool>>>>=OnceLock::new();
#[tauri::command]
pub fn cancel_analysis(id:String)->Result<(),String>{
    if let Ok(searches)=SEARCHES.get_or_init(||Mutex::new(HashMap::new())).lock(){if let Some(cancel)=searches.get(&id){let _=cancel.send(true);}}
    Ok(())
}
fn source_error(stderr:&str)->String{
    if stderr.contains("Unsupported URL")||stderr.contains("No suitable extractor") {format!("UNSUPPORTED_SOURCE\n{stderr}")}else{stderr.to_owned()}
}

fn full_thumbnail(source:&serde_json::Value)->serde_json::Value {
    let thumbnails=source["thumbnails"].as_array();
    let largest=thumbnails.and_then(|items|items.iter().filter(|item|{
        item["url"].as_str().is_some_and(|url|!url.is_empty())&&item["width"].as_u64().is_some_and(|w|w>0)&&item["height"].as_u64().is_some_and(|h|h>0)
    }).max_by_key(|item|item["width"].as_u64().unwrap().saturating_mul(item["height"].as_u64().unwrap())));
    if let Some(item)=largest{return item["url"].clone();}
    // yt-dlp's primary thumbnail is its preferred image when dimensions are absent.
    if source["thumbnail"].as_str().is_some_and(|url|!url.is_empty()){return source["thumbnail"].clone();}
    thumbnails.and_then(|items|items.iter().rev().find(|item|item["url"].as_str().is_some_and(|url|!url.is_empty()))).map(|item|item["url"].clone()).unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
pub async fn analyze_media(app: tauri::AppHandle, url: String, request_id:Option<String>) -> Result<serde_json::Value, String> {
    tools::validate_url(&url)?;
    let cache=CACHE.get_or_init(||Mutex::new(HashMap::new()));
    if let Ok(entries)=cache.lock(){if let Some((time,value))=entries.get(&url){if time.elapsed()<Duration::from_secs(600){return Ok(value.clone())}}}
    let (sender,mut cancelled)=tokio::sync::watch::channel(false);
    if let Some(id)=&request_id{SEARCHES.get_or_init(||Mutex::new(HashMap::new())).lock().map_err(|_|"Поиск недоступен")?.insert(id.clone(),sender);}
    let mut fast=url::Url::parse(&url).ok().and_then(|parsed|parsed.host_str().map(str::to_owned)).is_some_and(|host|host=="youtu.be"||host=="youtube.com"||host.ends_with(".youtube.com"));
    let extraction=async {
        loop {
            let mut command=tools::command(&app,"yt-dlp");command.kill_on_drop(true);
            command.args(["--ignore-config","--dump-single-json","--skip-download","--no-playlist","--no-warnings","--socket-timeout","15","--retries","1","--extractor-retries","1"]);
            // Metadata needs direct formats, not every segment of a long HLS/DASH manifest.
            // Fall back to full extraction when direct formats are unavailable (e.g. live streams).
            if fast {command.args(["--extractor-args","youtube:skip=hls,dash,translated_subs"]);}
            command.args(["--",&url]);
            let output=command.output().await.map_err(|e|format!("Не удалось запустить yt-dlp: {e}"))?;
            if !output.status.success(){
                let stderr=String::from_utf8_lossy(&output.stderr);
                if fast&&(stderr.contains("No video formats")||stderr.contains("No formats found")||stderr.contains("Requested format is not available")){fast=false;continue;}
                return Err(source_error(&stderr));
            }
            let source:serde_json::Value=serde_json::from_slice(&output.stdout).map_err(|e|format!("Некорректный ответ yt-dlp: {e}"))?;
            let playable=source["formats"].as_array().is_some_and(|formats|formats.iter().any(|f|f["url"].is_string()&&f["vcodec"].as_str().is_some_and(|codec|codec!="none")))||source["url"].is_string();
            if fast&&!playable {fast=false;continue;}
            break Ok(source);
        }
    };
    let result=tokio::select!{result=tokio::time::timeout(std::time::Duration::from_secs(90),extraction)=>Some(result),_=cancelled.changed(),if request_id.is_some()=>None};
    if let Some(id)=&request_id{if let Ok(mut searches)=SEARCHES.get().unwrap().lock(){searches.remove(id);}}
    let source=result.ok_or("SEARCH_CANCELLED")?.map_err(|_| "Сайт слишком долго отвечает. Попробуй ещё раз.".to_string())??;
    crate::preview::remember_source(&url,&source);
    let formats:Vec<_>=source["formats"].as_array().into_iter().flatten().map(|f|serde_json::json!({"format_id":f["format_id"],"height":f["height"],"vcodec":f["vcodec"],"acodec":f["acodec"],"ext":f["ext"]})).collect();
    let storyboard=source["formats"].as_array().and_then(|formats|formats.iter().filter(|f|f["protocol"]=="mhtml"&&f["fragments"].is_array()).min_by_key(|f|f["width"].as_u64().unwrap_or(1000).abs_diff(160))).cloned();
    let playable=source["formats"].as_array().and_then(|formats|formats.iter().filter(|f|f["vcodec"].as_str().is_some_and(|c|c!="none")&&f["protocol"].as_str().is_some_and(|p|p=="https"||p=="http")&&f["url"].as_str().is_some()).min_by_key(|f|{let muxed=f["acodec"].as_str().is_some_and(|c|c!="none");(if muxed{0}else{10000})+f["height"].as_u64().unwrap_or(360).abs_diff(360)}));
    let sound=playable.filter(|f|f["acodec"].as_str().is_some_and(|c|c!="none")).or_else(||source["formats"].as_array().and_then(|formats|formats.iter().find(|f|f["vcodec"]=="none"&&f["acodec"].as_str().is_some_and(|c|c!="none")&&f["url"].is_string())));
    let video_url=playable.map(|f|f["url"].clone()).unwrap_or_else(||source["url"].clone());
    let audio_url=sound.map(|f|f["url"].clone()).unwrap_or_else(||video_url.clone());
    let thumbnail=source["thumbnails"].as_array().and_then(|items|items.iter().filter(|f|f["url"].is_string()&&f["width"].as_u64().is_some_and(|w|w>=240)).min_by_key(|f|f["width"].as_u64().unwrap_or(1000))).map(|f|f["url"].clone()).unwrap_or_else(||source["thumbnail"].clone());
    let thumb_dimensions=source["thumbnails"].as_array().and_then(|items|items.iter().find(|t|t["url"]==thumbnail));
    let value=serde_json::json!({"title":source["title"],"uploader":source["uploader"],"channel":source["channel"],"duration":source["duration"],"thumbnail":thumbnail,"thumbnail_full":full_thumbnail(&source),"thumbnail_width":thumb_dimensions.map(|t|t["width"].clone()),"thumbnail_height":thumb_dimensions.map(|t|t["height"].clone()),"storyboard":storyboard,"video_url":video_url,"audio_url":audio_url,"formats":formats});
    if let Ok(mut entries)=cache.lock(){entries.retain(|_,(time,_)|time.elapsed()<Duration::from_secs(600));if entries.len()>=16{if let Some(oldest)=entries.iter().min_by_key(|(_,entry)|entry.0).map(|(key,_)|key.clone()){entries.remove(&oldest);}}entries.insert(url,(Instant::now(),value.clone()));}
    Ok(value)
}

#[cfg(test)]mod tests{
    use super::{source_error,full_thumbnail};
    #[test]fn full_cover_uses_largest_image(){let source=serde_json::json!({"thumbnail":"small","thumbnails":[{"url":"large","width":1920,"height":1080},{"url":"small","width":320,"height":180},{"url":"square","width":1080,"height":1080}]});assert_eq!(full_thumbnail(&source),"large");}
    #[test]fn full_cover_falls_back_without_dimensions(){assert_eq!(full_thumbnail(&serde_json::json!({"thumbnail":"preferred","thumbnails":[{"url":"other"}]})),"preferred");assert_eq!(full_thumbnail(&serde_json::json!({"thumbnails":[{"url":"first"},{"url":"last"}]})),"last");assert_eq!(full_thumbnail(&serde_json::json!({})),serde_json::Value::Null); }
    #[test]fn unsupported_source_has_specific_message(){let error=source_error("ERROR: Unsupported URL: https://example.com/");assert!(error.starts_with("UNSUPPORTED_SOURCE"));assert!(error.contains("https://example.com/"));assert!(!source_error("ERROR: Sign in to confirm your age").contains("UNSUPPORTED_SOURCE"));}
}
