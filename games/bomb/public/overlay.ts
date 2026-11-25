// The page layer over the 3D scene: a name over each person, a speech bubble when they talk, a banner for headline
// events, the status bar, and the bomb's face, which the defuser sees and the experts can only hear described.
// How long bubbles and banners stay up is their CSS animation; each removes itself when it ends.
import { wireColors, mark, gaugeSweep } from './layout.ts';
import type { Person } from './cast.ts';
import type { Bomb, PageView } from './types.ts';

type Point = { x: number; y: number };

function box(className: string, text = '') {
  return Object.assign(document.createElement('div'), { className, textContent: text });
}

const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// A dial from 0 to 99 with its needle at the reading.
function dial(reading: number) {
  const angle = (reading / 99 * 2 - 1) * gaugeSweep;
  const ticks = Array.from({ length: 11 }, (_, index) => {
    const turn = (index / 10 * 2 - 1) * gaugeSweep;
    return `<line x1="20" y1="4" x2="20" y2="${index % 5 ? 7 : 9}" transform="rotate(${turn} 20 20)"/>`;
  }).join('');
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/>${ticks}`
    + `<line class="bomb-needle" x1="20" y1="20" x2="20" y2="7" transform="rotate(${angle} 20 20)"/><circle cx="20" cy="20" r="2.5" class="bomb-hub"/></svg>`;
}

export function createOverlay(element: HTMLElement) {
  const stylesheet = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('scene.css', import.meta.url).href });
  document.head.append(stylesheet);
  const root = box('bomb-overlay');
  const face = box('bomb-face');
  const bar = box('bomb-bar');
  root.append(face, bar);
  element.append(root);
  let endsAt: number | null = null;
  let timer: HTMLElement | null = null;
  const people = new Map<string, { label: HTMLElement; bubble?: HTMLElement }>();
  const headlines: string[] = [];
  const showNextHeadline = () => {
    if (!headlines.length || root.querySelector('.bomb-banner')) return;
    const banner = box('bomb-banner', headlines.shift() ?? '');
    banner.setAttribute('role', 'status');
    banner.addEventListener('animationend', () => {
      banner.remove();
      showNextHeadline();
    });
    root.append(banner);
  };

  function drawFace(bomb: Bomb | null) {
    face.hidden = !bomb;
    face.replaceChildren();
    timer = null;
    endsAt = bomb?.endsAt ?? null;
    if (!bomb) return;
    const status = box('bomb-status');
    const top = box('bomb-top');
    timer = box('bomb-timer', clockText(bomb.left));
    const strikes = box('bomb-strikes');
    strikes.setAttribute('aria-label', `${bomb.strikes} of ${bomb.maxStrikes} strikes`);
    for (let index = 0; index < bomb.maxStrikes; index++) strikes.append(box(index < bomb.strikes ? 'bomb-strike bomb-struck' : 'bomb-strike'));
    top.append(timer, strikes);
    const tags = box('bomb-tags');
    tags.append(box('bomb-serial', bomb.serial), box('bomb-batteries', `${bomb.batteries} ${bomb.batteries === 1 ? 'battery' : 'batteries'}`));

    const wires = module('Wires', bomb.wires.solved);
    bomb.wires.colors.forEach((color, index) => {
      const wire = box(bomb.wires.cut[index] ? 'bomb-wire bomb-cut' : 'bomb-wire');
      wire.style.setProperty('--wire', wireColors[color]);
      wire.append(box('bomb-wire-number', String(index + 1)), box('bomb-wire-line'));
      wire.title = color;
      wires.append(wire);
    });

    const symbols = module('Symbols', bomb.symbols.solved);
    const keys = box('bomb-keys');
    bomb.symbols.shown.forEach((symbol, index) => {
      const key = box(index < bomb.symbols.pressed ? 'bomb-key bomb-pressed' : 'bomb-key');
      const picture = box('bomb-mark');
      picture.style.setProperty('--mark', `url("${mark(symbol)}")`);
      key.append(picture, box('bomb-key-name', symbol));
      keys.append(key);
    });
    symbols.append(keys);

    const gauges = module('Gauges', bomb.gauges.solved);
    const dials = box('bomb-dials');
    bomb.gauges.readings.forEach((reading, index) => {
      const gauge = box('bomb-gauge');
      gauge.innerHTML = dial(reading);
      gauge.append(box('bomb-reading', `${index + 1} · ${reading}`));
      dials.append(gauge);
    });
    gauges.append(dials);

    status.append(top, tags);
    face.append(status, wires, symbols, gauges);
  }

  function module(title: string, solved: boolean) {
    const section = box(solved ? 'bomb-module bomb-solved' : 'bomb-module');
    const heading = box('bomb-module-title', title);
    heading.append(box('bomb-light'));
    section.append(heading);
    return section;
  }

  return {
    // A person's label carries their role's icon once roles are dealt: a bomb for the defuser, an open manual for an
    // expert.
    add({ id, name, role }: Person) {
      const label = box('bomb-label');
      const text = box('bomb-label-text', name);
      if (role) {
        const icon = box('bomb-role-icon');
        icon.style.setProperty('--mark', `url("${mark(role === 'defuser' ? 'bomb' : 'book-open')}")`);
        text.append(box('bomb-role', role));
        label.dataset.role = role;
        label.append(icon);
      }
      label.append(text);
      root.append(label);
      people.set(id, { label });
    },
    clear() {
      for (const { label, bubble } of people.values()) {
        label.remove();
        bubble?.remove();
      }
      people.clear();
    },
    say(id: string, text: string) {
      const person = people.get(id);
      if (!person) return;
      person.bubble?.remove();
      person.bubble = box('bomb-bubble', text);
      person.bubble.addEventListener('animationend', () => person.bubble?.remove());
      root.append(person.bubble);
    },
    announce(text: string) {
      headlines.push(text);
      showNextHeadline();
    },
    // Drops the banner on screen and any waiting their turn.
    clearHeadlines() {
      headlines.length = 0;
      root.querySelector('.bomb-banner')?.remove();
    },
    place(id: string, above: Point, showName: boolean) {
      const person = people.get(id);
      if (!person) return;
      person.label.hidden = !showName;
      for (const node of [person.label, person.bubble]) {
        if (!node) continue;
        node.style.left = `${above.x}px`;
        node.style.top = `${above.y}px`;
      }
    },
    show(view: Partial<PageView> = {}) {
      bar.hidden = !view.bar?.text;
      bar.textContent = view.bar?.text ?? '';
      drawFace(view.bomb ?? null);
      root.dataset.phase = view.phase ?? 'lobby';
    },
    // Seconds left on the bomb's clock, or null when it is not counting down; the clock pulses once fewer than
    // urgentSeconds are left. Called every frame; the text only changes once a second.
    countdown(urgentSeconds: number): number | null {
      const left = endsAt && timer ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
      root.toggleAttribute('data-urgent', left !== null && left <= urgentSeconds);
      if (left === null || !timer) return null;
      const text = clockText(left);
      if (timer.textContent !== text) timer.textContent = text;
      return left;
    },
    remove() {
      root.remove();
      stylesheet.remove();
    },
  };
}
