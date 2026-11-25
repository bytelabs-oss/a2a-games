// Everything that can be in the kitchen besides the stations, as classes. What a thing is decides where it may go and
// what happens to it: an item can be carried; food is edible; a Cuttable thing turns into something else when cut, a
// Cookable one when it has been on the heat long enough, a Washable one when washed. A Plateable food is ready to go on
// a plate. Hazards (fire and rats) sit on stations but are never carried. The rules and the scene both import this file.

// How long each change takes, in seconds. Players are agents that take several seconds to decide each move, so what
// happens without them (cooking, burning, fire spreading, a rat eating) leaves time for a move or two in between.
export const seconds = { cut: 2.5, cook: 10, burn: 45, ignite: 20, wash: 3, spray: 2, ratEats: 40, fireSpreads: 20 } as const;

export abstract class Thing {
  abstract readonly kind: string;
}

export abstract class Item extends Thing {
  // What the page and the agents see of it.
  view(): ItemView {
    return { kind: this.kind as ItemKind };
  }
}

export abstract class Food extends Item {}

export interface Cuttable {
  readonly cutSeconds: number;
  cut(): Item;
}
export interface Cookable {
  readonly cookSeconds: number;
  cook(): Thing;
}
export interface Washable {
  readonly washSeconds: number;
  wash(): Item;
}
export interface Plateable {
  readonly plateable: true;
}

export const isCuttable = (thing: Thing): thing is Item & Cuttable => 'cut' in thing;
export const isCookable = (thing: Thing): thing is Item & Cookable => 'cook' in thing;
export const isWashable = (thing: Thing): thing is Item & Washable => 'wash' in thing;
export const isPlateable = (thing: Thing): thing is Food & Plateable => 'plateable' in thing;

// ── Food ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export class CutLettuce extends Food implements Plateable { readonly kind = 'CutLettuce'; readonly plateable = true; }
export class CutTomato extends Food implements Plateable { readonly kind = 'CutTomato'; readonly plateable = true; }
export class CutCheese extends Food implements Plateable { readonly kind = 'CutCheese'; readonly plateable = true; }
export class CutOnion extends Food implements Plateable { readonly kind = 'CutOnion'; readonly plateable = true; }

export class Lettuce extends Food implements Cuttable { readonly kind = 'Lettuce'; readonly cutSeconds = seconds.cut; cut() { return new CutLettuce(); } }
export class Tomato extends Food implements Cuttable { readonly kind = 'Tomato'; readonly cutSeconds = seconds.cut; cut() { return new CutTomato(); } }
export class Cheese extends Food implements Cuttable { readonly kind = 'Cheese'; readonly cutSeconds = seconds.cut; cut() { return new CutCheese(); } }
export class Onion extends Food implements Cuttable { readonly kind = 'Onion'; readonly cutSeconds = seconds.cut; cut() { return new CutOnion(); } }

export class Bun extends Food implements Plateable { readonly kind = 'Bun'; readonly plateable = true; }

// A steak is cut into a patty, which cooks on the heat; left there it burns, and burnt food left there catches fire.
export class Steak extends Food implements Cuttable { readonly kind = 'Steak'; readonly cutSeconds = seconds.cut; cut() { return new Patty(); } }
export class Patty extends Food implements Cookable { readonly kind = 'Patty'; readonly cookSeconds = seconds.cook; cook() { return new CookedPatty(); } }
export class CookedPatty extends Food implements Cookable, Plateable {
  readonly kind = 'CookedPatty';
  readonly plateable = true;
  readonly cookSeconds = seconds.burn;
  cook() { return new BurntPatty(); }
}
export class BurntPatty extends Food implements Cookable { readonly kind = 'BurntPatty'; readonly cookSeconds = seconds.ignite; cook() { return new Fire(); } }

// ── Plates and tools ─────────────────────────────────────────────────────────────────────────────────────────────

// A clean plate holds ready food, one of each kind.
export class Plate extends Item {
  readonly kind = 'Plate';
  foods: (Food & Plateable)[] = [];
  takes(thing: Thing): thing is Food & Plateable {
    return this.refuses(thing) === null;
  }
  // Why this plate does not take a thing, or null when it does.
  refuses(thing: Thing): string | null {
    if (thing instanceof Plate) return 'does not take another plate';
    if (!isPlateable(thing)) return `takes only ready food, and ${article(words(thing.kind))} is not ready`;
    if (this.foods.some(food => food.kind === thing.kind)) return `already has ${article(words(thing.kind))}`;
    return null;
  }
  view(): ItemView {
    return { kind: this.kind, foods: this.foods.map(food => food.kind as PlateableKind) };
  }
}

export class DirtyPlate extends Item implements Washable { readonly kind = 'DirtyPlate'; readonly washSeconds = seconds.wash; wash() { return new Plate(); } }

export class Extinguisher extends Item { readonly kind = 'Extinguisher'; }

// ── Hazards ──────────────────────────────────────────────────────────────────────────────────────────────────────

// A fire burns until a chef sprays it out, holding the extinguisher, and spreads every so often.
export class Fire extends Thing {
  readonly kind = 'Fire';
  readonly spraySeconds = seconds.spray;
  readonly spreadSeconds = seconds.fireSpreads;
}

// A rat eats the food it sits by after a while, unless a chef shoos it off.
export class Rat extends Thing {
  readonly kind = 'Rat';
  readonly eatSeconds = seconds.ratEats;
}

// A thing's kind in words, such as "cooked patty".
export const words = (kind: string) => kind.replace(/(?<=[a-z])(?=[A-Z])/g, ' ').toLowerCase();
// Words with "a" or "an" before them, by their first letter.
export const article = (text: string) => `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────────────────────

// What each crate gives, by the food's kind.
export const crateFoods = { Lettuce, Tomato, Cheese, Onion, Bun, Steak } as const;
export type CrateKind = keyof typeof crateFoods;

export type ItemKind = 'Lettuce' | 'CutLettuce' | 'Tomato' | 'CutTomato' | 'Cheese' | 'CutCheese' | 'Onion' | 'CutOnion' | 'Bun'
  | 'Steak' | 'Patty' | 'CookedPatty' | 'BurntPatty' | 'Plate' | 'DirtyPlate' | 'Extinguisher';
export type PlateableKind = 'CutLettuce' | 'CutTomato' | 'CutCheese' | 'CutOnion' | 'Bun' | 'CookedPatty';

export interface ItemView {
  kind: ItemKind;
  // What is on a plate.
  foods?: PlateableKind[];
}

// One thing in a chain, how it was made from the one before (cut or cooked), and in how many seconds.
export type Link = { thing: Thing; by: 'cut' | 'cook' | null; seconds: number };

// How a food from its crate gets to each thing it turns into: the things in order, each with how it was made from the
// one before, ending at one that changes no more or turns into something that is not food.
export function chainOf(start: Item): Link[] {
  const chain: Link[] = [{ thing: start, by: null, seconds: 0 }];
  for (let thing: Thing = start; thing instanceof Food;) {
    const next: Link | null = isCuttable(thing) ? { thing: thing.cut(), by: 'cut', seconds: thing.cutSeconds }
      : isCookable(thing) ? { thing: thing.cook(), by: 'cook', seconds: thing.cookSeconds } : null;
    if (!next) break;
    chain.push(next);
    thing = next.thing;
  }
  return chain;
}

// How a plateable food is made from its crate's food: cut or cooked, or null when it comes ready.
export function howMade(kind: PlateableKind): 'cut' | 'cook' | null {
  for (const make of Object.values(crateFoods)) {
    const step = chainOf(new make()).find(link => link.thing.kind === kind);
    if (step) return step.by;
  }
  return null;
}
