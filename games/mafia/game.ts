// Mafia for the a2a-games shell: the step table, the views, and the hooks that connect rules.ts to the shell.
import { startGame, endGame } from '../../src/shell/controls.ts';
import type { Game, Outcome, PlayerRef } from '../../src/shell/types.ts';
import * as rules from './rules.ts';
import type { Phase, Role, Settled, State } from './rules.ts';
import type { PageView } from './public/types.ts';

// A step: its form, the phases it works in, what it does, and how it runs. name is the rest of the step's text.
interface Step {
  form: string;
  phases: Phase[];
  description: string;
  run(state: State, player: PlayerRef, name: string): Outcome | Settled;
}

const { seats, seconds, nobody } = rules;

// The music that loops through the game, and the sound each phase opens with: files in public/, with their packs'
// licenses beside them.
const music = 'audio/unsolved-investigation/unsolved-investigation.ogg';
const sounds = {
  toll: 'audio/kenney-impact-sounds/impactBell_heavy_000.ogg',
  chime: 'audio/kenney-interface-sounds/confirmation_002.ogg',
  gavel: 'audio/kenney-impact-sounds/impactMetal_heavy_000.ogg',
};
const phaseSounds: Partial<Record<Phase, keyof typeof sounds>> = { night: 'toll', talk: 'chime', vote: 'gavel', over: 'toll' };

// Adds the sound of the phase the game moved into, when a hook moved it.
function withSound<T extends Outcome | Settled>(state: State, before: Phase, outcome: T | null): (T & Outcome) | null {
  const sound = state.phase !== before && phaseSounds[state.phase];
  return outcome && sound ? { ...outcome, sound } : outcome;
}
const refuse = (message: string): Outcome => ({ ok: false, message });
const seated = (state: State, player: PlayerRef) => rules.seatOf(state, player.id);
const isNarrator = (state: State, player: PlayerRef) => state.narrator?.id === player.id;
const roleText: Record<Role, string> = {
  mafia: 'At night, choose someone to eliminate with pick <name>. When there are two mafia, both must pick the same player; your view shows your partner and their pick, and you may plan with your partner by direct message in the room.',
  doctor: 'At night, protect one player from the mafia with pick <name>. You may protect yourself.',
  detective: 'At night, check one other player with pick <name>. At dawn your view shows whether they are mafia.',
  villager: 'You sleep at night and have no night choice.',
};

// Every step: its form, when it works, and what it does. The actions agents read and the parser both come from here.
const steps: Record<string, Step> = {
  narrate: {
    form: 'narrate',
    phases: ['lobby'],
    description: 'Take the narrator seat. The narrator starts the game, can give the floor, and never votes or chooses at night.',
    run(state, player) {
      if (state.narrator && !isNarrator(state, player)) return refuse(`${state.narrator.name} is already the narrator.`);
      state.players = state.players.filter(each => each.id !== player.id);
      state.narrator = { id: player.id, name: player.name };
      return { ok: true, message: 'You are the narrator.', events: [`${player.name} is the narrator.`] };
    },
  },
  start: {
    form: 'start',
    phases: ['lobby'],
    description: `Narrator only: deal the roles and begin the first night. Needs ${seats.min} to ${seats.max} players, every one of them ready.`,
    run(state, player) {
      if (!isNarrator(state, player)) return refuse('Only the narrator starts the game.');
      const started = startGame();
      return started.ok ? { ok: true, message: 'The game has started. Roles are dealt and the first night begins.' } : started;
    },
  },
  pick: {
    form: 'pick <name>',
    phases: ['night'],
    description: 'Mafia, doctor and detective: make your night choice. A new pick replaces your last one.',
    run(state, player, name) {
      const target = rules.named(state, name);
      if (!target) return refuse('Pick a living player by name.');
      return rules.pick(state, seated(state, player), target);
    },
  },
  floor: {
    form: 'floor, or floor <name> for the narrator',
    phases: ['talk'],
    description: `On your turn, take the floor to speak for up to ${seconds.turn} seconds. The narrator gives the floor to any living player with floor <name>.`,
    run(state, player, name) {
      if (isNarrator(state, player)) {
        const target = rules.named(state, name);
        return target ? { ok: true, events: rules.giveFloor(state, target) } : refuse('Give the floor to a living player by name.');
      }
      if (state.turn?.id !== player.id) return refuse('It is not your turn.');
      if (state.turn.speaking) return refuse('You already have the floor.');
      return { ok: true, message: 'You have the floor. Speak in the chat, then pass.', events: rules.giveFloor(state, seated(state, player)) };
    },
  },
  pass: {
    form: 'pass, or pass <name>',
    phases: ['talk'],
    description: 'On your turn, end it: pass gives the next seat its turn, pass <name> hands the floor to another living player.',
    run(state, player, name) {
      if (state.turn?.id !== player.id) return refuse('It is not your turn.');
      if (!name) return { ok: true, events: [rules.routine(state, `${player.name} passed.`), ...rules.nextTurn(state)] };
      const target = rules.named(state, name);
      if (!target || target.id === player.id) return refuse('Pass to another living player by name.');
      return { ok: true, events: [rules.routine(state, `${player.name} passes the floor to ${target.name}.`), ...rules.giveFloor(state, target)] };
    },
  },
  skip: {
    form: 'skip',
    phases: ['talk'],
    description: 'Ask to end the day and vote now. On your turn, skip also passes it. The vote opens as soon as every living player has asked, or when the day runs out.',
    run: (state, player) => rules.skip(state, seated(state, player)),
  },
  vote: {
    form: 'vote <name>, or vote nobody',
    phases: ['vote'],
    description: 'Vote to put a living player out, or vote nobody. A new vote replaces your last one.',
    run(state, player, name) {
      const target = name.toLowerCase() === nobody ? null : rules.named(state, name);
      if (!target && name.toLowerCase() !== nobody) return refuse('Vote for a living player by name, or nobody.');
      return rules.vote(state, seated(state, player), target);
    },
  },
};
// Steps only living players may take.
const playerSteps = new Set(['pick', 'pass', 'skip', 'vote']);

// Runs a rules outcome through the shell: a finished game ends itself.
function finish<T extends Outcome & { over?: boolean }>(outcome: T | null) {
  if (outcome?.over) endGame();
  return outcome;
}

function bar(state: State) {
  if (state.phase === 'lobby') {
    const waiting = state.narrator ? `Waiting for ${state.narrator.name} to start` : 'Waiting for a narrator';
    return `${waiting} · ${state.players.filter(player => player.ready).length} of ${state.players.length} ready`;
  }
  if (state.phase === 'night') return `Night ${state.day} · ${rules.choosers(state)} are choosing`;
  const turn = state.turn && rules.seatOf(state, state.turn.id).name;
  if (state.phase === 'talk') return state.turn?.speaking ? `${turn} has the floor` : `${turn}'s turn · floor or pass`;
  if (state.phase === 'vote') return `Vote · ${Object.keys(state.votes).length} of ${rules.living(state).length} voted`;
  return 'The game is over';
}

const secondsLeft = (state: State) => (state.endsAt ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000)) : null);

// The page sees everything, roles included: players only ever see their own view through their tools.
function pageView(state: State): PageView {
  return {
    day: state.day,
    // The page only needs day or night, for its lighting and the sun or moon.
    phase: state.phase === 'night' ? 'night' : 'day',
    narrator: state.narrator,
    players: state.players.map(({ id, name, role, alive }) => ({ id, name, role, eliminated: !alive })),
    bar: { text: bar(state), endsAt: state.endsAt },
  };
}

export type PlayerView = ReturnType<typeof playerView>;

function playerView(state: State, playerId: string) {
  const name = (id: string) => (id === nobody ? nobody : rules.seatOf(state, id).name);
  const you = rules.byId(state, playerId);
  const over = state.phase === 'over';
  const view = {
    day: state.day,
    phase: state.phase,
    secondsLeft: secondsLeft(state),
    ...(state.phase === 'talk' && state.dayEndsAt && { daySecondsLeft: Math.max(0, Math.ceil((state.dayEndsAt - Date.now()) / 1000)) }),
    narrator: state.narrator?.name ?? null,
    turn: state.turn && { name: name(state.turn.id), speaking: state.turn.speaking },
    players: state.players.map(player => ({ name: player.name, alive: player.alive, ...(state.phase === 'lobby' && { ready: player.ready }), ...((!player.alive || over) && { role: player.role }) })),
    voted: Object.keys(state.votes).length,
    winner: state.winner,
  };
  if (!you) return view;
  return {
    ...view,
    you: { name: you.name, role: you.role, alive: you.alive, ...(you.role && { duty: you.alive ? roleText[you.role] : 'You are out. Stay silent until the game ends.' }) },
    yourChoice: state.picks[you.id] ? name(state.picks[you.id]) : state.votes[you.id] ? name(state.votes[you.id]) : null,
    ...(you.role === 'mafia' && { mafia: state.players.filter(player => player.role === 'mafia').map(member => ({ name: member.name, alive: member.alive, pick: state.picks[member.id] ? name(state.picks[member.id]) : null })) }),
    ...(you.role === 'detective' && { checks: state.checks[you.id] ?? [] }),
  };
}

const mafia = {
  title: 'Mafia',
  rules: [
    `One agent is the narrator and ${seats.min} to ${seats.max} are players. The narrator claims the seat with narrate; players call ready once seated, and the narrator starts once every player is ready. The narrator never votes or chooses at night.`,
    'Each player gets a secret role, shown in their own view: one mafia (two with eight players), a detective from five players, a doctor from six, and villagers for the rest.',
    `Night (${seconds.night} seconds): the mafia agree on someone to eliminate, the doctor protects one player, the detective checks one player. Players stay silent. Night ends early once every choice is made.`,
    `Day (${seconds.day} seconds): living players take turns in seat order, and the order starts again once everyone has had a turn. On your turn, floor to speak for up to ${seconds.turn} seconds, or pass to skip; with the floor, pass hands it on. The narrator can give anyone the floor. Speak only while you have the floor. The vote opens when the day's time is up, or sooner once every living player has called skip.`,
    `Vote (${seconds.vote} seconds, or until everyone has voted): the most votes put a player out; a tie or a lead for nobody puts no one out. Eliminated players' roles are revealed and they stay silent.`,
    `The village wins when no mafia remain. The mafia win when they match everyone else. After ${rules.maxNights} nights it is a draw.`,
  ].join(' '),
  actions: Object.entries(steps).map(([name, step]) => ({ name, description: `${step.form}: ${step.description}` })),
  settings: [{ id: 'names', label: 'Show names', type: 'switch' as const, default: true }],
  tickSeconds: 1,
  music,
  sounds,

  create: rules.create,
  join(state, player) {
    if (!['lobby', 'over'].includes(state.phase)) return refuse('A game is in progress. Join the next one.');
    if (state.players.filter(each => !each.left).length + (state.narrator ? 1 : 0) > seats.max) return refuse(`The table has ${seats.max} seats and the narrator's chair, all taken.`);
    state.players.push({ id: player.id, name: player.name, role: null, alive: true, ready: false });
  },
  ready(state, player) {
    const seated = rules.byId(state, player.id);
    if (seated) seated.ready = true;
  },
  leave(state, player) {
    if (isNarrator(state, player)) {
      state.narrator = null;
      if (state.phase !== 'lobby' && state.phase !== 'over') {
        endGame();
        return { events: [{ text: 'The narrator left. The game stops with no winner.', headline: true }] };
      }
      return;
    }
    const before = state.phase;
    return withSound(state, before, finish(rules.leave(state, player)));
  },
  start: rules.start,
  end(state) {
    const stopped = state.phase !== 'over';
    rules.enter(state, 'over');
    const roles = state.players.filter(player => player.role).map(rules.reveal).join(' ');
    return { events: [...(stopped ? ['The game was stopped.'] : []), ...(roles ? [`Roles: ${roles}`] : [])] };
  },
  act(state, player, text) {
    const [name = '', ...rest] = text.split(/\s+/);
    const step = steps[name.toLowerCase()];
    if (!step) return refuse(`Unknown step "${name}". Steps: ${Object.keys(steps).join(', ')}.`);
    if (!step.phases.includes(state.phase)) return refuse(`${name} works during ${step.phases.join(' or ')}; it is ${state.phase} now.`);
    if (playerSteps.has(name.toLowerCase()) && !rules.byId(state, player.id)?.alive) return refuse('Only living players can do that.');
    const before = state.phase;
    return withSound(state, before, finish(step.run(state, player, rest.join(' '))));
  },
  tick(state) {
    const before = state.phase;
    return withSound(state, before, finish(rules.tick(state)));
  },
  view(state, playerId) {
    return playerId === null ? pageView(state) : playerView(state, playerId);
  },
} satisfies Game<State>;

export default mafia;
