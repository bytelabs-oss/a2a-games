// The kitchen co-op for the a2a-games shell: the hooks that connect rules.ts to the shell. Chefs cook the orders that
// come in, together, against the clock.
import { startGame, endGame } from '../../src/shell/controls.ts';
import type { Game } from '../../src/shell/types.ts';
import { announce, chefRules, dishes, music, plateCount, service, soundOf, sounds, spots, starScores } from './public/kitchen.ts';
import { chainOf, crateFoods, isPlateable, seconds, words, type Link } from './public/things.ts';
import * as rules from './rules.ts';

// One step of a food's life: what it is, how it was made and in how many seconds, and whether it is ready for a plate.
const stage = ({ thing, by, seconds: took }: Link) =>
  `${words(thing.kind)}${by ? ` (${by === 'cut' ? `cut, ${took} s` : `${took} s on the heat`}${isPlateable(thing) ? '; ready for a plate' : ''})` : isPlateable(thing) ? ' (ready for a plate)' : ''}`;
const lives = Object.values(crateFoods).map(make => chainOf(new make()).map(stage).join(' → ')).join('; ');

// Every station, as it describes itself: stations that say the same are named together.
const kitchen = Object.values(rules.build()).reduce((groups, station) => {
  const summary = station.summary();
  groups.set(summary, [...(groups.get(summary) ?? []), station.id]);
  return groups;
}, new Map<string, string[]>());
const stationsText = [...kitchen].map(([summary, ids]) => `${ids.join(', ')}: ${summary}`).join('. ');

const menu = Object.values(dishes).map(dish => `${dish.name} (${dish.foods.map(words).join(', ')}; ${dish.points} points; open ${dish.seconds} seconds)`).join('; ');

export default {
  title: 'Kitchen',
  rules: [
    `Up to ${chefRules.starts.length} chefs cook together. Service starts when every chef is ready, or when the page starts it, and runs for the minutes the page sets. The view's left is the seconds of service remaining.`,
    `An order comes in every ${service.orders.every} seconds while fewer than ${service.orders.open} are open. Each order stays open for its dish's seconds, shown as left. A served order scores its points. An order that runs out costs ${service.orders.missedPenalty} points. Orders still open when service ends cost nothing. Stars come at ${starScores.join(', ')} points.`,
    `Menu: ${menu}.`,
    `Foods, from crate to ready: ${lives}. Food on a stove cooks through each stage by itself. Cutting, washing or spraying stopped partway keeps its progress.`,
    `Stations: ${stationsText}.`,
    `Every chef and station has a cell, x and y. You use a station from the floor cell next to it. Chefs walk ${chefRules.speed} cells a second and pass through each other.`,
    `You are at the station you last walked to, shown as at in the view. Only one chef can be at a station: a walk to a station another chef is at is refused, and of two chefs walking to the same station, the second to arrive is refused.`,
    `When you are done at a station, give it up: move to a spot, so another chef can use the station. Spots are floor cells away from the stations: ${spots.map(spot => spot.id).join(', ')}. The view's spots show each one's cell and the chef on it, or null when it is empty. Only one chef can be on a spot: a move to a spot another chef is on is refused.`,
    `Steps act on the station you are at, so walk there first. Separate several steps with ; and they run in order. Act answers with the act's number, and once a step has to wait, listing the steps still running. When they all finish, a reply among your events says so, naming the act by its number. If a step fails, the steps after it are dropped, and a reply among your events says which act and step failed and why. You cannot act while steps are running; stop ends them.`,
    `You hold one thing at a time. Each counter, board and stove holds one thing, and a plate with food on it is one thing.`,
    `Every plate has a name, plate_1 to plate_${plateCount}, shown as id wherever the view shows the plate. To plate food, put ready food on the plate by its name, as in put plate_1, from the station the plate lies on, or hold a plate and take ready food onto it. A plate lying on a station covers it: a put on that station is refused. Food stays on its plate until the plate is delivered or binned. A plate does not go onto another plate.`,
    `There are ${plateCount} plates. A delivered plate comes back dirty to the sink.`,
    `A fire burns everything on its station. Every ${seconds.fireSpreads} seconds it spreads to a neighbouring station that can burn. To put it out, hold the extinguisher and spray for ${seconds.spray} seconds.`,
    `Rats climb onto counters and boards with food, on average every ${service.rats.default} seconds, or as often as the page's "Seconds between rats" sets. A rat eats the food there, including food on a plate, after ${seconds.ratEats} seconds. Shoo it with empty hands.`,
    `At a station with a fire or a rat, you can only spray or shoo.`,
    `Your view shows every chef, station and order, and the clock. You are "you".`,
    `Leaving the game closes its channel to you.`,
  ].join(' '),
  actions: Object.entries(rules.steps).map(([name, step]) => ({ name, description: `${step.form}: ${step.description}` })),
  options: [
    { id: 'minutes', label: 'Service length (minutes)', type: 'slider', default: service.minutes.default, min: service.minutes.min, max: service.minutes.max, step: 1 },
    { id: 'ratSeconds', label: 'Seconds between rats', type: 'slider', default: service.rats.default, min: service.rats.min, max: service.rats.max, step: 5 },
  ],
  settings: [{ id: 'names', label: 'Show names', type: 'switch', default: true }],
  music,
  sounds,
  // Often enough for chefs to walk smoothly from cell to cell.
  tickSeconds: 0.2,

  create: rules.create,
  join: rules.join,
  leave(state, player) {
    rules.leave(state, player);
  },
  ready(state, player) {
    if (rules.ready(state, player)) startGame();
  },
  start: rules.start,
  end: rules.end,
  act: rules.act,
  stop: rules.stop,
  tick(state, seconds) {
    const moved = rules.tick(state, seconds);
    if (!moved) return null;
    if (moved.over) endGame();
    return { events: moved.events.map(announce), sound: soundOf(moved.events) };
  },
  view: rules.view,
} satisfies Game<rules.State>;
