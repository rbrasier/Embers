// Touch-first HUD and input, drawn in the DOM over the 3D view.
// Left thumb: stick and call wheel. Right thumb: abilities and the contextual call.

import { ABILITIES, CALLS, CALL_ORDER, COMPANIONS, ENEMIES, HERO, type CallId } from '../sim/data';
import type { Sim, SimEvent, Unit } from '../sim/sim';
import type { View } from '../render/view';
import type { Sfx } from './audio';

const el = (tag: string, cls = '', html = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const WHEEL_ANGLES = [100, 65, 30, -5, -40]; // degrees, fanned up and to the right of the call button
const KEY_ABILITY: Record<string, number> = { Digit1: 0, KeyJ: 0, Digit2: 1, KeyK: 1, Digit3: 2, KeyL: 2, Digit4: 3, Semicolon: 3, Space: 4 };
const KEY_CALL: Record<string, CallId> = { KeyQ: 'interrupt', KeyE: 'stack', KeyR: 'spread', KeyF: 'burst', KeyC: 'focus' };

interface Bubble { node: HTMLElement; unit: number; t: number }

export class Hud {
  paused = true;
  private held = new Set<number>();
  private keys = new Set<string>();
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private wheel = { id: -1, sel: -1 };
  private frames: { root: HTMLElement; hp: HTMLElement; mp: HTMLElement | null; tag: HTMLElement; unit: Unit }[] = [];
  private abilityBtns: { root: HTMLElement; cd: HTMLElement; num: HTMLElement }[] = [];
  private strip: { root: HTMLElement; cd: HTMLElement }[] = [];
  private wheelItems: HTMLElement[] = [];
  private bubbles: Bubble[] = [];
  private arrows: HTMLElement[] = [];
  private packKey = '';
  private packSel = 0;
  private bannerT = 0;
  private hintT = 0;
  private promptCall: CallId | null = null;
  private screen = '';
  private $: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement, private sim: Sim, private view: View, private sfx: Sfx) {
    this.build();
    this.bind();
    this.showStart();
  }

  // --------------------------------------------------------------- build

  private add(id: string, cls = '', html = '', parent: HTMLElement = this.root) {
    const e = el('div', cls, html); e.id = id; parent.appendChild(e); this.$[id] = e; return e;
  }

  private build() {
    const frames = this.add('frames');
    for (const u of this.sim.party()) {
      const color = u.isHero ? HERO.color : COMPANIONS[u.def].color;
      const root = el('div', 'pf', `<b style="background:#${color.toString(16).padStart(6, '0')}"></b><span class="nm">${u.name}</span><span class="tag"></span><div class="hp"><i></i></div>${u.maxMana ? '<div class="mp"><i></i></div>' : ''}`);
      frames.appendChild(root);
      this.frames.push({ root, hp: root.querySelector('.hp i')!, mp: root.querySelector('.mp i'), tag: root.querySelector('.tag')!, unit: u });
    }
    const top = this.add('top');
    this.add('target', '', '<div class="nm"></div><div class="bar"><i></i></div>', top);
    this.add('castbar', '', '<div class="bar"><i></i></div><div class="nm"></div>', top);
    this.add('banner', '', '', top);
    this.add('pack');
    this.add('packMenu', '', '<button data-m="kill">☠ Kill</button><button data-m="control">⛓ Control</button>');
    this.add('menuBtn', 'round', '☰');
    this.add('stickZone', '', '<div id="stickBase"><div id="stickKnob"></div></div>');
    this.$.stickBase = this.root.querySelector('#stickBase')!; this.$.stickKnob = this.root.querySelector('#stickKnob')!;

    const strip = this.add('strip');
    for (const id of CALL_ORDER) {
      const r = el('div', 'si', `<span>${CALLS[id].glyph}</span><i></i>`);
      strip.appendChild(r); this.strip.push({ root: r, cd: r.querySelector('i')! });
    }
    this.add('callBtn', 'round', '<span>📣</span><small>CALL</small>');
    const wheel = this.add('wheel');
    for (const id of CALL_ORDER) {
      const w = el('div', 'wi', `<span>${CALLS[id].glyph}</span><small>${CALLS[id].name}</small>`);
      wheel.appendChild(w); this.wheelItems.push(w);
    }
    this.add('prompt', '', '<span class="g"></span><b></b><small></small><i></i>');

    const ab = this.add('abilities');
    HERO.abilities.forEach((id, i) => {
      const a = ABILITIES[id];
      const b = el('div', `ab ab${i} round`, `<span>${a.glyph}</span><small>${a.name}</small><i></i><em></em>`);
      b.dataset.slot = String(i); ab.appendChild(b);
      this.abilityBtns.push({ root: b, cd: b.querySelector('i')!, num: b.querySelector('em')! });
    });
    this.add('float');
    for (let i = 0; i < 4; i++) { const a = el('div', 'arrow', '⚠'); this.$.float.appendChild(a); this.arrows.push(a); }
    this.add('hint');
    this.add('down', '', 'You are down. You can still make calls. <button>Retry</button>');
    this.add('overlay');
    this.add('rotate', '', '<div>⟳</div>Turn your phone sideways to play');
  }

  // --------------------------------------------------------------- input

  private bind() {
    const $ = this.$;
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    $.stickZone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      stop(e); $.stickZone.setPointerCapture(e.pointerId);
      this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY;
      $.stickBase.style.left = `${e.clientX}px`; $.stickBase.style.top = `${e.clientY}px`; $.stickBase.classList.add('on');
    });
    $.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      const max = $.stickBase.offsetWidth * 0.42;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      this.stick.x = dx / max; this.stick.y = -dy / max;
      $.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const stickEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1; this.stick.x = this.stick.y = 0;
      $.stickKnob.style.transform = ''; $.stickBase.classList.remove('on'); $.stickBase.style.left = $.stickBase.style.top = '';
    };
    $.stickZone.addEventListener('pointerup', stickEnd); $.stickZone.addEventListener('pointercancel', stickEnd);

    for (const b of this.abilityBtns) {
      const slot = Number(b.root.dataset.slot);
      b.root.addEventListener('pointerdown', (e) => {
        stop(e); b.root.setPointerCapture(e.pointerId);
        this.sim.pressAbility(slot); this.held.add(slot); b.root.classList.add('down');
      });
      const up = () => { this.held.delete(slot); b.root.classList.remove('down'); };
      b.root.addEventListener('pointerup', up); b.root.addEventListener('pointercancel', up);
    }

    // Call wheel: hold to open, slide to a call, release to send.
    $.callBtn.addEventListener('pointerdown', (e) => {
      stop(e); $.callBtn.setPointerCapture(e.pointerId);
      this.wheel.id = e.pointerId; this.wheel.sel = -1;
      const r = $.callBtn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width * 1.75;
      $.wheel.style.left = `${cx}px`; $.wheel.style.top = `${cy}px`; $.wheel.classList.add('on');
      this.wheelItems.forEach((w, i) => {
        const a = (WHEEL_ANGLES[i] * Math.PI) / 180;
        w.style.transform = `translate(${Math.cos(a) * rad}px, ${-Math.sin(a) * rad}px)`;
      });
    });
    $.callBtn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.wheel.id) return;
      const r = $.callBtn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = -(e.clientY - (r.top + r.height / 2));
      let sel = -1;
      if (Math.hypot(dx, dy) > r.width * 0.6) {
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI; let best = 28;
        WHEEL_ANGLES.forEach((a, i) => { const d = Math.abs(((ang - a + 540) % 360) - 180); if (d < best) { best = d; sel = i; } });
      }
      this.wheel.sel = sel;
      this.wheelItems.forEach((w, i) => w.classList.toggle('sel', i === sel));
    });
    const wheelEnd = (e: PointerEvent, fire: boolean) => {
      if (e.pointerId !== this.wheel.id) return;
      this.wheel.id = -1; $.wheel.classList.remove('on');
      this.wheelItems.forEach((w) => w.classList.remove('sel'));
      if (fire && this.wheel.sel >= 0) this.sim.call(CALL_ORDER[this.wheel.sel]);
    };
    $.callBtn.addEventListener('pointerup', (e) => wheelEnd(e, true));
    $.callBtn.addEventListener('pointercancel', (e) => wheelEnd(e, false));

    $.prompt.addEventListener('pointerdown', (e) => { stop(e); if (this.promptCall) this.sim.call(this.promptCall); });

    $.pack.addEventListener('pointerdown', (e) => {
      const p = (e.target as HTMLElement).closest('.pk') as HTMLElement | null;
      if (!p) return;
      stop(e);
      const id = Number(p.dataset.id);
      this.packSel = this.packSel === id ? 0 : id;
      this.packKey = '';
    });
    $.packMenu.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      stop(e);
      this.sim.setMarker(this.packSel, b.dataset.m as 'kill' | 'control');
      this.packSel = 0; this.packKey = '';
    });

    $.menuBtn.addEventListener('pointerdown', (e) => { stop(e); this.showMenu(); });
    $.down.querySelector('button')!.addEventListener('click', () => this.sim.retry());
    $.overlay.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.act) this.act(b.dataset.act);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') { if (this.screen === 'menu') this.close(); else if (!this.screen) this.showMenu(); return; }
      if (e.code === 'Enter' && (this.screen === 'start' || this.screen === 'wipe')) { this.act(this.screen === 'start' ? 'start' : 'retry'); return; }
      if (this.paused) return;
      if (e.code in KEY_ABILITY) { e.preventDefault(); this.sim.pressAbility(KEY_ABILITY[e.code]); this.held.add(KEY_ABILITY[e.code]); }
      else if (e.code in KEY_CALL) this.sim.call(KEY_CALL[e.code]);
      else if (e.code === 'KeyG' && this.promptCall) this.sim.call(this.promptCall);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code in KEY_ABILITY) this.held.delete(KEY_ABILITY[e.code]); });
    window.addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });
  }

  /** Called once per frame before the sim steps. */
  applyInput() {
    const k = this.keys;
    let x = this.stick.x, y = this.stick.y;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    this.sim.move.x = x; this.sim.move.y = y;
    if (this.held.has(0)) this.sim.pressAbility(0); // hold Slash to keep swinging
  }

  // ------------------------------------------------------------- screens

  private open(name: string, html: string) {
    this.screen = name; this.paused = true;
    this.$.overlay.innerHTML = `<div class="card ${name}">${html}</div>`;
    this.$.overlay.classList.add('on');
  }
  private close() { this.screen = ''; this.paused = false; this.$.overlay.classList.remove('on'); }

  private act(a: string) {
    this.sfx.unlock();
    if (a === 'start') {
      this.close();
      const d = document.documentElement as any;
      if (matchMedia('(pointer: coarse)').matches) {
        try { void (d.requestFullscreen?.() as Promise<void> | undefined)?.then(() => (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}))?.catch?.(() => {}); } catch { /* not supported */ }
      }
    } else if (a === 'resume') this.close();
    else if (a === 'retry') { this.sim.retry(); this.close(); }
    else if (a === 'again') location.reload();
    else if (a === 'notes') this.showNotes();
    else if (a === 'menu') this.showMenu();
    else if (a === 'sound') { this.sfx.muted = !this.sfx.muted; this.showMenu(); }
  }

  private showStart() {
    this.open('start', `
      <h1>EMBERS</h1>
      <p class="sub">Working title · grey-box build · one pack, one boss</p>
      <p>You play one Blade and call the shots for four companions. They fight well on their own, but they will not interrupt, stack, spread or burn cooldowns unless you tell them to.</p>
      <ul>
        <li><b>Left thumb</b> moves. <b>Right thumb</b> attacks. Hold Slash to keep swinging.</li>
        <li><b>Hold 📣 CALL</b>, slide to a call, release. The big pulsing button is a one-tap shortcut when a call is relevant.</li>
        <li><b>Tap an enemy portrait</b> (top right) to mark it Kill or Control.</li>
        <li><b>☰</b> has boss notes and keyboard controls.</li>
      </ul>
      <button data-act="start" class="go">Enter the Kiln</button>`);
  }

  private showMenu() {
    this.open('menu', `
      <h2>Paused</h2>
      <button data-act="resume" class="go">Resume</button>
      <button data-act="notes">Boss notes and party</button>
      <button data-act="retry">Restart from checkpoint</button>
      <button data-act="sound">Sound: ${this.sfx.muted ? 'off' : 'on'}</button>
      <p class="keys"><b>Keyboard</b> · Move WASD · Abilities 1 2 3 4 · Evade Space · Interrupt Q · Stack E · Spread R · Burst F · Focus C · Prompt G · Menu Esc</p>`);
  }

  private showNotes() {
    const mechs = Object.values(ENEMIES).flatMap((d) => d.mechanics.map((m) => ({ d, m })));
    const rows = mechs.map(({ d, m }) => this.sim.seen[m.id]
      ? `<li><b>${m.name}</b> <span class="who">${d.name.split(',')[0]}${m.answer ? ` · answer: ${CALLS[m.answer].glyph} ${CALLS[m.answer].name}` : ''}</span><br>${m.how}</li>`
      : `<li class="unk"><b>???</b> <span class="who">${d.name.split(',')[0]}</span><br>Not seen yet.</li>`).join('');
    const party = Object.values(COMPANIONS).map((c) => `<li><b>${c.name}</b> <span class="who">${c.cls}</span><br>＋ ${c.strength}<br>－ ${c.quirk}</li>`).join('');
    const calls = CALL_ORDER.map((id) => `<li><b>${CALLS[id].glyph} ${CALLS[id].name}</b> <span class="who">${CALLS[id].cd} s</span><br>${CALLS[id].desc}</li>`).join('');
    this.open('notes', `<h2>Notes</h2><div class="cols"><div><h3>Mechanics</h3><ul>${rows}</ul></div><div><h3>Party</h3><ul>${party}</ul><h3>Calls</h3><ul>${calls}</ul></div></div><button data-act="menu" class="go">Back</button>`);
  }

  private showWipe() {
    const boss = this.sim.enemies.find((e) => e.boss)!;
    const counts = new Map<string, number>();
    for (const f of this.sim.failLog) counts.set(f, (counts.get(f) ?? 0) + 1);
    const lines = [...counts].slice(0, 7).map(([t, n]) => `<li>${t}${n > 1 ? ` <span class="who">×${n}</span>` : ''}</li>`).join('');
    this.open('wipe', `
      <h2>Wipe</h2>
      <p class="sub">${boss.aggro ? `${boss.name.split(',')[0]} had ${Math.ceil((boss.hp / boss.maxHp) * 100)}% health left.` : 'The pack got the better of you.'}</p>
      <h3>What went wrong</h3><ul>${lines || '<li>The party ran out of health.</li>'}</ul>
      <button data-act="retry" class="go">Retry from checkpoint</button>
      <button data-act="notes">Boss notes</button>`);
  }

  private showVictory() {
    const s = this.sim.stats;
    const mm = Math.floor(s.runTime / 60), ss = Math.floor(s.runTime % 60).toString().padStart(2, '0');
    this.open('victory', `
      <h2>The Kiln is cold</h2>
      <div class="stats"><div><b>${mm}:${ss}</b>time</div><div><b>${s.wipes}</b>wipes</div><div><b>${s.calls}</b>calls</div><div><b>${s.answered}</b>mechanics handled</div><div><b>${s.failed}</b>missed</div></div>
      <p>That is the whole grey-box: one pack and one boss. Was it still interesting on the fifth pull?</p>
      <button data-act="again" class="go">Run it again</button>`);
  }

  // -------------------------------------------------------------- events

  private float(text: string, cls: string, x: number, y: number) {
    const n = el('span', `ft ${cls}`, text);
    n.style.left = `${x}px`; n.style.top = `${y}px`;
    this.$.float.appendChild(n);
    setTimeout(() => n.remove(), 900);
  }

  private banner(text: string, cls = '') {
    this.$.banner.textContent = text; this.$.banner.className = `on ${cls}`; this.bannerT = 2.6;
  }

  private hint(text: string) {
    if (this.hintT > 1.4) return;
    this.$.hint.textContent = text; this.$.hint.className = 'on'; this.hintT = 1.8;
  }

  onEvent(e: SimEvent) {
    const sim = this.sim;
    switch (e.t) {
      case 'dmg': {
        const tgt = sim.unit(e.tgt)!;
        const mine = e.src === sim.hero.id && tgt.team === 'enemy';
        const hurt = tgt.team === 'party' && e.amt >= 100;
        if (!mine && !hurt) break;
        const p = this.view.project(tgt.x, tgt.y, this.view.heightOf(tgt.id) * 0.8);
        if (p.on) this.float(String(e.amt), mine ? 'mine' : 'hurt', p.x + (Math.random() - 0.5) * 30, p.y);
        break;
      }
      case 'bark': {
        const node = el('div', 'bark', e.text);
        this.$.float.appendChild(node);
        for (const b of this.bubbles) if (b.unit === e.unit) b.t = 0;
        this.bubbles.push({ node, unit: e.unit, t: 2.8 });
        break;
      }
      case 'call': this.sfx.play(e.id); this.banner(`${CALLS[e.id].glyph} ${CALLS[e.id].name}!`, 'call'); break;
      case 'callFail': this.sfx.play('deny'); this.hint(`${CALLS[e.id].name}: ${e.reason}`); break;
      case 'castStart': { const u = sim.unit(e.unit)!; if (u.team === 'enemy' && ABILITIES[e.ability].interruptible) this.sfx.play('cast'); break; }
      case 'telegraph': {
        if (e.answer === 'interrupt') break; // the cast bar carries these
        this.sfx.play('telegraph');
        const who = sim.unit(e.target);
        this.banner(`${e.name}${who ? ` on ${who.isHero ? 'YOU' : who.name}` : ''}`, 'warn');
        break;
      }
      case 'interrupted': {
        this.sfx.play('interrupted');
        const by = sim.unit(e.by)!;
        this.banner(`${ABILITIES[e.ability].name} interrupted by ${by.isHero ? 'you' : by.name}`, 'good');
        break;
      }
      case 'mechFail': this.sfx.play('fail'); this.banner(e.text, 'bad'); break;
      case 'death': this.sfx.play('death'); break;
      case 'hint': this.hint(e.text); break;
      case 'banner': this.banner(e.text, 'warn'); break;
      case 'phase':
        if (e.phase === 'wipe') { this.sfx.play('wipe'); setTimeout(() => this.showWipe(), 900); }
        else if (e.phase === 'victory') { this.sfx.play('victory'); setTimeout(() => this.showVictory(), 1400); }
        break;
    }
  }

  // -------------------------------------------------------------- update

  private setW(node: HTMLElement, f: number) { node.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`; }

  update(dt: number) {
    const sim = this.sim, $ = this.$;
    const coarse = matchMedia('(pointer: coarse)').matches;
    $.rotate.classList.toggle('on', coarse && window.innerHeight > window.innerWidth);

    // party frames
    const next = sim.nextInterrupter();
    for (const f of this.frames) {
      const u = f.unit;
      this.setW(f.hp, u.hp / u.maxHp);
      if (f.mp) this.setW(f.mp, u.mana / u.maxMana);
      f.root.classList.toggle('dead', !u.alive);
      f.root.classList.toggle('low', u.alive && u.hp / u.maxHp < 0.35);
      const tag = !u.alive ? '💀' : u.order ? (u.order.type === 'stack' ? '◎' : '✥') : u.id === next ? '✋' : '';
      if (f.tag.textContent !== tag) f.tag.textContent = tag;
    }

    // target and enemy cast bar
    const t = sim.unit(sim.hero.target);
    $.target.classList.toggle('on', !!t);
    if (t) {
      const nm = $.target.firstElementChild as HTMLElement;
      if (nm.textContent !== t.name) nm.textContent = t.name;
      this.setW($.target.querySelector('i')!, t.hp / t.maxHp);
    }
    const casters = sim.enemies.filter((e) => e.alive && e.cast);
    const c = casters.find((e) => ABILITIES[e.cast!.ability].interruptible) ?? casters.find((e) => e === t) ?? casters[0];
    $.castbar.classList.toggle('on', !!c);
    if (c) {
      const a = ABILITIES[c.cast!.ability];
      const label = `${a.interruptible ? '' : '🔒 '}${c.name.split(',')[0]}: ${a.name}`;
      const nm = $.castbar.querySelector('.nm') as HTMLElement;
      if (nm.textContent !== label) nm.textContent = label;
      $.castbar.classList.toggle('kick', !!a.interruptible);
      this.setW($.castbar.querySelector('i')!, c.cast!.t / c.cast!.dur);
    }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $.banner.className = ''; }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $.hint.className = ''; }

    // pack list
    const pack = sim.visiblePack();
    const sug = sim.suggestedKill();
    if (this.packSel && !pack.some((e) => e.id === this.packSel)) this.packSel = 0;
    const key = pack.map((e) => `${e.id}${e.marker ?? ''}`).join(',') + `|${sug}|${this.packSel}`;
    if (key !== this.packKey) {
      this.packKey = key;
      $.pack.innerHTML = pack.map((e) => `<div class="pk${e.id === sug ? ' sug' : ''}${e.id === this.packSel ? ' sel' : ''}${e.marker ? ` ${e.marker}` : ''}" data-id="${e.id}"><span>${ENEMIES[e.def].glyph}</span><u>${e.marker === 'kill' ? '☠' : e.marker === 'control' ? '⛓' : e.id === sug ? '!' : ''}</u><div class="hp"><i></i></div></div>`).join('');
      $.packMenu.classList.toggle('on', !!this.packSel);
      if (this.packSel) {
        const node = $.pack.querySelector(`[data-id="${this.packSel}"]`) as HTMLElement;
        const r = node.getBoundingClientRect();
        $.packMenu.style.right = `${Math.max(6, window.innerWidth - r.right - 30)}px`; $.packMenu.style.top = `${r.bottom + 6}px`;
      }
    }
    pack.forEach((e, i) => { const n = $.pack.children[i]?.querySelector('i') as HTMLElement | null; if (n) this.setW(n, e.hp / e.maxHp); });

    // abilities
    const h = sim.hero;
    HERO.abilities.forEach((id, i) => {
      const a = ABILITIES[id]; const b = this.abilityBtns[i];
      const cd = h.cds[id] ?? 0;
      b.cd.style.height = a.cd > 0 ? `${(cd / a.cd) * 100}%` : '0%';
      const txt = cd > 0.95 ? String(Math.ceil(cd)) : '';
      if (b.num.textContent !== txt) b.num.textContent = txt;
      b.root.classList.toggle('pulse', id === 'lunge' && sim.heroCanInterrupt());
      b.root.classList.toggle('off', !h.alive);
    });

    // calls
    CALL_ORDER.forEach((id, i) => {
      const f = sim.callCd[id] / CALLS[id].cd;
      this.strip[i].cd.style.height = `${f * 100}%`;
      this.strip[i].root.classList.toggle('rdy', f <= 0);
      this.wheelItems[i].classList.toggle('cd', f > 0);
    });
    const p = this.screen ? null : sim.prompt();
    this.promptCall = p ? p.call : null;
    $.prompt.classList.toggle('on', !!p);
    if (p) {
      const g = $.prompt.querySelector('.g') as HTMLElement, b = $.prompt.querySelector('b') as HTMLElement, s = $.prompt.querySelector('small') as HTMLElement;
      if (b.textContent !== CALLS[p.call].name) { g.textContent = CALLS[p.call].glyph; b.textContent = CALLS[p.call].name; }
      if (s.textContent !== p.text) s.textContent = p.text;
      ($.prompt.querySelector('i') as HTMLElement).style.width = `${Math.min(100, (p.left / 5) * 100)}%`;
    }
    $.down.classList.toggle('on', !h.alive && sim.phase !== 'wipe' && sim.phase !== 'victory');

    // bark bubbles follow their speaker
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]; b.t -= dt;
      const u = sim.unit(b.unit)!;
      if (b.t <= 0) { b.node.remove(); this.bubbles.splice(i, 1); continue; }
      const q = this.view.project(u.x, u.y, this.view.heightOf(u.id) + 1.1);
      b.node.style.transform = `translate(${Math.max(70, Math.min(window.innerWidth - 70, q.x))}px, ${Math.max(40, q.y)}px) translate(-50%, -100%)`;
      b.node.style.opacity = b.t < 0.4 ? String(b.t / 0.4) : '1';
    }

    // edge-of-screen warnings for dangers the camera cannot see
    const off: { x: number; y: number }[] = [];
    for (const z of sim.zones) if (!z.fired) { const q = this.view.project(z.x, z.y, 0); if (!q.on) off.push(q); }
    for (const e of casters) { const q = this.view.project(e.x, e.y, 1); if (!q.on) off.push(q); }
    const W = window.innerWidth, H = window.innerHeight;
    this.arrows.forEach((a, i) => {
      const q = off[i];
      a.classList.toggle('on', !!q);
      if (q) a.style.transform = `translate(${Math.max(24, Math.min(W - 24, q.x))}px, ${Math.max(24, Math.min(H - 24, q.y))}px) translate(-50%, -50%)`;
    });
  }
}
