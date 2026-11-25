// The page layer over the 3D kitchen: order tickets, a banner for each headline event, the score as a coin and the
// points, the service clock, a name tag and speech bubble over each chef, a progress bar over each station where
// something is moving on, and a word popping up over the station a kitchen event happened at. Bubbles, banners, words
// and ticket timers are timed by their CSS animations.
import type * as THREE from 'three';
import { dishes } from './kitchen.ts';
import { howMade } from './things.ts';
import { chefs as look, preparationMarks, toasts } from './layout.ts';
import { progressPositions, toastPositions } from './stations.ts';
import type { Pictures } from './icons.ts';
import type { ChefView, KitchenEvent, Order, PageView, StationView } from './types.ts';


type Point = { x: number; y: number };
type Project = (point: THREE.Vector3) => Point;

function box(className: string, text = '') {
  return Object.assign(document.createElement('div'), { className, textContent: text });
}

function image(className: string, src: string, alt: string) {
  return Object.assign(document.createElement('img'), { className, src, alt });
}

const markUrl = Object.fromEntries(Object.entries(preparationMarks).map(([made, file]) => [made, new URL(file, import.meta.url).href]));
// The clock turns red and pulses for the last seconds of service.
const endingSeconds = 30;
// The score pill bumps when points come in.
const bump = { keyframes: [{ scale: 1 }, { scale: 1.35, offset: 0.3 }, { scale: 1 }], timing: { duration: 400, easing: 'cubic-bezier(.3, 1.6, .5, 1)' } };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// A station's bar, from its progress `since` seconds after the view came: how full it is now, and whether it warns.
// Null when nothing there is moving on.
function stationBar({ progress }: StationView, since: number) {
  if (!progress) return null;
  const fill = Math.min(1, progress.fill + progress.rate * since);
  return { fill, warning: progress.warning };
}

export function createOverlay(element: HTMLElement) {
  const stylesheet = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('scene.css', import.meta.url).href });
  document.head.append(stylesheet);
  const root = box('kitchen-overlay');
  const tickets = box('kitchen-tickets');
  const score = box('kitchen-pill kitchen-score');
  const points = box('kitchen-points');
  score.append(box('kitchen-coin'), points);
  const clock = box('kitchen-pill kitchen-clock');
  root.append(tickets, score, clock);
  element.append(root);

  const chefs = new Map<string, { label: HTMLElement; bubble?: HTMLElement }>();
  // Words that pop up where something just happened, such as "fire!", each pinned to a point in the scene.
  const shownToasts = new Set<{ node: HTMLElement; point: THREE.Vector3 }>();
  const bars = new Map<string, HTMLElement>();
  let view: Partial<PageView> = {};
  // When the view came, on this page's clock. Times in a view count from then.
  let viewedAt = performance.now();
  const sinceView = () => (performance.now() - viewedAt) / 1000;
  let pictures: Pictures | null = null;
  let ticketsKey = '';

  const headlines: string[] = [];
  const showNextHeadline = () => {
    if (!headlines.length || root.querySelector('.kitchen-banner')) return;
    const banner = box('kitchen-banner', headlines.shift() ?? '');
    banner.setAttribute('role', 'status');
    banner.addEventListener('animationend', () => {
      banner.remove();
      showNextHeadline();
    });
    root.append(banner);
  };

  // One paper ticket per open order, in pictures: its time draining along the top, the plated dish, and each
  // ingredient that goes on it with a knife or pan beneath for how it is prepared. The bar drains over the
  // order's time, starting from how much is already gone.
  function drawTickets(orders: Order[] = []) {
    // A ticket is drawn once; its time drains by itself from the time left when it was drawn.
    const key = JSON.stringify([orders.map(({ id }) => id), Boolean(pictures)]);
    if (key === ticketsKey || !pictures) return;
    const drawn = pictures;
    ticketsKey = key;
    tickets.replaceChildren(...orders.map(({ dish, seconds, left }) => {
      const ticket = box('kitchen-ticket');
      const time = box('kitchen-ticket-time');
      time.style.animationDuration = `${seconds}s`;
      time.style.animationDelay = `${left - sinceView() - seconds}s`;
      const parts = box('kitchen-ticket-foods');
      for (const food of dishes[dish].foods) {
        const part = box('kitchen-ticket-food');
        part.append(image('kitchen-ticket-ingredient', drawn.foods[food], food));
        const made = howMade(food);
        const mark = made && markUrl[made];
        if (mark) part.append(image('kitchen-ticket-mark', mark, ''));
        parts.append(part);
      }
      ticket.append(time, image('kitchen-ticket-dish', drawn.dishes[dish], dishes[dish].name), parts);
      return ticket;
    }));
  }

  // Keeps one element per id in nodes, making missing ones with make and removing those whose id is gone.
  function sync(nodes: Map<string, HTMLElement>, ids: string[], make: () => HTMLElement) {
    for (const [id, node] of nodes) {
      if (ids.includes(id)) continue;
      node.remove();
      nodes.delete(id);
    }
    for (const id of ids) {
      if (nodes.has(id)) continue;
      const node = make();
      root.append(node);
      nodes.set(id, node);
    }
  }

  function place(node: HTMLElement, { x, y }: Point) {
    Object.assign(node.style, { left: `${x}px`, top: `${y}px` });
  }

  return {
    // Takes the page's view: the points, the tickets, and which stations have bars.
    show(next: Partial<PageView> = {}) {
      const before = view.score;
      view = next;
      viewedAt = performance.now();
      const now = next.score ?? 0;
      points.textContent = String(now);
      if (before !== undefined && now > before && !reducedMotion.matches) score.animate(bump.keyframes, bump.timing);
      drawTickets(next.orders);
      const stations = Object.entries(next.stations ?? {});
      sync(bars, stations.map(([id]) => id), () => box('kitchen-progress'));
    },
    // The ticket pictures, once they are rendered.
    pictures(rendered: Pictures) {
      pictures = rendered;
      drawTickets(view.orders);
    },
    // Chefs are {id, name, seat}; each gets a name tag in their seat's colour, and a bubble when they speak.
    chefs(list: ChefView[] = []) {
      for (const [id, chef] of chefs) {
        if (list.some(each => each.id === id)) continue;
        chef.label.remove();
        chef.bubble?.remove();
        chefs.delete(id);
      }
      for (const { id, name, seat } of list) {
        let chef = chefs.get(id);
        if (!chef) {
          chef = { label: box('kitchen-label') };
          root.append(chef.label);
          chefs.set(id, chef);
        }
        const { label } = chef;
        label.textContent = name;
        label.style.setProperty('--chef', look.colors[seat]);
      }
    },
    say(id: string, text: string) {
      const chef = chefs.get(id);
      if (!chef) return;
      chef.bubble?.remove();
      // The bubble shows the start of a line; the chat has all of it.
      chef.bubble = box('kitchen-bubble');
      chef.bubble.append(box('kitchen-bubble-text', text));
      chef.bubble.addEventListener('animationend', () => chef.bubble?.remove());
      root.append(chef.bubble);
    },
    // A kitchen event that happened at a station pops up its word over it, when it has one.
    happened(event: KitchenEvent) {
      const word = toasts.words[event.type];
      const point = 'station' in event ? toastPositions.get(event.station) : undefined;
      if (word && point) this.toast(word, point);
    },
    toast(text: string, point: THREE.Vector3) {
      const node = box('kitchen-toast', text);
      const toast = { node, point };
      node.addEventListener('animationend', () => {
        node.remove();
        shownToasts.delete(toast);
      });
      root.append(node);
      shownToasts.add(toast);
    },
    announce(text: string) {
      headlines.push(text);
      showNextHeadline();
    },
    // Called every frame with project, which turns a point in the scene into screen pixels, and each chef's name
    // point. Moves name tags, bubbles, bars and fire tags, and refreshes the bars and the clock.
    frame(project: Project, chefPoints: { id: string; point: THREE.Vector3 }[], showNames: boolean) {
      for (const { id, point } of chefPoints) {
        const chef = chefs.get(id);
        if (!chef) continue;
        chef.label.hidden = !showNames;
        const at = project(point);
        for (const node of [chef.label, chef.bubble]) if (node) place(node, at);
      }
      for (const [id, bar] of bars) {
        const station = view.stations?.[id];
        const position = progressPositions.get(id);
        const shown = station && position && stationBar(station, sinceView());
        bar.hidden = !shown;
        if (!shown) continue;
        bar.classList.toggle('kitchen-warning', shown.warning);
        bar.style.setProperty('--progress', String(shown.fill));
        place(bar, project(position));
      }
      for (const { node, point } of shownToasts) place(node, project(point));
      const left = view.left === undefined ? null : Math.max(0, Math.ceil(view.left - sinceView()));
      const text = left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      clock.hidden = !text;
      if (clock.textContent !== text) clock.textContent = text;
      clock.classList.toggle('kitchen-ending', left !== null && left <= endingSeconds);
    },
    clear() {
      this.chefs([]);
      sync(bars, [], () => box('kitchen-progress'));
    },
    remove() {
      root.remove();
      stylesheet.remove();
    },
  };
}
