use std::{sync::atomic::{AtomicBool,Ordering},time::Duration};
use serde::Deserialize;
use sha2::{Digest,Sha256};
use tauri::{Emitter,Manager};
use tokio::io::AsyncWriteExt;

static UPDATING:AtomicBool=AtomicBool::new(false);
const API:&str="https://api.github.com/repos/teiqo/cutload/releases/latest";
const LIMIT:u64=300*1024*1024;
#[derive(Deserialize)] struct Asset{name:String,browser_download_url:String,size:u64,digest:Option<String>}
#[derive(Deserialize)] struct Release{tag_name:String,draft:bool,prerelease:bool,assets:Vec<Asset>}
fn select(release:Release,current:&str)->Result<(Asset,String),String>{
    let version=release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    let next=semver::Version::parse(version).map_err(|_|"Неверная версия обновления")?;
    let installed=semver::Version::parse(current).map_err(|_|"Неверная версия приложения")?;
    if release.draft||release.prerelease||!next.pre.is_empty()||next<=installed{return Err("Установлена актуальная версия".into())}
    let name=format!("cutload_{version}_x64-setup.exe");
    let asset=release.assets.into_iter().find(|a|a.name==name).ok_or("Установщик этой версии не найден")?;
    let expected=format!("https://github.com/teiqo/cutload/releases/download/{}/{}",release.tag_name,name);
    if asset.browser_download_url!=expected||asset.size==0||asset.size>LIMIT{return Err("Неверный файл обновления".into())}
    let digest=asset.digest.as_deref().and_then(|d|d.strip_prefix("sha256:")).ok_or("У обновления отсутствует контрольная сумма")?;
    if digest.len()!=64||!digest.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Неверная контрольная сумма обновления".into())}
    let digest=digest.to_ascii_lowercase();Ok((asset,digest))
}
fn progress(app:&tauri::AppHandle,stage:&str,percent:u64){let _=app.emit("app-update-progress",serde_json::json!({"stage":stage,"percent":percent}));}
async fn install(app:&tauri::AppHandle)->Result<(),String>{
    if cfg!(debug_assertions){return Err("Обновление устанавливается только в установленном приложении".into())}
    let client=reqwest::Client::builder().user_agent("cutload-updater").connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(600)).build().map_err(|e|e.to_string())?;
    progress(app,"checking",0);
    let release:Release=client.get(API).header("Accept","application/vnd.github+json").send().await.map_err(|_|"Не удалось проверить обновление. Проверь интернет")?.error_for_status().map_err(|_|"GitHub временно недоступен. Попробуй позже")?.json().await.map_err(|_|"Не удалось прочитать сведения об обновлении")?;
    let (asset,digest)=select(release,&app.package_info().version.to_string())?;
    let directory=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("updates").join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&directory).await.map_err(|_|"Не удалось создать папку обновления")?;
    let partial=directory.join("installer.part");let installer=directory.join(&asset.name);
    let result=async{
        let mut response=client.get(&asset.browser_download_url).send().await.map_err(|_|"Не удалось скачать обновление. Проверь интернет")?.error_for_status().map_err(|_|"Установщик временно недоступен")?;
        let mut file=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&partial).await.map_err(|_|"Не удалось сохранить обновление")?;
        let mut hash=Sha256::new();let mut downloaded=0u64;let mut last=101;
        progress(app,"downloading",0);
        while let Some(chunk)=response.chunk().await.map_err(|_|"Загрузка обновления прервалась. Попробуй ещё раз")?{
            downloaded+=chunk.len() as u64;if downloaded>asset.size||downloaded>LIMIT{return Err("Размер обновления не совпадает".into())}
            file.write_all(&chunk).await.map_err(|_|"Не удалось записать обновление. Проверь свободное место")?;hash.update(&chunk);
            let percent=downloaded*100/asset.size;if percent!=last{last=percent;progress(app,"downloading",percent);}
        }
        file.flush().await.map_err(|e|e.to_string())?;drop(file);
        if downloaded!=asset.size||format!("{:x}",hash.finalize())!=digest{return Err("Проверка файла не прошла. Повтори загрузку обновления".into())}
        tokio::fs::rename(&partial,&installer).await.map_err(|e|e.to_string())?;
        progress(app,"installing",100);
        // Tauri NSIS passive update mode installs to the existing location and
        // restarts the app after success. The current process releases its files.
        std::process::Command::new(&installer).args(["/P","/UPDATE","/R"]).spawn().map_err(|_|"Не удалось запустить установщик. Попробуй ещё раз")?;
        Ok(())
    }.await;
    if result.is_err(){let _=tokio::fs::remove_file(&partial).await;let _=tokio::fs::remove_file(&installer).await;let _=tokio::fs::remove_dir(&directory).await;}
    result
}
#[tauri::command]
pub async fn install_update(app:tauri::AppHandle,jobs:tauri::State<'_,crate::jobs::Jobs>)->Result<(),String>{
    if UPDATING.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err("Обновление уже устанавливается".into())}
    {
        let mut registry=jobs.0.lock().map_err(|_|{UPDATING.store(false,Ordering::SeqCst);"Не удалось проверить текущие загрузки"})?;
        if !registry.is_empty(){UPDATING.store(false,Ordering::SeqCst);return Err("Сначала дождись загрузки файла или отмени её".into())}
        registry.insert("app-update".into(),tokio::sync::watch::channel(false).0);
    }
    let result=install(&app).await;
    if let Ok(mut registry)=jobs.0.lock(){registry.remove("app-update");}
    UPDATING.store(false,Ordering::SeqCst);
    if result.is_ok(){app.exit(0);}result
}
#[cfg(test)] mod tests{
    use super::*;
    fn release(tag:&str)->Release{Release{tag_name:tag.into(),draft:false,prerelease:false,assets:vec![Asset{name:format!("cutload_{}_x64-setup.exe",tag.trim_start_matches('v')),browser_download_url:format!("https://github.com/teiqo/cutload/releases/download/{tag}/cutload_{}_x64-setup.exe",tag.trim_start_matches('v')),size:100,digest:Some(format!("sha256:{}","a".repeat(64)))}]}}
    #[test] fn newer_only(){assert!(select(release("v1.0.2"),"1.0.1").is_ok());assert!(select(release("v1.0.1"),"1.0.1").is_err());assert!(select(release("v1.0.0"),"1.0.1").is_err());assert!(select(release("v1.0.2-beta.1"),"1.0.1").is_err());}
    #[test] fn rejects_wrong_origin_and_hash(){let mut r=release("v1.0.2");r.assets[0].browser_download_url="https://example.com/setup.exe".into();assert!(select(r,"1.0.1").is_err());let mut r=release("v1.0.2");r.assets[0].digest=None;assert!(select(r,"1.0.1").is_err());let mut r=release("v1.0.2");r.assets[0].size=LIMIT+1;assert!(select(r,"1.0.1").is_err());}
}
