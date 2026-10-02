use std::path::PathBuf;
use tauri::Manager;
use tokio::process::Command;

pub fn executable(app: &tauri::AppHandle, name: &str) -> PathBuf {
    let filename = format!("{name}{}", if cfg!(windows) { ".exe" } else { "" });
    if let Ok(resources) = app.path().resource_dir() {
        let candidate = resources.join("binaries").join(&filename);
        if candidate.is_file() { return candidate; }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&filename);
    if cfg!(debug_assertions) && development.is_file() { return development; }
    PathBuf::from(filename)
}
pub fn command(app: &tauri::AppHandle, name: &str) -> Command {
    let mut command = Command::new(executable(app, name));
    #[cfg(windows)] command.creation_flags(0x08000000);
    command.kill_on_drop(true);
    command
}
pub fn validate_url(value: &str) -> Result<(), String> {
    let parsed = url::Url::parse(value).map_err(|_| "Некорректная ссылка".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Нужна ссылка http или https".into());
    }
    Ok(())
}
pub fn safe_title(value: &str) -> String {
    let title: String = value.chars().filter(|c| !c.is_control()).map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).take(120).collect();
    let title = title.trim().trim_end_matches(['.', ' ']);
    let title = if title.is_empty() { "cutload" } else { title };
    // Prefix Windows device names, including names with an extension.
    let stem=title.split('.').next().unwrap_or(title).to_uppercase();
    if matches!(stem.as_str(),"CON"|"PRN"|"AUX"|"NUL") || (stem.len()==4 && (stem.starts_with("COM")||stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) { format!("_{title}") } else { title.to_string() }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_local_commands() { assert!(validate_url("file:///C:/test").is_err()); assert!(validate_url("--exec").is_err()); assert!(validate_url("https://www.youtube.com/watch?v=abc").is_ok()); }
    #[test] fn sanitizes_windows_names() { assert_eq!(safe_title("a/b:c?"),"a_b_c_"); assert_eq!(safe_title("CON.mp4"),"_CON.mp4"); assert_eq!(safe_title("..."),"cutload"); }
}
