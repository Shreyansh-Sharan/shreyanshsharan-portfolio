mergeInto(LibraryManager.library, {
  // Sends { source: 'cricket', type, payload } to the page that embeds the game (the portfolio site).
  CricketPost: function (type, payload) {
    var message = { source: 'cricket', type: UTF8ToString(type), payload: UTF8ToString(payload) };
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
      window.dispatchEvent(new CustomEvent('cricket', { detail: message }));
    } catch (e) {
      console.warn('CricketPost failed', e);
    }
  },

  // Asks the page for an ad: { source: 'cricket', type: 'adbreak' | 'rewarded', placement, id }.
  CricketAd: function (type, placement, id) {
    var message = { source: 'cricket', type: UTF8ToString(type), placement: UTF8ToString(placement), id: UTF8ToString(id) };
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
      window.dispatchEvent(new CustomEvent('cricket', { detail: message }));
    } catch (e) {
      console.warn('CricketAd failed', e);
    }
  },

  // Returns the next message the page posted into this window (JSON), or an empty string. The listener is installed
  // on first use and queues { type, id, query } for messages whose type the game understands.
  CricketPoll: function () {
    if (!window.__cricketInbox) {
      window.__cricketInbox = [];
      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
        if (d.source === 'cricket') return; // our own posts echoed back
        var known = ['start', 'adbreak-done', 'ad-started', 'reward-granted', 'reward-skipped', 'pause', 'resume', 'mute', 'unmute'];
        if (known.indexOf(d.type) < 0) return;
        window.__cricketInbox.push(JSON.stringify({ type: d.type, id: d.id ? String(d.id) : '', query: d.query ? String(d.query) : '' }));
      });
      // Messages that arrived before the game started polling (the page may post 'start' early).
      if (window.__cricketEarly) {
        for (var i = 0; i < window.__cricketEarly.length; i++) window.__cricketInbox.push(window.__cricketEarly[i]);
        window.__cricketEarly = null;
      }
    }
    var next = window.__cricketInbox.length ? window.__cricketInbox.shift() : '';
    var size = lengthBytesUTF8(next) + 1;
    var buffer = _malloc(size);
    stringToUTF8(next, buffer, size);
    return buffer;
  },

  CricketEmbedded: function () {
    try {
      return window.parent && window.parent !== window ? 1 : 0;
    } catch (e) {
      return 1;
    }
  },
});
