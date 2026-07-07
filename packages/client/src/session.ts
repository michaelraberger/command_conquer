/**
 * Which player this client controls. 0 in single-player; assigned by the
 * lobby in multiplayer. Mutable module state, set once during boot.
 */
export const session = {
  localPlayer: 0,
};
