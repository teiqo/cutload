use std::{collections::HashMap,path::{Path,PathBuf},sync::{Arc,Mutex,atomic::{AtomicU64,Ordering}},process::Stdio};
use serde::{Deserialize,Serialize};
use tauri::{Emitter,Manager};
use tokio::{io::{AsyncBufReadExt,BufReader},sync::watch};
use crate::tools;

#[derive(Default,Clone)] pub struct Jobs(pub Arc<Mutex<HashMap<String,watch::Sender<bool>>>>);
static COUNTER:AtomicU64=AtomicU64::new(0);
#[tauri::command]
pub async fn save_cover(app:tauri::AppHandle,url:String,title:String,folder:String)->Result<serde_json::Value,String>{
    tools::validate_url(&url)?;let folder=PathBuf::from(folder);if !folder.is_dir(){return Err("Выбери существующую папку сохранения".into())}
    let id=format!("cover-{}",uuid::Uuid::new_v4());let temporary=folder.join(format!(".cutload-{id}.jpg"));
    let name=tools::safe_title(&title);let mut path=folder.join(format!("{name} — cover.jpg"));let mut suffix=1;while path.exists(){path=folder.join(format!("{name} — cover ({suffix}).jpg"));suffix+=1}
    let mut command=tools::command(&app,"ffmpeg");command.args(["-hide_banner","-loglevel","error","-nostdin","-n","-rw_timeout","10000000","-i"]).arg(&url).args(["-frames:v","1","-q:v","2"]).arg(&temporary);command.kill_on_drop(true);
    let result=async{let output=tokio::time::timeout(std::time::Duration::from_secs(20),command.output()).await.map_err(|_|"Обложка слишком долго загружается")?.map_err(|e|e.to_string())?;if !output.status.success(){return Err("Не удалось скачать обложку".into())}
        tokio::fs::hard_link(&temporary,&path).await.map_err(|e|e.to_string())?;crate::history::record(&app,&id,&title,&path,Some(&url)).await?;Ok(serde_json::json!({"id":id,"path":path.to_string_lossy()}))}.await;
    let _=tokio::fs::remove_file(temporary).await;result
}
#[derive(Deserialize,Clone)] pub struct DownloadRequest {
    url:String,title:String,folder:String,quality:String,codec:String,format:String,audio:bool,duration:Option<f64>,start:Option<f64>,end:Option<f64>,#[serde(default)]thumbnail:Option<String>
}
#[derive(Serialize,Clone)] pub struct Progress { id:String,stage:String,percent:Option<f64>,message:String,path:Option<String>,downloaded_bytes:Option<f64>,total_bytes:Option<f64>,eta:Option<f64> }
fn emit(app:&tauri::AppHandle,id:&str,stage:&str,percent:Option<f64>,message:&str,path:Option<&Path>) {
    let _=app.emit("download-progress",Progress{id:id.into(),stage:stage.into(),percent,message:message.into(),path:path.map(|p|p.to_string_lossy().into_owned()),downloaded_bytes:None,total_bytes:None,eta:None});
}
fn transfer_progress(id:&str,value:&str)->Option<Progress>{
    let data:serde_json::Value=serde_json::from_str(value).ok()?;
    let number=|key:&str|data[key].as_f64().filter(|n|n.is_finite()&&*n>=0.);
    let downloaded_bytes=number("downloaded_bytes");
    let total_bytes=number("total_bytes").or_else(||number("total_bytes_estimate"));
    let percent=downloaded_bytes.zip(total_bytes).filter(|(_,total)|*total>0.).map(|(done,total)|(done/total*80.).clamp(0.,80.));
    Some(Progress{id:id.into(),stage:"downloading".into(),percent,message:"скачивание".into(),path:None,downloaded_bytes,total_bytes,eta:number("eta")})
}
fn emit_transfer(app:&tauri::AppHandle,id:&str,value:&str){if let Some(progress)=transfer_progress(id,value){let _=app.emit("download-progress",progress);}}

fn validate(request:&DownloadRequest)->Result<(),String> {
    tools::validate_url(&request.url)?;
    if !Path::new(&request.folder).is_dir(){return Err("Выбери существующую папку сохранения".into())}
    if !matches!(request.quality.as_str(),"auto"|"2160"|"1440"|"1080"|"720"|"480"|"360"|"audio"){return Err("Неизвестное качество".into())}
    let valid=if request.audio { matches!((request.format.as_str(),request.codec.as_str()),("webm","original")|("mp3","mp3")|("m4a","aac")|("opus","opus")|("flac","flac")|("wav","wav")) } else { matches!((request.format.as_str(),request.codec.as_str()),("mp4","original")|("mp4","h264")|("mp4","hevc")|("mp4","av1")|("webm","vp9")) };
    if !valid{return Err("Несовместимые формат и кодек".into())}
    match (request.start,request.end) {
        (None,None)=>(),(Some(start),Some(end)) if start.is_finite()&&end.is_finite()&&start>=0.&&end-start>=5.=>(),_=>return Err("Фрагмент должен быть не короче 5 секунд".into())
    }
    Ok(())
}

#[tauri::command]
pub async fn start_download(app:tauri::AppHandle,jobs:tauri::State<'_,Jobs>,request:DownloadRequest)->Result<String,String> {
    validate(&request)?;
    let id=format!("{}-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),COUNTER.fetch_add(1,Ordering::Relaxed));
    let (sender,receiver)=watch::channel(false);
    {let mut registry=jobs.0.lock().map_err(|_|"Менеджер загрузок недоступен")?;if !registry.is_empty(){return Err("Сначала дождись текущей загрузки или отмени её".into())}registry.insert(id.clone(),sender);}
    let registry=jobs.0.clone();let job_id=id.clone();
    tauri::async_runtime::spawn(async move {
        let result=run(&app,&job_id,request,receiver).await;
        if let Err(error)=result {let cancelled=error=="cancelled";emit(&app,&job_id,if cancelled{"cancelled"}else{"error"},None,if cancelled{"Загрузка отменена"}else{&error},None)}
        if let Ok(mut jobs)=registry.lock(){jobs.remove(&job_id);}
    });
    Ok(id)
}
#[tauri::command]
pub fn cancel_download(jobs:tauri::State<'_,Jobs>,id:String)->Result<(),String>{
    if let Some(sender)=jobs.0.lock().map_err(|_|"Менеджер загрузок недоступен")?.get(&id){let _=sender.send(true);}Ok(())
}

async fn process(app:&tauri::AppHandle,id:&str,mut command:tokio::process::Command,mut cancel:watch::Receiver<bool>,duration:Option<f64>,stage:&str,explanation:&str)->Result<Vec<String>,String>{
    if *cancel.borrow(){return Err("cancelled".into())}
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child=command.spawn().map_err(|e|format!("Не удалось запустить обработчик: {e}"))?;
    let pid=child.id();
    let mut stdout=BufReader::new(child.stdout.take().unwrap()).lines();let mut stderr=BufReader::new(child.stderr.take().unwrap()).lines();
    let(mut out_open,mut err_open)=(true,true);let mut paths=Vec::new();let mut errors=Vec::new();let mut exit=None;
    while out_open||err_open||exit.is_none(){
        tokio::select!{
            _=cancel.changed()=>{
                #[cfg(windows)] if let Some(pid)=pid {let mut kill=tokio::process::Command::new("taskkill.exe");kill.creation_flags(0x08000000);let _=kill.args(["/PID",&pid.to_string(),"/T","/F"]).output().await;}
                let _=child.kill().await;let _=child.wait().await;return Err("cancelled".into())
            }
            line=stdout.next_line(),if out_open=>{match line.map_err(|e|e.to_string())? {
                Some(line)=>{
                    if let Some(path)=line.strip_prefix("FILE:"){if let Ok(path)=serde_json::from_str::<String>(path){paths.push(path)}}
                    else if let Some(value)=line.strip_prefix("PROGRESS:"){emit_transfer(app,id,value)}
                    else if let Some(value)=line.strip_prefix("out_time_us="){if let (Ok(us),Some(seconds))=(value.parse::<f64>(),duration){if seconds>0.{emit(app,id,stage,Some((80.+us/1_000_000./seconds*20.).clamp(80.,99.9)),explanation,None)}}}
                },None=>out_open=false
            }}
            line=stderr.next_line(),if err_open=>{match line.map_err(|e|e.to_string())?{Some(line)=>{if let Some(value)=line.strip_prefix("PROGRESS:"){emit_transfer(app,id,value)}else{errors.push(line);if errors.len()>12{errors.remove(0);}}},None=>err_open=false}}
            result=child.wait(),if exit.is_none()=>{exit=Some(result.map_err(|e|e.to_string())?);}
        }
    }
    if !exit.unwrap().success(){return Err(errors.join("\n").chars().take(1600).collect())}Ok(paths)
}

async fn run(app:&tauri::AppHandle,id:&str,request:DownloadRequest,cancel:watch::Receiver<bool>)->Result<(),String>{
    let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("jobs");let work=root.join(id);
    tokio::fs::create_dir_all(&work).await.map_err(|e|e.to_string())?;
    let result=run_inner(app,id,&request,cancel,&work).await;
    // This directory is generated exclusively for this job, never a user-provided path.
    let _=tokio::fs::remove_dir_all(&work).await;
    result
}
fn track_codec(output:&str,kind:&str)->String {
    output.lines().find_map(|line|line.split_once(&format!(": {kind}: ")).map(|(_,detail)|detail.split([' ', ',']).next().unwrap_or("").to_string())).unwrap_or_default()
}
fn can_copy(codec:&str,source:&str,trim:bool)->bool { !trim&&!source.is_empty()&&codec==source }
fn video_height(output:&str)->Option<u32>{output.lines().filter(|line|line.contains(": Video: ")).flat_map(|line|line.split_whitespace()).find_map(|word|{let (w,h)=word.trim_end_matches(',').split_once('x')?;if w.parse::<u32>().is_ok(){h.parse().ok()}else{None}})}
async fn codecs(app:&tauri::AppHandle,source:&Path,mut cancel:watch::Receiver<bool>)->Result<(String,String,Option<u32>),String>{
    let mut probe=tools::command(app,"ffmpeg");probe.args(["-hide_banner","-nostdin","-i"]).arg(source);
    tokio::select! {
        _=cancel.changed()=>Err("cancelled".into()),
        output=tokio::time::timeout(std::time::Duration::from_secs(10),probe.output())=>{
            let stderr=output.ok().and_then(Result::ok).map(|output|String::from_utf8_lossy(&output.stderr).into_owned()).unwrap_or_default();
            Ok((track_codec(&stderr,"Video"),track_codec(&stderr,"Audio"),video_height(&stderr)))
        }
    }
}
async fn run_inner(app:&tauri::AppHandle,id:&str,r:&DownloadRequest,cancel:watch::Receiver<bool>,work:&Path)->Result<(),String>{
    emit(app,id,"downloading",Some(0.),"подключение к источнику",None);
    let selector=if r.audio {"bestaudio/best".into()}else if r.quality=="auto"{"bestvideo+bestaudio/best".into()}else{format!("bestvideo[height={}]+bestaudio/best[height={}]/bestvideo[height>={}]+bestaudio/best[height>={}]/bestvideo+bestaudio/best",r.quality,r.quality,r.quality,r.quality)};
    let mut download=tools::command(app,"yt-dlp");
    download.args(["--ignore-config","--no-playlist","--no-warnings","--newline","--progress","--no-simulate","--concurrent-fragments","8","--socket-timeout","20","--progress-template","download:PROGRESS:%(progress)j","--print","after_move:FILE:%(filepath)j","--merge-output-format","mkv","--ffmpeg-location"]);
    download.arg(tools::executable(app,"ffmpeg")).arg("-f").arg(selector).arg("-o").arg(work.join("source.%(ext)s")).arg("--").arg(&r.url);
    let paths=process(app,id,download,cancel.clone(),None,"downloading","получаю файл с сайта").await?;
    let source=PathBuf::from(paths.last().ok_or("yt-dlp не вернул путь к файлу")?);
    if !source.starts_with(work)||!source.is_file(){return Err("Некорректный путь результата загрузки".into())}
    let extension=&r.format;
    let title=tools::safe_title(&r.title);let mut output=PathBuf::from(&r.folder).join(format!("{title}.{extension}"));
    let mut suffix=1;while output.exists(){output=PathBuf::from(&r.folder).join(format!("{title} ({suffix}).{extension}"));suffix+=1;}
    let temporary=PathBuf::from(&r.folder).join(format!(".cutload-{id}.{extension}"));
    let requested_height=if r.audio{None}else{r.quality.parse::<u32>().ok()};
    let (source_video,source_audio,source_height)=if r.codec!="original"||requested_height.is_some(){codecs(app,&source,cancel.clone()).await?}else{(String::new(),String::new(),None)};
    let resize=requested_height.is_some_and(|target|source_height.map(|height|height>target).unwrap_or(true));
    let needs_processing=resize||r.codec!="original"||r.start.is_some()||source.extension().and_then(|e|e.to_str())!=Some(extension.as_str());
    let video_target=match r.codec.as_str(){"h264"=>"h264","hevc"=>"hevc","av1"=>"av1","vp9"=>"vp9",_=>""};
    let audio_target=if r.audio {match r.codec.as_str(){"wav"=>"pcm_s16le",value=>value}}else{match r.codec.as_str(){"h264"=>"mp3","hevc"=>"aac","av1"|"vp9"=>"opus",_=>""}};
    let copy_video=!resize&&can_copy(video_target,&source_video,r.start.is_some());
    let copy_audio=can_copy(audio_target,&source_audio,r.start.is_some());
    let explanation=if r.start.is_some(){"вырезаю выбранный фрагмент; точные границы требуют обработки"}else if r.codec=="original"||(copy_audio&&(r.audio||copy_video)){"кодеки подходят: меняю контейнер без перекодирования"}else if copy_video{"видео уже подходит: копирую его и преобразую только звук"}else{"исходный кодек отличается: преобразую файл в выбранный формат"};
    let result=async {
        if needs_processing {
            emit(app,id,"processing",Some(80.),explanation,None);
            let mut ffmpeg=tools::command(app,"ffmpeg");ffmpeg.args(["-hide_banner","-nostdin","-n","-i"]).arg(&source);
            if let (Some(start),Some(end))=(r.start,r.end){ffmpeg.arg("-ss").arg(start.to_string()).arg("-t").arg((end-start).to_string());}
            if r.audio {ffmpeg.args(["-vn","-map","0:a:0"]);match r.codec.as_str(){"mp3"=>{ffmpeg.args(["-c:a","libmp3lame","-q:a","2"]);},"aac"=>{ffmpeg.args(["-c:a","aac","-b:a","192k"]);},"opus"=>{ffmpeg.args(["-c:a","libopus","-b:a","160k"]);},"flac"=>{ffmpeg.args(["-c:a","flac"]);},"wav"=>{ffmpeg.args(["-c:a","pcm_s16le"]);},_=>{ffmpeg.args(["-c:a","copy"]);}}}
            else {match r.codec.as_str(){"h264"=>{ffmpeg.args(["-c:v","libx264","-preset","fast","-crf","20","-c:a","libmp3lame","-q:a","2"]);},"hevc"=>{ffmpeg.args(["-c:v","libx265","-preset","fast","-crf","24","-c:a","aac","-b:a","192k"]);},"av1"=>{ffmpeg.args(["-c:v","libsvtav1","-preset","8","-crf","30","-c:a","libopus"]);},"vp9"=>{ffmpeg.args(["-c:v","libvpx-vp9","-deadline","good","-cpu-used","4","-crf","30","-b:v","0","-c:a","libopus"]);},_=>{ffmpeg.args(["-c","copy"]);}}}
            if !r.audio {ffmpeg.args(["-map","0:v:0?","-map","0:a:0?"]);}
            // Later per-stream options override the encoder only when its input
            // already matches. Exact fragment cuts still use the selected encoder.
            if !r.audio&&copy_video {ffmpeg.args(["-c:v","copy"]);}
            if resize{ffmpeg.arg("-vf").arg(format!("scale=-2:'min(ih,{})'",r.quality));if r.codec=="original"{ffmpeg.args(["-c:v","libx264","-preset","fast","-crf","20","-c:a","aac","-b:a","192k"]);}}
            if copy_audio {ffmpeg.args(["-c:a","copy"]);}
            if !r.audio&&r.format=="mp4"{ffmpeg.args(["-movflags","+faststart"]);}
            ffmpeg.args(["-progress","pipe:1","-nostats"]).arg(&temporary);
            process(app,id,ffmpeg,cancel.clone(),r.end.zip(r.start).map(|(end,start)|end-start).or(r.duration),"processing",explanation).await?;
        }else{tokio::fs::copy(&source,&temporary).await.map_err(|e|e.to_string())?;}
        if *cancel.borrow(){return Err("cancelled".to_string())}
        // Same-directory hard link publishes the finished file without a second
        // full-file copy on NTFS. It cannot overwrite an existing destination.
        if tokio::fs::hard_link(&temporary,&output).await.is_ok(){let _=crate::history::record(app,id,&r.title,&output,r.thumbnail.as_deref()).await;emit(app,id,"complete",Some(100.),"готово",Some(&output));return Ok(())}
        // Filesystems without hard links retain the no-overwrite copy fallback.
        let mut destination=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&output).await.map_err(|e|e.to_string())?;
        let mut input=tokio::fs::File::open(&temporary).await.map_err(|e|e.to_string())?;
        if let Err(error)=tokio::io::copy(&mut input,&mut destination).await{drop(destination);let _=tokio::fs::remove_file(&output).await;return Err(error.to_string())}
        let _=crate::history::record(app,id,&r.title,&output,r.thumbnail.as_deref()).await;
        emit(app,id,"complete",Some(100.),"готово",Some(&output));Ok(())
    }.await;
    let _=tokio::fs::remove_file(&temporary).await;result
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn transfer_metrics_handle_estimates_and_unknown_eta(){let p=transfer_progress("test",r#"{"downloaded_bytes":5000000,"total_bytes":null,"total_bytes_estimate":10000000,"eta":12}"#).unwrap();assert_eq!(p.percent,Some(40.));assert_eq!(p.total_bytes,Some(10000000.));assert_eq!(p.eta,Some(12.));let p=transfer_progress("test",r#"{"downloaded_bytes":20,"eta":null}"#).unwrap();assert_eq!(p.percent,None);assert_eq!(p.eta,None);assert!(transfer_progress("test","not json").is_none());}
    #[test]fn compatible_tracks_copy_but_precise_trims_encode(){assert!(can_copy("h264","h264",false));assert!(!can_copy("h264","av1",false));assert!(!can_copy("h264","h264",true));assert!(!can_copy("","",false));assert_eq!(track_codec("  Stream #0:0: Video: h264 (High), yuv420p","Video"),"h264");}
    #[test]fn reads_dimensions_for_copy_and_downscale_decision(){assert_eq!(video_height("Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1], 30 fps"),Some(1080));assert_eq!(video_height("Stream #0:0: Audio: mp3, 44100 Hz"),None);}
    #[test]fn rejects_invalid_codec_and_short_trim(){let mut r=DownloadRequest{url:"https://example.com/video".into(),title:"test".into(),folder:std::env::temp_dir().to_string_lossy().into(),quality:"1080".into(),codec:"h264".into(),format:"mp4".into(),audio:false,duration:None,start:Some(1.),end:Some(5.),thumbnail:None};assert!(validate(&r).is_err());r.end=Some(6.);assert!(validate(&r).is_ok());r.format="webm".into();assert!(validate(&r).is_err());}
}
