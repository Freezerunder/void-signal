/* Nova Games — shared account + leaderboard client.
 *
 * Every other file here is a self-contained single page on purpose. This one
 * is the deliberate exception: accounts and the leaderboard have to agree
 * across the launcher and every game, and four copies of an auth client is
 * four places for them to drift apart. Loaded as a classic script (not a
 * module) so it still works over file:// inside the Electron build, where
 * module loading is blocked by CORS.
 *
 * The publishable key below is meant to be public — it is the browser half of
 * a Supabase project, and every rule that matters is enforced server-side by
 * row-level security and triggers (see supabase/schema.sql). It is not a
 * secret and does not need hiding.
 *
 * Everything degrades: if the network is down, the project is paused, or the
 * schema has not been applied yet, calls fail softly and callers fall back to
 * the local-only path they used before this existed.
 */
(function () {
  'use strict';

  var CONFIG = {
    url: 'https://dznnweyjhbsqomykiznq.supabase.co',
    key: 'sb_publishable_Q3GpGkQalSB4dYXlocEbEg_8ObGhaK7'
  };

  // Accounts are username + password, as they always were here. Supabase Auth
  // is email-based, so the username is mapped onto a synthetic address on a
  // domain that receives no mail. This is why "Confirm email" has to be off in
  // the project's auth settings — there is no inbox to confirm from.
  var EMAIL_DOMAIN = 'players.novagames.app';

  var AUTH_KEY = 'nova.auth.v1';
  var LOCAL_SCORES_KEY = 'arcade.scores.v1';
  var DAILY_KEY = 'nova.daily.v1';

  var auth = null;      // { access_token, refresh_token, expires_at, user }
  var lastError = null;

  // ------------------------------------------------------------ storage

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeJSON(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  // -------------------------------------------------------------- fetch

  function isOffline(err) {
    // A TypeError from fetch is the network itself failing, as opposed to the
    // server answering with an error we can show the player.
    return err instanceof TypeError;
  }

  function request(path, options) {
    options = options || {};
    var headers = {
      'apikey': CONFIG.key,
      'Content-Type': 'application/json'
    };
    // PostgREST wants a bearer token on every call; unauthenticated reads use
    // the publishable key as their own bearer.
    var token = (options.token === undefined)
      ? (auth && auth.access_token ? auth.access_token : CONFIG.key)
      : options.token;
    headers['Authorization'] = 'Bearer ' + token;

    if (options.headers) {
      Object.keys(options.headers).forEach(function (k) { headers[k] = options.headers[k]; });
    }

    return fetch(CONFIG.url + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && (data.msg || data.message || data.error_description || data.error)) ||
                    ('Request failed (' + res.status + ')');
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // --------------------------------------------------------------- auth

  function emailFor(username) {
    return username.trim().toLowerCase().replace(/\s+/g, '.') + '@' + EMAIL_DOMAIN;
  }

  function storeSession(session) {
    if (!session || !session.access_token) return null;
    auth = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      // A minute of slack so a request never leaves with a token that expires
      // while it is in flight.
      expires_at: Date.now() + ((session.expires_in || 3600) - 60) * 1000,
      user: auth && auth.user ? auth.user : null
    };
    writeJSON(AUTH_KEY, auth);
    return auth;
  }

  function setProfile(profile) {
    if (!auth) return;
    auth.user = profile ? {
      id: profile.id, username: profile.username, isDev: !!profile.is_dev
    } : null;
    writeJSON(AUTH_KEY, auth);
  }

  function clearSession() {
    auth = null;
    writeJSON(AUTH_KEY, null);
  }

  function refreshIfNeeded() {
    if (!auth) return Promise.resolve(null);
    if (Date.now() < auth.expires_at) return Promise.resolve(auth);
    if (!auth.refresh_token) { clearSession(); return Promise.resolve(null); }

    var keep = auth.user;
    return request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', token: CONFIG.key, body: { refresh_token: auth.refresh_token }
    }).then(function (session) {
      storeSession(session);
      setProfile(keep ? { id: keep.id, username: keep.username, is_dev: keep.isDev } : null);
      return auth;
    }).catch(function (err) {
      // An expired or revoked refresh token means the session is genuinely
      // over; a network blip must not sign anyone out.
      if (!isOffline(err)) clearSession();
      return null;
    });
  }

  function fetchProfile(userId) {
    return request('/rest/v1/profiles?select=id,username,is_dev&id=eq.' + encodeURIComponent(userId))
      .then(function (rows) { return (rows && rows[0]) || null; });
  }

  function signUp(username, password) {
    lastError = null;
    if (!/^[A-Za-z0-9 _-]{3,16}$/.test(username)) {
      return Promise.reject(new Error('Username: 3–16 characters, letters/numbers/space/_/- only.'));
    }
    if (!password || password.length < 6) {
      return Promise.reject(new Error('Password must be at least 6 characters.'));
    }

    return request('/auth/v1/signup', {
      method: 'POST', token: CONFIG.key,
      body: { email: emailFor(username), password: password }
    }).then(function (result) {
      // With "Confirm email" left on, signup returns a user but no session,
      // and there is no inbox behind the synthetic address to confirm from.
      if (!result || !result.access_token) {
        throw new Error('Sign-ups need email confirmation turned off in the Supabase project.');
      }
      storeSession(result);
      var id = result.user && result.user.id;
      return request('/rest/v1/profiles', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: { id: id, username: username.trim() }
      });
    }).then(function (rows) {
      var profile = rows && rows[0];
      setProfile(profile);
      return currentUser();
    }).catch(function (err) {
      // The profile row is what makes an account real; without it there is a
      // half-made auth user that can never be completed under the same name.
      if (auth && !auth.user) clearSession();
      throw translate(err);
    });
  }

  function signIn(username, password) {
    lastError = null;
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST', token: CONFIG.key,
      body: { email: emailFor(username), password: password }
    }).then(function (session) {
      storeSession(session);
      return fetchProfile(session.user.id);
    }).then(function (profile) {
      if (!profile) throw new Error('That account has no profile — sign up again to finish it.');
      setProfile(profile);
      return currentUser();
    }).catch(function (err) {
      clearSession();
      throw translate(err);
    });
  }

  function translate(err) {
    if (isOffline(err)) return new Error('Cannot reach the server. Check your connection.');
    var m = String(err.message || '');
    if (/Invalid login credentials/i.test(m)) return new Error('Wrong username or password.');
    if (/already registered|already been registered/i.test(m)) return new Error('That name is taken.');
    if (/duplicate key|profiles_username_key/i.test(m)) return new Error('That name is taken.');
    if (/Could not find the table/i.test(m)) return new Error('The database schema has not been set up yet.');
    return err;
  }

  function signOut() {
    var token = auth && auth.access_token;
    clearSession();
    if (!token) return Promise.resolve();
    return request('/auth/v1/logout', { method: 'POST', token: token })
      .catch(function () { /* the local session is already gone either way */ });
  }

  function currentUser() {
    return (auth && auth.user) ? auth.user : null;
  }

  // Called once on page load: revives a stored session and confirms the
  // profile still exists server-side.
  function restore() {
    auth = readJSON(AUTH_KEY);
    if (!auth || !auth.access_token) { auth = null; return Promise.resolve(null); }

    return refreshIfNeeded().then(function (live) {
      if (!live) return null;
      var id = live.user && live.user.id;
      if (!id) return null;
      return fetchProfile(id).then(function (profile) {
        // Offline, the cached profile stands. Online with no profile row, the
        // account is gone and the session with it.
        if (!profile) { clearSession(); return null; }
        setProfile(profile);
        return currentUser();
      }).catch(function (err) {
        if (isOffline(err)) return currentUser();
        return currentUser();
      });
    });
  }

  // ------------------------------------------------------------- daily
  // Everyone worldwide gets the same board each day, because the seed is
  // derived from the date and the game name and nothing else — no server
  // round-trip, no shared state, just the same arithmetic everywhere.
  //
  // The date is UTC to match the server's current_date, which is what the
  // insert trigger stamps onto a daily run. Local dates would put a player in
  // Sydney on a different board from the one their score gets filed under.

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dayStamp(now) {
    var d = now || new Date();
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // xfnv1a: spreads a short string across the whole 32-bit range, so
  // consecutive days do not produce near-identical seeds.
  function seedFrom(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32: small, fast, and good enough that a shuffled bag does not
  // show patterns. Returns a drop-in replacement for Math.random.
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyRng(game, now) {
    return makeRng(seedFrom(game + ':' + dayStamp(now)));
  }

  function msUntilReset(now) {
    var d = now || new Date();
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return next - d.getTime();
  }

  // Today's daily attempt for one game, or null if there isn't one. A record
  // from a previous day is not today's, so the reset needs no cleanup pass —
  // yesterday's entry simply stops matching and gets overwritten on the next
  // run.
  function dailyRecord(game) {
    var db = readJSON(DAILY_KEY) || {};
    var rec = db[game];
    return (rec && rec.day === dayStamp()) ? rec : null;
  }

  // `pending` means the run has not reached the server and a retry could still
  // land it. It is the difference between "you have played today" and "your
  // run is on the board", which are not the same thing on a flaky connection.
  function recordDaily(game, score, pending, meta, userId) {
    var db = readJSON(DAILY_KEY) || {};
    db[game] = {
      day: dayStamp(), score: score, pending: !!pending,
      meta: meta || {}, user: userId || null, at: Date.now()
    };
    writeJSON(DAILY_KEY, db);
    return db[game];
  }

  // Retries a daily run whose POST failed earlier. Deliberately scoped to the
  // account that recorded it: signing in on a shared machine must never post
  // somebody else's attempt under your name, and a run played signed-out was
  // never eligible for the board in the first place.
  function flushDaily(game) {
    var rec = dailyRecord(game);
    var user = currentUser();
    if (!rec || !rec.pending) return Promise.resolve({ posted: false, reason: 'nothing-pending' });
    if (!user || rec.user !== user.id) return Promise.resolve({ posted: false, reason: 'not-yours' });
    return submitScore(game, rec.score, rec.meta, true);
  }

  // -------------------------------------------------------- leaderboard

  function localScores(game) {
    var db = readJSON(LOCAL_SCORES_KEY) || {};
    var list = db[game];
    return Array.isArray(list) ? list : [];
  }

  function saveLocalScore(game, entry) {
    var db = readJSON(LOCAL_SCORES_KEY) || {};
    var list = Array.isArray(db[game]) ? db[game] : [];
    list.push(entry);
    list.sort(function (a, b) { return (b.score - a.score) || (a.at - b.at); });
    db[game] = list.slice(0, 10);
    writeJSON(LOCAL_SCORES_KEY, db);
    return db[game];
  }

  // Always records locally, then tries the server. A run is never lost to a
  // dropped connection, and a signed-out player still gets a board.
  function submitScore(game, score, meta, daily) {
    var user = currentUser();
    var entry = {
      name: user ? user.username : 'Guest',
      score: score,
      at: Date.now()
    };
    if (meta) Object.keys(meta).forEach(function (k) { entry[k] = meta[k]; });
    // A daily attempt belongs to the shared board, so it is kept out of the
    // local free-play list rather than double-counted there — but it is still
    // written down, under its own key, because a dropped connection must not
    // silently swallow the single run a player gets today.
    if (daily) recordDaily(game, score, true, meta, user ? user.id : null);
    else saveLocalScore(game, entry);

    if (!user) return Promise.resolve({ posted: false, reason: 'guest' });

    return refreshIfNeeded().then(function () {
      return request('/rest/v1/scores', {
        method: 'POST',
        body: {
          user_id: user.id, game: game, score: score,
          meta: meta || {}, daily: !!daily
        }
      });
    }).then(function () {
      if (daily) recordDaily(game, score, false, meta, user.id);
      return { posted: true };
    }).catch(function (err) {
      // 23505 is the one-daily-run-per-day unique index doing its job, which
      // is a rule rather than a failure. The server already holds today's run,
      // so the local record is settled too — leaving it pending would offer a
      // retry that can never succeed.
      if (err.data && err.data.code === '23505') {
        if (daily) recordDaily(game, score, false, meta, user.id);
        return { posted: false, reason: 'already-played' };
      }
      return { posted: false, reason: String(err.message || err) };
    });
  }

  // Global top N. Falls back to whatever this browser has if the server is
  // unreachable, so the panel is never simply empty.
  function topScores(game, limit, daily) {
    limit = limit || 10;
    var query = '/rest/v1/scores?select=username,score,meta,created_at' +
                '&game=eq.' + encodeURIComponent(game) +
                (daily ? '&daily=is.true&day=eq.' + dayStamp() : '&daily=is.false') +
                '&order=score.desc,created_at.asc&limit=' + limit;

    return request(query).then(function (rows) {
      return {
        global: true,
        rows: (rows || []).map(function (r) {
          return {
            name: r.username,
            score: r.score,
            won: !!(r.meta && r.meta.won),
            at: Date.parse(r.created_at) || 0
          };
        })
      };
    }).catch(function () {
      // A daily board has no local equivalent — it is the shared race or it is
      // nothing, and showing this device's free-play scores under a "Daily"
      // heading would be a lie.
      if (daily) return { global: false, daily: true, rows: [] };
      return { global: false, rows: localScores(game).slice(0, limit) };
    });
  }

  window.Nova = {
    configured: !!(CONFIG.url && CONFIG.key),
    restore: restore,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    user: currentUser,
    submitScore: submitScore,
    topScores: topScores,
    localScores: localScores,
    daily: {
      stamp: dayStamp,
      rng: dailyRng,
      makeRng: makeRng,
      seedFrom: seedFrom,
      msUntilReset: msUntilReset,
      record: dailyRecord,
      played: function (game) { return !!dailyRecord(game); },
      flush: flushDaily
    },
    lastError: function () { return lastError; }
  };
})();
