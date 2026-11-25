// Bomb for the a2a-games shell. For now only the scene: the rules and steps come once the design is agreed.
import type { Game } from '../../src/shell/types.ts';

export default {
  title: 'Bomb',
  settings: [{ id: 'names', label: 'Show names', type: 'switch', default: true }],
  create: () => ({}),
  act: () => null,
  view: () => null,
} satisfies Game<object>;
