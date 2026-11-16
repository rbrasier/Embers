// A scripted player used by the headless tests and for balance checks.
// 'calls' plays the fight as designed. 'nocalls' fights well but never
// makes a call or sets a marker, to prove the calls are what win it.

import { Sim } from './sim';

const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function autopilot(sim: Sim, mode: 'calls' | 'nocalls') {
  const h = sim.hero;
  const calls = mode === 'calls';
  if (calls) {
    const hex = sim.visiblePack().find((e) => e.def === 'hexer');
    if (hex && hex.marker !== 'kill') sim.setMarker(hex.id, 'kill');
  }
  const t = sim.unit(h.target);
  let mx = 0, my = 0;
  const pool = sim.zones.find((z) => (z.mech.kind === 'pool' || z.mech.kind === 'slam') && d(h, z) < z.r + 0.8);
  const brand = sim.zones.some((z) => z.mech.kind === 'brand' && !z.fired);
  const soak = sim.zones.some((z) => z.mech.kind === 'soak' && !z.fired);
  if (pool) {
    const dd = d(h, pool) || 1;
    mx = (h.x - pool.x) / dd || 0; my = (h.y - pool.y) / dd || -1;
  } else if (brand && calls) {
    let near = null as null | { x: number; y: number }; let nd = 5.6;
    for (const c of sim.companions) if (c.alive && d(c, h) < nd) { nd = d(c, h); near = c; }
    if (near) { const dd = nd || 1; mx = (h.x - near.x) / dd || 1; my = (h.y - near.y) / dd; }
  } else if (soak && calls) {
    // hold still so the party can gather
  } else if (t) {
    if (d(h, t) - t.r > 2.4) { const dd = d(h, t); mx = (t.x - h.x) / dd; my = (t.y - h.y) / dd; }
  } else if (sim.party().every((p) => p.alive && p.hp > p.maxHp * 0.9)) my = 1;
  sim.move.x = mx; sim.move.y = my;

  if (h.alive && t) {
    const far = d(h, t) - t.r > 6;
    if (sim.heroCanInterrupt() || (far && !t.boss)) sim.pressAbility(2);
    else if (h.hp < h.maxHp * 0.45 && (h.cds.evade ?? 0) <= 0) sim.pressAbility(4);
    else if (t.boss && (h.cds.flurry ?? 0) <= 0) sim.pressAbility(3);
    else if ((h.cds.rend ?? 0) <= 0) sim.pressAbility(1);
    else sim.pressAbility(0);
  }

  if (!calls || !sim.inCombat) return;
  const p = sim.prompt();
  if (p && !(p.call === 'interrupt' && sim.heroCanInterrupt())) sim.call(p.call);
  const boss = sim.enemies.find((e) => e.boss && e.alive && e.aggro);
  if (boss && sim.callCd.burst <= 0) sim.call('burst');
}

/** Run a whole dungeon headless. Returns the sim when it ends or times out. */
export function runHeadless(seed: number, mode: 'calls' | 'nocalls', maxSeconds = 600, maxWipes = 0): Sim {
  const sim = new Sim(seed);
  for (let i = 0; i < maxSeconds * 30; i++) {
    autopilot(sim, mode);
    sim.step();
    sim.events.length = 0;
    if (sim.phase === 'victory') break;
    if (sim.phase === 'wipe') { if (sim.stats.wipes >= maxWipes) break; sim.retry(); }
  }
  return sim;
}
