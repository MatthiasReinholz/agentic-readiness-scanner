/** Decorative, self-contained network. Geometry is shared by hosted and offline pages. */
export function signalNetwork(): string {
  return `<div class="signal-network" aria-hidden="true"><svg viewBox="0 0 900 400" fill="none" xmlns="http://www.w3.org/2000/svg">
<g class="signal-wires"><path d="M65 90 230 55 380 140 590 65 810 100 720 210 820 325 400 355 300 220 120 255 65 90M230 55 590 65 720 210 510 260 380 140 300 220 510 260 400 355M380 140 590 65M300 220 120 255M510 260 820 325"/></g>
<g class="signal-nodes"><circle cx="65" cy="90" r="5"/><circle cx="230" cy="55" r="5"/><circle cx="380" cy="140" r="20"/><circle cx="590" cy="65" r="5"/><circle cx="810" cy="100" r="5"/><circle cx="120" cy="255" r="5"/><circle cx="300" cy="220" r="5"/><circle cx="510" cy="260" r="5"/><circle cx="720" cy="210" r="5"/><circle cx="820" cy="325" r="5"/><circle cx="400" cy="355" r="5"/></g>
<circle class="signal-packet signal-packet-a" r="4"/><circle class="signal-packet signal-packet-b" r="4"/><circle class="signal-packet signal-packet-c" r="3"/>
</svg></div>`;
}

/** Ambient decoration follows OS motion preferences and pauses during active scanning. */
export const SIGNAL_NETWORK_SCRIPT = `(function(){
  if(!window.matchMedia)return;
  var root=document.documentElement;
  var media=window.matchMedia('(prefers-reduced-motion: reduce)');
  function paint(){root.setAttribute('data-motion',media.matches?'paused':'running')}
  media.addEventListener('change',paint);
  paint();
})();`;
