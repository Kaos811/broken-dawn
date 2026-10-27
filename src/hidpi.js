// Stage 17: crisp rendering on high-DPR screens.
// The game canvas is RES x the 720-wide logical layout. Everything in the code base keeps working in
// logical px: pointer.x / pointer.y are divided back by RES, every camera's screen->world mapping takes
// logical screen points, UI cameras zoom by RES, and Text / baked textures render at RES x so they
// stay sharp instead of being upscaled.
export function installHiDpi(Phaser, RES) {
  if (RES === 1) return;
  const SM = Phaser.Scale.ScaleManager.prototype;
  const tx = SM.transformX, ty = SM.transformY;
  SM.transformX = function (pageX) { return tx.call(this, pageX) / RES; };
  SM.transformY = function (pageY) { return ty.call(this, pageY) / RES; };
  const BC = Phaser.Cameras.Scene2D.BaseCamera.prototype;
  const gwp = BC.getWorldPoint;
  BC.getWorldPoint = function (x, y, output) { return gwp.call(this, x * RES, y * RES, output); };
  // Text: resolution 0 (default) means "use the game's" -> RES (Phaser would force 1)
  const TS = Phaser.GameObjects.TextStyle.prototype;
  const setStyle = TS.setStyle;
  TS.setStyle = function (style, updateText, setDefaults) {
    if (setDefaults && !style?.resolution) style = { ...(style ?? {}), resolution: RES };
    return setStyle.call(this, style, updateText, setDefaults);
  };
}
