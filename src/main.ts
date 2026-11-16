import './ui/style.css';
import { TICK } from './sim/data';
import { Sim } from './sim/sim';
import { View } from './render/view';
import { Hud } from './ui/hud';
import { Sfx } from './ui/audio';

const seed = Number(new URLSearchParams(location.search).get('seed')) || (Date.now() & 0xffff) + 1;
const sim = new Sim(seed);
const view = new View(document.getElementById('view') as HTMLCanvasElement);
const sfx = new Sfx();
const hud = new Hud(document.getElementById('hud')!, sim, view, sfx);

window.addEventListener('resize', () => view.resize());
window.addEventListener('orientationchange', () => setTimeout(() => view.resize(), 250));
window.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// Fixed-step simulation, rendered as often as the display allows.
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!hud.paused) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 5) {
      hud.applyInput();
      sim.step();
      acc -= TICK; steps++;
    }
    if (steps === 5) acc = 0;
  }
  for (const e of sim.events) { view.onEvent(e, sim); hud.onEvent(e); }
  sim.events.length = 0;
  view.update(sim, dt);
  hud.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the game from the browser console.
(window as any).embers = { sim, hud };
