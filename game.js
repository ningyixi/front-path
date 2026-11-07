/**
 * Front Path — WeChat mini-game entry.
 * Open this folder with WeChat DevTools (compile type: game).
 */
require('./js/levels.js');
require('./js/game-core.js');

const systemInfo = wx.getSystemInfoSync();
const canvas = wx.createCanvas();

const game = new FrontPathGame(canvas, {
  dpr: systemInfo.pixelRatio || 1,
});
game.resize(systemInfo.windowWidth, systemInfo.windowHeight, systemInfo.pixelRatio || 1);

if (wx.onWindowResize) {
  wx.onWindowResize(function (res) {
    game.resize(res.windowWidth, res.windowHeight, systemInfo.pixelRatio || 1);
  });
}
