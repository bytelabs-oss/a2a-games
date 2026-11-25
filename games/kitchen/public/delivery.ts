// The delivery belt: one moving belt across the delivery counters, carrying plates into the order window, and the
// sign over it. The chevrons are a texture scrolled each frame.
import * as THREE from 'three';
import { stations, floorPlan } from './kitchen.ts';
import { delivery, grid } from './layout.ts';
import { cellPosition } from './world.ts';

const counters = stations.filter(station => station.kind === 'delivery');

type Draw = (context: CanvasRenderingContext2D, width: number, height: number) => void;

// A canvas texture: the canvas is drawn by draw, again once the font has loaded.
function canvasTexture([width, height]: readonly [number, number], draw: Draw, font?: string) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = () => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw on a canvas.');
    draw(context, width, height);
    texture.needsUpdate = true;
  };
  paint();
  if (font) document.fonts.load(font).then(paint);
  return texture;
}

export function buildDelivery(scene: THREE.Scene) {
  const { belt, sign } = delivery;
  // The canvas's top edge is the belt's back edge, so the chevron points into the order window.
  const arrows = canvasTexture(belt.arrowCanvas, (context, width, height) => {
    context.fillStyle = belt.color;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = belt.arrow;
    context.lineWidth = belt.lineWidth;
    context.lineCap = context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(width / 4, height * 3 / 4);
    context.lineTo(width / 2, height / 4);
    context.lineTo(width * 3 / 4, height * 3 / 4);
    context.stroke();
  });
  arrows.wrapS = arrows.wrapT = THREE.RepeatWrapping;
  arrows.repeat.set(1, belt.arrowsDeep);
  const middle = counters.reduce((sum, station) => sum.add(cellPosition(station.x, station.y)), new THREE.Vector3()).divideScalar(counters.length);
  const beltGeometry = new THREE.BoxGeometry(counters.length * grid.cell - belt.inset * 2, belt.height, grid.cell - belt.inset * 2);
  const beltMaterial = new THREE.MeshStandardMaterial({ map: arrows });
  const mesh = new THREE.Mesh(beltGeometry, beltMaterial);
  mesh.position.copy(middle).setY(belt.base + belt.height / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);

  const label = canvasTexture(sign.canvasSize, (context, width, height) => {
    context.fillStyle = sign.color;
    context.fillRect(0, 0, width, height);
    context.fillStyle = sign.textColor;
    context.font = sign.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(sign.text, width / 2, height / 2);
  }, sign.font);
  const signGeometry = new THREE.BoxGeometry(...sign.size);
  const edge = new THREE.MeshStandardMaterial({ color: sign.color });
  const face = new THREE.MeshBasicMaterial({ map: label });
  const board = new THREE.Mesh(signGeometry, [edge, edge, edge, edge, face, edge]);
  // The sign hangs on the back wall's face, which is the plan's back edge.
  board.position.set(middle.x, sign.height, -floorPlan.length * grid.cell / 2 + sign.size[2] / 2);
  scene.add(board);

  return {
    // The chevrons run away from the camera, into the window.
    animate(time: number) {
      arrows.offset.y = -time * belt.speed;
    },
    dispose() {
      for (const resource of [arrows, beltGeometry, beltMaterial, label, signGeometry, edge, face]) resource.dispose();
    },
  };
}
