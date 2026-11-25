// The bomb as it sits on its table: a panel on the case's front drawn from the page's view of the bomb, with the
// countdown, the strikes and the wires, so the case reads as a bomb from across the bunker. The full face, with the
// symbols and gauges, is on the page layer.
import * as THREE from 'three';
import { bunker, device, wireColors } from './layout.ts';
import type { Bomb } from './types.ts';

const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function createDevice(scene: THREE.Scene) {
  const canvas = Object.assign(document.createElement('canvas'), { width: device.width, height: device.height });
  const found = canvas.getContext('2d');
  if (!found) throw new Error('The bomb panel has no 2D canvas.');
  const context = found;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const { table, top, caseSize } = bunker.bomb;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(caseSize.x - device.inset * 2, caseSize.y - device.inset * 2),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  // The case has a strip of tape down its front; the panel stands just clear of it.
  panel.position.set(table.x, top + caseSize.y / 2, table.z + caseSize.z / 2 + device.standoff);
  panel.visible = false;
  scene.add(panel);
  let shown = '';

  // Redraws only when what the panel shows has changed, at most once a second while the clock runs. The clock and
  // strikes fill the left half, the wires the right.
  function draw(bomb: Bomb | null, left: number | null) {
    panel.visible = Boolean(bomb);
    if (!bomb) return;
    const seconds = left ?? bomb.left;
    const key = JSON.stringify([seconds, bomb.strikes, bomb.wires]);
    if (key === shown) return;
    shown = key;
    const { width, height } = device;
    const unit = height / 16;
    context.fillStyle = '#26282c';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#0b0b0c';
    context.fillRect(unit, unit * 1.5, width / 2 - unit * 2, unit * 8);
    context.fillStyle = '#ff4a36';
    context.font = `700 ${unit * 6.5}px ui-monospace, Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(clockText(seconds), width / 4, unit * 5.7);
    for (let index = 0; index < bomb.maxStrikes; index++) {
      context.beginPath();
      context.arc(width / 4 + (index - (bomb.maxStrikes - 1) / 2) * unit * 3, unit * 12.5, unit, 0, Math.PI * 2);
      context.fillStyle = index < bomb.strikes ? '#ff4a36' : '#0b0b0c';
      context.fill();
    }
    const { colors, cut } = bomb.wires;
    const gap = (unit * 13) / Math.max(colors.length, 1);
    const [from, to] = [width / 2 + unit, width - unit * 1.5];
    colors.forEach((color, index) => {
      const y = unit * 1.5 + gap * (index + 0.5);
      context.strokeStyle = wireColors[color];
      context.lineWidth = Math.min(gap * 0.55, unit * 1.2);
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(from, y);
      if (cut[index]) {
        context.lineTo((from + to) / 2 - unit, y);
        context.moveTo((from + to) / 2 + unit, y);
      }
      context.lineTo(to, y);
      context.stroke();
    });
    texture.needsUpdate = true;
  }

  return {
    draw,
    dispose() {
      panel.geometry.dispose();
      panel.material.dispose();
      texture.dispose();
      panel.removeFromParent();
    },
  };
}
