// Mafia's rules as a state machine. The phase is lobby, night, talk, vote or over; enter() is the one place a phase
// begins, and every change returns the public events it caused.
import type { EventEntry, PlayerRef } from '../../src/shell/types.ts';

export type Phase = 'lobby' | 'night' | 'talk' | 'vote' | 'over';
export type Role = 'mafia' | 'villager' | 'detective' | 'doctor';
export type Winner = 'village' | 'mafia' | 'draw';

// A player at the table. role is null until the roles are dealt; left marks a player who left mid-game.
export interface Seat {
  id: string;
  name: string;
  role: Role | null;
  alive: boolean;
  ready: boolean;
  left?: boolean;
}

// What the detective learned about one player, on one day.
export interface Check {
  day: number;
  name: string;
  mafia: boolean;
}

// endsAt and dayEndsAt are epoch milliseconds. picks, votes and skips are by player id; a vote is a player id or
// nobody. queue is the seats still to have a turn today.
export interface State {
  phase: Phase;
  day: number;
  endsAt: number | null;
  dayEndsAt: number | null;
  narrator: PlayerRef | null;
  players: Seat[];
  picks: Record<string, string>;
  votes: Record<string, string>;
  skips: Record<string, boolean>;
  queue: string[];
  turn: { id: string; speaking: boolean } | null;
  checks: Record<string, Check[]>;
  winner: Winner | null;
}

// What a change to the game returns: its events, and over once a side has won.
export interface Settled {
  ok?: boolean;
  message?: string;
  events: EventEntry[];
  over?: boolean;
}
export const seats = { min: 4, max: 8 };
export const seconds = { night: 90, day: 180, turn: 45, vote: 60 };
export const maxNights = 12;
export const nobody = 'nobody';

export function create(): State {
  return { phase: 'lobby', day: 0, endsAt: null, dayEndsAt: null, narrator: null, players: [], picks: {}, votes: {}, skips: {}, queue: [], turn: null, checks: {}, winner: null };
}

export const byId = (state: State, id: string | null | undefined) => state.players.find(player => player.id === id);
// The seat a known id belongs to. The rules only ask for ids of seated players.
export const seatOf = (state: State, id: string) => {
  const seat = byId(state, id);
  if (!seat) throw new Error(`No player at the table has the id ${id}.`);
  return seat;
};
export const living = (state: State) => state.players.filter(player => player.alive);
export const named = (state: State, name: string) => living(state).find(player => player.name.toLowerCase() === name.trim().toLowerCase());
const mafia = (state: State) => living(state).filter(player => player.role === 'mafia');
const chooses = (player: Seat) => player.role === 'mafia' || player.role === 'doctor' || player.role === 'detective';
const later = (time: number) => Date.now() + time * 1000;
const headline = (text: string) => ({ text, headline: true });
// Headlines go to everyone. Routine news, turn by turn, goes only to the narrator, who runs the table, and to the
// player it is about: every wake-up costs an agent time, and a pile of them delays the one it has to act on.
export const routine = (state: State, text: string, about: Seat[] = []) => ({ text, to: [state.narrator?.id, ...about.map(player => player.id)].filter(id => id !== undefined) });
// Mafia is a team; there can be many villagers; the detective and the doctor are one each.
const titles: Record<Role, string> = { mafia: 'mafia', villager: 'a villager', detective: 'the detective', doctor: 'the doctor' };
export const reveal = (player: Seat) => `${player.name} was ${player.role ? titles[player.role] : 'not dealt a role'}.`;

// The living roles that choose at night, as words: "the mafia and the doctor".
const list = new Intl.ListFormat('en', { type: 'conjunction' });
export const choosers = (state: State) => list.format(['mafia', 'doctor', 'detective'].filter(role => living(state).some(player => player.role === role)).map(role => `the ${role}`));

// Mafia, then the detective from five players, then the doctor from six; everyone else is a villager. Shuffled.
function dealRoles(count: number) {
  const roles: Role[] = [...Array(count >= 8 ? 2 : 1).fill('mafia'), ...(count >= 5 ? ['detective'] : []), ...(count >= 6 ? ['doctor'] : [])];
  const dealt: Role[] = [...roles, ...Array<Role>(count - roles.length).fill('villager')];
  for (let index = dealt.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [dealt[index], dealt[other]] = [dealt[other], dealt[index]];
  }
  return dealt;
}

// A fresh game for the narrator and the players still here, whether it is the first game or the next one.
export function start(state: State) {
  if (!state.narrator) return { ok: false, message: 'A narrator must claim the seat with narrate first.' };
  const players = state.players.filter(player => !player.left);
  if (players.length < seats.min || players.length > seats.max) return { ok: false, message: `Mafia needs ${seats.min} to ${seats.max} players besides the narrator.` };
  const waiting = players.filter(player => !player.ready).map(player => player.name);
  if (waiting.length) return { ok: false, message: `Waiting for ${list.format(waiting)} to call ready.` };
  Object.assign(state, create(), { narrator: state.narrator, players });
  dealRoles(players.length).forEach((role, index) => Object.assign(players[index], { role, alive: true }));
  return { ok: true, events: ['Roles are dealt. Each player sees their own role in their view.', ...enter(state, 'night')] };
}

// Begins a phase and returns its announcements.
export function enter(state: State, phase: Phase): EventEntry[] {
  state.phase = phase;
  state.picks = {};
  state.votes = {};
  state.skips = {};
  state.turn = null;
  if (phase === 'night') {
    state.day++;
    state.endsAt = later(seconds.night);
    const who = choosers(state);
    return [headline(`Night ${state.day} falls. ${who[0].toUpperCase()}${who.slice(1)} choose.`)];
  }
  if (phase === 'talk') {
    state.dayEndsAt = later(seconds.day);
    state.queue = [];
    return [headline(`Day ${state.day}. The village wakes.`), ...nextTurn(state)];
  }
  if (phase === 'vote') {
    state.endsAt = later(seconds.vote);
    return [headline('The vote is open.')];
  }
  state.endsAt = null;
  return [];
}

function eliminate(state: State, player: Seat, how: string) {
  player.alive = false;
  state.queue = state.queue.filter(id => id !== player.id);
  return headline(`${player.name} ${how}. ${reveal(player)}`);
}

const results = {
  village: 'The village wins. No mafia remain.',
  mafia: 'The mafia wins. They match the rest of the village.',
  draw: `A draw. ${maxNights} nights have passed.`,
};

// After an elimination the game ends if a side has won: the village with no mafia left, the mafia once they match
// everyone else, or a draw when lastNight says the final night's vote is done. Otherwise it moves on to next, or
// stays in the phase when there is no next. over tells the game to end.
function settle(state: State, events: EventEntry[], { next, lastNight = false }: { next?: Phase; lastNight?: boolean } = {}): Settled {
  const count = mafia(state).length;
  state.winner = !count ? 'village' : count >= living(state).length - count ? 'mafia' : lastNight ? 'draw' : null;
  if (state.winner) {
    enter(state, 'over');
    return { events: [...events, headline(results[state.winner])], over: true };
  }
  return { events: [...events, ...(next ? enter(state, next) : [])] };
}

export function pick(state: State, player: Seat, target: Seat) {
  if (!chooses(player)) return { ok: false, message: 'Villagers sleep at night. Only the mafia, doctor and detective choose.' };
  if (player.role === 'mafia' && target.role === 'mafia') return { ok: false, message: 'The mafia cannot choose one of their own.' };
  if (player.role === 'detective' && target === player) return { ok: false, message: 'The detective checks someone else.' };
  state.picks[player.id] = target.id;
  return { ok: true, message: `You chose ${target.name}.` };
}

function agreed(state: State) {
  const targets = new Set<string | undefined>(mafia(state).map(member => state.picks[member.id]));
  return targets.size === 1 && !targets.has(undefined) ? [...targets][0] : null;
}

function dawn(state: State) {
  const target = byId(state, agreed(state));
  const saved = living(state).some(player => player.role === 'doctor' && state.picks[player.id] === target?.id);
  const killed = target && !saved;
  // A detective killed this night learns nothing from their check.
  for (const detective of living(state).filter(player => player.role === 'detective' && state.picks[player.id] && !(killed && player === target))) {
    const checked = seatOf(state, state.picks[detective.id]);
    (state.checks[detective.id] ??= []).push({ day: state.day, name: checked.name, mafia: checked.role === 'mafia' });
  }
  return settle(state, [killed ? eliminate(state, target, 'was eliminated in the night') : headline('Nobody was eliminated in the night.')], { next: 'talk' });
}

// A turn lasts its full length, but never past the end of the day.
const turnEnd = (state: State) => Math.min(later(seconds.turn), state.dayEndsAt ?? Infinity);

// Gives the next seat its turn. Once everyone has had one, the order starts again; the day's timer, not the
// turns, decides when the vote opens.
export function nextTurn(state: State) {
  if (!state.queue.length) state.queue = living(state).map(player => player.id);
  const seat = seatOf(state, state.queue.shift() ?? '');
  state.turn = { id: seat.id, speaking: false };
  state.endsAt = turnEnd(state);
  return [routine(state, `${seat.name}'s turn: floor to speak or pass to skip.`, [seat])];
}

// Gives a player the floor for a full turn. Out of turn, it counts as their turn.
export function giveFloor(state: State, player: Seat) {
  state.queue = state.queue.filter(id => id !== player.id);
  state.turn = { id: player.id, speaking: true };
  state.endsAt = turnEnd(state);
  return [routine(state, `${player.name} has the floor.`, [player])];
}

// A player asks to end the day and vote now; the vote opens as soon as every living player has asked. A skip on
// the player's own turn also passes it, since they have nothing more to say.
export function skip(state: State, player: Seat) {
  state.skips[player.id] = true;
  const asked = living(state).filter(each => state.skips[each.id]).length;
  const news = routine(state, `${player.name} is ready to vote (${asked} of ${living(state).length}).`);
  if (asked === living(state).length) return { ok: true, events: [news, ...enter(state, 'vote')] };
  if (state.turn?.id !== player.id) return { ok: true, events: [news] };
  return { ok: true, events: [news, routine(state, `${player.name} passed.`), ...nextTurn(state)] };
}

export function vote(state: State, player: Seat, target: Seat | null | undefined) {
  state.votes[player.id] = target?.id ?? nobody;
  return { ok: true, message: `You voted for ${target?.name ?? nobody}.` };
}

// Shows every vote; the most votes are eliminated, unless it is a tie or nobody leads.
function count(state: State) {
  const tally: Record<string, number> = {};
  for (const choice of Object.values(state.votes)) tally[choice] = (tally[choice] ?? 0) + 1;
  const choice = (id: string) => (id === nobody ? nobody : seatOf(state, id).name);
  const cast = living(state).map(voter => `${voter.name} → ${state.votes[voter.id] ? choice(state.votes[voter.id]) : 'no vote'}`);
  const [first, second] = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const out = first && first[0] !== nobody && first[1] !== second?.[1] ? byId(state, first[0]) : null;
  const events = [headline(`Votes: ${cast.join(', ')}.`), out ? eliminate(state, out, 'is voted out') : headline('Nobody is voted out.')];
  return settle(state, events, { next: 'night', lastNight: state.day >= maxNights });
}

// A player who leaves mid-game counts as eliminated and sits out the next game; the phase goes on without them.
export function leave(state: State, player: PlayerRef): Settled {
  const seated = byId(state, player.id);
  if (!seated) return { events: [] };
  if (state.phase === 'lobby' || state.phase === 'over') {
    state.players = state.players.filter(each => each !== seated);
    return { events: [] };
  }
  seated.left = true;
  if (!seated.alive) return { events: [] };
  const left = eliminate(state, seated, 'left the game');
  delete state.picks[seated.id];
  delete state.votes[seated.id];
  const settled = settle(state, [left]);
  if (!settled.over && state.turn?.id === seated.id) settled.events.push(...nextTurn(state));
  return settled;
}

// Moves the game on when a phase is complete or its time is up: the night once every choice is made and the
// mafia agree, the vote once everyone has voted, a turn when its time runs out. Ending the night here rather than
// in a pick keeps its events from being recorded as caused by the last player to choose. Returns nothing when
// nothing changed.
export function tick(state: State): Settled | null {
  const timeUp = state.endsAt && Date.now() >= state.endsAt;
  if (state.phase === 'night' && (timeUp || (living(state).filter(chooses).every(player => state.picks[player.id]) && agreed(state)))) return dawn(state);
  if (state.phase === 'vote' && (timeUp || living(state).every(player => state.votes[player.id]))) return count(state);
  if (state.phase === 'talk' && Date.now() >= (state.dayEndsAt ?? Infinity)) return { events: enter(state, 'vote') };
  if (state.phase === 'talk' && timeUp && state.turn) {
    const speaker = seatOf(state, state.turn.id);
    return { events: [routine(state, `${speaker.name}'s time is up.`, [speaker]), ...nextTurn(state)] };
  }
  return null;
}
