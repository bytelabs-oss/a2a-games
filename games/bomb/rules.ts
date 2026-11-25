// Bomb's rules as a state machine. The phase is lobby, armed or over; enter() is the one place a phase begins, and
// every change returns the events it caused. The manual's pages are written from the same tables the answers use, so
// what an expert reads and what the rules check can never disagree.
import type { EventEntry, PlayerRef } from '../../src/shell/types.ts';

export type Phase = 'lobby' | 'armed' | 'over';
export type Role = 'defuser' | 'expert';
export type Result = 'defused' | 'exploded' | 'stopped';

export const modules = ['wires', 'symbols', 'gauges'] as const;
export type Module = (typeof modules)[number];
// The manual's pages, in the order they are dealt: the index says which letter's rules apply, then one per module.
export const pages = ['index', ...modules] as const;
export type Page = (typeof pages)[number];

export const letters = ['A', 'B', 'C', 'D'] as const;
export type Letter = (typeof letters)[number];
export const wireColors = ['red', 'blue', 'yellow', 'white', 'black', 'green'] as const;
export type WireColor = (typeof wireColors)[number];
export const symbols = ['star', 'moon', 'sun', 'eye', 'key', 'crown', 'anchor', 'bell', 'feather', 'flame', 'droplet', 'snowflake'] as const;
export type Symbol = (typeof symbols)[number];

export const seats = { min: 3, max: 5 };
export const clock = { seconds: 300, strikePenalty: 30, maxStrikes: 3 };
export const bombParts = { wires: { min: 3, max: 6 }, symbols: 4, gauges: 3, batteries: { min: 1, max: 4 } };
// A serial number alternates letter and digit, six characters long, with no I or O to mistake for 1 or 0.
const serialLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const serialLength = 6;
// Gauges read 0 to 99. One click of a valve lowers its gauge by click; below 0 it comes round from 100.
export const gauge = { readings: 100, click: 15 };
// More than this many batteries is "3 or 4" on the index page.
const fewBatteries = 2;

// Each letter's order for the symbols, and its band for the gauges, low and high both inside.
export const symbolOrders = {
  A: ['star', 'droplet', 'bell', 'eye', 'moon', 'crown', 'anchor', 'snowflake', 'key', 'flame', 'sun', 'feather'],
  B: ['key', 'sun', 'crown', 'star', 'anchor', 'moon', 'droplet', 'feather', 'eye', 'bell', 'flame', 'snowflake'],
  C: ['snowflake', 'flame', 'feather', 'sun', 'bell', 'key', 'star', 'eye', 'crown', 'droplet', 'moon', 'anchor'],
  D: ['moon', 'anchor', 'eye', 'flame', 'key', 'snowflake', 'sun', 'bell', 'droplet', 'star', 'crown', 'feather'],
} satisfies Record<Letter, Symbol[]>;
export const gaugeBands = { A: [20, 34], B: [40, 54], C: [60, 74], D: [10, 24] } satisfies Record<Letter, [number, number]>;

export interface Bomb {
  serial: string;
  batteries: number;
  wires: { colors: WireColor[]; cut: boolean[] };
  // pressed counts the buttons pressed in the right order so far.
  symbols: { shown: Symbol[]; pressed: number };
  gauges: { readings: number[] };
  solved: Record<Module, boolean>;
  strikes: number;
}

// A player in the round. role is null until the roles are dealt; pages are an expert's share of the manual.
export interface Seat {
  id: string;
  name: string;
  ready: boolean;
  role: Role | null;
  pages: Page[];
}

// endsAt is when the bomb goes off, in epoch milliseconds, while it is armed. left is the seconds that were left when
// the round ended.
export interface State {
  phase: Phase;
  players: Seat[];
  bomb: Bomb | null;
  endsAt: number | null;
  left: number;
  result: Result | null;
}

// What a change to the game returns: its events, and over once the round has ended.
export interface Settled {
  ok?: boolean;
  message?: string;
  events: EventEntry[];
  over?: boolean;
}

export function create(): State {
  return { phase: 'lobby', players: [], bomb: null, endsAt: null, left: clock.seconds, result: null };
}

export const byId = (state: State, id: string | null | undefined) => state.players.find(player => player.id === id);
export const defuser = (state: State) => state.players.find(player => player.role === 'defuser') ?? null;
export const experts = (state: State) => state.players.filter(player => player.role === 'expert');
export const secondsLeft = (state: State) => (state.endsAt ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000)) : state.left);
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const headline = (text: string) => ({ text, headline: true });
const refuse = (message: string): Settled => ({ ok: false, message, events: [] });
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
function shuffled<T>(list: readonly T[]) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

// The answers the rules check steps against. Every one depends on the bomb's letter.
export function letterOf(bomb: Bomb): Letter {
  const odd = Number(bomb.serial.at(-1)) % 2 === 1;
  const many = bomb.batteries > fewBatteries;
  return odd ? (many ? 'D' : 'C') : (many ? 'B' : 'A');
}

// The number, from 1, of the one wire to cut.
export function wireToCut(bomb: Bomb): number {
  const colors = bomb.wires.colors;
  const count = colors.length;
  const rules: Record<Letter, () => number> = {
    A: () => (count === 3 ? 2 : count),
    B: () => (colors.includes('red') ? colors.lastIndexOf('red') + 1 : 1),
    C: () => (colors.filter(color => color === 'yellow').length === 1 ? colors.indexOf('yellow') + 1 : count - 1),
    D: () => (colors.includes('black') ? colors.indexOf('black') + 1 : count % 2 === 0 ? 3 : 1),
  };
  return rules[letterOf(bomb)]();
}

// The module's symbols in the order to press them.
export const symbolOrder = (bomb: Bomb) => symbolOrders[letterOf(bomb)].filter(symbol => bomb.symbols.shown.includes(symbol));

export const inBand = (reading: number, letter: Letter) => reading >= gaugeBands[letter][0] && reading <= gaugeBands[letter][1];
const turned = (reading: number) => (reading - gauge.click + gauge.readings) % gauge.readings;

// Every page of the manual, as the expert who holds it reads it.
export const manual: Record<Page, string> = {
  index: [
    'INDEX: THE BOMB\'S LETTER. Every other page needs the letter. Ask the defuser for the last digit of the serial number and the number of batteries.',
    `Last digit even, 1 to ${fewBatteries} batteries: A. Even, more than ${fewBatteries}: B. Odd, 1 to ${fewBatteries}: C. Odd, more than ${fewBatteries}: D.`,
  ].join(' '),
  wires: [
    `WIRES. The module has ${bombParts.wires.min} to ${bombParts.wires.max} wires, numbered from 1 at the top. Cut exactly one; any other is a strike.`,
    'A: with exactly 3 wires cut wire 2, otherwise the last wire.',
    'B: the last red wire; with no red wire, wire 1.',
    'C: the yellow wire if exactly one wire is yellow, otherwise the second to last wire.',
    'D: the first black wire; with no black wire, wire 3 when the number of wires is even and wire 1 when it is odd.',
  ].join(' '),
  symbols: [
    `SYMBOLS. The module has ${bombParts.symbols} buttons, each with a symbol. Press all of them in the order the symbols come in the letter's list. A button out of order is a strike and does not count.`,
    ...letters.map(letter => `${letter}: ${symbolOrders[letter].join(', ')}.`),
  ].join(' '),
  gauges: [
    `GAUGES. The module has ${bombParts.gauges} gauges reading 0 to ${gauge.readings - 1}, each with a valve. One click lowers its gauge by ${gauge.click}; below 0 it comes round from ${gauge.readings}.`,
    'The module is solved when every gauge reads inside the letter\'s band. Turning a valve whose gauge already reads inside the band is a strike.',
    ...letters.map(letter => `${letter}: ${gaugeBands[letter][0]} to ${gaugeBands[letter][1]}.`),
  ].join(' '),
};

// Readings outside every letter's band, so the gauges never start solved.
const offBand = Array.from({ length: gauge.readings }, (_, reading) => reading).filter(reading => letters.every(letter => !inBand(reading, letter)));

function makeBomb(): Bomb {
  const serial = Array.from({ length: serialLength }, (_, index) => (index % 2 ? String(between(0, 9)) : pick([...serialLetters]))).join('');
  const wires = between(bombParts.wires.min, bombParts.wires.max);
  return {
    serial,
    batteries: between(bombParts.batteries.min, bombParts.batteries.max),
    wires: { colors: Array.from({ length: wires }, () => pick(wireColors)), cut: Array(wires).fill(false) },
    symbols: { shown: shuffled(symbols).slice(0, bombParts.symbols), pressed: 0 },
    gauges: { readings: Array.from({ length: bombParts.gauges }, () => pick(offBand)) },
    solved: { wires: false, symbols: false, gauges: false },
    strikes: 0,
  };
}

// A fresh round for the players here: one defuser at random, the rest experts, and the manual dealt among the experts
// a page at a time.
export function start(state: State): Settled {
  const players = state.players;
  if (players.length < seats.min || players.length > seats.max) return refuse(`Bomb needs ${seats.min} to ${seats.max} players.`);
  Object.assign(state, create(), { players });
  const [first, ...rest] = shuffled(players);
  Object.assign(first, { role: 'defuser', pages: [] });
  rest.forEach(player => Object.assign(player, { role: 'expert', pages: [] }));
  pages.forEach((page, index) => rest[index % rest.length].pages.push(page));
  state.bomb = makeBomb();
  return { ok: true, events: enter(state, 'armed') };
}

// Begins a phase and returns its announcements.
export function enter(state: State, phase: Phase, result: Result | null = null): EventEntry[] {
  state.phase = phase;
  if (phase === 'armed') {
    state.endsAt = Date.now() + clock.seconds * 1000;
    const who = defuser(state);
    return [headline(`The bomb is armed: ${clockText(clock.seconds)} on the clock. ${who?.name} is the defuser; ${experts(state).map(player => player.name).join(', ')} hold the manual.`)];
  }
  state.left = secondsLeft(state);
  state.endsAt = null;
  state.result = result;
  for (const player of state.players) player.ready = false;
  if (result === 'defused') return [headline(`The bomb is defused with ${clockText(state.left)} left.`)];
  if (result === 'exploded') return [headline('The bomb went off.')];
  return [];
}

const ordinal = ['one', 'two', 'three', 'four', 'five'];

// A wrong step: a strike, thirty seconds off the clock, and the bomb goes off on the last strike.
function strike(state: State, bomb: Bomb, what: string): Settled {
  bomb.strikes++;
  if (bomb.strikes >= clock.maxStrikes) return { ok: true, message: `${what} Strike ${ordinal[bomb.strikes - 1]}.`, events: [headline(`Strike ${ordinal[bomb.strikes - 1]}.`), ...enter(state, 'over', 'exploded')], over: true };
  state.endsAt = (state.endsAt ?? Date.now()) - clock.strikePenalty * 1000;
  const news = `Strike ${ordinal[bomb.strikes - 1]}. ${clock.strikePenalty} seconds off the clock.`;
  return { ok: true, message: `${what} ${news}`, events: [headline(news)] };
}

// A module solved, and the bomb defused once all of them are.
function solve(state: State, bomb: Bomb, module: Module, what: string): Settled {
  bomb.solved[module] = true;
  const events: EventEntry[] = [headline(`${capital(module)} solved.`)];
  if (modules.every(each => bomb.solved[each])) return { ok: true, message: what, events: [...events, ...enter(state, 'over', 'defused')], over: true };
  return { ok: true, message: what, events };
}

function armedBomb(state: State, module: Module) {
  if (!state.bomb) throw new Error('An armed round has no bomb.');
  return state.bomb.solved[module] ? null : state.bomb;
}

export function cut(state: State, wire: number): Settled {
  const bomb = armedBomb(state, 'wires');
  if (!bomb) return refuse('Wires is already solved.');
  const { colors, cut: cuts } = bomb.wires;
  if (!Number.isInteger(wire) || wire < 1 || wire > colors.length) return refuse(`Say which wire, from 1 to ${colors.length}.`);
  if (cuts[wire - 1]) return refuse(`Wire ${wire} is already cut.`);
  cuts[wire - 1] = true;
  const what = `Cut wire ${wire}, the ${colors[wire - 1]} one.`;
  return wire === wireToCut(bomb) ? solve(state, bomb, 'wires', what) : strike(state, bomb, what);
}

export function press(state: State, symbol: string): Settled {
  const bomb = armedBomb(state, 'symbols');
  if (!bomb) return refuse('Symbols is already solved.');
  const { shown, pressed } = bomb.symbols;
  const index = shown.indexOf(symbol as Symbol);
  if (index < 0) return refuse(`No button shows ${symbol}. The buttons show ${shown.join(', ')}.`);
  const order = symbolOrder(bomb);
  if (order.indexOf(symbol as Symbol) < pressed) return refuse(`${capital(symbol)} is already pressed.`);
  if (order[pressed] !== symbol) return strike(state, bomb, `Pressed ${symbol}, out of order.`);
  bomb.symbols.pressed++;
  const what = `Pressed ${symbol}.`;
  return bomb.symbols.pressed === shown.length ? solve(state, bomb, 'symbols', what) : { ok: true, message: what, events: [] };
}

// Turns a valve one click at a time. A click on a gauge already inside the band is a strike, and the clicks after it
// are dropped.
export function turn(state: State, gaugeNumber: number, clicks: number): Settled {
  const bomb = armedBomb(state, 'gauges');
  if (!bomb) return refuse('Gauges is already solved.');
  const readings = bomb.gauges.readings;
  if (!Number.isInteger(gaugeNumber) || gaugeNumber < 1 || gaugeNumber > readings.length) return refuse(`Say which gauge, from 1 to ${readings.length}.`);
  if (!Number.isInteger(clicks) || clicks < 1) return refuse('Say how many clicks, 1 or more.');
  const letter = letterOf(bomb);
  for (let click = 0; click < clicks; click++) {
    const reading = readings[gaugeNumber - 1];
    const done = click ? ` after ${click} ${click === 1 ? 'click' : 'clicks'}` : '';
    if (inBand(reading, letter)) return strike(state, bomb, `Gauge ${gaugeNumber} already read ${reading}, inside the band, when its valve was turned${done}.`);
    readings[gaugeNumber - 1] = turned(reading);
  }
  const what = `Turned gauge ${gaugeNumber} ${clicks} ${clicks === 1 ? 'click' : 'clicks'}: it reads ${readings[gaugeNumber - 1]}.`;
  return readings.every(reading => inBand(reading, letter)) ? solve(state, bomb, 'gauges', what) : { ok: true, message: what, events: [] };
}

// A player who leaves during a round: without the defuser nobody can defuse the bomb, so the round stops; an expert's
// pages go to the experts still here, and with none left the round stops.
export function leave(state: State, player: PlayerRef): Settled {
  const seat = byId(state, player.id);
  if (!seat) return { events: [] };
  state.players = state.players.filter(each => each !== seat);
  if (state.phase !== 'armed') return { events: [] };
  const remaining = experts(state);
  if (seat.role === 'defuser' || !remaining.length) {
    return { events: [headline(`${seat.name} left, and nobody can finish without them. The round stops.`), ...enter(state, 'over', 'stopped')], over: true };
  }
  seat.pages.forEach((page, index) => remaining[index % remaining.length].pages.push(page));
  return { events: [headline(`${seat.name} left. Their pages go to ${remaining.map(each => each.name).join(', ')}.`)] };
}

// The clock running out sets the bomb off.
export function tick(state: State): Settled | null {
  if (state.phase !== 'armed' || !state.endsAt || Date.now() < state.endsAt) return null;
  return { events: [headline('Time ran out.'), ...enter(state, 'over', 'exploded')], over: true };
}
