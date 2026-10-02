export function explainError(raw:string,english=false){
  const t=(ru:string,en:string)=>english?en:ru;
  const rules:[RegExp,string,string,string,string,boolean][]=[
    [/UNSUPPORTED_SOURCE|Unsupported URL/i,'источник не поддерживается','source is not supported','вставь прямую ссылку на видео или ссылку с другого сервиса','use a direct media link or another service',false],
    [/Некорректная ссылка|Нужна ссылка|Invalid URL/i,'проверь ссылку','check the link','вставь полную ссылку, начинающуюся с https://','paste a complete link starting with https://',false],
    [/proxy|502|503|Bad Gateway|Tunnel connection/i,'источник сейчас недоступен','the source is currently unavailable','проверь соединение и настройки прокси, затем попробуй ещё раз','check your connection and proxy settings, then retry',true],
    [/timeout|timed out|долго отвечает/i,'источник отвечает слишком долго','the source is taking too long','проверь интернет или попробуй ещё раз немного позже','check your connection or retry in a moment',true],
    [/429|Too Many Requests/i,'сервис временно ограничил запросы','the service is limiting requests','подожди несколько минут и повтори попытку','wait a few minutes and retry',true],
    [/Sign in|login|private|age.?restricted|members.only|403|Forbidden/i,'доступ к видео ограничен','access to this video is restricted','проверь, открывается ли ссылка на сайте; выбери доступное видео','check the link on its website or choose a publicly available video',false],
    [/unavailable|removed|404|not found|Нет файла|перемещён|удалён/i,'видео или файл не найден','video or file was not found','проверь ссылку или расположение файла','check the link or file location',false],
    [/No space|ENOSPC|disk full|недостаточно места/i,'на диске не хватает места','there is not enough disk space','освободи место или выбери другую папку','free up space or choose another folder',false],
    [/Permission denied|Access is denied|доступ.*запрещ|папк/i,'не удалось сохранить файл','could not save the file','выбери существующую папку, в которую разрешена запись','choose an existing writable folder',false],
    [/Requested format.*not available|No video formats/i,'нужный формат недоступен','the requested format is unavailable','выбери авто · макс или другое качество','choose auto · max or another quality',false],
    [/ffmpeg|encode|codec|конверт|перекод/i,'не удалось подготовить файл','could not prepare the file','попробуй mp4 с h264 + mp3 или оригинальный кодек','try mp4 with h264 + mp3 or the original codec',false],
    [/локальн|Failed to fetch|NetworkError|connection|network|соединени/i,'соединение с загрузчиком потеряно','connection to the downloader was lost','проверь интернет и перезапусти локальный загрузчик, затем повтори действие','check your connection and restart the local downloader, then retry',true],
  ];
  const found=rules.find(([pattern])=>pattern.test(raw));
  return {title:found?t(found[1],found[2]):t('не удалось выполнить действие','could not complete the action'),action:found?t(found[3],found[4]):t('попробуй ещё раз; если ошибка повторится, открой подробности','retry; if the error persists, open details'),details:raw,retry:found?.[5]??true};
}
export function errorExplanation(raw:string,english=false){
  const explanation=explainError(raw,english),box=document.createElement('div'),label=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),full=document.createElement('pre');
  label.textContent=`${explanation.title}. ${explanation.action}`;details.className='error-details';summary.textContent=english?'details':'подробнее';full.textContent=raw;details.append(summary,full);box.append(label,details);return box;
}
