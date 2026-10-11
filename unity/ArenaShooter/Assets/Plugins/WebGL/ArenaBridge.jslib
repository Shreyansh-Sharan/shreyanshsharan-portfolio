mergeInto(LibraryManager.library, {
  // Sends { source: 'arena', type, payload } to the page that embeds the game (the portfolio site).
  ArenaPost: function (type, payload) {
    var message = { source: 'arena', type: UTF8ToString(type), payload: UTF8ToString(payload) };
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
      window.dispatchEvent(new CustomEvent('arena', { detail: message }));
    } catch (e) {
      console.warn('ArenaPost failed', e);
    }
  },
});
