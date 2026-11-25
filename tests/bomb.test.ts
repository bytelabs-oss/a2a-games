import assert from 'node:assert/strict';
import { test } from 'node:test';
import game, { type PlayerView } from '../games/bomb/game.ts';
import * as rules from '../games/bomb/rules.ts';

// Plays through the game's own hooks, the way the shell calls them, with a round already started.
function round(count: number) {
  const state = game.create();
  const people = ['Ash', 'Briar', 'Cove', 'Dune', 'Elm'].slice(0, count).map(name => ({ id: name.toLowerCase(), name }));
  for (const person of people) game.join(state, person);
  assert.equal(game.start(state)?.ok, true);
  const defuser = people.find(person => rules.byId(state, person.id)?.role === 'defuser');
  const expert = people.find(person => rules.byId(state, person.id)?.role === 'expert');
  assert.ok(defuser && expert);
  const bomb = state.bomb;
  assert.ok(bomb);
  return { state, people, defuser, expert, bomb, act: (step: string, who = defuser) => game.act(state, who, step) as rules.Settled };
}

test('one defuser sees the bomb, the experts split the manual, and only the defuser can act', () => {
  const { state, defuser, expert, act } = round(3);
  assert.equal(state.phase, 'armed');
  const experts = rules.experts(state);
  assert.equal(experts.length, 2);
  assert.deepEqual(experts.flatMap(player => player.pages).sort(), [...rules.pages].sort(), 'every page is dealt once');
  assert.ok(experts.every(player => player.pages.length === 2));

  const defuserView = game.view(state, defuser.id) as PlayerView;
  const expertView = game.view(state, expert.id) as PlayerView;
  assert.ok('bomb' in defuserView && !('manual' in defuserView));
  assert.ok('manual' in expertView && !('bomb' in expertView));
  assert.equal(act('cut 1', expert).ok, false, 'experts cannot touch the bomb');
  assert.equal(game.join(state, { id: 'late', name: 'Late' })?.ok, false, 'nobody joins mid-round');
});

test('a wrong step is a strike that takes time off, and the last strike sets the bomb off', () => {
  const { state, bomb, act } = round(3);
  const wrong = Array.from({ length: bomb.wires.colors.length }, (_, index) => index + 1).find(wire => wire !== rules.wireToCut(bomb));
  const before = state.endsAt ?? 0;
  act(`cut ${wrong}`);
  assert.equal(bomb.strikes, 1);
  assert.equal(before - (state.endsAt ?? 0), rules.clock.strikePenalty * 1000);
  const order = rules.symbolOrder(bomb);
  act(`press ${order[1]}`);
  act(`press ${order[1]}`);
  assert.equal(state.phase, 'over');
  assert.equal(state.result, 'exploded');
});

test('solving every module defuses the bomb, and the clock running out sets it off', () => {
  const { state, bomb, act } = round(4);
  act(`cut ${rules.wireToCut(bomb)}`);
  assert.ok(bomb.solved.wires);
  for (const symbol of rules.symbolOrder(bomb)) assert.equal(act(`press ${symbol}`).ok, true);
  const letter = rules.letterOf(bomb);
  bomb.gauges.readings.forEach((_, index) => {
    while (!rules.inBand(bomb.gauges.readings[index], letter)) assert.equal(act(`turn ${index + 1}`).ok, true);
  });
  assert.equal(bomb.strikes, 0);
  assert.equal(state.result, 'defused');

  const late = round(3);
  late.state.endsAt = Date.now() - 1;
  game.tick(late.state, 1);
  assert.equal(late.state.result, 'exploded');
});

test('an expert who leaves hands on their pages; the defuser leaving stops the round', () => {
  const { state, defuser, expert } = round(4);
  const pages = rules.byId(state, expert.id)?.pages ?? [];
  game.leave(state, expert);
  assert.deepEqual(rules.experts(state).flatMap(player => player.pages).filter(page => pages.includes(page)).sort(), [...pages].sort());
  game.leave(state, defuser);
  assert.equal(state.result, 'stopped');
});
