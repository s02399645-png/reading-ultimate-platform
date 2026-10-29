/* Backend adapters. The app talks only to window.Backend, so stage 1 (local)
   and stage 2 (Worker + D1) share the same UI code. */
(function () {
  'use strict';
  var cfg = window.APP_CONFIG || { MODE: 'local', API_BASE: '/api' };

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var EMPTY_STATE = function () { return { deck: [], settings: {}, attempts: [] }; };

  /* ---------- Stage 1: everything stays in this browser ---------- */
  var Local = {
    mode: 'local',
    user: { name: '', role: 'student' },
    init: function () { return Promise.resolve(this.user); },
    listPassages: function () { return fetch('data/index.json').then(function (r) { return r.json(); }); },
    getPassage: function (id) {
      if (!/^[a-z0-9-]+$/i.test(id)) return Promise.reject(new Error('Bad passage id'));
      return fetch('data/' + id + '.json').then(function (r) {
        if (!r.ok) throw new Error('Passage not found');
        return r.json();
      });
    },
    saveAnswer: function (rec) {
      var a = LS.get('ielts.answers', []);
      var i = a.findIndex(function (x) { return x.attemptId === rec.attemptId && x.questionId === rec.questionId; });
      if (i >= 0) a[i] = Object.assign(a[i], rec); else a.push(rec);
      LS.set('ielts.answers', a);
      return Promise.resolve();
    },
    getAnswers: function () { return Promise.resolve(LS.get('ielts.answers', [])); },
    getState: function () { return Promise.resolve(Object.assign(EMPTY_STATE(), LS.get('ielts.state', {}))); },
    setState: function (s) { LS.set('ielts.state', s); return Promise.resolve(); },
    deleteAccount: function () {
      try { localStorage.clear(); } catch (e) {}
      return Promise.resolve();
    }
  };

  /* ---------- Stage 2: Cloudflare Worker API ---------- */
  function call(path, method, body) {
    var opts = {
      method: method || 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'marginalia' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(cfg.API_BASE + path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!r.ok) {
          var err = new Error((data && data.error) || ('HTTP ' + r.status));
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  var Api = {
    mode: 'api',
    user: null,
    init: function () {
      var self = this;
      return call('/me').then(function (d) { self.user = d.user; return self.user; })
        .catch(function (e) { if (e.status === 401) { self.user = null; return null; } throw e; });
    },
    ping: function () { return call('/me').catch(function () {}); },
    login: function (email, password) {
      var self = this;
      return call('/login', 'POST', { email: email, password: password }).then(function (d) { self.user = d.user; return d.user; });
    },
    signup: function (name, email, password, invite) {
      var self = this;
      return call('/signup', 'POST', { name: name, email: email, password: password, invite: invite }).then(function (d) { self.user = d.user; return d.user; });
    },
    logout: function () { var self = this; return call('/logout', 'POST', {}).then(function () { self.user = null; }); },
    listPassages: function () { return call('/passages'); },
    getPassage: function (id) { return call('/passages/' + encodeURIComponent(id)); },
    saveAnswer: function (rec) { return call('/answers', 'POST', rec); },
    getAnswers: function () { return call('/answers'); },
    getState: function () { return call('/state').then(function (s) { return Object.assign(EMPTY_STATE(), s); }); },
    setState: function (s) { return call('/state', 'PUT', s); },
    deleteAccount: function (password) { var self = this; return call('/me', 'DELETE', { password: password }).then(function () { self.user = null; }); },
    changePassword: function (current, next) { return call('/me/password', 'POST', { current: current, next: next }); },
    // teacher
    teacherStudents: function () { return call('/teacher/students'); },
    teacherStudent: function (id) { return call('/teacher/students/' + encodeURIComponent(id)); },
    teacherResetPassword: function (id, password) { return call('/teacher/students/' + encodeURIComponent(id) + '/password', 'POST', { password: password }); }
  };

  window.Backend = cfg.MODE === 'api' ? Api : Local;
})();
