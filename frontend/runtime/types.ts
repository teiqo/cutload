export interface MediaFormat { format_id: string; height?: number; vcodec?: string; acodec?: string; ext?: string }
export interface Storyboard {width:number;height:number;rows:number;columns:number;fps:number;fragments:{url:string;duration:number}[]}
export interface MediaInfo { title:string; uploader?:string; channel?:string; duration?:number; thumbnail?:string; thumbnail_width?:number; thumbnail_height?:number; storyboard?:Storyboard; video_url?:string; audio_url?:string; formats:MediaFormat[] }
export interface DownloadRequest { url:string; title:string; folder:string; quality:string; codec:string; format:string; audio:boolean; thumbnail?:string; duration?:number; start?:number; end?:number }
export interface Progress { id:string; stage:string; percent?:number; message:string; path?:string; downloaded_bytes?:number; total_bytes?:number; eta?:number }
export interface RecentDownload { id:string; title:string; path:string; created:number; thumbnail?:string }
