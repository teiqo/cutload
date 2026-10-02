export function newerRelease(tag:string,current:string):boolean {
  const parse=(value:string)=>{const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);return match?match.slice(1).map(Number):null};
  const next=parse(tag),installed=parse(current);if(!next||!installed)return false;
  for(let i=0;i<3;i++){if(next[i]!==installed[i])return next[i]>installed[i]}
  return false;
}
