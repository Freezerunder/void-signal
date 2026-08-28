/* Nova Games — shared account + leaderboard client.
 *
 * Every other file here is a self-contained single page on purpose. This one
 * is the deliberate exception: accounts and the leaderboard have to agree
 * across the launcher and every game, and four copies of an auth client is
 * four places for them to drift apart. Loaded as a classic script (not a
 * module) so it still works over file:// inside the Electron build, where
 * module loading is blocked by CORS — which is also why this talks to
 * Firebase's plain REST endpoints instead of the Firebase JS SDK (the SDK is
 * ESM-first and assumes a bundler).
 *
 * Backed by Firebase (Identity Toolkit for auth, Firestore for data) rather
 * than Supabase: a free-tier Supabase project auto-pauses after a week of no
 * traffic, which meant logins failing until someone noticed and clicked
 * Restore in a dashboard. Firebase's Spark (free) plan has no such pause.
 *
 * The apiKey below is meant to be public — same deal as any client-side
 * Firebase config — it identifies the project, it does not authorize
 * anything by itself. Every rule that matters is enforced server-side by
 * Firestore Security Rules (see firestore.rules), not by this file.
 *
 * Everything degrades: if the network is down or the project is
 * unreachable, calls fail softly and callers fall back to the local-only
 * path they used before this existed.
 */
(function () {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyBrQT4Bp5YtERmZkHScb6MLCVeNIqklccI',
    projectId: 'nova-games-980db'
  };

  var IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1';
  var TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
  var FIRESTORE_URL = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.projectId + '/databases/(default)/documents';

  // Accounts are username + password, as they always were here. Firebase
  // Auth is email-based, so the username is mapped onto a synthetic address
  // on a domain that receives no mail.
  var EMAIL_DOMAIN = 'players.novagames.app';

  var AUTH_KEY = 'nova.auth.v1';
  var LOCAL_SCORES_KEY = 'arcade.scores.v1';
  var DAILY_KEY = 'nova.daily.v1';

  // Running inside the Electron wrapper rather than a browser tab. The
  // user-agent is the whole test on purpose: a `file:` protocol check looks
  // like a reasonable second signal and is actively wrong, because opening
  // these pages straight off disk in a normal browser (which the README
  // suggests) is also `file:`. Electron appends Electron/<ver> to the UA and
  // electron/main.js never overrides it. Lives here rather than in each page
  // so the four of them cannot drift apart on what counts as the desktop app.
  var IS_DESKTOP = /\bElectron\//i.test(
    (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  );

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
    // A TypeError from fetch is the network itself failing, as opposed to
    // the server answering with an error we can show the player.
    return err instanceof TypeError;
  }

  function parseResponse(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      if (!res.ok) {
        var err = new Error((data && data.error && data.error.message) || ('http ' + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    });
  }

  // Identity Toolkit wants the API key as a query param and JSON bodies.
  function idRequest(method, body) {
    return fetch(IDENTITY_URL + '/accounts:' + method + '?key=' + CONFIG.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(parseResponse);
  }

  // The token-refresh endpoint is a different host and wants form encoding
  // with snake_case fields — one of Google's few REST inconsistencies here.
  function tokenRequest(refreshToken) {
    return fetch(TOKEN_URL + '?key=' + CONFIG.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
    }).then(parseResponse);
  }

  function fsRequest(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var token = options.token !== undefined ? options.token : (auth && auth.access_token);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(FIRESTORE_URL + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    }).then(parseResponse);
  }

  // ------------------------------------------------------ firestore values
  // Firestore's REST API wants every field wrapped in a {typeValue: x}
  // envelope rather than plain JSON. These two functions are the only place
  // that has to know that.

  function fsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
    if (typeof v === 'object') return { mapValue: { fields: fsFields(v) } };
    return { nullValue: null };
  }

  function fsFields(obj) {
    var fields = {};
    Object.keys(obj || {}).forEach(function (k) { fields[k] = fsValue(obj[k]); });
    return fields;
  }

  function fsParse(v) {
    if (!v) return null;
    var key = Object.keys(v)[0];
    switch (key) {
      case 'stringValue': return v.stringValue;
      case 'booleanValue': return v.booleanValue;
      case 'integerValue': return parseInt(v.integerValue, 10);
      case 'doubleValue': return v.doubleValue;
      case 'timestampValue': return v.timestampValue;
      case 'nullValue': return null;
      case 'arrayValue': return (v.arrayValue.values || []).map(fsParse);
      case 'mapValue': return fsDoc(v.mapValue.fields || {});
      default: return null;
    }
  }

  function fsDoc(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = fsParse(fields[k]); });
    return out;
  }

  function emailFor(username) {
    return username.trim().toLowerCase().replace(/\s+/g, '.') + '@' + EMAIL_DOMAIN;
  }

  function storeSession(session) {
    // session shape from signUp/signIn: { idToken, refreshToken, expiresIn, localId }
    if (!session || !session.idToken) return null;
    auth = {
      access_token: session.idToken,
      refresh_token: session.refreshToken,
      // A minute of slack so a request never leaves with a token that
      // expires while it is in flight.
      expires_at: Date.now() + ((parseInt(session.expiresIn, 10) || 3600) - 60) * 1000,
      user: auth && auth.user ? auth.user : null
    };
    writeJSON(AUTH_KEY, auth);
    return auth;
  }

  function setProfile(profile) {
    if (!auth) return;
    auth.user = profile
      ? { id: profile.id, username: profile.username, isDev: !!profile.isDev, realName: profile.realName || '' }
      : null;
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
    return tokenRequest(auth.refresh_token).then(function (session) {
      storeSession({
        idToken: session.id_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in
      });
      setProfile(keep ? { id: keep.id, username: keep.username, isDev: keep.isDev, realName: keep.realName } : null);
      return auth;
    }).catch(function (err) {
      // An expired or revoked refresh token means the session is genuinely
      // over; a network blip must not sign anyone out.
      if (!isOffline(err)) clearSession();
      return null;
    });
  }

  function fetchProfile(userId, token) {
    return fsRequest('/profiles/' + encodeURIComponent(userId), { token: token })
      .then(function (doc) {
        var data = fsDoc(doc.fields);
        return { id: userId, username: data.username, isDev: !!data.isDev, realName: data.realName || '' };
      })
      .catch(function (err) {
        if (err.status === 404) return null;
        throw err;
      });
  }

  function signUp(username, password, realName) {
    lastError = null;
    if (!/^[A-Za-z0-9 _-]{3,16}$/.test(username)) {
      return Promise.reject(new Error('Username: 3–16 characters, letters/numbers/space/_/- only.'));
    }
    if (!password || password.length < 6) {
      return Promise.reject(new Error('Password must be at least 6 characters.'));
    }
    var cleanRealName = (realName || '').trim();
    if (!cleanRealName || cleanRealName.length > 60) {
      return Promise.reject(new Error('Enter your real name (up to 60 characters).'));
    }

    var uid, cleanName = username.trim(), session, devFlag;

    return idRequest('signUp', { email: emailFor(username), password: password, returnSecureToken: true })
      .then(function (result) {
        session = result;
        uid = result.localId;
        storeSession(session);

        // The owner rule, enforced where it cannot be bypassed: whoever's
        // create of this one document lands first holds dev access forever,
        // and nobody after them does. Firestore document creation is atomic
        // per-document, so this race has exactly one winner regardless of
        // how many people sign up at once.
        return fsRequest('/meta?documentId=owner', {
          method: 'POST', token: session.idToken,
          body: { fields: fsFields({ uid: uid }) }
        }).then(function () { devFlag = true; })
          .catch(function (err) {
            // The rule embeds its own !exists() check (it has to, to reason
            // about who's first), so losing the race is a rule-level 403,
            // not the storage-level 409 a plain id collision would be. Both
            // mean "someone else already claimed it" here.
            if (err.status !== 403 && err.status !== 409) throw err;
            devFlag = false;
          });
      })
      .then(function () {
        return fsRequest('/profiles?documentId=' + encodeURIComponent(uid), {
          method: 'POST', token: session.idToken,
          body: { fields: fsFields({
            username: cleanName, isDev: devFlag, realName: cleanRealName,
            createdAt: new Date().toISOString()
          }) }
        });
      })
      .then(function () {
        setProfile({ id: uid, username: cleanName, isDev: devFlag, realName: cleanRealName });
        return currentUser();
      })
      .catch(function (err) {
        // The profile document is what makes an account real; without it
        // there is a half-made auth user that can never be completed under
        // the same name.
        if (auth && !auth.user) clearSession();
        throw translate(err);
      });
  }

  function signIn(username, password) {
    lastError = null;
    var session;
    return idRequest('signInWithPassword', { email: emailFor(username), password: password, returnSecureToken: true })
      .then(function (result) {
        session = result;
        storeSession(session);
        return fetchProfile(session.localId, session.idToken);
      })
      .then(function (profile) {
        if (!profile) throw new Error('That account has no profile — sign up again to finish it.');
        setProfile(profile);
        return currentUser();
      })
      .catch(function (err) {
        clearSession();
        throw translate(err);
      });
  }

  function translate(err) {
    if (isOffline(err)) return new Error('Cannot reach the server. Check your connection.');
    var m = String(err.message || '');
    if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(m)) return new Error('Wrong username or password.');
    if (/EMAIL_EXISTS/.test(m)) return new Error('That name is taken.');
    if (/WEAK_PASSWORD/.test(m)) return new Error('Password must be at least 6 characters.');
    if (/TOO_MANY_ATTEMPTS_TRY_LATER/.test(m)) return new Error('Too many attempts — wait a bit and try again.');
    if (/PERMISSION_DENIED|insufficient permissions/i.test(m)) return new Error('That could not be completed — try again.');
    return err;
  }

  function signOut() {
    // Nothing server-side to revoke for password auth over this REST
    // surface — signing out is just forgetting the local tokens.
    clearSession();
    return Promise.resolve();
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
      return fetchProfile(id, live.access_token).then(function (profile) {
        // Offline, the cached profile stands. Online with no profile
        // document, the account is gone and the session with it.
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
  // The date is UTC so it matches the integer day stamped onto a daily run
  // (see submitScore below). Local dates would put a player in Sydney on a
  // different board from the one their score gets filed under.

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

  // The integer day used server-side to stamp and rate-limit a daily run —
  // see the firestore.rules comment on /scores for why this exists.
  function dayNumber(now) {
    return Math.floor((now || Date.now()) / 86400000);
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

  // `pending` means the run has not reached the server and a retry could
  // still land it. It is the difference between "you have played today" and
  // "your run is on the board", which are not the same thing on a flaky
  // connection.
  function recordDaily(game, score, pending, meta, userId) {
    var db = readJSON(DAILY_KEY) || {};
    db[game] = {
      day: dayStamp(), score: score, pending: !!pending,
      meta: meta || {}, user: userId || null, at: Date.now()
    };
    writeJSON(DAILY_KEY, db);
    return db[game];
  }

  // Marks today's attempt as settled: no retry is possible or needed. The
  // run already on record wins over the one just played, because replaying
  // the daily does not replace the run that actually reached the board.
  function settleDaily(game, score, meta, userId) {
    var prior = dailyRecord(game);
    if (prior && !prior.pending) return prior;
    return recordDaily(game, prior ? prior.score : score, false,
                       prior ? prior.meta : meta, userId);
  }

  // Retries a daily run whose POST failed earlier. Deliberately scoped to
  // the account that recorded it: signing in on a shared machine must never
  // post somebody else's attempt under your name, and a run played
  // signed-out was never eligible for the board in the first place.
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

    if (daily) {
      var prior = dailyRecord(game);
      if (!prior || prior.pending) {
        recordDaily(game, score, true, meta, user ? user.id : null);
      }
    } else {
      saveLocalScore(game, entry);
    }

    if (!user) return Promise.resolve({ posted: false, reason: 'guest' });

    return refreshIfNeeded().then(function () {
      var body = {
        userId: user.id, username: user.username, game: game,
        score: score, meta: meta || {}, daily: !!daily, day: daily ? dayNumber() : null,
        createdAt: new Date().toISOString()
      };

      if (daily) {
        // A daily run's document id doubles as the one-per-day lock:
        // Firestore create-only semantics mean a second attempt the same
        // day collides with the first and fails, mirroring the unique
        // index this used to be.
        var dailyPath = '/scores?documentId=' + encodeURIComponent(user.id + '_' + game + '_' + body.day);
        return fsRequest(dailyPath, { method: 'POST', token: auth.access_token, body: { fields: fsFields(body) } })
          .then(function () { return { posted: true }; })
          .catch(function (err) {
            // ALREADY_EXISTS (409) is the one-daily-run-per-day lock doing
            // its job, which is a rule rather than a failure. The server
            // already holds today's run, so the local record is settled
            // too — leaving it pending would offer a retry that can never
            // succeed.
            if (err.status === 409) return { already: true };
            throw err;
          });
      }

      // Free play keeps one document per (player, game) — the id itself
      // is the identity, so a new run replaces the old one instead of
      // piling up as a separate row. Without this, the leaderboard filled
      // up with the same handful of players' whole run history instead of
      // one row per player. Read the existing best first so a worse run
      // never overwrites a better one, and so we know create vs. update.
      var docPath = '/scores/' + encodeURIComponent(user.id + '_' + game);
      return fsRequest(docPath, { token: auth.access_token })
        .then(function (doc) { return fsDoc(doc.fields); })
        .catch(function (err) {
          if (err.status === 404) return null;
          throw err;
        })
        .then(function (existing) {
          if (existing && existing.score != null && existing.score >= score) {
            return { notImproved: true };
          }
          return fsRequest(existing ? docPath : '/scores?documentId=' + encodeURIComponent(user.id + '_' + game), {
            method: existing ? 'PATCH' : 'POST',
            token: auth.access_token,
            body: { fields: fsFields(body) }
          }).then(function () { return { posted: true }; });
        });
    }).then(function (result) {
      if (result.already || (daily && result.posted)) settleDaily(game, score, meta, user.id);
      if (result.notImproved) return { posted: false, reason: 'not-improved' };
      if (result.already) return { posted: false, reason: 'already-played' };
      return { posted: true };
    }).catch(function (err) {
      return { posted: false, reason: String(err.message || err) };
    });
  }

  // Global top N. Falls back to whatever this browser has if the server is
  // unreachable, so the panel is never simply empty.
  function topScores(game, limit, daily) {
    limit = limit || 10;

    var filters = [
      { fieldFilter: { field: { fieldPath: 'game' }, op: 'EQUAL', value: { stringValue: game } } }
    ];
    filters.push(daily
      ? { fieldFilter: { field: { fieldPath: 'day' }, op: 'EQUAL', value: { integerValue: String(dayNumber()) } } }
      : { fieldFilter: { field: { fieldPath: 'daily' }, op: 'EQUAL', value: { booleanValue: false } } });

    var body = {
      structuredQuery: {
        from: [{ collectionId: 'scores' }],
        where: { compositeFilter: { op: 'AND', filters: filters } },
        orderBy: [
          { field: { fieldPath: 'score' }, direction: 'DESCENDING' },
          { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }
        ],
        limit: limit
      }
    };

    return fsRequest(':runQuery', { method: 'POST', body: body }).then(function (rows) {
      var docs = (rows || []).filter(function (r) { return r && r.document; });
      return {
        global: true,
        rows: docs.map(function (r) {
          var data = fsDoc(r.document.fields);
          return {
            name: data.username,
            score: data.score,
            won: !!(data.meta && data.meta.won),
            meta: data.meta || {},
            at: Date.parse(data.createdAt) || 0
          };
        })
      };
    }).catch(function () {
      // A daily board has no local equivalent — it is the shared race or it
      // is nothing, and showing this device's free-play scores under a
      // "Daily" heading would be a lie.
      if (daily) return { global: false, daily: true, rows: [] };
      return { global: false, rows: localScores(game).slice(0, limit) };
    });
  }

  window.Nova = {
    configured: !!(CONFIG.apiKey && CONFIG.projectId),
    isDesktop: IS_DESKTOP,
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
