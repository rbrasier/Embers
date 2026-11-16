// Headless combat simulation. No rendering, no DOM, no wall clock.
// Fixed tick and a seeded generator make every run replayable.

import { RNG } from './rng';
import {
  ABILITIES, ARENA, BARKS, BUFFS, CALLS, COMPANIONS, ENEMIES, ENTRANCE, FOCUS_TIME, HERO, ORDER_TIME,
  PARTY_ORDER, SPAWNS, SPREAD_MIN, TICK,
  type AbilityDef, type CallId, type CompanionDef, type Marker, type MechanicDef, type Role,
} from './data';

export interface Buff { id: string; t: number; stacks: number; src: number; tickT: number }
export interface Cast { ability: string; t: number; dur: number; target: number; mech: MechanicDef | null }
export interface Order { type: 'stack' | 'spread'; t: number; x: number; y: number }

export interface Unit {
  id: number; team: 'party' | 'enemy'; def: string; name: string; role: Role | 'enemy';
  isHero: boolean; boss: boolean;
  x: number; y: number; face: number; r: number;
  hp: number; maxHp: number; mana: number; maxMana: number; alive: boolean; speed: number;
  target: number; cast: Cast | null; gcd: number; cds: Record<string, number>; buffs: Buff[];
  lastHit: string;
  // enemies
  group: number; aggro: boolean; threat: Record<number, number>; swingT: number; mechT: number[];
  marker: Marker; homeX: number; homeY: number; enrageT: number;
  // companions
  order: Order | null; awareT: number; barkT: number; moving: boolean; manaWarn: number; slot: number;
}

export interface Zone {
  id: number; mech: MechanicDef; x: number; y: number; r: number; follow: number; src: number;
  t: number; delay: number; dur: number; fired: boolean; tickT: number; wave: number;
}

export type Phase = 'explore' | 'combat' | 'wipe' | 'victory';

export type SimEvent =
  | { t: 'dmg'; src: number; tgt: number; amt: number; label: string }
  | { t: 'heal'; tgt: number; amt: number }
  | { t: 'bark'; unit: number; text: string }
  | { t: 'call'; id: CallId; responders: number[] }
  | { t: 'callFail'; id: CallId; reason: string }
  | { t: 'castStart'; unit: number; ability: string }
  | { t: 'interrupted'; unit: number; by: number; ability: string }
  | { t: 'telegraph'; mech: string; name: string; target: number; answer: CallId | null }
  | { t: 'mechFail'; mech: string; text: string }
  | { t: 'zoneFire'; kind: string; x: number; y: number; r: number }
  | { t: 'death'; unit: number }
  | { t: 'fx'; vis: string; from: number; to: number }
  | { t: 'hint'; text: string }
  | { t: 'banner'; text: string }
  | { t: 'phase'; phase: Phase }
  | { t: 'combat'; on: boolean };

export interface Prompt { call: CallId; text: string; left: number }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Sim {
  rng: RNG;
  tick = 0;
  time = 0;
  units: Unit[] = [];
  zones: Zone[] = [];
  events: SimEvent[] = [];
  hero!: Unit;
  companions: Unit[] = [];
  enemies: Unit[] = [];
  phase: Phase = 'explore';
  inCombat = false;
  callCd: Record<CallId, number> = { interrupt: 0, stack: 0, spread: 0, burst: 0, focus: 0 };
  move = { x: 0, y: 0 };
  focus: { target: number; t: number } | null = null;
  failLog: string[] = [];
  seen: Record<string, boolean> = {}; // mechanics the player has seen at least once
  stats = { wipes: 0, calls: 0, answered: 0, failed: 0, runTime: 0, deaths: 0 };
  private queued: { slot: number; t: number } | null = null;
  private nextId = 1;
  private zoneId = 1;
  private waveId = 1;

  constructor(seed = 1) {
    this.rng = new RNG(seed);
    this.hero = this.makeUnit({
      team: 'party', def: 'hero', name: HERO.name, role: HERO.role, isHero: true, x: ENTRANCE.x, y: ENTRANCE.y,
      r: 0.6, hp: HERO.hp, speed: HERO.speed,
    });
    PARTY_ORDER.forEach((id, i) => {
      const d = COMPANIONS[id];
      const c = this.makeUnit({
        team: 'party', def: id, name: d.name, role: d.role, x: ENTRANCE.x + d.follow.x, y: ENTRANCE.y + d.follow.y,
        r: 0.6, hp: d.hp, speed: d.speed, mana: d.mana,
      });
      c.slot = i;
      this.companions.push(c);
    });
    for (const s of SPAWNS) {
      const d = ENEMIES[s.def];
      const e = this.makeUnit({ team: 'enemy', def: s.def, name: d.name, role: 'enemy', x: s.x, y: s.y, r: d.radius, hp: d.hp, speed: d.speed });
      e.group = s.group; e.boss = !!d.boss; e.face = -Math.PI / 2;
      e.mechT = d.mechanics.map((m) => m.first);
      this.enemies.push(e);
    }
  }

  private makeUnit(o: Partial<Unit> & { hp: number }): Unit {
    const u: Unit = {
      id: this.nextId++, team: 'party', def: '', name: '', role: 'damage', isHero: false, boss: false,
      x: 0, y: 0, face: Math.PI / 2, r: 0.6, maxHp: o.hp, mana: o.mana ?? 0, maxMana: o.mana ?? 0,
      alive: true, speed: 6, target: 0, cast: null, gcd: 0, cds: {}, buffs: [], lastHit: '',
      group: 0, aggro: false, threat: {}, swingT: 0, mechT: [], marker: null, homeX: o.x ?? 0, homeY: o.y ?? 0, enrageT: 0,
      order: null, awareT: 0, barkT: 0, moving: false, manaWarn: 0, slot: 0,
      ...o,
    };
    this.units.push(u);
    return u;
  }

  // ------------------------------------------------------------ queries

  unit(id: number): Unit | null { return this.units[id - 1] ?? null; }
  party(): Unit[] { return [this.hero, ...this.companions]; }
  tank(): Unit | null { return this.companions.find((c) => c.role === 'tank') ?? null; }
  has(u: Unit, buff: string): boolean { return u.buffs.some((b) => b.id === buff); }
  stunned(u: Unit): boolean { return u.buffs.some((b) => BUFFS[b.id].stun); }

  private mult(u: Unit, key: 'dmg' | 'taken' | 'haste' | 'heal'): number {
    let m = 1;
    for (const b of u.buffs) { const v = BUFFS[b.id][key]; if (v) m *= Math.pow(v, b.stacks); }
    return m;
  }

  /** Enemies worth showing in the pack list: fighting, or close to the hero. */
  visiblePack(): Unit[] {
    return this.enemies.filter((e) => e.alive && (e.aggro || dist(e, this.hero) < 30));
  }

  /** The most dangerous enemy in view, offered as a Kill target if none is marked. */
  suggestedKill(): number {
    const pack = this.visiblePack();
    if (pack.length < 2 || pack.some((e) => e.marker === 'kill')) return 0;
    let best: Unit | null = null;
    for (const e of pack) if (e.marker !== 'control' && ENEMIES[e.def].danger > 0 && (!best || ENEMIES[e.def].danger > ENEMIES[best.def].danger)) best = e;
    return best ? best.id : 0;
  }

  private interruptibleCasts(): Unit[] {
    return this.enemies.filter((e) => e.alive && e.cast && ABILITIES[e.cast.ability].interruptible);
  }

  private pickInterrupter(e: Unit): Unit | null {
    let best: Unit | null = null; let bestCd = 1e9;
    for (const c of this.companions) {
      const d = COMPANIONS[c.def];
      if (!c.alive || !d.interrupt || this.stunned(c) || (c.cds[d.interrupt] ?? 0) > 0) continue;
      const a = ABILITIES[d.interrupt];
      if (dist(c, e) - e.r > a.range) continue;
      if (a.cd < bestCd) { best = c; bestCd = a.cd; }
    }
    return best;
  }

  /** Who would answer an Interrupt call right now. Shown on the party frames. */
  nextInterrupter(): number {
    if (!this.inCombat) return 0;
    const casting = this.interruptibleCasts();
    const e = casting[0] ?? this.unit(this.hero.target) ?? this.enemies.find((x) => x.alive && x.aggro) ?? null;
    if (!e || !e.alive) return 0;
    return this.pickInterrupter(e)?.id ?? 0;
  }

  /** True when the hero's own target is casting something Lunge could stop. */
  heroCanInterrupt(): boolean {
    const t = this.unit(this.hero.target);
    return !!(t && t.alive && t.cast && ABILITIES[t.cast.ability].interruptible && (this.hero.cds.lunge ?? 0) <= 0);
  }

  /** The contextual prompt: a call that is available and relevant right now. */
  prompt(): Prompt | null {
    let best: Prompt | null = null;
    const offer = (p: Prompt) => { if (!best || p.left < best.left) best = p; };
    const ordered = (type: string) => this.companions.some((c) => c.alive && c.order?.type === type);
    for (const z of this.zones) {
      if (z.fired || !z.mech.answer) continue;
      const call = z.mech.answer;
      if (this.callCd[call] > 0) continue;
      if ((call === 'stack' || call === 'spread') && ordered(call)) continue;
      offer({ call, text: z.mech.name, left: z.delay - z.t });
    }
    if (this.callCd.interrupt <= 0) {
      for (const e of this.interruptibleCasts()) {
        if (this.pickInterrupter(e)) offer({ call: 'interrupt', text: ABILITIES[e.cast!.ability].name, left: e.cast!.dur - e.cast!.t });
      }
    }
    return best;
  }

  // ----------------------------------------------------------- commands

  pressAbility(slot: number) { this.queued = { slot, t: 0.35 }; }

  setMarker(id: number, m: Marker) {
    const e = this.unit(id);
    if (!e || e.team !== 'enemy' || !e.alive) return;
    const was = e.marker;
    if (m) for (const o of this.enemies) if (o.marker === m) o.marker = null;
    e.marker = was === m ? null : m;
  }

  clearMarker(id: number) { const e = this.unit(id); if (e) e.marker = null; }

  call(id: CallId): boolean {
    if (this.phase === 'wipe' || this.phase === 'victory') return false;
    if (this.callCd[id] > 0) { this.events.push({ t: 'callFail', id, reason: 'Not ready' }); return false; }
    const able = this.companions.filter((c) => c.alive && !this.stunned(c));
    const responders: number[] = [];

    if (id === 'interrupt') {
      const casts = this.interruptibleCasts();
      if (!casts.length) { this.events.push({ t: 'callFail', id, reason: 'Nothing to interrupt' }); return false; }
      casts.sort((a, b) => (a.cast!.dur - a.cast!.t) - (b.cast!.dur - b.cast!.t));
      const e = casts.find((c) => c.id === this.hero.target) ?? casts[0];
      const who = this.pickInterrupter(e);
      if (!who) { this.events.push({ t: 'callFail', id, reason: 'No interrupt ready in range' }); return false; }
      const ab = COMPANIONS[who.def].interrupt!;
      who.cast = null;
      who.cds[ab] = ABILITIES[ab].cd;
      this.events.push({ t: 'fx', vis: ABILITIES[ab].vis, from: who.id, to: e.id });
      this.interruptCast(e, who);
      responders.push(who.id);
    } else if (id === 'stack') {
      for (const c of able) {
        c.order = { type: 'stack', t: ORDER_TIME, x: 0, y: 0 };
        responders.push(c.id);
        if (c.cast && COMPANIONS[c.def].finishCast) this.bark(c, 'casting', true); else this.bark(c, 'stack');
      }
    } else if (id === 'spread') {
      this.assignSpread(able);
      for (const c of able) {
        responders.push(c.id);
        if (c.cast && COMPANIONS[c.def].finishCast) this.bark(c, 'casting', true); else this.bark(c, 'spread');
      }
    } else if (id === 'burst') {
      for (const c of able) {
        this.resolve(c, ABILITIES[COMPANIONS[c.def].burst], c);
        responders.push(c.id);
        this.bark(c, 'burst');
      }
    } else if (id === 'focus') {
      const t = this.unit(this.hero.target);
      if (!t || !t.alive) { this.events.push({ t: 'callFail', id, reason: 'No target' }); return false; }
      this.focus = { target: t.id, t: FOCUS_TIME };
      for (const c of able) responders.push(c.id);
    }
    this.callCd[id] = CALLS[id].cd;
    this.stats.calls++;
    this.events.push({ t: 'call', id, responders });
    return true;
  }

  /** Give each companion a spot clear of the hero and of each other. */
  private assignSpread(able: Unit[]) {
    const h = this.hero;
    const tank = this.tank();
    const anchor = (tank && this.unit(tank.target)) || this.enemies.find((e) => e.alive && e.aggro) || null;
    const taken: { x: number; y: number }[] = [{ x: h.x, y: h.y }];
    const pools = this.zones.filter((z) => z.mech.kind === 'pool');
    const ok = (p: { x: number; y: number }) =>
      p.x > ARENA.minX + 1 && p.x < ARENA.maxX - 1 && p.y > ARENA.minY + 1 && p.y < ARENA.maxY - 1 &&
      taken.every((q) => dist(p, q) >= SPREAD_MIN) && pools.every((z) => dist(p, z) > z.r + 1);
    const ring = (cx: number, cy: number, r: number, n: number) => {
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) out.push({ x: cx + Math.cos((i / n) * Math.PI * 2) * r, y: cy + Math.sin((i / n) * Math.PI * 2) * r });
      return out;
    };
    const ordered = [...able].sort((a, b) => Number(COMPANIONS[b.def].melee) - Number(COMPANIONS[a.def].melee) || a.slot - b.slot);
    for (const c of ordered) {
      const d = COMPANIONS[c.def];
      let spot: { x: number; y: number } | null = null;
      if (d.role === 'tank') spot = { x: c.x, y: c.y }; // the tank holds the boss where it is
      else {
        const cx = anchor ? anchor.x : h.x, cy = anchor ? anchor.y : h.y;
        const tiers: { x: number; y: number }[][] = [];
        if (ok(c)) tiers.push([{ x: c.x, y: c.y }]);
        if (d.melee && anchor) tiers.push(ring(cx, cy, anchor.r + 1.7, 20));
        tiers.push([...ring(cx, cy, 9, 20), ...ring(cx, cy, 12, 24), ...ring(cx, cy, 15, 28)]);
        for (const tier of tiers) {
          let bd = 1e9;
          for (const p of tier) { if (!ok(p)) continue; const dd = dist(p, c); if (dd < bd) { bd = dd; spot = p; } }
          if (spot) break;
        }
        if (!spot) { // nothing clean: take the roomiest point
          let bm = -1;
          for (const p of tiers[tiers.length - 1]) {
            const m = Math.min(...taken.map((q) => dist(p, q)));
            if (m > bm && p.x > ARENA.minX + 1 && p.x < ARENA.maxX - 1 && p.y > ARENA.minY + 1 && p.y < ARENA.maxY - 1) { bm = m; spot = p; }
          }
        }
      }
      spot = spot ?? { x: c.x, y: c.y };
      taken.push(spot);
      c.order = { type: 'spread', t: ORDER_TIME, x: spot.x, y: spot.y };
    }
  }

  /** Reset to the last checkpoint. Dead enemies stay dead. */
  retry() {
    this.stats.wipes++;
    this.zones = [];
    this.focus = null;
    this.failLog = [];
    this.queued = null;
    for (const k of Object.keys(this.callCd) as CallId[]) this.callCd[k] = 0;
    for (const u of this.party()) {
      const f = u.isHero ? { x: 0, y: 0 } : COMPANIONS[u.def].follow;
      Object.assign(u, { x: ENTRANCE.x + f.x, y: ENTRANCE.y + f.y, hp: u.maxHp, mana: u.maxMana, alive: true, cast: null, gcd: 0, cds: {}, buffs: [], order: null, target: 0, face: Math.PI / 2, awareT: 0 });
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      Object.assign(e, { x: e.homeX, y: e.homeY, hp: e.maxHp, cast: null, cds: {}, buffs: [], aggro: false, threat: {}, swingT: 0, target: 0, enrageT: 0, face: -Math.PI / 2 });
      e.mechT = ENEMIES[e.def].mechanics.map((m) => m.first);
    }
    this.inCombat = false;
    this.phase = 'explore';
    this.events.push({ t: 'phase', phase: 'explore' });
    const c = this.rng.pick(this.companions);
    c.barkT = 0;
    this.bark(c, 'retry', true);
  }

  // ---------------------------------------------------------- mechanics

  private bark(u: Unit, key: string, force = false) {
    const lines = BARKS[u.def]?.[key];
    if (!lines || !u.alive) return;
    if (!force && u.barkT > 0) return;
    u.barkT = 3;
    this.events.push({ t: 'bark', unit: u.id, text: this.rng.pick(lines) });
  }

  private addBuff(u: Unit, id: string, src: Unit) {
    const d = BUFFS[id];
    const cur = u.buffs.find((b) => b.id === id);
    if (cur) { cur.t = 0; if (d.stacks) cur.stacks++; return; }
    u.buffs.push({ id, t: 0, stacks: 1, src: src.id, tickT: d.every ?? 0 });
  }

  private damage(src: Unit | null, tgt: Unit, amt: number, label: string, opt: { threat?: number; ground?: boolean; fixed?: boolean } = {}) {
    if (!tgt.alive) return;
    let v = amt;
    if (src && !opt.fixed) v *= this.mult(src, 'dmg');
    v *= this.mult(tgt, 'taken');
    if (tgt.team === 'party' && !tgt.isHero) {
      const d = COMPANIONS[tgt.def];
      v *= d.taken;
      if (opt.ground) { v *= d.groundTaken; if (d.groundTaken > 1) this.bark(tgt, 'fire'); }
    }
    v = Math.round(v);
    tgt.hp -= v;
    tgt.lastHit = label;
    if (tgt.team === 'enemy') {
      if (src) tgt.threat[src.id] = (tgt.threat[src.id] ?? 0) + v * (opt.threat ?? 1);
      if (!tgt.aggro && src) this.aggroGroup(tgt.group, src);
      const i = tgt.buffs.findIndex((b) => BUFFS[b.id].breakOnDamage);
      if (i >= 0) tgt.buffs.splice(i, 1);
    }
    this.events.push({ t: 'dmg', src: src?.id ?? 0, tgt: tgt.id, amt: v, label });
    if (tgt.hp <= 0) this.kill(tgt);
  }

  private healUnit(src: Unit, tgt: Unit, amt: number) {
    if (!tgt.alive) return;
    const v = Math.round(Math.min(tgt.maxHp - tgt.hp, amt * this.mult(src, 'heal')));
    if (v <= 0) return;
    tgt.hp += v;
    this.events.push({ t: 'heal', tgt: tgt.id, amt: v });
    const live = this.enemies.filter((e) => e.alive && e.aggro);
    for (const e of live) e.threat[src.id] = (e.threat[src.id] ?? 0) + (v * 0.4) / live.length;
  }

  private kill(u: Unit) {
    u.hp = 0; u.alive = false; u.cast = null; u.buffs = []; u.order = null; u.marker = null;
    this.events.push({ t: 'death', unit: u.id });
    if (u.team === 'party') {
      this.stats.deaths++;
      this.failLog.push(`${u.isHero ? 'You' : u.name} died to ${u.lastHit}.`);
      const other = this.companions.find((c) => c.alive);
      if (other) this.bark(other, 'death', true);
    } else {
      this.zones = this.zones.filter((z) => !(z.src === u.id && !z.fired));
      if (this.focus?.target === u.id) this.focus = null;
    }
  }

  private aggroGroup(group: number, by: Unit) {
    let any = false;
    for (const e of this.enemies) {
      if (e.group !== group || !e.alive || e.aggro) continue;
      e.aggro = true; any = true;
      for (const p of this.party()) e.threat[p.id] = 0.1;
      e.threat[by.id] = 5;
    }
    if (any) for (const c of this.companions) if (COMPANIONS[c.def].role !== 'healer' || this.rng.next() < 0.3) { this.bark(c, 'pull'); break; }
  }

  private interruptCast(e: Unit, by: Unit) {
    if (!e.cast) return;
    const c = e.cast;
    e.cast = null;
    if (c.mech) this.stats.answered++;
    this.events.push({ t: 'interrupted', unit: e.id, by: by.id, ability: c.ability });
    if (!by.isHero) this.bark(by, 'interrupt', true);
  }

  /** Returns 'ok' or the reason the ability could not be used. */
  private tryUse(u: Unit, abId: string, tgt: Unit | null): string {
    const a = ABILITIES[abId];
    if (!u.alive || u.cast || this.stunned(u)) return 'busy';
    if ((u.cds[abId] ?? 0) > 0) return 'cd';
    if (a.gcd > 0 && u.gcd > 0) return 'cd';
    if (a.mana && u.mana < a.mana) return 'mana';
    if (a.target !== 'self') {
      if (!tgt || !tgt.alive) return 'target';
      if (dist(u, tgt) - tgt.r > a.range) return 'range';
      if (a.target === 'enemy') u.face = Math.atan2(tgt.y - u.y, tgt.x - u.x);
    }
    const haste = this.mult(u, 'haste');
    u.cds[abId] = a.cd;
    if (a.gcd > 0) u.gcd = a.gcd / haste;
    if (a.mana) u.mana -= a.mana;
    if (a.cast > 0) {
      u.cast = { ability: abId, t: 0, dur: a.cast / haste, target: tgt?.id ?? u.id, mech: null };
      this.events.push({ t: 'castStart', unit: u.id, ability: abId });
    } else this.resolve(u, a, tgt ?? u);
    return 'ok';
  }

  private resolve(u: Unit, a: AbilityDef, tgt: Unit) {
    if (a.vis !== 'none') this.events.push({ t: 'fx', vis: a.vis, from: u.id, to: tgt.id });
    for (const f of a.fx) {
      switch (f.k) {
        case 'dmg': this.damage(u, tgt, f.amt, a.name, { threat: f.threat }); break;
        case 'aoe':
          for (const e of this.units) {
            if (e.team === u.team || !e.alive || this.has(e, 'cage')) continue;
            if (e.team === 'enemy' && !e.aggro) continue;
            if (dist(u, e) - e.r <= f.radius) this.damage(u, e, f.amt, a.name, { threat: f.threat });
          }
          break;
        case 'partyDmg': for (const p of this.party()) this.damage(u, p, f.amt, a.name); break;
        case 'heal': this.healUnit(u, tgt, f.amt); break;
        case 'partyHeal': for (const p of this.party()) this.healUnit(u, p, f.amt); break;
        case 'buffSelf': this.addBuff(u, f.buff, u); break;
        case 'buffTarget':
          if (tgt.alive) {
            this.addBuff(tgt, f.buff, u);
            if (BUFFS[f.buff].stun) { tgt.cast = null; if (tgt.team === 'enemy' && !tgt.aggro) this.aggroGroup(tgt.group, u); }
          }
          break;
        case 'dash': {
          const d = dist(u, tgt) || 1;
          const keep = tgt.r + 1.5;
          if (d > keep) { u.x = tgt.x + ((u.x - tgt.x) / d) * keep; u.y = tgt.y + ((u.y - tgt.y) / d) * keep; }
          break;
        }
        case 'interrupt': if (tgt.cast && ABILITIES[tgt.cast.ability].interruptible) this.interruptCast(tgt, u); break;
        case 'taunt': {
          let top = 0;
          for (const k in tgt.threat) top = Math.max(top, tgt.threat[k]);
          tgt.threat[u.id] = top * 1.3 + 50;
          break;
        }
        case 'mana': u.mana = Math.min(u.maxMana, u.mana + f.amt); break;
      }
    }
  }

  private progressCast(u: Unit, dt: number) {
    const c = u.cast;
    if (!c) return;
    c.t += dt;
    if (c.t < c.dur) return;
    u.cast = null;
    const a = ABILITIES[c.ability];
    const tgt = this.unit(c.target) ?? u;
    if (a.target !== 'self' && !tgt.alive) return;
    this.resolve(u, a, tgt);
    if (c.mech && c.mech.kind === 'cast') this.mechFailed(c.mech);
  }

  private mechFailed(m: MechanicDef) {
    this.stats.failed++;
    if (m.fail) {
      this.failLog.push(m.fail);
      this.events.push({ t: 'mechFail', mech: m.id, text: m.fail });
    }
    const c = this.rng.pick(this.companions);
    this.bark(c, 'fail');
  }

  private triggerMech(e: Unit, m: MechanicDef): boolean {
    const live = this.party().filter((p) => p.alive);
    if (!live.length) return false;
    const soft = live.filter((p) => p.role !== 'tank');
    const pickFrom = soft.length ? soft : live;
    let target = 0;
    const zone = (x: number, y: number, follow: number, wave = 0): Zone => ({
      id: this.zoneId++, mech: m, x, y, r: m.radius ?? 3, follow, src: e.id, t: 0, delay: m.telegraph, dur: m.dur ?? 0,
      fired: false, tickT: 0, wave,
    });
    switch (m.kind) {
      case 'cast':
        if (this.tryUse(e, m.ability!, e) !== 'ok') return false;
        e.cast!.mech = m;
        break;
      case 'slam':
        if (this.tryUse(e, m.ability!, e) !== 'ok') return false;
        this.zones.push(zone(e.x, e.y, 0));
        break;
      case 'soak': {
        const p = this.rng.pick(pickFrom);
        target = p.id;
        this.zones.push(zone(p.x, p.y, p.id));
        break;
      }
      case 'brand': {
        const wave = this.waveId++;
        for (const p of live) this.zones.push(zone(p.x, p.y, p.id, wave));
        break;
      }
      case 'pool': {
        const p = this.rng.pick(pickFrom);
        this.zones.push(zone(p.x, p.y, 0));
        break;
      }
    }
    this.seen[m.id] = true;
    this.events.push({ t: 'telegraph', mech: m.id, name: m.name, target, answer: m.answer });
    return true;
  }

  private fireZone(z: Zone) {
    const m = z.mech;
    const src = this.unit(z.src);
    const inside = (p: Unit) => p.alive && dist(p, z) <= z.r;
    this.events.push({ t: 'zoneFire', kind: m.kind, x: z.x, y: z.y, r: z.r });
    if (m.kind === 'soak') {
      const s = this.party().filter(inside);
      for (const p of s) this.damage(src, p, m.dmg! / s.length, m.name, { fixed: true });
      if (s.length < (m.need ?? 1)) this.mechFailed(m); else this.stats.answered++;
    } else if (m.kind === 'slam') {
      const s = this.party().filter(inside);
      for (const p of s) this.damage(src, p, m.dmg!, m.name);
    } else if (m.kind === 'brand') {
      // Resolve the whole wave together, from positions at the moment it lands.
      const wave = this.zones.filter((o) => o.wave === z.wave && !o.fired);
      const hits = new Map<Unit, number>();
      for (const o of wave) {
        o.fired = true;
        if (o !== z) this.events.push({ t: 'zoneFire', kind: m.kind, x: o.x, y: o.y, r: o.r });
        const owner = this.unit(o.follow);
        for (const p of this.party()) if (p !== owner && p.alive && dist(p, o) <= o.r) hits.set(p, (hits.get(p) ?? 0) + 1);
      }
      let overlaps = 0;
      for (const o of wave) { const p = this.unit(o.follow); if (p) this.damage(src, p, m.base ?? 0, m.name, { fixed: true }); }
      for (const [p, n] of hits) { overlaps += n; this.damage(src, p, m.dmg! * n, m.name, { fixed: true }); }
      if (overlaps > 0) this.mechFailed(m); else this.stats.answered++;
    }
  }

  // --------------------------------------------------------------- step

  step() {
    if (this.phase === 'wipe' || this.phase === 'victory') return;
    const dt = TICK;
    this.tick++; this.time += dt; this.stats.runTime += dt;
    for (const k of Object.keys(this.callCd) as CallId[]) this.callCd[k] = Math.max(0, this.callCd[k] - dt);
    if (this.focus) { this.focus.t -= dt; if (this.focus.t <= 0) this.focus = null; }
    for (const u of this.units) if (u.alive) this.tickUnit(u, dt);
    this.stepHero(dt);
    for (const c of this.companions) this.stepCompanion(c, dt);
    for (const e of this.enemies) this.stepEnemy(e, dt);
    this.separateEnemies();
    this.stepZones(dt);
    this.checkState();
  }

  private tickUnit(u: Unit, dt: number) {
    u.gcd = Math.max(0, u.gcd - dt);
    for (const k in u.cds) if (u.cds[k] > 0) u.cds[k] = Math.max(0, u.cds[k] - dt);
    for (let i = u.buffs.length - 1; i >= 0; i--) {
      const b = u.buffs[i]; const d = BUFFS[b.id];
      b.t += dt;
      if (d.dot) {
        b.tickT -= dt;
        if (b.tickT <= 0) { b.tickT += d.every!; this.damage(this.unit(b.src), u, d.dot, d.name); if (!u.alive) return; }
      }
      if (b.t >= d.dur) u.buffs.splice(u.buffs.indexOf(b), 1);
    }
    if (u.team === 'party') {
      if (this.inCombat) { if (u.maxMana) u.mana = Math.min(u.maxMana, u.mana + COMPANIONS[u.def].manaRegen * dt); }
      else { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.12 * dt); u.mana = Math.min(u.maxMana, u.mana + u.maxMana * 0.12 * dt); }
    }
  }

  private moveToward(u: Unit, x: number, y: number, step: number): boolean {
    const dx = x - u.x, dy = y - u.y; const d = Math.hypot(dx, dy);
    if (d < 0.12) return false;
    const s = Math.min(step, d);
    u.x = clamp(u.x + (dx / d) * s, ARENA.minX + u.r, ARENA.maxX - u.r);
    u.y = clamp(u.y + (dy / d) * s, ARENA.minY + u.r, ARENA.maxY - u.r);
    u.face = Math.atan2(dy, dx);
    return true;
  }

  private pickHeroTarget() {
    const h = this.hero;
    const near = this.enemies.filter((e) => e.alive && dist(e, h) < 30 && (e.aggro || dist(e, h) < 24));
    if (!near.length) { h.target = 0; return; }
    const kill = near.find((e) => e.marker === 'kill');
    if (kill) { h.target = kill.id; return; }
    const cur = this.unit(h.target);
    if (cur && near.includes(cur) && !this.has(cur, 'cage')) return;
    const free = near.filter((e) => !this.has(e, 'cage') && e.marker !== 'control');
    const pool = free.length ? free : near;
    let best = pool[0]; let bs = 1e9;
    for (const e of pool) {
      const d = dist(e, h);
      const front = Math.cos(Math.atan2(e.y - h.y, e.x - h.x) - h.face);
      const s = d - front * 4;
      if (s < bs) { bs = s; best = e; }
    }
    h.target = best.id;
  }

  private stepHero(dt: number) {
    const h = this.hero;
    if (!h.alive) { this.queued = null; return; }
    this.pickHeroTarget();
    if (!this.stunned(h)) {
      const len = Math.hypot(this.move.x, this.move.y);
      if (len > 0.08) {
        const k = Math.min(1, len) / len;
        this.moveToward(h, h.x + this.move.x * k * 10, h.y + this.move.y * k * 10, h.speed * Math.min(1, len) * dt);
      }
    }
    if (this.queued) {
      const ab = HERO.abilities[this.queued.slot];
      const a = ABILITIES[ab];
      const tgt = a.target === 'enemy' ? this.unit(h.target) : h;
      const res = this.tryUse(h, ab, tgt);
      if (res === 'ok') this.queued = null;
      else {
        this.queued.t -= dt;
        if (this.queued.t <= 0 || res === 'range' || res === 'target') {
          if (res === 'range') this.events.push({ t: 'hint', text: 'Too far away' });
          else if (res === 'target') this.events.push({ t: 'hint', text: 'No target' });
          this.queued = null;
        }
      }
    }
  }

  // ------------------------------------------------------- companion AI
  // A small priority list per role, plus a handler for each order.

  private dangerZone(c: Unit): Zone | null {
    for (const z of this.zones) {
      if (z.mech.kind !== 'pool' && !(z.mech.kind === 'slam' && !z.fired)) continue;
      if (dist(c, z) < z.r + 0.6) return z;
    }
    return null;
  }

  private companionTarget(c: Unit, d: CompanionDef): Unit | null {
    const live = this.enemies.filter((e) => e.alive && e.aggro);
    if (!live.length) return null;
    if (this.focus) { const f = this.unit(this.focus.target); if (f && f.alive) return f; }
    const free = live.filter((e) => e.marker !== 'control' && !this.has(e, 'cage'));
    const pool = free.length ? free : live;
    const kill = pool.find((e) => e.marker === 'kill');
    if (kill) return kill;
    const nearest = () => pool.reduce((a, b) => (dist(a, c) <= dist(b, c) ? a : b));
    if (d.role === 'tank') { const cur = this.unit(c.target); return cur && pool.includes(cur) ? cur : nearest(); }
    const tank = this.tank();
    const tt = tank && tank.alive ? this.unit(tank.target) : null;
    if (tt && pool.includes(tt)) return tt;
    const cur = this.unit(c.target);
    return cur && pool.includes(cur) ? cur : nearest();
  }

  private approach(c: Unit, t: { x: number; y: number }, keep: number) {
    const d = dist(c, t) || 1;
    return { x: t.x + ((c.x - t.x) / d) * keep, y: t.y + ((c.y - t.y) / d) * keep };
  }

  private combatSpot(c: Unit, d: CompanionDef, tgt: Unit | null) {
    if (d.role === 'healer') {
      const tank = this.tank();
      const anchor = tank && tank.alive ? tank : this.hero;
      return dist(c, anchor) > 20 ? this.approach(c, anchor, 14) : null;
    }
    if (!tgt) return null;
    const gap = dist(c, tgt) - tgt.r;
    if (d.role === 'tank') return gap > 2.0 ? this.approach(c, tgt, tgt.r + 1.4) : null;
    if (d.melee) {
      if (gap <= 2.2 && !this.dangerZone(c)) return null;
      // a spot in reach of the target, out of its face and out of the fire
      let best: { x: number; y: number } | null = null; let bd = 1e9;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const p = { x: tgt.x + Math.cos(a) * (tgt.r + 1.5), y: tgt.y + Math.sin(a) * (tgt.r + 1.5) };
        if (tgt.boss && Math.cos(a - tgt.face) > 0.4) continue;
        if (this.zones.some((z) => (z.mech.kind === 'pool' || z.mech.kind === 'slam') && dist(p, z) < z.r + 0.8)) continue;
        if (dist(p, this.hero) < 1.6) continue;
        const dd = dist(p, c);
        if (dd < bd) { bd = dd; best = p; }
      }
      return best;
    }
    return gap > d.range - 3 ? this.approach(c, tgt, d.range - 8) : null;
  }

  private stepCompanion(c: Unit, dt: number) {
    if (!c.alive) return;
    const d = COMPANIONS[c.def];
    c.barkT -= dt;
    if (c.order) { c.order.t -= dt; if (c.order.t <= 0) c.order = null; }
    if (c.maxMana) {
      const f = c.mana / c.maxMana;
      if (f < 0.08 && c.manaWarn < 2) { c.manaWarn = 2; this.bark(c, 'oom', true); }
      else if (f < 0.3 && c.manaWarn < 1) { c.manaWarn = 1; this.bark(c, 'lowmana', true); }
      else if (f > 0.6) c.manaWarn = 0;
    }
    if (this.stunned(c)) return;

    let dest: { x: number; y: number } | null = null;
    let speed = c.speed * (this.inCombat ? d.combatSpeed : 1.15);
    let urgent = false;
    if (c.order) {
      urgent = true;
      if (c.order.type === 'stack') {
        const a = c.slot * 1.57 + 0.8;
        dest = { x: this.hero.x + Math.cos(a) * 1.1, y: this.hero.y + Math.sin(a) * 1.1 };
      } else dest = { x: c.order.x, y: c.order.y };
    } else {
      const z = this.dangerZone(c);
      if (z) {
        c.awareT += dt;
        if (c.awareT >= d.react) { // leaves ground effects, but late and slowly
          urgent = true; speed *= 0.65;
          const dd = dist(c, z);
          const ux = dd > 0.1 ? (c.x - z.x) / dd : 0, uy = dd > 0.1 ? (c.y - z.y) / dd : -1;
          dest = { x: z.x + ux * (z.r + 1.6), y: z.y + uy * (z.r + 1.6) };
          if (d.melee && d.role !== 'tank' && this.inCombat) dest = this.combatSpot(c, d, this.companionTarget(c, d)) ?? dest;
        }
      } else c.awareT = 0;
    }
    const tgt = this.inCombat ? this.companionTarget(c, d) : null;
    if (tgt) c.target = tgt.id;
    if (!dest) {
      if (this.inCombat) dest = this.combatSpot(c, d, tgt);
      else {
        const fx = this.hero.x + d.follow.x, fy = this.hero.y + d.follow.y;
        if (Math.hypot(fx - c.x, fy - c.y) > 1.2) dest = { x: fx, y: fy };
      }
    }
    if (dest && Math.hypot(dest.x - c.x, dest.y - c.y) < 0.3) dest = null;
    if (c.cast) {
      if (dest && urgent && !d.finishCast) c.cast = null;
      else { this.progressCast(c, dt); return; }
    }
    c.moving = dest ? this.moveToward(c, dest.x, dest.y, speed * dt) : false;
    if (this.inCombat) this.companionAct(c, d, tgt);
  }

  private companionAct(c: Unit, d: CompanionDef, tgt: Unit | null) {
    if (d.taunt) {
      for (const e of this.enemies) {
        if (!e.alive || !e.aggro || e.marker === 'control' || this.has(e, 'cage') || e.target === c.id || !e.target) continue;
        if (this.tryUse(c, d.taunt, e) === 'ok') break;
      }
    }
    if (d.control) {
      const m = this.enemies.find((e) => e.alive && e.aggro && e.marker === 'control' && !this.has(e, 'cage'));
      const others = this.enemies.some((e) => e.alive && e.aggro && e.marker !== 'control');
      if (m && others && this.tryUse(c, d.control, m) === 'ok') { this.bark(c, 'cage'); return; }
    }
    if (d.role === 'healer') {
      if (c.moving) return;
      const allies = this.party().filter((p) => p.alive);
      const hurt = allies.filter((p) => p.hp / p.maxHp < 0.72).length;
      if (hurt >= 3 && this.tryUse(c, 'i_chorus', c) === 'ok') return;
      const low = allies.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b));
      if (low.maxHp - low.hp >= 150) this.tryUse(c, 'i_mend', low);
      return;
    }
    if (!tgt) return;
    for (const ab of d.rotation) {
      if (ABILITIES[ab].cast > 0 && c.moving) continue;
      if (this.tryUse(c, ab, tgt) === 'ok') break;
    }
  }

  // ----------------------------------------------------------- enemy AI

  private stepEnemy(e: Unit, dt: number) {
    if (!e.alive) return;
    const d = ENEMIES[e.def];
    if (!e.aggro) {
      for (const p of this.party()) if (p.alive && dist(e, p) < d.aggro) { this.aggroGroup(e.group, p); break; }
      return;
    }
    if (this.stunned(e)) return;
    e.swingT = Math.max(0, e.swingT - dt);
    if (e.cast) { this.progressCast(e, dt); return; }

    let t: Unit | null = null; let top = -1;
    const cur = this.unit(e.target);
    for (const p of this.party()) {
      if (!p.alive) continue;
      const th = (e.threat[p.id] ?? 0) * (p === cur ? 1.1 : 1);
      if (th > top) { top = th; t = p; }
    }
    if (!t) return;
    e.target = t.id;

    if (d.enrageAt && e.hp / e.maxHp < d.enrageAt) {
      e.enrageT -= dt;
      if (e.enrageT <= 0) {
        if (!this.has(e, 'enrage')) this.events.push({ t: 'banner', text: `${e.name.split(',')[0]} is overheating. Finish it!` });
        this.addBuff(e, 'enrage', e);
        e.enrageT = 6;
      }
    }
    for (let i = 0; i < d.mechanics.length; i++) e.mechT[i] -= dt;
    for (let i = 0; i < d.mechanics.length; i++) {
      if (e.mechT[i] <= 0 && this.triggerMech(e, d.mechanics[i])) { e.mechT[i] = d.mechanics[i].every; break; }
    }
    if (e.cast) return;

    const gap = dist(e, t) - e.r - t.r;
    if (gap > d.range) this.moveToward(e, t.x, t.y, e.speed * dt);
    else {
      e.face = Math.atan2(t.y - e.y, t.x - e.x);
      if (e.swingT <= 0) {
        e.swingT = d.swing;
        this.events.push({ t: 'fx', vis: d.range > 5 ? 'bolt' : 'melee', from: e.id, to: t.id });
        this.damage(e, t, d.dmg, e.name);
      }
    }
  }

  private separateEnemies() {
    const live = this.enemies.filter((e) => e.alive && e.aggro && !e.cast);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy); const min = a.r + b.r;
      if (d >= min) continue;
      const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0; const push = (min - d) * 0.25;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
    }
  }

  private stepZones(dt: number) {
    for (const z of this.zones) {
      z.t += dt;
      if (z.follow) { const u = this.unit(z.follow); if (u && u.alive) { z.x = u.x; z.y = u.y; } else if (!z.fired) { z.t = 1e9; z.fired = true; continue; } }
      if (!z.fired && z.t >= z.delay) { z.fired = true; this.fireZone(z); }
      if (z.fired && z.dur > 0 && z.t < z.delay + z.dur) {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += 0.5;
          for (const p of this.party()) if (p.alive && dist(p, z) <= z.r) this.damage(this.unit(z.src), p, z.mech.dmg!, z.mech.name, { ground: true });
        }
      }
    }
    this.zones = this.zones.filter((z) => !z.fired || (z.dur > 0 && z.t < z.delay + z.dur));
  }

  private checkState() {
    const fighting = this.enemies.some((e) => e.alive && e.aggro);
    if (fighting !== this.inCombat) {
      this.inCombat = fighting;
      this.events.push({ t: 'combat', on: fighting });
      if (!fighting) { // the pull is over: tidy up and pick up the fallen
        this.zones = [];
        this.focus = null;
        for (const p of this.party()) {
          p.order = null; p.cast = null;
          if (!p.alive) { p.alive = true; p.hp = p.maxHp * 0.5; p.buffs = []; }
        }
      }
    }
    if (this.phase === 'explore' || this.phase === 'combat') {
      const want: Phase = fighting ? 'combat' : 'explore';
      if (want !== this.phase) this.phase = want;
    }
    if (this.enemies.every((e) => !e.boss || !e.alive)) {
      this.phase = 'victory';
      this.events.push({ t: 'phase', phase: 'victory' });
      const c = this.companions.find((x) => x.alive);
      if (c) this.bark(c, 'win', true);
    } else if (this.party().every((p) => !p.alive)) {
      this.phase = 'wipe';
      this.events.push({ t: 'phase', phase: 'wipe' });
    }
  }

  /** Cheap state fingerprint, used to check determinism. */
  hash(): number {
    let h = this.tick;
    for (const u of this.units) h = (Math.imul(h, 31) + Math.round(u.x * 100) + Math.round(u.y * 100) * 7 + Math.round(u.hp) * 13) | 0;
    return h;
  }
}
