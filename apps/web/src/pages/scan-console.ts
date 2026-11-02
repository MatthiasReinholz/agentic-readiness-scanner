/**
 * The scan console: what the home page shows while a scan runs. The page posts to
 * /api/scan/stream and animates what the scanner reports as it happens: the five phases,
 * one radar blip and one grid cell per check verdict, a request counter against the
 * budget, and a terminal log. Nothing in it is decoration over a spinner: every cell that
 * lights up is a check the scanner decided. The platform holds streamed responses back
 * until they end, so the page also polls /api/scan/progress/<token>, which the scan request
 * writes as it goes; events carry a sequence number so neither source applies one twice.
 * Without JavaScript the form posts
 * to /scan as before, and a dropped stream falls back to that path too.
 */
import { catalog } from '@agentic-readiness/catalog';
import { escapeHtml } from '@agentic-readiness/core';
import { card } from '@agentic-readiness/ui';

const PHASES: [string, string][] = [
  ['home', 'Home page'],
  ['robots', 'robots.txt'],
  ['sitemap', 'Sitemap'],
  ['sample', 'Sampling'],
  ['checks', `${catalog.checks.length} checks`],
];

/** Styles the console needs beyond the compiled utility classes: animations and colours. */
export const SCAN_CONSOLE_STYLE = `
@view-transition{navigation:auto}
#sc-grid{view-transition-name:check-map}
.sc-radar.sc-handoff{view-transition-name:level-badge}
.sc-cell{display:grid;place-items:center;font:700 10px/1 ui-monospace,monospace;color:hsl(var(--background));width:16px;height:16px;border-radius:3px;background:hsl(var(--muted));border:1px solid hsl(var(--input));transition:background .25s,border-color .25s}
.sc-cell[data-v]{animation:sc-pop .35s ease-out}
.sc-cell[data-v=pass]{background:hsl(var(--success));border-color:hsl(var(--success))}
.sc-cell[data-v=warn]{background:hsl(var(--warning));border-color:hsl(var(--warning))}
.sc-cell[data-v=fail]{background:hsl(var(--destructive));border-color:hsl(var(--destructive))}
.sc-cell[data-v=skip]{background:transparent;border-style:dashed}
.sc-cell[data-v=pass]::after{content:"✓" / ""}.sc-cell[data-v=warn]::after{content:"!" / ""}.sc-cell[data-v=fail]::after{content:"×" / ""}
.sc-cell.sc-wave{animation:sc-wave .6s ease-in-out}
.sc-radar{position:relative;width:72px;height:72px;border-radius:50%;border:1px solid hsl(var(--primary)/.45);background:radial-gradient(circle,hsl(var(--primary)/.08) 0 30%,transparent 31%),radial-gradient(circle,transparent 0 62%,hsl(var(--primary)/.18) 63% 64%,transparent 65%);overflow:hidden;flex:none}
.sc-sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,hsl(var(--primary)/0) 0deg,hsl(var(--primary)/0) 290deg,hsl(var(--primary)/.55) 360deg);animation:sc-spin 1.6s linear infinite}
.sc-blip{position:absolute;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;animation:sc-blip 1.6s ease-out forwards}
.sc-blip[data-v=pass]{background:hsl(var(--success))}.sc-blip[data-v=warn]{background:hsl(var(--warning))}.sc-blip[data-v=fail]{background:hsl(var(--destructive))}.sc-blip[data-v=skip]{background:hsl(var(--muted-foreground))}
.sc-bar{height:6px;border-radius:999px;background:hsl(var(--muted));overflow:hidden}
.sc-fill{height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,hsl(var(--primary)),hsl(var(--primary)/.7),hsl(var(--primary)));background-size:200% 100%;animation:sc-shimmer 1.2s linear infinite;transition:width .4s ease-out}
.sc-phase{display:inline-flex;align-items:center;gap:6px;border:1px solid hsl(var(--border));border-radius:999px;padding:2px 10px;font-size:.78rem;color:hsl(var(--muted-foreground));transition:all .3s}
.sc-phase::before{content:'';width:7px;height:7px;border-radius:50%;background:hsl(var(--border))}
.sc-phase[data-s=active]{color:hsl(var(--foreground));border-color:hsl(var(--primary)/.6)}
.sc-phase[data-s=active]::before{background:hsl(var(--primary));animation:sc-pulse 1s ease-in-out infinite}
.sc-phase[data-s=done]{color:hsl(var(--foreground))}
.sc-phase[data-s=done]::before{background:hsl(var(--success))}
.sc-log{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.76rem;line-height:1.55;height:11.5em;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;mask-image:linear-gradient(to bottom,transparent,#000 30%)}
.sc-log div{flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:sc-in .2s ease-out}
.sc-t{color:hsl(var(--muted-foreground))}.sc-pass{color:hsl(var(--success))}.sc-warn{color:hsl(var(--warning))}.sc-fail{color:hsl(var(--destructive))}.sc-skip{color:hsl(var(--muted-foreground))}
.sc-caret::after{content:'▌';margin-left:2px;animation:sc-caret 1s steps(1) infinite}
@keyframes sc-spin{to{transform:rotate(360deg)}}
@keyframes sc-blip{0%{opacity:0;transform:scale(2.4)}15%{opacity:1;transform:scale(1)}100%{opacity:.55}}
@keyframes sc-pop{0%{transform:scale(.4)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes sc-wave{50%{transform:translateY(-4px)}}
@keyframes sc-shimmer{to{background-position:-200% 0}}
@keyframes sc-pulse{50%{opacity:.35}}
@keyframes sc-in{from{opacity:0;transform:translateY(4px)}}
@keyframes sc-caret{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}.sc-sweep,.sc-fill,.sc-caret::after,.sc-phase[data-s=active]::before{animation:none}.sc-cell[data-v],.sc-cell.sc-wave,.sc-blip,.sc-log div{animation:none}}
`;

/** The console markup, hidden until a scan starts. Grid cells are rendered from the catalog. */
export function scanConsoleMarkup(): string {
  const groups = catalog.groups
    .map((group) => {
      const cells = catalog.checks
        .filter((check) => check.group === group.id)
        .map(
          (check) =>
            `<span class="sc-cell" data-id="${escapeHtml(check.id)}" title="${escapeHtml(`${check.id} ${check.title}`)}"></span>`,
        )
        .join('');
      return `<div class="flex items-center gap-2"><span class="w-7 shrink-0 font-mono text-xs text-muted-foreground" title="${escapeHtml(group.title)}">${escapeHtml(group.id)}</span><span class="flex flex-wrap gap-1">${cells}</span></div>`;
    })
    .join('');
  const phases = PHASES.map(
    ([id, label]) => `<span class="sc-phase" data-phase="${id}">${escapeHtml(label)}</span>`,
  ).join('');
  return `<section id="scan-console" class="${card} mt-6 hidden p-5 sm:p-6" aria-live="polite" aria-busy="true">
<div class="flex items-center gap-4">
<div class="sc-radar" aria-hidden="true"><div class="sc-sweep"></div><div id="sc-blips"></div></div>
<div class="min-w-0 flex-1">
<p class="text-sm text-muted-foreground" id="sc-status">Starting the scan</p>
<h2 class="mt-0.5 truncate text-lg font-semibold tracking-tight" id="sc-host"></h2>
<p class="mt-1 font-mono text-xs text-muted-foreground"><span id="sc-elapsed">0.0 s</span> · <span id="sc-requests">0</span> requests · <span id="sc-checks">0/${catalog.checks.length}</span> checks</p>
</div>
<div class="hidden text-right sm:block"><div class="text-3xl font-extrabold leading-none tabular-nums" id="sc-percent">0%</div></div>
</div>
<div class="sc-bar mt-4" aria-hidden="true"><div class="sc-fill" id="sc-fill"></div></div>
<div class="mt-4 flex flex-wrap gap-2">${phases}</div>
<div class="mt-5 grid gap-1.5" id="sc-grid">${groups}</div>
<div class="mt-5 rounded-lg border border-border bg-muted/40 px-3 py-2"><div class="sc-log" id="sc-log"></div></div>
<p class="mt-3 text-sm text-muted-foreground sc-caret" id="sc-quip"></p>
<p class="mt-3 hidden text-sm" id="sc-error"></p>
</section>`;
}

/**
 * The console script. Plain ES2017 so it runs everywhere the form does; every string from
 * the network is written with textContent, never as markup.
 */
export const SCAN_CONSOLE_SCRIPT = `(function(){
var form=document.getElementById('scan-form');var box=document.getElementById('scan-console');
if(!form||!box||!window.fetch||!window.ReadableStream||!window.TextDecoder||!window.crypto||!crypto.getRandomValues)return;
var $=function(id){return document.getElementById(id)};window.addEventListener('pageswap',function(e){var t=e.viewTransition;if(t){var q=function(){};t.ready.catch(q);t.finished.catch(q);t.updateCallbackDone.catch(q)}});
var QUIPS={
home:['Knocking on the front door. Politely, with a name tag.','User agent: AgenticReadinessScanner. No disguises today.','Following redirects like a well-trained crawler.'],
robots:['Reading robots.txt like the terms and conditions. Because it is.','Checking the guest list: Googlebot, Bingbot, GPTBot, ClaudeBot…','Training crawlers and answer engines are not the same thing. We check both.'],
sitemap:['Unfolding the sitemap. It is always bigger than it looks.','Gunzipping. Hold your breath.','Looking for product URLs among the blog posts.'],
sample:['Picking product pages at random. Deterministically. Do not ask.','The return policy is always in the footer. Always.','Choosing the market you typed, not the one listed first.'],
checks:['Counting GTIN check digits. Mod 10, no calculator.','Asking /.well-known/ucp whether anyone is home.','Parsing JSON-LD. Someone always forgets a comma.','Measuring the HTML against Googlebot’s 2 MB of patience.','Not impersonating Googlebot. We checked.','Being very nice to the rate limiter.','Reading the shipping policy so you do not have to.','Matching the markup price against the visible price.','Looking for a doctype. It is 2026 and we still look.','Checking whether an agent could actually buy something here.']};
var NOTE={done:'Opening your report',reused:'Scanned a moment ago, replaying the result'};
var started=0,timer=null,quipTimer=null,pollTimer=null,token='',lastSeq=0,phase='',checks=0,total=${catalog.checks.length},done=false,quipIndex=0,disposable=false;
function pad(n){return (n<10?'0':'')+n.toFixed(2)}
function stamp(){return pad((Date.now()-started)/1000)}
function log(parts){var line=document.createElement('div');var t=document.createElement('span');t.className='sc-t';t.textContent='['+stamp()+'] ';line.appendChild(t);parts.forEach(function(p){var s=document.createElement('span');if(p[1])s.className=p[1];s.textContent=p[0];line.appendChild(s)});var l=$('sc-log');l.appendChild(line);while(l.childNodes.length>40)l.removeChild(l.firstChild)}
function setPhase(id){var order=['home','robots','sitemap','sample','checks'];var i=order.indexOf(id);box.querySelectorAll('.sc-phase').forEach(function(el){var j=order.indexOf(el.getAttribute('data-phase'));el.setAttribute('data-s',j<i?'done':j===i?'active':'')});phase=id;quipIndex=0;quip()}
function quip(){var list=QUIPS[phase]||QUIPS.home;$('sc-quip').textContent='› '+list[quipIndex%list.length];quipIndex++}
var floor=0,ceiling=0,shown=0;
function target(a,b){floor=Math.max(floor,a);ceiling=Math.max(ceiling,b)}
function tick(){$('sc-elapsed').textContent=((Date.now()-started)/1000).toFixed(1)+' s';if(!done&&shown<ceiling-0.5){shown=Math.max(shown,floor)+(ceiling-Math.max(shown,floor))*0.04}paint()}
function paint(){var p=Math.min(100,Math.round(shown));$('sc-fill').style.width=p+'%';$('sc-percent').textContent=p+'%'}
var PH={home:[4,8],robots:[8,12],sitemap:[12,16],sample:[16,20]};
function blip(v){var b=document.createElement('span');b.className='sc-blip';b.setAttribute('data-v',v);var a=Math.random()*Math.PI*2,r=8+Math.random()*26;b.style.left=(36+Math.cos(a)*r)+'px';b.style.top=(36+Math.sin(a)*r)+'px';var c=$('sc-blips');c.appendChild(b);while(c.childNodes.length>24)c.removeChild(c.firstChild)}
function cell(id,v){var el=box.querySelector('.sc-cell[data-id="'+id+'"]');if(el)el.setAttribute('data-v',v)}
var TAG={pass:['PASS','sc-pass'],warn:['WARN','sc-warn'],fail:['FAIL','sc-fail'],skip:['SKIP','sc-skip']};
function onProgress(e){$('sc-requests').textContent=e.requests+'/'+e.budget;
if(e.type==='phase'){var r=PH[e.phase];if(r){target(r[0],r[1]);shown=Math.max(shown,r[0])}log([[e.detail,'']]);var order=['home','robots','sitemap','sample','checks'];setPhase(order[order.indexOf(e.phase)+1]||'checks')}
else if(e.type==='target'){total=e.checks;setPhase('checks');$('sc-status').textContent='Running '+e.checks+' checks'+(e.platform==='unknown'?'':' on a '+e.platform+' store')+' · profile '+e.profile.replace(/-/g,' ');target(20,24);log([['target ','sc-t'],[e.origin+' · '+e.products+' product page(s) · '+e.policies+' policy page(s)','']])}
else if(e.type==='check'){checks=e.index;$('sc-checks').textContent=e.index+'/'+e.total;cell(e.id,e.verdict);if(e.verdict!=='skip'||Math.random()<0.4)blip(e.verdict);var pr=20+80*e.index/e.total;target(pr,Math.min(99,pr+80/e.total));shown=Math.max(shown,pr);var t=TAG[e.verdict]||TAG.skip;var parts=[[t[0]+' ',t[1]],[e.id+' ','sc-t'],[e.title,'']];if((e.verdict==='fail'||e.verdict==='warn')&&e.message)parts.push([' — '+e.message,'sc-t']);log(parts)}}
function finish(d){done=true;clearTimeout(pollTimer);box.setAttribute('aria-busy','false');clearInterval(quipTimer);var replay=d.reused?d.results.filter(function(r){var el=box.querySelector('.sc-cell[data-id="'+r.id+'"]');return el&&!el.getAttribute('data-v')}):[];var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var step=reduce?0:Math.max(8,Math.min(30,900/Math.max(1,replay.length)));
if(d.reused){$('sc-status').textContent=NOTE.reused;setPhase('checks');$('sc-requests').textContent=String(d.requests);$('sc-elapsed').textContent=(d.duration_ms/1000).toFixed(1)+' s';log([['scanned at '+d.scanned_at.replace('T',' ').slice(0,19)+' UTC, reused within the cooldown','sc-t']])}
var i=0;function next(){if(i<replay.length){var r=replay[i++];cell(r.id,r.verdict);if(r.verdict!=='skip')blip(r.verdict);if(r.verdict!=='pass'&&r.verdict!=='skip'){var c=box.querySelector('.sc-cell[data-id="'+r.id+'"]');var t=TAG[r.verdict];log([[t[0]+' ',t[1]],[c?c.title:r.id,'']])}shown=20+80*i/replay.length;paint();$('sc-checks').textContent=i+'/'+replay.length;setTimeout(next,step);return}
shown=100;paint();box.querySelectorAll('.sc-phase').forEach(function(el){el.setAttribute('data-s','done')});
if(!reduce)box.querySelectorAll('.sc-cell').forEach(function(el,k){setTimeout(function(){el.classList.add('sc-wave')},k*12)});
$('sc-status').textContent=NOTE.done;$('sc-host').textContent='Level '+d.level.value+' · '+d.level.name;
log([['done ','sc-pass'],['level '+d.level.value+' · ingestion '+d.scores.ingestion+(d.scores.commerce===null?'':' · commerce '+d.scores.commerce)+' · '+d.requests+' requests in '+(d.duration_ms/1000).toFixed(1)+' s','']]);
$('sc-quip').classList.remove('sc-caret');$('sc-quip').textContent='› Opening the report…';setTimeout(function(){try{sessionStorage.setItem('ars-arrived',d.report_url+'|'+(d.duration_ms/1000).toFixed(1)+' s')}catch(_){}var r=box.querySelector('.sc-radar');if(r)r.classList.add('sc-handoff');location.href=d.report_url},reduce?400:1200)}
next()}
function fail(msg){document.documentElement.removeAttribute('data-scanning');done=true;clearTimeout(pollTimer);clearInterval(quipTimer);clearInterval(timer);box.setAttribute('aria-busy','false');var e=$('sc-error');e.classList.remove('hidden');e.className='mt-3 text-sm text-destructive';e.textContent=msg;$('sc-quip').classList.remove('sc-caret');$('sc-quip').textContent='';$('sc-status').textContent='The scan stopped';form.querySelectorAll('input,select,button').forEach(function(el){el.disabled=false});log([['error ','sc-fail'],[msg,'']])}
function fallback(){if(disposable){fail('The connection dropped. One-time scans are not saved; wait a minute before trying again.');return}document.documentElement.removeAttribute('data-scanning');done=true;clearTimeout(pollTimer);form.removeEventListener('submit',onSubmit);form.querySelectorAll('input,select,button').forEach(function(el){el.disabled=false});form.submit()}
function handle(ev,d){if(done)return;if(ev==='progress'){if(typeof d.seq==='number'){if(d.seq<=lastSeq)return;lastSeq=d.seq}onProgress(d)}else if(ev==='done'){clearInterval(timer);tick();finish(d)}else if(ev==='failure'){fail(d.message)}}
function poll(){if(done)return;fetch('/api/scan/progress/'+token+'?after='+lastSeq,{cache:'no-store'}).then(function(r){return r.status===200?r.json():null}).then(function(j){if(!j)return;(j.events||[]).forEach(function(e){handle('progress',e)});if(j.final)handle(j.final.event,j.final.data)}).catch(function(){}).then(function(){if(!done)pollTimer=setTimeout(poll,600)})}
function onSubmit(ev){var data=new FormData(form);var url=String(data.get('url')||'').trim();if(!url)return;disposable=true;try{var parsed=new URL(url.indexOf('://')>0?url:'https://'+url);disposable=parsed.pathname!=='/'||!!parsed.search||!!parsed.port||!!parsed.username||!!parsed.password}catch(_){}if(disposable){document.documentElement.setAttribute('data-scanning','');box.classList.remove('hidden');$('sc-host').textContent=url;$('sc-status').textContent='One-time scan · results stay in this tab';$('sc-quip').textContent='Fetching public signals. This scan is not saved.';return}ev.preventDefault();
var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);token=Array.prototype.map.call(bytes,function(b){return ('0'+b.toString(16)).slice(-2)}).join('');lastSeq=0;var body={url:url,progress_token:token};var prof=String(data.get('profile')||'');if(prof)body.profile=prof;
document.documentElement.setAttribute('data-scanning','');started=Date.now();done=false;floor=0;ceiling=4;shown=0;box.classList.remove('hidden');box.setAttribute('aria-busy','true');$('sc-error').classList.add('hidden');$('sc-log').textContent='';$('sc-blips').textContent='';box.querySelectorAll('.sc-cell').forEach(function(el){el.removeAttribute('data-v');el.classList.remove('sc-wave')});
$('sc-host').textContent=url.replace(/^https?:\\/\\//,'').replace(/\\/$/,'');$('sc-status').textContent=disposable?'One-time scan · results stay in this tab':'Connecting';setPhase('home');log([['POST ','sc-t'],['/api/scan/stream '+url,'']]);
form.querySelectorAll('input,select,button').forEach(function(el){el.disabled=true});box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
clearInterval(timer);timer=setInterval(tick,100);clearInterval(quipTimer);quipTimer=setInterval(quip,2600);
var got=false;clearTimeout(pollTimer);if(!disposable)pollTimer=setTimeout(poll,500);
fetch('/api/scan/stream',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify(body)}).then(function(res){
if(!res.ok||!/event-stream/.test(res.headers.get('content-type')||'')){return res.json().then(function(j){fail(j.error||('HTTP '+res.status))},function(){fail('HTTP '+res.status)})}
var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
function pump(){return reader.read().then(function(r){if(r.done){if(!done){setTimeout(function(){if(!done){clearInterval(timer);fail('The connection dropped before the scan finished. The result may still arrive: try again in a minute.')}},8000)}return}
buf+=dec.decode(r.value,{stream:true});var parts=buf.split('\\n\\n');buf=parts.pop();parts.forEach(function(chunk){var ev='message',dat='';chunk.split('\\n').forEach(function(line){if(line.indexOf('event:')===0)ev=line.slice(6).trim();else if(line.indexOf('data:')===0)dat+=line.slice(5).trim()});if(!dat)return;got=true;var d;try{d=JSON.parse(dat)}catch(_){return}
handle(ev,d)});return pump()})}
return pump()}).catch(function(){if(!got&&lastSeq===0)fallback()})}
form.addEventListener('submit',onSubmit)})();`;
