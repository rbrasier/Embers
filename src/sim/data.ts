// All game content is data. The simulation in sim.ts interprets these records.
// Every number here is a starting value for tuning.

export const TICK = 1 / 30;
export const ARENA = { minX: -14, maxX: 14, minY: 0, maxY: 70 };
export const ENTRANCE = { x: 0, y: 4 };

export type Role = 'tank' | 'healer' | 'damage';
export type CallId = 'interrupt' | 'stack' | 'spread' | 'burst' | 'focus';
export type Marker = 'kill' | 'control' | null;

// ---------------------------------------------------------------- buffs

export interface BuffDef {
  name: string;
  dur: number;
  dmg?: number; // damage dealt multiplier (per stack)
  taken?: number; // damage taken multiplier
  haste?: number;
  heal?: number; // healing done multiplier
  dot?: number; // damage per tick
  every?: number; // dot interval
  stun?: boolean;
  breakOnDamage?: boolean;
  stacks?: boolean;
}

export const BUFFS: Record<string, BuffDef> = {
  rend: { name: 'Rend', dur: 8, dot: 30, every: 1 },
  flurry: { name: 'Flurry', dur: 10, dmg: 1.4, haste: 1.3 },
  evade: { name: 'Evade', dur: 3, taken: 0.25 },
  adrenaline: { name: 'Adrenaline', dur: 10, dmg: 1.5 },
  conflagrate: { name: 'Conflagrate', dur: 10, dmg: 2.4 },
  rally: { name: 'Rally', dur: 10, dmg: 1.3, taken: 0.8 },
  clarity: { name: 'Clarity', dur: 10, heal: 1.4 },
  cage: { name: 'Ember Cage', dur: 25, stun: true, breakOnDamage: true },
  fury: { name: 'Kiln Fury', dur: 9999, dmg: 1.3, stacks: true },
  enrage: { name: 'Overheating', dur: 9999, dmg: 1.1, stacks: true },
};

// ------------------------------------------------------------ abilities

export type Fx =
  | { k: 'dmg'; amt: number; threat?: number }
  | { k: 'aoe'; amt: number; radius: number; threat?: number }
  | { k: 'partyDmg'; amt: number }
  | { k: 'heal'; amt: number }
  | { k: 'partyHeal'; amt: number }
  | { k: 'buffSelf'; buff: string }
  | { k: 'buffTarget'; buff: string }
  | { k: 'dash' }
  | { k: 'interrupt' }
  | { k: 'taunt' }
  | { k: 'mana'; amt: number };

export interface AbilityDef {
  name: string;
  glyph: string;
  target: 'enemy' | 'ally' | 'self';
  range: number;
  cd: number;
  cast: number;
  gcd: number;
  mana?: number;
  interruptible?: boolean;
  vis: 'melee' | 'bolt' | 'heal' | 'nova' | 'buff' | 'none';
  fx: Fx[];
  desc?: string;
}

export const ABILITIES: Record<string, AbilityDef> = {
  // Blade (player hero)
  slash: { name: 'Slash', glyph: '⚔', target: 'enemy', range: 3, cd: 0, cast: 0, gcd: 0.8, vis: 'melee',
    fx: [{ k: 'dmg', amt: 62 }], desc: 'Filler strike. Hold to repeat.' },
  rend: { name: 'Rend', glyph: '🩸', target: 'enemy', range: 3, cd: 6, cast: 0, gcd: 0.8, vis: 'melee',
    fx: [{ k: 'dmg', amt: 40 }, { k: 'buffTarget', buff: 'rend' }], desc: 'Strike and bleed for 8 s.' },
  lunge: { name: 'Lunge', glyph: '➶', target: 'enemy', range: 15, cd: 12, cast: 0, gcd: 0.4, vis: 'melee',
    fx: [{ k: 'dash' }, { k: 'dmg', amt: 90 }, { k: 'interrupt' }], desc: 'Dash to the target. Interrupts its cast.' },
  flurry: { name: 'Flurry', glyph: '🌀', target: 'self', range: 0, cd: 60, cast: 0, gcd: 0, vis: 'buff',
    fx: [{ k: 'buffSelf', buff: 'flurry' }], desc: 'Major cooldown: faster, harder hits for 10 s.' },
  evade: { name: 'Evade', glyph: '🛡', target: 'self', range: 0, cd: 25, cast: 0, gcd: 0, vis: 'buff',
    fx: [{ k: 'buffSelf', buff: 'evade' }], desc: 'Defensive: take 75% less damage for 3 s.' },

  // Brannoch (Warden)
  b_strike: { name: 'Strike', glyph: '⚔', target: 'enemy', range: 2.6, cd: 0, cast: 0, gcd: 1.5, vis: 'melee', fx: [{ k: 'dmg', amt: 42, threat: 6 }] },
  b_slam: { name: 'Shield Slam', glyph: '⚔', target: 'enemy', range: 2.6, cd: 8, cast: 0, gcd: 1.5, vis: 'melee', fx: [{ k: 'dmg', amt: 75, threat: 6 }] },
  b_thunder: { name: 'Thunderous Roar', glyph: '⚔', target: 'enemy', range: 4, cd: 6, cast: 0, gcd: 1.5, vis: 'nova', fx: [{ k: 'aoe', amt: 26, radius: 7, threat: 10 }] },
  b_taunt: { name: 'Taunt', glyph: '!', target: 'enemy', range: 24, cd: 4, cast: 0, gcd: 0, vis: 'none', fx: [{ k: 'taunt' }] },
  b_bash: { name: 'Shield Bash', glyph: '✋', target: 'enemy', range: 4, cd: 18, cast: 0, gcd: 0, vis: 'melee', fx: [{ k: 'interrupt' }] },
  b_rally: { name: 'Rally', glyph: '🔥', target: 'self', range: 0, cd: 0, cast: 0, gcd: 0, vis: 'buff', fx: [{ k: 'buffSelf', buff: 'rally' }] },

  // Isolde (Mender)
  i_mend: { name: 'Mend', glyph: '✚', target: 'ally', range: 40, cd: 0, cast: 1.5, gcd: 0, mana: 20, vis: 'heal', fx: [{ k: 'heal', amt: 240 }] },
  i_chorus: { name: 'Chorus', glyph: '✚', target: 'self', range: 0, cd: 8, cast: 1.8, gcd: 0, mana: 55, vis: 'heal', fx: [{ k: 'partyHeal', amt: 230 }] },
  i_clarity: { name: 'Clarity', glyph: '🔥', target: 'self', range: 0, cd: 0, cast: 0, gcd: 0, vis: 'buff', fx: [{ k: 'buffSelf', buff: 'clarity' }, { k: 'mana', amt: 150 }] },

  // Kestrel (Blade)
  k_stab: { name: 'Stab', glyph: '⚔', target: 'enemy', range: 2.6, cd: 0, cast: 0, gcd: 1.0, vis: 'melee', fx: [{ k: 'dmg', amt: 56 }] },
  k_kick: { name: 'Kick', glyph: '✋', target: 'enemy', range: 4, cd: 14, cast: 0, gcd: 0, vis: 'melee', fx: [{ k: 'interrupt' }] },
  k_adrenaline: { name: 'Adrenaline', glyph: '🔥', target: 'self', range: 0, cd: 0, cast: 0, gcd: 0, vis: 'buff', fx: [{ k: 'buffSelf', buff: 'adrenaline' }] },

  // Vex (Pyromancer)
  v_bolt: { name: 'Firebolt', glyph: '🔥', target: 'enemy', range: 22, cd: 0, cast: 1.8, gcd: 0, vis: 'bolt', fx: [{ k: 'dmg', amt: 122 }] },
  v_counter: { name: 'Counterflare', glyph: '✋', target: 'enemy', range: 30, cd: 24, cast: 0, gcd: 0, vis: 'bolt', fx: [{ k: 'interrupt' }] },
  v_conflag: { name: 'Conflagrate', glyph: '🔥', target: 'self', range: 0, cd: 0, cast: 0, gcd: 0, vis: 'buff', fx: [{ k: 'buffSelf', buff: 'conflagrate' }] },
  v_cage: { name: 'Ember Cage', glyph: '⛓', target: 'enemy', range: 30, cd: 3, cast: 0, gcd: 0, vis: 'bolt', fx: [{ k: 'buffTarget', buff: 'cage' }] },

  // Enemy casts
  hex_volley: { name: 'Scorch Volley', glyph: '', target: 'self', range: 0, cd: 0, cast: 2.6, gcd: 0, interruptible: true, vis: 'nova', fx: [{ k: 'partyDmg', amt: 210 }] },
  slam_windup: { name: 'Ground Slam', glyph: '', target: 'self', range: 0, cd: 0, cast: 2.5, gcd: 0, interruptible: false, vis: 'none', fx: [] },
  searing_chant: { name: 'Searing Chant', glyph: '', target: 'self', range: 0, cd: 0, cast: 3.2, gcd: 0, interruptible: true, vis: 'nova', fx: [{ k: 'partyDmg', amt: 430 }, { k: 'buffSelf', buff: 'fury' }] },
};

// ---------------------------------------------------------------- party

export interface HeroDef {
  name: string; cls: string; role: Role; hp: number; speed: number; color: number;
  abilities: string[]; // slots 0..3 actives, slot 4 defensive
}

export const HERO: HeroDef = {
  name: 'You', cls: 'Blade', role: 'damage', hp: 1100, speed: 7.5, color: 0xf2c14e,
  abilities: ['slash', 'rend', 'lunge', 'flurry', 'evade'],
};

export interface CompanionDef {
  name: string; cls: string; role: Role; hp: number; mana: number; manaRegen: number;
  speed: number; combatSpeed: number; // multiplier while fighting
  taken: number; groundTaken: number; // passive damage multipliers
  melee: boolean; range: number;
  react: number; // seconds before reacting to a ground effect
  finishCast: boolean; // finishes the current cast before moving
  rotation: string[]; // priority list
  interrupt?: string; burst: string; control?: string; taunt?: string;
  strength: string; quirk: string; color: number;
  follow: { x: number; y: number };
}

export const COMPANIONS: Record<string, CompanionDef> = {
  brannoch: {
    name: 'Brannoch', cls: 'Warden', role: 'tank', hp: 2300, mana: 0, manaRegen: 0,
    speed: 7, combatSpeed: 0.6, taken: 0.55, groundTaken: 1, melee: true, range: 2.6, react: 1.0, finishCast: false,
    rotation: ['b_slam', 'b_thunder', 'b_strike'], interrupt: 'b_bash', burst: 'b_rally', taunt: 'b_taunt',
    strength: 'Holds threat on large pulls', quirk: 'Slow to reposition in a fight', color: 0x4a7bd0,
    follow: { x: -1.6, y: -2.2 },
  },
  isolde: {
    name: 'Isolde', cls: 'Mender', role: 'healer', hp: 1000, mana: 1000, manaRegen: 8,
    speed: 7, combatSpeed: 1, taken: 1, groundTaken: 1, melee: false, range: 40, react: 1.0, finishCast: false,
    rotation: [], burst: 'i_clarity',
    strength: 'Strong group healing', quirk: 'Runs low on mana in long fights', color: 0x58c98b,
    follow: { x: 1.6, y: -4.8 },
  },
  kestrel: {
    name: 'Kestrel', cls: 'Blade', role: 'damage', hp: 1050, mana: 0, manaRegen: 0,
    speed: 7.5, combatSpeed: 1, taken: 1, groundTaken: 1.5, melee: true, range: 2.6, react: 1.0, finishCast: false,
    rotation: ['k_stab'], interrupt: 'k_kick', burst: 'k_adrenaline',
    strength: 'Fastest interrupt cooldown', quirk: 'Takes extra damage from ground effects', color: 0xd0504a,
    follow: { x: 2.2, y: -2.0 },
  },
  vex: {
    name: 'Vex', cls: 'Pyromancer', role: 'damage', hp: 950, mana: 0, manaRegen: 0,
    speed: 6.5, combatSpeed: 1, taken: 1, groundTaken: 1, melee: false, range: 22, react: 1.0, finishCast: true,
    rotation: ['v_bolt'], interrupt: 'v_counter', burst: 'v_conflag', control: 'v_cage',
    strength: 'Huge burst when called', quirk: 'Finishes the current cast before moving', color: 0xf08a3c,
    follow: { x: -1.6, y: -5.2 },
  },
};

export const PARTY_ORDER = ['brannoch', 'isolde', 'kestrel', 'vex'];

// ---------------------------------------------------------------- calls

export interface CallDef { name: string; glyph: string; cd: number; desc: string }

export const CALLS: Record<CallId, CallDef> = {
  interrupt: { name: 'Interrupt', glyph: '✋', cd: 12, desc: 'The best-placed companion interrupts the enemy cast.' },
  stack: { name: 'Stack', glyph: '◎', cd: 20, desc: 'All companions move to you and stay close.' },
  spread: { name: 'Spread', glyph: '✥', cd: 20, desc: 'All companions move apart.' },
  burst: { name: 'Burst', glyph: '🔥', cd: 120, desc: 'All companions use their damage cooldowns.' },
  focus: { name: 'Focus', glyph: '🎯', cd: 30, desc: 'All companions switch to your target at once.' },
};
export const CALL_ORDER: CallId[] = ['interrupt', 'stack', 'spread', 'burst', 'focus'];

export const ORDER_TIME = 7; // seconds a Stack or Spread order holds
export const FOCUS_TIME = 10;
export const SPREAD_MIN = 5.2; // spacing companions aim for on Spread

// ------------------------------------------------- mechanics and enemies

// One record per mechanic: telegraph, timing, the required response,
// which call answers it, and what failure does.
export interface MechanicDef {
  id: string;
  name: string;
  kind: 'cast' | 'soak' | 'brand' | 'pool' | 'slam';
  answer: CallId | null;
  first: number; // seconds into the fight
  every: number;
  telegraph: number; // warning time in seconds
  ability?: string; // cast mechanics
  radius?: number;
  dmg?: number; // soak: total split; brand: per overlap; pool: per tick; slam: flat
  base?: number; // brand: unavoidable damage to each player
  need?: number; // soak: soakers needed to count as handled
  dur?: number; // pool lifetime
  how: string; // shown in boss notes
  fail: string; // shown on the wipe screen
}

export interface EnemyDef {
  name: string; glyph: string; hp: number; dmg: number; swing: number; speed: number;
  radius: number; range: number; aggro: number; danger: number; color: number; boss?: boolean;
  enrageAt?: number; mechanics: MechanicDef[];
}

export const ENEMIES: Record<string, EnemyDef> = {
  thrall: {
    name: 'Ashbound Thrall', glyph: '🗡', hp: 1500, dmg: 70, swing: 1.6, speed: 5.5, radius: 0.7, range: 1.2,
    aggro: 11, danger: 0, color: 0x7d5a68, mechanics: [],
  },
  hexer: {
    name: 'Cinder Hexer', glyph: '☄', hp: 1300, dmg: 55, swing: 2.2, speed: 5, radius: 0.7, range: 18,
    aggro: 11, danger: 3, color: 0x9b59d0,
    mechanics: [{
      id: 'volley', name: 'Scorch Volley', kind: 'cast', answer: 'interrupt', first: 3, every: 9, telegraph: 2.6,
      ability: 'hex_volley', how: 'Burns the whole party. Interrupt it, cage the Hexer, or kill it first.',
      fail: 'Scorch Volley went off. It needed an Interrupt.',
    }],
  },
  brute: {
    name: 'Slag Brute', glyph: '🔨', hp: 2600, dmg: 110, swing: 2.0, speed: 5, radius: 1.0, range: 1.3,
    aggro: 11, danger: 1, color: 0x8a4632,
    mechanics: [{
      id: 'slam', name: 'Ground Slam', kind: 'slam', answer: null, first: 6, every: 11, telegraph: 2.5,
      ability: 'slam_windup', radius: 5, dmg: 380, how: 'Step out of the circle.', fail: 'Ground Slam hit the party.',
    }],
  },
  vharok: {
    name: 'Vharok, the Kiln-Keeper', glyph: '👹', hp: 40000, dmg: 130, swing: 1.6, speed: 5, radius: 2.0, range: 1.6,
    aggro: 13, danger: 5, color: 0x4a2f2a, boss: true, enrageAt: 0.3,
    mechanics: [
      {
        id: 'chant', name: 'Searing Chant', kind: 'cast', answer: 'interrupt', first: 6, every: 10, telegraph: 3.2,
        ability: 'searing_chant',
        how: 'Interrupt it. Every chant that finishes burns the party and makes Vharok hit harder for the rest of the fight. It comes faster than any one interrupt recharges, so alternate your Lunge with the Interrupt call.',
        fail: 'Searing Chant went off. It needed an Interrupt.',
      },
      {
        id: 'meteor', name: 'Meteor', kind: 'soak', answer: 'stack', first: 14, every: 30, telegraph: 5,
        radius: 4.5, dmg: 2500, need: 4,
        how: 'A blue circle follows one party member. Its damage is split between everyone inside. Call Stack so the party shares it.',
        fail: 'Meteor was not shared. It needed a Stack call.',
      },
      {
        id: 'brand', name: 'Cinder Brand', kind: 'brand', answer: 'spread', first: 29, every: 30, telegraph: 5,
        radius: 4, dmg: 380, base: 70,
        how: 'Everyone gets an orange ring that explodes onto anyone else inside it. Call Spread, and move yourself clear too.',
        fail: 'Cinder Brand hit a clump. It needed a Spread call.',
      },
      {
        id: 'pool', name: 'Cinder Pool', kind: 'pool', answer: null, first: 9, every: 13, telegraph: 1.5,
        radius: 3, dmg: 36, dur: 10,
        how: 'Fire on the floor. Companions leave it on their own, slowly. Keep yourself out and do not Stack inside one.',
        fail: '',
      },
    ],
  },
};

export interface Spawn { def: string; x: number; y: number; group: number }

export const SPAWNS: Spawn[] = [
  { def: 'thrall', x: -3, y: 25, group: 1 },
  { def: 'thrall', x: 3, y: 25, group: 1 },
  { def: 'brute', x: 0, y: 27, group: 1 },
  { def: 'hexer', x: 0, y: 31, group: 1 },
  { def: 'vharok', x: 0, y: 56, group: 2 },
];

// ---------------------------------------------------------------- barks

export const BARKS: Record<string, Record<string, string[]>> = {
  brannoch: {
    pull: ['On me!', 'Shields up.', 'Eyes on me, ugly.'],
    interrupt: ['Bashed.', 'Quiet, you.'],
    stack: ['Coming. Slowly.', 'On my way.'],
    spread: ['Holding here.'],
    burst: ['For the hearth!'],
    fail: ['That one was ours to stop.', 'Call it sooner.'],
    death: ['Hold the line!'],
    retry: ['Again. We have this.', 'Same plan, cleaner.'],
    win: ['The kiln is cold. Well called.'],
  },
  isolde: {
    pull: ['Stay where I can see you.'],
    stack: ['Coming!', 'To you.'],
    spread: ['Moving out.'],
    burst: ['Second wind.'],
    lowmana: ['Mana is running low!', 'I cannot keep this up much longer.'],
    oom: ['I am out of mana!'],
    fail: ['That hurt. Call it next time!', 'I cannot heal through that.'],
    death: ['No! Stay with me!'],
    retry: ['Deep breath. Again.'],
    win: ['Everyone still has their eyebrows?'],
  },
  kestrel: {
    pull: ['Finally.', 'Mine.'],
    interrupt: ['Shut it.', 'Not today.', 'Kicked.'],
    stack: ['Right behind you.'],
    spread: ['Giving you room.'],
    burst: ['Now it gets fun.'],
    fire: ['Hot! Hot! Hot!', 'Why is it always fire?'],
    fail: ['Somebody call that!'],
    death: ['Man down!'],
    retry: ['I had it that time.'],
    win: ['Told you. Easy.'],
  },
  vex: {
    pull: ['Stand clear of the bright part.'],
    interrupt: ['Countered.', 'Hush.'],
    stack: ['Coming.'],
    spread: ['Spreading.'],
    casting: ['One moment. Casting.', 'Let me finish this.'],
    burst: ['Burn it all!', 'Everything, now!'],
    cage: ['Caged.', 'Stay.'],
    fail: ['That was avoidable.'],
    death: ['Careless.'],
    retry: ['Shall we try that with calls?'],
    win: ['Adequate. Even stylish.'],
  },
};
