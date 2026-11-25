import assert from 'node:assert/strict';
import { test } from 'node:test';
import game from '../games/kitchen/game.ts';
import type { State } from '../games/kitchen/rules.ts';
import { dishes, plateCount, service } from '../games/kitchen/public/kitchen.ts';
import { seconds } from '../games/kitchen/public/things.ts';
import type { Outcome } from '../src/shell/types.ts';

const tickMs = game.tickSeconds * 1000;

// A kitchen with one chef, Oak, in service. Its time only moves when the test ticks it.
function kitchen() {
  const state = game.create();
  const oak = { id: 'oak', name: 'Oak' };
  game.join(state, oak);
  game.start(state, { minutes: service.minutes.min });
  state.orders = [];
  state.orderIn = state.ratIn = Infinity;
  // Moves the clock on by `seconds`, a tick at a time.
  const pass = (seconds: number) => {
    for (let left = seconds * 1000; left > 0; left -= tickMs) {
      game.tick(state, game.tickSeconds);
    }
  };
  // Runs a chef's steps one after another, as the shell does, ticking until each settles. Returns the first failure, or
  // the last.
  const act = async (steps: string, who = oak) => {
    let last: Outcome = { ok: true };
    for (const step of steps.split(';')) {
      let settled = false;
      const result = Promise.resolve(game.act(state, who, step.trim())).then(outcome => { settled = true; return outcome ?? { ok: true }; });
      for (let guard = 0; !settled && guard < 1000; guard++) {
        pass(game.tickSeconds);
        await Promise.resolve();
      }
      last = await result;
      if (!last.ok) return last;
    }
    return last;
  };
  // What a station shows: its view, as the page and the chefs see it.
  const look = (id: string) => state.stations[id]?.view(false);
  return { state, act, pass, look, chef: () => state.chefs[0] };
}

test('a chef cuts, plates and delivers a salad, which scores its points', async () => {
  const { state, act, look } = kitchen();
  state.orders = [{ id: 'o1', dish: 'salad', seconds: Infinity, left: Infinity }];
  assert.equal((await act('walk plates; take plates; walk counter_2; put counter_2')).ok, true);
  assert.equal(look('plates')?.stack?.count, plateCount - 1, 'a plate taken leaves the stack');
  for (const crate of ['lettuce_crate', 'tomato_crate', 'onion_crate']) {
    assert.equal((await act(`walk ${crate}; take ${crate}; walk board_1; put board_1; cut board_1; take board_1; walk counter_2; put plate_1`)).ok, true);
  }
  assert.deepEqual(look('counter_2')?.items, [{ kind: 'Plate', id: 'plate_1', foods: dishes.salad.foods }]);
  assert.equal((await act('take counter_2; walk delivery_1; deliver o1')).ok, true);
  assert.equal(state.score, dishes.salad.points);
  assert.equal(look('sink')?.stack?.count, 1, 'the plate comes back dirty to the sink');
  assert.equal((await act('walk sink; wash sink')).ok, true);
  assert.equal(look('plates')?.stack?.count, plateCount, 'washed, it joins the clean plates');
  const taken: (string | undefined)[] = [];
  for (const counter of ['counter_3', 'counter_4', 'counter_5', 'counter_6']) {
    await act('walk plates; take plates');
    taken.push(state.chefs[0]?.held?.view().id);
    await act(`walk ${counter}; put ${counter}`);
  }
  assert.deepEqual(taken, ['plate_2', 'plate_3', 'plate_4', 'plate_1'], 'a plate keeps its name through being delivered and washed');
});

test('steps are refused where they do not fit', async () => {
  const { act } = kitchen();
  assert.match((await act('take plates')).message ?? '', /Walk to plates first/);
  assert.match((await act('walk plates; take plates; take plates')).message ?? '', /hands are full/, 'hands hold one item');
  assert.match((await act('walk board_1; put board_1')).message ?? '', /does not take/, 'plates go on counters and delivery only');
  await act('walk counter_2; put counter_2; walk lettuce_crate; take lettuce_crate; walk board_1; put board_1; cut board_1; take board_1; walk counter_2');
  assert.match((await act('put counter_2')).message ?? '', /plate_1 is on counter_2.*put plate_1/, 'a station with a plate on it takes nothing more');
  assert.match((await act('walk counter_1; put plate_1')).message ?? '', /Walk to counter_2 first/, 'a plate takes food from the station it lies on');
  assert.match((await act('put plate_4')).message ?? '', /plate_4 does not lie on a station/);
  assert.equal((await act('walk counter_2; put plate_1')).ok, true);
});

test('only one chef can be at a station, until they move to a spot, and only one chef on a spot', async () => {
  const { state, act } = kitchen();
  const ash = { id: 'ash', name: 'Ash' };
  game.join(state, ash);
  const chef = (id: string) => state.chefs.find(each => each.id === id);
  const spotsSeen = () => (game.view(state, null) as { spots: Record<string, { chef: string | null }> }).spots;
  assert.equal((await act('walk board_1')).ok, true);
  assert.match((game.act(state, ash, 'walk board_1') as Outcome).message ?? '', /Oak is at board_1/);
  assert.equal(chef('ash')?.at, null, 'a refused walk leaves the chef where they were');
  assert.equal((await act('move spot_1')).ok, true);
  assert.deepEqual([chef('oak')?.at, chef('oak')?.spot, spotsSeen().spot_1?.chef], [null, 'spot_1', 'Oak'], 'Oak left the board for the spot');
  assert.equal((await act('walk board_1', ash)).ok, true, 'the board is free for Ash');
  assert.match((game.act(state, ash, 'move spot_1') as Outcome).message ?? '', /Oak is on spot_1/);
  assert.equal(chef('ash')?.at?.id, 'board_1', 'a refused move leaves the chef where they were');
  assert.match((await act('move nowhere')).message ?? '', /no spot called nowhere/);
  await act('walk board_2');
  assert.equal(spotsSeen().spot_1?.chef, null, 'walking away empties the spot');
});

test('steak cooks by itself on a stove, then burns, then becomes a fire', async () => {
  const { act, pass, look } = kitchen();
  await act('walk steak_crate; take steak_crate; walk board_1; put board_1; cut board_1; take board_1; walk stove_1; put stove_1');
  const onStove = () => look('stove_1')?.items?.[0]?.kind;
  pass(seconds.cook + 1);
  assert.equal(onStove(), 'CookedPatty');
  pass(seconds.burn);
  assert.equal(onStove(), 'BurntPatty');
  pass(seconds.ignite);
  assert.equal(look('stove_1')?.fire, true);
  assert.equal(onStove(), undefined, 'the fire burns what lay there');
});

test('a missed order loses points, and service ends when its time runs out', () => {
  const { state, pass } = kitchen();
  state.orders = [{ id: 'o1', dish: 'burger', seconds: 1, left: 1 }];
  pass(2);
  assert.equal(state.score, -service.orders.missedPenalty);
  pass(state.left ?? 0);
  assert.ok((state.left ?? 0) <= 0, 'the service clock runs out with the ticks');
  assert.equal(game.end(state).ok, true);
  assert.equal(state.phase, 'over');
});
