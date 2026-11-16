// Draws the simulation with three.js. Reads sim state; never changes it.
// Sim (x, y) maps to world (x, 0, -y), so north is into the screen.

import * as THREE from 'three';
import { ABILITIES, ARENA, COMPANIONS, ENEMIES, ENTRANCE, HERO, SPAWNS } from '../sim/data';
import type { Sim, SimEvent, Unit, Zone } from '../sim/sim';

interface UnitView {
  group: THREE.Group; rig: THREE.Group; mats: THREE.MeshLambertMaterial[]; base: THREE.Color[];
  bar: THREE.Group; fill: THREE.Mesh; marker: THREE.Sprite; castRing: THREE.Mesh; cage: THREE.Mesh;
  flash: number; flashColor: THREE.Color; bump: number; height: number; barW: number; lastX: number; lastY: number;
  walk: number; markerKey: string; dead: number;
}
interface ZoneView { group: THREE.Group; fill: THREE.Mesh; ring: THREE.Mesh }
interface Effect { obj: THREE.Object3D; t: number; dur: number; tick: (k: number) => void }

const ZONE_COLORS: Record<string, number> = { soak: 0x4aa8ff, brand: 0xff9a3c, pool: 0xff5a2a, slam: 0xff3838 };
const lam = (color: number, emissive = 0x000000) => new THREE.MeshLambertMaterial({ color, emissive });

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, 1, 0.5, 200);
  private units = new Map<number, UnitView>();
  private zones = new Map<number, ZoneView>();
  private effects: Effect[] = [];
  private focus = new THREE.Vector3(0, 0, -ENTRANCE.y);
  private targetRing: THREE.Mesh;
  private heroRing: THREE.Mesh;
  private markerTex: Record<string, THREE.Texture> = {};
  private v = new THREE.Vector3();
  private clock = 0;
  private w = 1; private h = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0x15100e);
    this.scene.fog = new THREE.Fog(0x15100e, 38, 80);
    this.scene.add(new THREE.HemisphereLight(0xfff0dc, 0x4a3830, 1.9));
    const sun = new THREE.DirectionalLight(0xffdcb8, 1.7);
    sun.position.set(-8, 20, 10);
    this.scene.add(sun);
    this.buildRoom();
    this.targetRing = this.flatRing(1, 0.14, 0xff5040, 0.9);
    this.heroRing = this.flatRing(0.85, 0.1, 0xffe08a, 0.9);
    this.scene.add(this.targetRing, this.heroRing);
    this.markerTex.kill = this.glyphTexture('☠', '#c62828');
    this.markerTex.control = this.glyphTexture('⛓', '#1565c0');
    this.resize();
  }

  resize() {
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- scenery

  private flatRing(r: number, width: number, color: number, opacity: number) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r - width, r, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  private glyphTexture(glyph: string, bg: string) {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = bg; g.beginPath(); g.arc(48, 48, 44, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = '56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(glyph, 48, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildRoom() {
    const W = ARENA.maxX - ARENA.minX, L = ARENA.maxY - ARENA.minY;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5e514a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const s = 84 + ((i * 7 + j * 13) % 5) * 4;
      g.fillStyle = `rgb(${s + 22},${s + 8},${s})`;
      g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(W / 8, L / 8); tex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -L / 2);
    this.scene.add(floor);

    const wallMat = lam(0x3a2e2a);
    const wall = (x: number, z: number, w: number, d: number, hgt = 4) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wallMat);
      m.position.set(x, hgt / 2, z); this.scene.add(m);
    };
    wall(ARENA.minX - 1, -L / 2, 2, L + 4); wall(ARENA.maxX + 1, -L / 2, 2, L + 4);
    wall(0, -L - 1, W + 4, 2, 6);
    // the gate between the hall and the boss room: wide open, purely a landmark
    wall(ARENA.minX + 3, -42, 6, 1.6, 5); wall(ARENA.maxX - 3, -42, 6, 1.6, 5);

    const fire = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const stone = lam(0x57463f);
    for (let y = 6; y < L; y += 9) for (const x of [ARENA.minX + 0.6, ARENA.maxX - 0.6]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.4, 8), stone);
      p.position.set(x, 1.2, -y); this.scene.add(p);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), fire);
      f.position.set(x, 2.75, -y); this.scene.add(f);
    }
    const boss = SPAWNS.find((s) => ENEMIES[s.def].boss)!;
    const dais = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0.07, depthWrite: false }));
    dais.rotation.x = -Math.PI / 2; dais.position.set(boss.x, 0.02, -boss.y); this.scene.add(dais);
    const rim = this.flatRing(12, 0.25, 0xff8a40, 0.35); rim.position.set(boss.x, 0.03, -boss.y); this.scene.add(rim);
    const cp = this.flatRing(2.2, 0.2, 0x6ad0ff, 0.6); cp.position.set(ENTRANCE.x, 0.03, -ENTRANCE.y); this.scene.add(cp);
  }

  // --------------------------------------------------------------- units

  private part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  }

  private buildUnit(u: Unit): UnitView {
    const group = new THREE.Group(); const rig = new THREE.Group(); group.add(rig);
    const mats: THREE.MeshLambertMaterial[] = [];
    const mat = (c: number, e = 0) => { const m = lam(c, e); mats.push(m); return m; };
    let height = 2.0; let barW = 1.4;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(u.r * 1.25, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; group.add(shadow);

    if (u.team === 'party') {
      const color = u.isHero ? HERO.color : COMPANIONS[u.def].color;
      const cls = u.isHero ? HERO.cls : COMPANIONS[u.def].cls;
      const body = mat(color); const skin = mat(0xe8c39e); const dark = mat(0x2b2422);
      this.part(new THREE.CapsuleGeometry(0.42, 0.7, 4, 10), body, 0, 0.85, 0, rig);
      this.part(new THREE.SphereGeometry(0.3, 12, 10), skin, 0, 1.72, 0, rig);
      if (cls === 'Warden') {
        rig.scale.set(1.2, 1.05, 1.2);
        this.part(new THREE.BoxGeometry(0.75, 0.95, 0.12), mat(0xc9d6ea), -0.35, 0.95, 0.5, rig);
        this.part(new THREE.BoxGeometry(1.1, 0.25, 0.5), dark, 0, 1.35, 0, rig);
      } else if (cls === 'Mender') {
        this.part(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), dark, 0.5, 1.0, 0.15, rig);
        this.part(new THREE.SphereGeometry(0.17, 10, 8), mat(0xaaffcc, 0x44cc88), 0.5, 2.1, 0.15, rig);
        this.part(new THREE.ConeGeometry(0.55, 0.9, 10), body, 0, 0.45, 0, rig);
      } else if (cls === 'Pyromancer') {
        this.part(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6), dark, 0.5, 0.95, 0.15, rig);
        this.part(new THREE.SphereGeometry(0.19, 10, 8), mat(0xffd080, 0xff7a20), 0.5, 2.0, 0.15, rig);
        this.part(new THREE.ConeGeometry(0.36, 0.6, 10), body, 0, 2.05, 0, rig);
      } else {
        const steel = mat(0xdfe6ee);
        this.part(new THREE.BoxGeometry(0.07, 0.07, 1.0), steel, 0.5, 0.95, 0.45, rig);
        this.part(new THREE.BoxGeometry(0.07, 0.07, 1.0), steel, -0.5, 0.95, 0.45, rig);
        if (u.isHero) this.part(new THREE.BoxGeometry(0.7, 0.9, 0.06), mat(0x8a2b2b), 0, 0.95, -0.42, rig);
      }
    } else {
      const d = ENEMIES[u.def];
      const body = mat(d.color); const dark = mat(0x241a18);
      if (u.def === 'thrall') {
        this.part(new THREE.CapsuleGeometry(0.45, 0.6, 4, 10), body, 0, 0.8, 0, rig);
        this.part(new THREE.SphereGeometry(0.3, 10, 8), dark, 0, 1.6, 0, rig);
        this.part(new THREE.ConeGeometry(0.09, 0.4, 6), mat(0xd8c8b0), 0.2, 1.95, 0, rig);
        this.part(new THREE.ConeGeometry(0.09, 0.4, 6), mat(0xd8c8b0), -0.2, 1.95, 0, rig);
      } else if (u.def === 'hexer') {
        this.part(new THREE.ConeGeometry(0.6, 1.9, 10), body, 0, 0.95, 0, rig);
        this.part(new THREE.SphereGeometry(0.28, 10, 8), dark, 0, 1.95, 0, rig);
        this.part(new THREE.SphereGeometry(0.2, 10, 8), mat(0xe0b0ff, 0xb040ff), 0.45, 1.5, 0.3, rig);
        height = 2.5;
      } else if (u.def === 'brute') {
        this.part(new THREE.BoxGeometry(1.5, 1.5, 1.1), body, 0, 1.0, 0, rig);
        this.part(new THREE.SphereGeometry(0.36, 10, 8), dark, 0, 2.0, 0.1, rig);
        this.part(new THREE.BoxGeometry(0.4, 0.4, 1.3), mat(0x555555), 0.95, 1.0, 0.5, rig);
        height = 2.7; barW = 2;
      } else {
        this.part(new THREE.CylinderGeometry(1.25, 1.7, 3.2, 10), body, 0, 1.6, 0, rig);
        this.part(new THREE.BoxGeometry(4.2, 0.9, 1.5), dark, 0, 3.2, 0, rig);
        this.part(new THREE.SphereGeometry(0.75, 12, 10), dark, 0, 4.1, 0.1, rig);
        this.part(new THREE.SphereGeometry(0.6, 12, 10), mat(0xffb060, 0xff5a10), 0, 2.2, 1.25, rig);
        this.part(new THREE.ConeGeometry(0.22, 1.1, 6), mat(0xd8c8b0), 0.6, 4.9, 0, rig).rotation.z = -0.4;
        this.part(new THREE.ConeGeometry(0.22, 1.1, 6), mat(0xd8c8b0), -0.6, 4.9, 0, rig).rotation.z = 0.4;
        height = 5.7; barW = 5;
      }
    }

    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(barW + 0.1, 0.24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.15), new THREE.MeshBasicMaterial({ color: u.team === 'party' ? 0x5fdc6a : 0xe8443a, depthTest: false }));
    bg.renderOrder = 10; fill.renderOrder = 11;
    bar.add(bg, fill);
    this.scene.add(bar);

    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    marker.scale.set(1.1, 1.1, 1); marker.renderOrder = 12; marker.visible = false;
    this.scene.add(marker);

    const castRing = this.flatRing(u.r + 0.75, 0.22, 0xffd54a, 0.95); castRing.position.y = 0.05; castRing.visible = false;
    group.add(castRing);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(u.r + 0.5, u.r + 0.5, height, 10, 3, true), new THREE.MeshBasicMaterial({ color: 0xffa040, wireframe: true, transparent: true, opacity: 0.8 }));
    cage.position.y = height / 2; cage.visible = false; group.add(cage);

    this.scene.add(group);
    return {
      group, rig, mats, base: mats.map((m) => m.emissive.clone()), bar, fill, marker, castRing, cage, flash: 0,
      flashColor: new THREE.Color(0xffffff), bump: 0, height, barW, lastX: u.x, lastY: u.y, walk: 0, markerKey: '', dead: 0,
    };
  }

  private flash(id: number, color: number, amount = 1) {
    const v = this.units.get(id); if (!v) return;
    v.flash = amount; v.flashColor.set(color);
  }

  private addEffect(obj: THREE.Object3D, dur: number, tick: (k: number) => void) {
    this.scene.add(obj); this.effects.push({ obj, t: 0, dur, tick });
  }

  private burstRing(x: number, y: number, r: number, color: number, dur = 0.45, fill = false) {
    const geo = fill ? new THREE.CircleGeometry(1, 40) : new THREE.RingGeometry(0.86, 1, 40);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, -y);
    this.addEffect(m, dur, (k) => { const s = r * (fill ? 1 : 0.2 + 0.8 * k); m.scale.set(s, s, s); (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); });
  }

  onEvent(e: SimEvent, sim: Sim) {
    if (e.t === 'fx') {
      const a = sim.unit(e.from), b = sim.unit(e.to);
      if (!a || !b) return;
      if (e.vis === 'melee') {
        const v = this.units.get(a.id); if (v) v.bump = 1;
        if (b !== a) this.flash(b.id, 0xffffff, 0.7);
      } else if (e.vis === 'bolt') {
        const color = a.team === 'party' ? 0xffa040 : 0xc070ff;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color }));
        const from = new THREE.Vector3(a.x, 1.5, -a.y), to = new THREE.Vector3(b.x, 1.2, -b.y);
        this.addEffect(m, 0.2, (k) => m.position.lerpVectors(from, to, k));
        this.flash(b.id, color, 0.6);
      } else if (e.vis === 'heal') {
        if (b === a && ABILITIES.i_chorus) this.burstRing(a.x, a.y, 9, 0x6dffa0, 0.6);
        this.flash(b.id, 0x40ff80, 0.8);
      } else if (e.vis === 'nova') this.burstRing(a.x, a.y, a.team === 'party' ? 7 : 14, a.team === 'party' ? 0x9ec4ff : 0xff5030, 0.5);
      else if (e.vis === 'buff') { this.burstRing(a.x, a.y, 2.2, 0xffe08a, 0.5); this.flash(a.id, 0xffd060, 1); }
    } else if (e.t === 'zoneFire') {
      this.burstRing(e.x, e.y, e.r, ZONE_COLORS[e.kind] ?? 0xffffff, 0.5, true);
    } else if (e.t === 'interrupted') {
      const u = sim.unit(e.unit); if (!u) return;
      this.flash(u.id, 0xffffff, 1.4); this.burstRing(u.x, u.y, u.r + 2.5, 0xffffff, 0.35);
    } else if (e.t === 'call') {
      for (const id of e.responders) { const u = sim.unit(id); if (u) this.burstRing(u.x, u.y, 1.6, 0x7fd4ff, 0.5); }
    }
  }

  // ---------------------------------------------------------------- sync

  update(sim: Sim, dt: number) {
    this.clock += dt;
    const cq = this.camera.quaternion;
    for (const u of sim.units) {
      let v = this.units.get(u.id);
      if (!v) { v = this.buildUnit(u); this.units.set(u.id, v); v.group.position.set(u.x, 0, -u.y); }
      const g = v.group;
      const jump = Math.hypot(u.x - g.position.x, -u.y - g.position.z) > 6;
      const k = jump ? 1 : Math.min(1, dt * 16);
      g.position.x += (u.x - g.position.x) * k; g.position.z += (-u.y - g.position.z) * k;
      let da = u.face + Math.PI / 2 - g.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      g.rotation.y += da * Math.min(1, dt * 12);

      const moved = Math.hypot(u.x - v.lastX, u.y - v.lastY) > 0.01; v.lastX = u.x; v.lastY = u.y;
      if (moved && u.alive) v.walk += dt * 14;
      v.bump = Math.max(0, v.bump - dt * 6);
      v.rig.position.set(0, u.alive && moved ? Math.abs(Math.sin(v.walk)) * 0.12 : 0, v.bump * 0.45);

      v.dead += ((u.alive ? 0 : 1) - v.dead) * Math.min(1, dt * 8);
      v.rig.rotation.x = -v.dead * (Math.PI / 2) * 0.95;
      v.rig.position.y += v.dead * 0.35;
      g.visible = !(u.team === 'enemy' && !u.alive && v.dead > 0.98);

      v.flash = Math.max(0, v.flash - dt * 5);
      for (let i = 0; i < v.mats.length; i++) v.mats[i].emissive.copy(v.base[i]).lerp(v.flashColor, Math.min(1, v.flash) * 0.8);

      v.bar.visible = u.alive;
      v.bar.position.set(g.position.x, v.height + 0.45, g.position.z);
      v.bar.quaternion.copy(cq);
      const f = Math.max(0, u.hp / u.maxHp);
      v.fill.scale.x = Math.max(0.001, f); v.fill.position.x = (-v.barW / 2) * (1 - f);

      const key = u.alive ? u.marker ?? '' : '';
      if (key !== v.markerKey) {
        v.markerKey = key; v.marker.visible = !!key;
        if (key) { v.marker.material.map = this.markerTex[key]; v.marker.material.needsUpdate = true; }
      }
      v.marker.position.set(g.position.x, v.height + 1.35, g.position.z);

      const casting = u.alive && u.cast && u.team === 'enemy';
      v.castRing.visible = !!casting;
      if (casting) {
        const s = 0.5 + 0.5 * (u.cast!.t / u.cast!.dur);
        v.castRing.scale.set(s, s, s);
        (v.castRing.material as THREE.MeshBasicMaterial).color.set(ABILITIES[u.cast!.ability].interruptible ? 0xffd54a : 0x9a9a9a);
      }
      v.cage.visible = u.alive && sim.has(u, 'cage');
      if (v.cage.visible) v.cage.rotation.y += dt * 1.5;
    }

    const h = sim.hero;
    const hv = this.units.get(h.id)!;
    this.heroRing.position.set(hv.group.position.x, 0.04, hv.group.position.z);
    this.heroRing.visible = h.alive;
    const t = sim.unit(h.target);
    this.targetRing.visible = !!(t && t.alive);
    if (t && t.alive) {
      const tv = this.units.get(t.id)!;
      const s = t.r + 0.55 + Math.sin(this.clock * 5) * 0.05;
      this.targetRing.scale.set(s, s, s);
      this.targetRing.position.set(tv.group.position.x, 0.04, tv.group.position.z);
    }

    this.syncZones(sim);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t += dt;
      if (e.t >= e.dur) { this.scene.remove(e.obj); this.effects.splice(i, 1); } else e.tick(e.t / e.dur);
    }

    // camera: follow the hero, lean toward the fight
    const want = this.v.set(hv.group.position.x, 0, hv.group.position.z);
    if (t && t.alive && sim.inCombat) { want.x += (t.x - h.x) * 0.3; want.z += (-t.y + h.y) * 0.3; }
    this.focus.lerp(want, Math.min(1, dt * 4));
    const portrait = this.camera.aspect < 1;
    const pull = portrait ? 1.7 : this.camera.aspect < 1.6 ? 1.15 : 1;
    this.camera.position.set(this.focus.x * 0.85, 18 * pull, this.focus.z + 13 * pull);
    this.camera.lookAt(this.focus.x * 0.85, 0, this.focus.z - 2);
    this.renderer.render(this.scene, this.camera);
  }

  private syncZones(sim: Sim) {
    const live = new Set<number>();
    for (const z of sim.zones) {
      live.add(z.id);
      let v = this.zones.get(z.id);
      if (!v) { v = this.buildZone(z); this.zones.set(z.id, v); }
      v.group.position.set(z.x, 0.06, -z.y);
      const fm = v.fill.material as THREE.MeshBasicMaterial;
      if (!z.fired) {
        const k = Math.min(1, z.t / z.delay);
        v.fill.scale.set(k, k, k);
        fm.opacity = 0.22 + 0.2 * k;
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(this.clock * (6 + 10 * k));
      } else {
        v.fill.scale.set(1, 1, 1);
        fm.opacity = 0.42 + 0.1 * Math.sin(this.clock * 7 + z.id);
      }
    }
    for (const [id, v] of this.zones) if (!live.has(id)) { this.scene.remove(v.group); this.zones.delete(id); }
  }

  private buildZone(z: Zone): ZoneView {
    const color = ZONE_COLORS[z.mech.kind] ?? 0xffffff;
    const group = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(z.r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    const ring = this.flatRing(z.r, 0.16, color, 1);
    ring.position.y = 0.01;
    group.add(fill, ring);
    this.scene.add(group);
    return { group, fill, ring };
  }

  /** Screen position of a point in the world, for labels drawn in the DOM. */
  project(x: number, y: number, height: number): { x: number; y: number; on: boolean } {
    this.v.set(x, height, -y).project(this.camera);
    const on = this.v.z < 1 && Math.abs(this.v.x) <= 1 && Math.abs(this.v.y) <= 1;
    return { x: (this.v.x * 0.5 + 0.5) * this.w, y: (-this.v.y * 0.5 + 0.5) * this.h, on };
  }

  heightOf(id: number): number { return this.units.get(id)?.height ?? 2; }
}
