import { describe, expect, test } from 'vitest';
import { Sim } from '../src/sim/sim';
import { autopilot, runHeadless } from '../src/sim/autopilot';
import { CALLS } from '../src/sim/data';

describe('combat simulation', () => {
  test('is deterministic for a given seed', () => {
    const a = runHeadless(7, 'calls', 60);
    const b = runHeadless(7, 'calls', 60);
    expect(a.hash()).toBe(b.hash());
    expect(runHeadless(8, 'calls', 60).hash()).not.toBe(a.hash());
  });

  test('correct calls clear the dungeon without a death', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = runHeadless(seed, 'calls');
      expect(s.phase, `seed ${seed}: ${s.failLog.join(' / ')}`).toBe('victory');
      expect(s.stats.failed).toBe(0);
    }
  });

  test('a party that is never called wipes on the boss', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = runHeadless(seed, 'nocalls');
      expect(s.phase, `seed ${seed}`).toBe('wipe');
      expect(s.stats.failed).toBeGreaterThan(0);
      expect(s.failLog.length).toBeGreaterThan(0);
    }
  });

  test('a wipe returns to the checkpoint and keeps dead trash dead', () => {
    const s = runHeadless(3, 'nocalls');
    const deadBefore = s.enemies.filter((e) => !e.alive).length;
    s.retry();
    expect(s.phase).toBe('explore');
    expect(s.party().every((p) => p.alive && p.hp === p.maxHp)).toBe(true);
    expect(s.enemies.filter((e) => !e.alive).length).toBe(deadBefore);
    const boss = s.enemies.find((e) => e.boss)!;
    expect(boss.hp).toBe(boss.maxHp);
    expect(s.stats.wipes).toBe(1);
  });

  test('calls go on cooldown and are refused until ready', () => {
    const s = new Sim(1);
    expect(s.call('stack')).toBe(true);
    expect(s.callCd.stack).toBe(CALLS.stack.cd);
    expect(s.call('stack')).toBe(false);
    expect(s.companions.every((c) => c.order?.type === 'stack')).toBe(true);
    expect(s.call('interrupt')).toBe(false); // nothing is casting
    expect(s.callCd.interrupt).toBe(0);
  });

  test('companions never interrupt unless told to', () => {
    const s = new Sim(2);
    let interruptsByCompanions = 0;
    for (let i = 0; i < 30 * 200 && (s.phase === 'explore' || s.phase === 'combat'); i++) {
      autopilot(s, 'nocalls');
      s.step();
      for (const e of s.events) if (e.t === 'interrupted' && e.by !== s.hero.id) interruptsByCompanions++;
      s.events.length = 0;
    }
    expect(interruptsByCompanions).toBe(0);
  });

  test('a Control marker keeps the marked enemy out of the fight', () => {
    const s = new Sim(1);
    const hexer = s.enemies.find((e) => e.def === 'hexer')!;
    s.setMarker(hexer.id, 'control');
    let caged = 0, casts = 0;
    for (let i = 0; i < 30 * 40; i++) {
      s.move.y = s.inCombat ? 0 : 1;
      s.pressAbility(0);
      s.step();
      if (s.has(hexer, 'cage')) caged++;
      for (const e of s.events) if (e.t === 'castStart' && e.unit === hexer.id) casts++;
      s.events.length = 0;
      if (s.enemies.filter((e) => e.group === 1 && e.alive).length === 1) break;
    }
    expect(caged).toBeGreaterThan(60);
    expect(casts).toBeLessThanOrEqual(1);
    expect(hexer.hp).toBe(hexer.maxHp);
  });
});
