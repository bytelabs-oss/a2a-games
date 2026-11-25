// Bomb for the a2a-games shell: the step table, the views, and the hooks that connect rules.ts to the shell. One
// defuser sees the bomb; the experts hold the manual; they talk until it is defused or goes off.
import { startGame, endGame } from '../../src/shell/controls.ts';
import type { Game, Outcome, PlayerRef } from '../../src/shell/types.ts';
import * as rules from './rules.ts';
import type { Phase, Role, Settled, State } from './rules.ts';
import type { PageView } from './public/types.ts';

const { seats, clock, bombParts, gauge, modules } = rules;

// A step: its form, what it does, and how it runs on the rest of the step's text. Every step is the defuser's, while
// the bomb is armed.
interface Step {
  form: string;
  description: string;
  run(state: State, argument: string): Settled;
}
const stepPhase: Phase = 'armed';
const stepRole: Role = 'defuser';

const steps: Record<string, Step> = {
  cut: {
    form: 'cut <wire>',
    description: 'Cut a wire, numbered from 1 at the top. The right wire solves Wires; any other is a strike.',
    run: (state, wire) => rules.cut(state, Number(wire)),
  },
  press: {
    form: 'press <symbol>',
    description: 'Press the button with that symbol. The next one in the right order counts; one out of order is a strike and does not count. All of them in order solves Symbols.',
    run: (state, symbol) => rules.press(state, symbol.toLowerCase()),
  },
  turn: {
    form: 'turn <gauge> [clicks]',
    description: `Turn a gauge's valve one click, or the number of clicks given, one at a time. Each click lowers the gauge by ${gauge.click}; below 0 it comes round from ${gauge.readings}. A click on a gauge already inside the band is a strike, and the clicks after it are dropped. Every gauge inside the band solves Gauges.`,
    run(state, argument) {
      const [gaugeNumber, clicks = '1'] = argument.split(/\s+/);
      return rules.turn(state, Number(gaugeNumber), Number(clicks));
    },
  },
};

const refuse = (message: string): Outcome => ({ ok: false, message });

// Runs a rules outcome through the shell: a finished round ends the game.
function finish(outcome: Settled | null) {
  if (outcome?.over) endGame();
  return outcome;
}

const solvedCount = (state: State) => modules.filter(module => state.bomb?.solved[module]).length;

function bar(state: State) {
  if (state.phase === 'lobby') return `Waiting for everyone to be ready · ${state.players.filter(player => player.ready).length} of ${state.players.length} ready`;
  if (state.phase === 'armed') return `${rules.defuser(state)?.name} is defusing · ${solvedCount(state)} of ${modules.length} modules solved`;
  if (state.result === 'defused') return `Defused with ${rules.clockText(state.left)} left`;
  if (state.result === 'exploded') return 'The bomb went off';
  return 'The round was stopped';
}

// The page sees everything, the whole bomb and every expert's pages: players only ever see their own view through
// their tools.
function pageView(state: State): PageView {
  const bomb = state.bomb;
  const phase = state.phase === 'over' && (state.result === 'defused' || state.result === 'exploded') ? state.result : state.phase === 'armed' ? 'armed' : 'lobby';
  return {
    phase,
    players: state.players.map(({ id, name, role, pages }) => ({ id, name, role, pages })),
    bomb: bomb && phase !== 'lobby' ? {
      serial: bomb.serial,
      batteries: bomb.batteries,
      endsAt: state.endsAt,
      left: state.left,
      strikes: bomb.strikes,
      maxStrikes: clock.maxStrikes,
      wires: { ...bomb.wires, solved: bomb.solved.wires },
      symbols: { ...bomb.symbols, solved: bomb.solved.symbols },
      gauges: { ...bomb.gauges, solved: bomb.solved.gauges },
    } : null,
    bar: { text: bar(state) },
  };
}

const duties: Record<Role, string> = {
  defuser: 'You see the bomb and have no manual. Describe it to the experts and do what they tell you: cut, press and turn.',
  expert: 'You hold part of the manual and cannot see the bomb. Ask the defuser what it shows, and tell them what to do.',
};

export type PlayerView = ReturnType<typeof playerView>;

// What one player may know: everyone sees the clock, the strikes and which modules are solved; only the defuser sees
// the bomb, and only an expert their own pages.
function playerView(state: State, playerId: string) {
  const you = rules.byId(state, playerId);
  const bomb = state.bomb;
  const view = {
    phase: state.phase,
    result: state.result,
    secondsLeft: rules.secondsLeft(state),
    strikes: bomb?.strikes ?? 0,
    maxStrikes: clock.maxStrikes,
    solved: bomb?.solved ?? null,
    players: state.players.map(player => ({ name: player.name, role: player.role })),
  };
  if (!you) return view;
  return {
    ...view,
    you: { name: you.name, role: you.role, ...(you.role && { duty: duties[you.role] }) },
    ...(you.role === 'defuser' && bomb && {
      bomb: {
        serial: bomb.serial,
        batteries: bomb.batteries,
        wires: bomb.wires.colors.map((color, index) => ({ wire: index + 1, color, cut: bomb.wires.cut[index] })),
        symbols: { buttons: bomb.symbols.shown, pressedInOrder: bomb.symbols.pressed },
        gauges: bomb.gauges.readings.map((reading, index) => ({ gauge: index + 1, reading })),
      },
    }),
    ...(you.role === 'expert' && { manual: you.pages.map(page => ({ page, text: rules.manual[page] })) }),
  };
}

const bomb = {
  title: 'Bomb',
  rules: [
    `${seats.min} to ${seats.max} players. The round starts when everyone has called ready, or when the page starts it. One player is dealt the defuser at random; the rest are experts.`,
    'The defuser sees the bomb in their view and has no manual. The experts cannot see the bomb; the manual\'s four pages (Index, Wires, Symbols, Gauges) are dealt among them, and each sees only their own pages in their view.',
    `The bomb has a serial number, ${bombParts.batteries.min} to ${bombParts.batteries.max} batteries, and three modules: Wires, Symbols and Gauges. Every module's rule depends on the bomb's letter, A to D, which only the Index page says how to find.`,
    `The bomb goes off when its ${clock.seconds / 60} minutes run out. Each wrong step is a strike and takes ${clock.strikePenalty} seconds off the clock; ${clock.maxStrikes} strikes set the bomb off. Solving all three modules defuses it.`,
    'Only the defuser takes steps. Everyone sees the clock, the strikes and which modules are solved. Players talk in the game\'s chat or in their agent-room.',
    'Leaving the game closes its channel to you.',
  ].join(' '),
  actions: Object.entries(steps).map(([name, step]) => ({ name, description: `${step.form}: ${step.description}` })),
  settings: [{ id: 'names', label: 'Show names', type: 'switch' as const, default: true }],
  tickSeconds: 1,

  create: rules.create,
  join(state, player) {
    if (state.phase === 'armed') return refuse('A round is in progress. Join the next one.');
    if (state.players.length >= seats.max) return refuse(`Bomb takes ${seats.max} players, and they are all here.`);
    state.players.push({ id: player.id, name: player.name, ready: false, role: null, pages: [] });
  },
  ready(state, player) {
    const seat = rules.byId(state, player.id);
    if (!seat) return;
    seat.ready = true;
    if (state.players.length >= seats.min && state.players.every(each => each.ready)) startGame();
  },
  leave: (state, player: PlayerRef) => finish(rules.leave(state, player)),
  start: rules.start,
  end(state) {
    if (state.phase !== 'armed') return;
    rules.enter(state, 'over', 'stopped');
    return { events: ['The round was stopped.'] };
  },
  act(state, player, text) {
    const [name = '', ...rest] = text.trim().split(/\s+/);
    const step = steps[name.toLowerCase()];
    if (!step) return refuse(`Unknown step "${name}". Steps: ${Object.keys(steps).join(', ')}.`);
    if (state.phase !== stepPhase) return refuse(`${name} works while the bomb is armed; it is ${state.phase} now.`);
    if (rules.byId(state, player.id)?.role !== stepRole) return refuse('Only the defuser can touch the bomb.');
    return finish(step.run(state, rest.join(' ')));
  },
  tick: state => finish(rules.tick(state)),
  view: (state, playerId) => (playerId === null ? pageView(state) : playerView(state, playerId)),
} satisfies Game<State>;

export default bomb;
