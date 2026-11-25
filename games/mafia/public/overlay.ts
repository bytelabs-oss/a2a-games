// The page layer over the 3D scene: a name over each person, a speech bubble when they talk, and a banner for
// headline events. How long bubbles and banners stay up is their CSS animation; each removes itself when it ends.
import type { Person } from './cast.ts';
import type { PageView } from './types.ts';

type Point = { x: number; y: number };

function box(className: string, text = '') {
  return Object.assign(document.createElement('div'), { className, textContent: text });
}

function removeWhenShown(node: HTMLElement) {
  node.addEventListener('animationend', () => node.remove());
  return node;
}

export function createOverlay(element: HTMLElement) {
  const stylesheet = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('scene.css', import.meta.url).href });
  document.head.append(stylesheet);
  const root = box('mafia-overlay');
  const day = box('mafia-day');
  const sky = box('mafia-sky');
  const bar = box('mafia-bar');
  const barText = box('mafia-bar-text');
  const barClock = box('mafia-bar-clock');
  bar.append(barText, barClock);
  root.append(day, sky, bar);
  let endsAt: number | null = null;
  element.append(root);
  const people = new Map<string, { label: HTMLElement; eyes: HTMLElement | null; bubble?: HTMLElement }>();
  // Headlines can arrive together, such as night falling and a death; each gets its full time on screen, in order.
  const headlines: string[] = [];
  const showNextHeadline = () => {
    if (!headlines.length || root.querySelector('.mafia-banner')) return;
    const banner = box('mafia-banner', headlines.shift() ?? '');
    banner.setAttribute('role', 'status');
    banner.addEventListener('animationend', () => {
      banner.remove();
      showNextHeadline();
    });
    root.append(banner);
  };

  return {
    // A person is {id, name, role, out}: role is shown under the name when the page knows it, and an eliminated
    // person's name fades and their eyes are crossed out.
    add({ id, name, role, out }: Person) {
      const label = box(out ? 'mafia-label mafia-out' : 'mafia-label', name);
      if (role) label.append(box('mafia-role', role));
      const eyes = out ? box('mafia-eyes', '× ×') : null;
      root.append(label, ...(eyes ? [eyes] : []));
      people.set(id, { label, eyes });
    },
    clear() {
      for (const { label, eyes, bubble } of people.values()) {
        label.remove();
        eyes?.remove();
        bubble?.remove();
      }
      people.clear();
    },
    say(id: string, text: string) {
      const person = people.get(id);
      if (!person) return;
      person.bubble?.remove();
      person.bubble = removeWhenShown(box('mafia-bubble', text));
      root.append(person.bubble);
    },
    announce(text: string) {
      headlines.push(text);
      showNextHeadline();
    },
    // Puts a person's name and bubble above their head and any crossed-out eyes on their face, in screen pixels.
    place(id: string, above: Point, face: Point, showName: boolean) {
      const person = people.get(id);
      if (!person) return;
      const { label, eyes, bubble } = person;
      label.hidden = !showName;
      for (const [node, { x, y }] of [[label, above], [bubble, above], [eyes, face]] as const) {
        if (!node) continue;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
      }
    },
    // The day number top left, and a sun by day or a moon by night top right. Hidden until the game has a day.
    clock({ day: number, phase }: Partial<PageView> = {}) {
      day.hidden = sky.hidden = !number;
      day.textContent = `Day ${number}`;
      sky.className = phase === 'night' ? 'mafia-sky mafia-moon' : 'mafia-sky mafia-sun';
      sky.setAttribute('aria-label', String(phase));
    },
    // The bar at the bottom: what is happening and who must act, with a countdown to endsAt when there is one.
    timer({ text, endsAt: end }: Partial<PageView['bar']> = {}) {
      bar.hidden = !text;
      barText.textContent = text ?? '';
      endsAt = end ?? null;
      this.countdown();
    },
    // Called every frame; the clock only changes once a second.
    countdown() {
      const left = endsAt && Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const clock = left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      barClock.hidden = !clock;
      if (barClock.textContent !== clock) barClock.textContent = clock;
    },
    remove() {
      root.remove();
      stylesheet.remove();
    },
  };
}
