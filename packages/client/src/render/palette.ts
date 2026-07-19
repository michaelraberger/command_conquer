import {
  RESOURCE_GEMS,
  TERRAIN_BRIDGE,
  TERRAIN_BRIDGE_WRECK,
  TERRAIN_GRASS,
  TERRAIN_ICE,
  TERRAIN_ROCK,
  TERRAIN_SAND,
  TERRAIN_TREE,
  TERRAIN_WATER,
} from '@cac/sim';

/** Top-down terrain colors, shared by start-screen previews, minimap and editor. */
export function terrainRgb(kind: number): readonly [number, number, number] {
  return kind === TERRAIN_WATER
    ? [43, 93, 138]
    : kind === TERRAIN_ROCK
      ? [125, 122, 114]
      : kind === TERRAIN_TREE
        ? [46, 74, 30]
        : kind === TERRAIN_GRASS
          ? [77, 122, 53]
          : kind === TERRAIN_ICE
            ? [188, 219, 233]
            : kind === TERRAIN_SAND
              ? [214, 189, 130]
              : kind === TERRAIN_BRIDGE
                ? [166, 124, 71]
                : kind === TERRAIN_BRIDGE_WRECK
                  ? [54, 84, 112] // drowned rubble, reads as water
                  : [138, 111, 77]; // dirt / default
}

export const ORE_CSS = '#d9a62e';
export const GEMS_CSS = '#9d7bff';

export const resourceCss = (kind: number): string => (kind === RESOURCE_GEMS ? GEMS_CSS : ORE_CSS);

/** The map layers a top-down painter needs — satisfied by GameState,
 *  CustomMapData and the editor's draft buffers alike. */
export interface MapLayers {
  mapWidth: number;
  mapHeight: number;
  terrain: ArrayLike<number>;
  ore: ArrayLike<number>;
  resourceKind: ArrayLike<number>;
}

/** Paints terrain + resource fields 1px-per-cell into `ctx` (origin 0,0). */
export function paintMapData(ctx: CanvasRenderingContext2D, map: MapLayers): void {
  const img = ctx.createImageData(map.mapWidth, map.mapHeight);
  for (let i = 0; i < map.mapWidth * map.mapHeight; i++) {
    const [r, g, b] = terrainRgb(map.terrain[i]!);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < map.mapWidth * map.mapHeight; i++) {
    if (map.ore[i]! === 0) continue;
    ctx.fillStyle = resourceCss(map.resourceKind[i]!);
    ctx.fillRect(i % map.mapWidth, Math.floor(i / map.mapWidth), 1, 1);
  }
}

export function colorCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
