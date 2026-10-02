//! Development-only loopback bridge. The installed application uses Tauri IPC.
use std::sync::{Arc,Mutex};
use axum::{Router,Json,extract::{State,Request},middleware::{self,Next},response::{Response,IntoResponse},http::{StatusCode,Method,HeaderValue},routing::{get,post}};
use serde::Deserialize;
use serde_json::{json,Value};
use tauri::{Listener,Manager};

const ORIGIN:&str="http://127.0.0.1:5174";
#[derive(Clone)]
struct Bridge {app:tauri::AppHandle,token:String,events:Arc<Mutex<(u64,Vec<Value>)>>}

async fn guard(State(state):State<Bridge>,request:Request,next:Next)->Response {
    let headers=request.headers();
    if headers.get("origin").and_then(|v|v.to_str().ok())!=Some(ORIGIN)
        ||headers.get("host").and_then(|v|v.to_str().ok())!=Some("127.0.0.1:5175") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response=if request.method()==Method::OPTIONS {StatusCode::NO_CONTENT.into_response()}
    else if request.uri().path()!="/session"&&headers.get("authorization").and_then(|v|v.to_str().ok())!=Some(format!("Bearer {}",state.token).as_str()) {StatusCode::UNAUTHORIZED.into_response()}
    else {next.run(request).await};
    response.headers_mut().insert("access-control-allow-origin",HeaderValue::from_static(ORIGIN));
    response.headers_mut().insert("access-control-allow-methods",HeaderValue::from_static("GET, POST, OPTIONS"));
    response.headers_mut().insert("access-control-allow-headers",HeaderValue::from_static("authorization, content-type"));
    response.headers_mut().insert("cache-control",HeaderValue::from_static("no-store"));
    response
}
async fn session(State(state):State<Bridge>)->Json<Value>{Json(json!({"token":state.token}))}
#[derive(Deserialize)]struct Rpc {command:String,args:Value}
async fn rpc(State(state):State<Bridge>,Json(input):Json<Rpc>)->Json<Value>{
    let result:Result<Value,String>=async {
        match input.command.as_str(){
            "analyze_media"=>crate::media::analyze_media(state.app.clone(),input.args["url"].as_str().ok_or("Нет ссылки")?.into(),input.args["requestId"].as_str().map(String::from)).await,
            "cancel_analysis"=>crate::media::cancel_analysis(input.args["id"].as_str().ok_or("Нет поиска")?.into()).map(|_|Value::Null),
            "downloads_folder"=>crate::downloads_folder(state.app.clone()).map(|value|json!(value)),
            "choose_folder"=>crate::choose_folder().await.map(|value|json!(value)),
            "project_folder"=>crate::preview::project_folder().map(|value|json!(value)),
            "preview_video"=>crate::preview::preview_video(state.app.clone(),input.args["url"].as_str().ok_or("Нет ссылки")?.into()).await,
            "preview_frame"=>crate::preview::preview_frame(state.app.clone(),input.args["url"].as_str().ok_or("Нет ссылки")?.into(),input.args["time"].as_f64().ok_or("Нет времени")?).await,
            "recent_downloads"=>crate::history::recent_downloads(state.app.clone()).await.map(|value|json!(value)),
            "download_thumbnail"=>crate::history::download_thumbnail(state.app.clone(),input.args["id"].as_str().ok_or("Нет загрузки")?.into()).await.map(|value|json!(value)),
            "save_cover"=>crate::jobs::save_cover(state.app.clone(),input.args["url"].as_str().ok_or("Нет обложки")?.into(),input.args["title"].as_str().unwrap_or("cover").into(),input.args["folder"].as_str().ok_or("Нет папки")?.into()).await,
            "open_download"=>crate::history::open_download(state.app.clone(),input.args["id"].as_str().ok_or("Нет загрузки")?.into(),input.args["reveal"].as_bool().unwrap_or(false)).await.map(|_|Value::Null),
            "start_download"=>{
                let request=serde_json::from_value(input.args["request"].clone()).map_err(|e|e.to_string())?;
                crate::jobs::start_download(state.app.clone(),state.app.state::<crate::jobs::Jobs>(),request).await.map(|value|json!(value))
            },
            "cancel_download"=>crate::jobs::cancel_download(state.app.state::<crate::jobs::Jobs>(),input.args["id"].as_str().ok_or("Нет загрузки")?.into()).map(|_|Value::Null),
            "progress"=>{
                let after=input.args["after"].as_u64().unwrap_or(0);
                let events=state.events.lock().map_err(|_|"События недоступны")?;
                Ok(json!({"cursor":events.0,"events":events.1.iter().filter(|event|event["sequence"].as_u64().unwrap_or(0)>after).collect::<Vec<_>>()}))
            },
            _=>Err("Неизвестная команда".into())
        }
    }.await;
    Json(match result{Ok(value)=>json!({"result":value}),Err(error)=>json!({"error":error})})
}

pub async fn serve(app:tauri::AppHandle)->Result<(),String>{
    let state=Bridge{app:app.clone(),token:uuid::Uuid::new_v4().to_string(),events:Arc::new(Mutex::new((0,Vec::new())))};
    let events=state.events.clone();
    app.listen("download-progress",move |event|{
        if let Ok(value)=serde_json::from_str::<Value>(event.payload()){
            if let Ok(mut events)=events.lock(){events.0+=1;let sequence=events.0;events.1.push(json!({"sequence":sequence,"payload":value}));if events.1.len()>100{events.1.remove(0);}}
        }
    });
    let router=Router::new().route("/session",get(session)).route("/rpc",post(rpc))
        .layer(middleware::from_fn_with_state(state.clone(),guard)).with_state(state);
    let listener=tokio::net::TcpListener::bind("127.0.0.1:5175").await.map_err(|e|format!("Локальный загрузчик: {e}"))?;
    println!("cutload browser backend: http://127.0.0.1:5175");
    axum::serve(listener,router).await.map_err(|e|e.to_string())
}
