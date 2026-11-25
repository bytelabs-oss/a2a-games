import assert from 'node:assert/strict';
import { test } from 'node:test';
import game, { type PlayerView } from '../games/mafia/game.ts';
import type { Role, State } from '../games/mafia/rules.ts';

// Plays through the game's own act, start and tick, the way the shell calls them. The first seat is mafia here.
function table(count: number) {
  const state = game.create();
  const people = ['Narrator', ...['Alder', 'Birch', 'Clover', 'Finch', 'Hazel'].slice(0, count)].map(name => ({ id: name.toLowerCase(), name }));
  for (const person of people) {
    game.join(state, person);
    game.ready(state, person);
  }
  const person = (name: string) => {
    const found = people.find(each => each.name === name);
    assert.ok(found, `${name} is at the table`);
    return found;
  };
  const act = (name: string, step: string) => game.act(state, person(name), step);
  return { state, act };
}

test('a narrator seats players, the night kills unless the doctor saves, and the vote can end the game', () => {
  const { state, act } = table(5);
  assert.equal(act('Alder', 'start')?.ok, false);
  game.join(state, { id: 'late', name: 'Late' });
  act('Narrator', 'narrate');
  assert.match(game.start(state).message ?? '', /Waiting for Late/, 'everyone must be ready');
  game.leave(state, { id: 'late', name: 'Late' });
  assert.equal(act('Narrator', 'narrate')?.ok, true);
  const started = game.start(state);
  assert.equal(started.ok, true);
  assert.equal(state.phase, 'night');
  const role = (name: string) => {
    const found = state.players.find(player => player.name === name);
    assert.ok(found, `${name} is seated`);
    return found;
  };
  const dealt: Role[] = ['mafia', 'detective', 'villager', 'villager', 'villager'];
  for (const [index, name] of ['Alder', 'Birch', 'Clover', 'Finch', 'Hazel'].entries()) role(name).role = dealt[index] ?? null;

  assert.equal(act('Clover', 'pick Alder')?.ok, false, 'villagers have no night choice');
  assert.equal(act('Alder', 'pick Alder')?.ok, false, 'the mafia cannot pick their own');
  act('Birch', 'pick Alder');
  assert.deepEqual(act('Alder', 'pick Clover')?.events, undefined, 'the last choice reveals nothing itself');
  assert.equal(game.tick(state)?.sound, 'chime', 'dawn has its sound');
  assert.equal(state.phase, 'talk', 'night ends on the tick after every choice is made');
  assert.equal(role('Clover').alive, false);
  const viewOf = (id: string) => game.view(state, id) as PlayerView;
  const detective = viewOf('birch');
  assert.ok('checks' in detective, 'the detective sees their checks');
  assert.deepEqual(detective.checks, [{ day: 1, name: 'Alder', mafia: true }]);
  assert.equal(viewOf('finch').players.find(player => player.name === 'Alder')?.role, undefined, 'living roles stay secret');

  assert.equal(act('Birch', 'floor')?.ok, false, 'only the player whose turn it is takes the floor');
  const turnOf = (current: State) => {
    assert.ok(current.turn, 'someone has the turn');
    return current.turn;
  };
  const first = turnOf(state).id;
  act(state.players.find(player => player.id === first)?.name ?? '', 'floor');
  assert.equal(turnOf(state).speaking, true);
  act('Narrator', 'floor Hazel');
  assert.equal(turnOf(state).id, 'hazel', 'the narrator gives the floor to anyone');
  assert.ok(!game.act(state, { id: 'birch', name: 'Birch' }, 'pass')?.ok);
  const turnNews = act('Hazel', 'pass')?.events?.[0];
  assert.deepEqual(typeof turnNews === 'object' && turnNews.to, ['narrator'], 'routine news goes to the narrator and whoever it is about');
  state.endsAt = 1;
  game.tick(state);
  state.dayEndsAt = 1;
  game.tick(state);

  assert.equal(state.phase, 'vote');
  for (const name of ['Alder', 'Birch', 'Finch', 'Hazel']) act(name, name === 'Alder' ? 'vote nobody' : 'vote Alder');
  assert.equal(game.tick(state)?.sound, 'toll', 'the end of the game has its sound');
  assert.equal(state.winner, 'village');
  assert.equal(state.phase, 'over');

  game.join(state, { id: 'reed', name: 'Reed' });
  game.ready(state, { id: 'reed', name: 'Reed' });
  assert.equal(game.start(state).ok, true, 'the next game starts from a finished one, with a newcomer');
  assert.equal(state.day, 1);
});

test('a tie puts nobody out, and a table of three is refused', () => {
  const short = table(3);
  short.act('Narrator', 'narrate');
  assert.equal(game.start(short.state).ok, false);

  const { state, act } = table(4);
  act('Narrator', 'narrate');
  game.start(state);
  state.endsAt = 1;
  game.tick(state);
  state.dayEndsAt = 1;
  game.tick(state);
  const alive = state.players.filter(player => player.alive).map(player => player.name);
  alive.forEach((name, index) => act(name, `vote ${alive[(index + 1) % 2]}`));
  game.tick(state);
  assert.equal(state.players.filter(player => player.alive).length, alive.length);
  assert.equal(state.phase, 'night');

  state.endsAt = 1;
  game.tick(state);
  const speaker = state.players.find(player => player.id === state.turn?.id)?.name ?? '';
  act(speaker, 'skip');
  assert.notEqual(state.turn?.id, speaker.toLowerCase(), 'a skip on your turn also passes it');
  const awake = state.players.filter(player => player.alive && player.name !== speaker).map(player => player.name);
  for (const name of awake.slice(0, -1)) act(name, 'skip');
  assert.equal(state.phase, 'talk', 'the day goes on until everyone asks to vote');
  act(awake.at(-1) ?? '', 'skip');
  assert.equal(state.phase, 'vote');
});
