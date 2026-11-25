// The kitchen's stations as classes. Every station answers the same few questions its own way: what it accepts, what a
// chef's put and take do there, what work a chef can do there, and what happens there as time passes. A surface holds
// things; a board is a surface for what can be cut; a stove is one for what can be cooked, and cooks it by itself.
// Fire and rats can come onto a station; putting one out or chasing one off is work any station allows.
import {
  DirtyPlate, Extinguisher, Fire, Food, Item, Plate, Rat, isCookable, isCuttable, isPlateable, article, words, type ItemView,
} from './public/things.ts';
import type { KitchenEvent, Place, ProgressView, StationView, StepName } from './public/types.ts';

// The chef at a station: their name and what they hold, one item at a time.
export interface Hands {
  name: string;
  held: Item | null;
}

export interface Done {
  ok: boolean;
  message: string;
  events?: KitchenEvent[];
}

export type Work = { status: 'working' } | { status: 'done' | 'stopped'; message: string; events?: KitchenEvent[] };

const ok = (message: string, events: KitchenEvent[] = []): Done => ({ ok: true, message, events });
const refuse = (message: string): Done => ({ ok: false, message });
const name = (thing: { kind: string }) => words(thing.kind);
const describe = (item: Item) => (item instanceof Plate
  ? (item.foods.length ? `a plate of ${item.foods.map(name).join(', ')}` : 'an empty plate') : article(name(item)));
const progress = (fill: number, rate: number, warning = false): ProgressView => ({ fill, rate, warning });

export abstract class Station {
  // Whether a fire can start or spread here, and whether rats climb onto it.
  readonly flammable: boolean = false;
  readonly ratsClimb: boolean = false;
  fire: Fire | null = null;
  rat: Rat | null = null;
  // How long the fire has burned since it last spread, how long it has been sprayed, and how long the rat has nibbled.
  private fireAge = 0;
  private sprayed = 0;
  private ratAge = 0;

  readonly place: Place;

  constructor(place: Place) {
    this.place = place;
  }

  get id() {
    return this.place.id;
  }

  accepts(_item: Item): boolean {
    return false;
  }

  // What this station is for, in words, for the rules.
  abstract purpose(): string;

  // What this station is for, and whether it can burn and rats climb onto it.
  summary() {
    return [this.purpose(), this.flammable && 'it can catch fire', this.ratsClimb && 'rats climb onto it when food lies there']
      .filter(Boolean).join('; ');
  }

  put(hands: Hands, _ontoPlate = false): Done {
    return refuse(hands.held ? `Nothing is put down on ${this.id}.` : 'Your hands are empty.');
  }

  take(_hands: Hands): Done {
    return refuse(`Nothing is taken from ${this.id}.`);
  }

  // Why a chef cannot start a step here, or null when they can. Putting out a fire and chasing off a rat work anywhere.
  canWork(step: StepName, hands: Hands): string | null {
    if (step === 'spray') {
      if (!this.fire) return `${this.id} is not on fire.`;
      return hands.held instanceof Extinguisher ? null : 'To spray, hold the extinguisher.';
    }
    if (step === 'shoo') return this.rat ? (hands.held ? 'To shoo, empty your hands.' : null) : `There is no rat on ${this.id}.`;
    return `There is nothing to ${step} on ${this.id}.`;
  }

  // A chef's work here, `seconds` more of it.
  work(step: StepName, seconds: number, hands: Hands): Work {
    const why = this.canWork(step, hands);
    if (why) return { status: 'stopped', message: why };
    if (step === 'shoo') {
      this.rat = null;
      return { status: 'done', message: `You shooed the rat off ${this.id}.`, events: [{ type: 'ratShooed', station: this.id, chef: hands.name }] };
    }
    const fire = this.fire as Fire;
    this.sprayed += seconds;
    if (this.sprayed < fire.spraySeconds) return { status: 'working' };
    this.fire = null;
    this.sprayed = 0;
    return { status: 'done', message: `The fire on ${this.id} is out.`, events: [{ type: 'fireOut', station: this.id, chef: hands.name }] };
  }

  // What happens here as `seconds` pass: a fire grows toward spreading, a rat toward eating. spreads says the fire is
  // ready to spread; changed says something people can see changed.
  tick(seconds: number): { events: KitchenEvent[]; spreads: boolean; changed: boolean } {
    const events: KitchenEvent[] = [];
    let spreads = false;
    let changed = false;
    if (this.fire) {
      this.fireAge += seconds;
      if (this.fireAge >= this.fire.spreadSeconds) {
        this.fireAge = 0;
        spreads = true;
      }
    }
    if (this.rat) {
      this.ratAge += seconds;
      if (this.ratAge >= this.rat.eatSeconds) {
        this.rat = null;
        this.eaten();
        events.push({ type: 'ratAte', station: this.id });
        changed = true;
      }
    }
    return { events, spreads, changed };
  }

  // The station catches fire, which burns whatever lies here.
  ignite() {
    this.fire = new Fire();
    this.fireAge = this.sprayed = 0;
    this.rat = null;
    this.burnt();
  }

  // A rat climbs on.
  climb() {
    this.rat = new Rat();
    this.ratAge = 0;
  }

  // Whether there is food here for a rat to eat.
  hasFood(): boolean {
    return false;
  }
  protected eaten() {}
  protected burnt() {}

  // What the page sees here; working says a chef is working here now.
  view(working: boolean): StationView {
    const shown: StationView = { x: this.place.x, y: this.place.y };
    if (this.fire) shown.fire = true;
    if (this.rat) shown.rat = true;
    if (this.rat) shown.progress = progress(this.ratAge / this.rat.eatSeconds, 1 / this.rat.eatSeconds, true);
    else if (this.fire) shown.progress = progress(this.sprayed / this.fire.spraySeconds, working ? 1 / this.fire.spraySeconds : 0);
    return shown;
  }
}

// How many things a counter, board or stove holds.
export const surfaceCapacity = 1;

// A surface holds up to `capacity` things it accepts. Food goes onto a plate here only when the put names the plate, and
// food taken while holding a plate goes onto that plate.
export abstract class Surface extends Station {
  readonly capacity: number = surfaceCapacity;
  items: Item[] = [];

  put(hands: Hands, ontoPlate = false): Done {
    const held = hands.held;
    if (!held) return refuse('Your hands are empty.');
    const plate = this.items.find((item): item is Plate => item instanceof Plate);
    if (ontoPlate) {
      if (!plate) return refuse(`There is no plate on ${this.id}.`);
      if (!plate.takes(held)) return refuse(`The plate on ${this.id} ${plate.refuses(held)}.`);
      plate.foods.push(held);
      hands.held = null;
      return ok(`Added the ${name(held)} to the plate on ${this.id}.`);
    }
    if (plate) return refuse(`A plate is on ${this.id}. To add what you hold to that plate: put ${this.id} plate.`);
    if (!this.accepts(held)) return refuse(`${this.id} does not take ${describe(held)}.`);
    if (this.items.length >= this.capacity) return refuse(`${this.id} already holds ${this.items.map(describe).join(' and ')}.`);
    this.items.push(held);
    hands.held = null;
    this.changedItems();
    return ok(`You put ${describe(held)} on ${this.id}.`);
  }

  take(hands: Hands): Done {
    const held = hands.held;
    const top = this.items.at(-1);
    if (!top) return refuse(`There is nothing on ${this.id} to take.`);
    if (held instanceof Plate) {
      const food = this.items.find(item => held.takes(item));
      if (food && isPlateable(food)) {
        held.foods.push(food);
        this.items = this.items.filter(item => item !== food);
        this.changedItems();
        return ok(`Added the ${name(food)} to your plate.`);
      }
      const refused = (top instanceof Food || top instanceof Plate) && held.refuses(top);
      if (refused) return refuse(`Your plate ${refused}.`);
    }
    if (held) return refuse(`Your hands are full: you hold ${describe(held)}.`);
    this.items.pop();
    hands.held = top;
    this.changedItems();
    return ok(`You hold ${describe(top)}.`);
  }

  // Called when what lies here changes; a station that works on it starts over.
  protected changedItems() {}

  hasFood() {
    return this.items.some(item => item instanceof Food || (item instanceof Plate && item.foods.length > 0));
  }
  protected eaten() {
    this.items = this.items.filter(item => !(item instanceof Food));
    for (const item of this.items) if (item instanceof Plate) item.foods = [];
    this.changedItems();
  }
  protected burnt() {
    this.items = [];
    this.changedItems();
  }

  view(working: boolean): StationView {
    return { ...super.view(working), ...(this.items.length && { items: this.items.map(item => item.view()) }) };
  }
}

export class Counter extends Surface {
  readonly flammable = true;
  readonly ratsClimb = true;
  accepts(_item: Item) {
    return true;
  }
  purpose() {
    return `holds anything, ${this.capacity} at a time`;
  }
}

// A board holds one thing that can be cut, and a chef cuts it there.
export class Board extends Surface {
  readonly flammable = true;
  readonly ratsClimb = true;
  private cutFor = 0;

  accepts(item: Item) {
    return isCuttable(item);
  }
  purpose() {
    return `holds food to cut, ${this.capacity} at a time; a chef cuts it here with empty hands`;
  }
  protected changedItems() {
    this.cutFor = 0;
  }
  canWork(step: StepName, hands: Hands) {
    if (step !== 'cut') return super.canWork(step, hands);
    if (!this.items.some(isCuttable)) return `There is nothing to cut on ${this.id}.`;
    return hands.held ? 'To cut, empty your hands.' : null;
  }
  work(step: StepName, seconds: number, hands: Hands): Work {
    if (step !== 'cut') return super.work(step, seconds, hands);
    const why = this.canWork(step, hands);
    const item = this.items.find(isCuttable);
    if (why || !item) return { status: 'stopped', message: why ?? '' };
    this.cutFor += seconds;
    if (this.cutFor < item.cutSeconds) return { status: 'working' };
    const cut = item.cut();
    this.items = this.items.map(each => (each === item ? cut : each));
    this.cutFor = 0;
    return { status: 'done', message: `The ${name(item)} is cut: ${describe(cut)}.` };
  }
  view(working: boolean): StationView {
    const shown = super.view(working);
    const item = this.items.find(isCuttable);
    if (!shown.progress && item && (working || this.cutFor > 0)) shown.progress = progress(this.cutFor / item.cutSeconds, working ? 1 / item.cutSeconds : 0);
    return shown;
  }
}

// A stove holds one thing that can be cooked, and cooks it by itself: ready food first, then, left on, burnt food, and
// then a fire.
export class Stove extends Surface {
  readonly flammable = true;
  private heated = 0;

  accepts(item: Item) {
    return isCookable(item);
  }
  purpose() {
    return `holds food to cook, ${this.capacity} at a time; it cooks here by itself`;
  }
  protected changedItems() {
    this.heated = 0;
  }
  tick(seconds: number) {
    const result = super.tick(seconds);
    const item = this.items.find(isCookable);
    if (!item || this.fire) return result;
    this.heated += seconds;
    if (this.heated < item.cookSeconds) return result;
    const next = item.cook();
    if (next instanceof Fire) {
      this.ignite();
      result.events.push({ type: 'fireStarted', station: this.id });
    } else if (next instanceof Item) {
      this.items = this.items.map(each => (each === item ? next : each));
      this.heated = 0;
      result.events.push(isPlateable(next) ? { type: 'foodCooked', station: this.id, food: next.view().kind } : { type: 'foodBurnt', station: this.id, food: next.view().kind });
    }
    result.changed = true;
    return result;
  }
  view(working: boolean): StationView {
    const shown = super.view(working);
    const item = this.items.find(isCookable);
    // Heading for food that is not ready, or for a fire, warns.
    if (!shown.progress && item) shown.progress = progress(this.heated / item.cookSeconds, 1 / item.cookSeconds, !isPlateable(item.cook()));
    return shown;
  }
}

// The hook the extinguisher hangs on.
export class Hook extends Surface {
  accepts(item: Item) {
    return item instanceof Extinguisher;
  }
  purpose() {
    return 'holds the extinguisher';
  }
}

// A crate gives its food, as many as needed. Food that is ready as it comes, such as a bun, goes onto a plate in hand.
export class Crate extends Station {
  private readonly make: () => Food;

  constructor(place: Place, make: () => Food) {
    super(place);
    this.make = make;
  }
  purpose() {
    return `gives ${article(name(this.make()))}, as many as needed`;
  }
  take(hands: Hands): Done {
    const food = this.make();
    if (hands.held instanceof Plate && hands.held.takes(food)) {
      hands.held.foods.push(food);
      return ok(`Added the ${name(food)} to your plate.`);
    }
    if (hands.held) return refuse(`Your hands are full: you hold ${describe(hands.held)}.`);
    hands.held = food;
    return ok(`You hold ${describe(food)}.`);
  }
}

// A stack of clean plates; a chef takes one at a time.
export class PlateRack extends Station {
  count: number;

  purpose() {
    return 'gives a clean plate, one at a time';
  }
  constructor(place: Place, count: number) {
    super(place);
    this.count = count;
  }
  take(hands: Hands): Done {
    if (hands.held) return refuse(`Your hands are full: you hold ${describe(hands.held)}.`);
    if (!this.count) return refuse(`There are no clean plates on ${this.id}.`);
    this.count -= 1;
    hands.held = new Plate();
    return ok(`You hold ${describe(hands.held)}.`);
  }
  view(working: boolean): StationView {
    return { ...super.view(working), ...(this.count && { stack: { kind: 'Plate', count: this.count } }) };
  }
}

// Delivered plates come back dirty to the sink, where a chef washes them one at a time into the rack.
export class Sink extends Station {
  dirty: DirtyPlate[] = [];
  private washedFor = 0;

  private readonly rack: PlateRack;

  purpose() {
    return `takes dirty plates; a chef washes one here with empty hands in ${new DirtyPlate().washSeconds} seconds, and it joins the clean plates`;
  }
  constructor(place: Place, rack: PlateRack) {
    super(place);
    this.rack = rack;
  }
  canWork(step: StepName, hands: Hands) {
    if (step !== 'wash') return super.canWork(step, hands);
    if (!this.dirty.length) return `There are no dirty plates at ${this.id}.`;
    return hands.held ? 'To wash, empty your hands.' : null;
  }
  work(step: StepName, seconds: number, hands: Hands): Work {
    if (step !== 'wash') return super.work(step, seconds, hands);
    const why = this.canWork(step, hands);
    const plate = this.dirty.at(-1);
    if (why || !plate) return { status: 'stopped', message: why ?? '' };
    this.washedFor += seconds;
    if (this.washedFor < plate.washSeconds) return { status: 'working' };
    this.dirty.pop();
    plate.wash();
    this.rack.count += 1;
    this.washedFor = 0;
    return { status: 'done', message: 'The plate is clean.' };
  }
  view(working: boolean): StationView {
    const shown = super.view(working);
    const plate = this.dirty.at(-1);
    if (plate) shown.stack = { kind: 'DirtyPlate', count: this.dirty.length };
    if (!shown.progress && plate && (working || this.washedFor > 0)) shown.progress = progress(this.washedFor / plate.washSeconds, working ? 1 / plate.washSeconds : 0);
    return shown;
  }
}

// The bin throws food away, and empties a plate, which stays in the chef's hands.
export class Bin extends Station {
  purpose() {
    return 'throws away food, and the food on a plate';
  }
  put(hands: Hands): Done {
    const held = hands.held;
    if (held instanceof Food) {
      hands.held = null;
      return ok(`You threw away ${describe(held)}.`);
    }
    if (held instanceof Plate && held.foods.length) {
      held.foods = [];
      return ok('You threw away the food on your plate.');
    }
    return refuse(held ? `${describe(held)} is not thrown away.` : 'Your hands are empty.');
  }
}

// The delivery belt takes a plate only for an order's ticket, with deliver <order>.
export class Belt extends Station {
  purpose() {
    return 'takes a plate for an order, with deliver';
  }
  put(_hands: Hands): Done {
    return refuse(`Hand a plate over at ${this.id} with deliver <order>.`);
  }
}

// The view of a thing a chef holds.
export const viewOf = (item: Item | null): ItemView[] => (item ? [item.view()] : []);
