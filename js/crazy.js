// CrazyGames SDK v3 adapter. Safe no-op when the SDK is missing or disabled.
(function () {
  var sdk = null;
  var game = null;
  var inPlay = false;
  function ok() { return !!sdk; }
  function call(fn) { try { var r = fn(); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
  var platform = {
    rewardedAvailable: false,
    attach: function (g) { game = g; },
    loadingStart: function () { if (ok()) call(function () { return sdk.game.loadingStart(); }); },
    loadingStop: function () { if (ok()) call(function () { return sdk.game.loadingStop(); }); },
    // SDK throttles start/stop to ~1/s, so coalesce to the latest desired state.
    _want: false, _last: 0, _timer: null,
    _sync: function () {
      if (!ok() || platform._timer) return;
      var wait = Math.max(0, platform._last + 1100 - Date.now());
      platform._timer = setTimeout(function () {
        platform._timer = null;
        if (platform._want === inPlay) return;
        inPlay = platform._want;
        platform._last = Date.now();
        call(function () { return inPlay ? sdk.game.gameplayStart() : sdk.game.gameplayStop(); });
      }, wait);
    },
    gameplayStart: function () { platform._want = true; platform._sync(); },
    gameplayStop: function () { platform._want = false; platform._sync(); },
    happytime: function () { if (ok()) call(function () { return sdk.game.happytime(); }); },
    _ad: function (type, onDone, onReward) {
      if (!ok()) { onDone && onDone(); return; }
      var finished = false;
      var end = function (rewarded) {
        if (finished) return; finished = true;
        if (game) game.setAdActive(false);
        if (rewarded && onReward) onReward();
        if (onDone) onDone();
      };
      try {
        sdk.ad.requestAd(type, {
          adStarted: function () { if (game) game.setAdActive(true); },
          adFinished: function () { end(true); },
          adError: function () { end(false); }
        });
      } catch (e) { end(false); }
    },
    requestMidgame: function (cb) { platform._ad('midgame', cb); },
    requestRewarded: function (onReward) { platform._ad('rewarded', null, onReward); }
  };
  window.FrontPathPlatform = platform;
  window.FrontPathPlatformInit = function () {
    var S = window.CrazyGames && window.CrazyGames.SDK;
    if (!S) return Promise.resolve(false);
    return Promise.resolve()
      .then(function () { return S.init(); })
      .then(function () {
        if (S.environment === 'disabled') return false;
        sdk = S;
        platform.rewardedAvailable = true;
        return true;
      })
      .catch(function () { return false; });
  };
})();
