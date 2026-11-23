// ────────────────────────────────────────────────────────────────
// Campaign countdown — no dependencies, works on any page that
// includes js/config.js before this file.
//
// Markup:
//   <div class="campaign-countdown" data-countdown="ramadan">
//     <div class="cd-box"><span class="cd-num" data-cd="days">0</span>
//       <span class="cd-label" data-i18n="waqf.countdown.days">Dagar</span></div>
//     ... hours / minutes / seconds ...
//   </div>
//
// data-countdown="ramadan" → counts to CAMPAIGN.ramadanStart, then flips
// to "Ramadan · Dag N" mode. data-countdown="eid" → counts to CAMPAIGN.eid
// and hides when passed.
// ────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  function t(key, fallback) {
    return (typeof window.getTranslation === 'function' && window.getTranslation(key, fallback)) || fallback;
  }

  function pad(n) { return ('0' + n).slice(-2); }

  function parseDate(dateStr) {
    var p = String(dateStr || '').split('T')[0].split('-');
    if (p.length !== 3) return null;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function render() {
    var C = window.CAMPAIGN || {};
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var kind = el.getAttribute('data-countdown');
      var dateStr = kind === 'eid' ? C.eid : C.ramadanStart;
      var target = parseDate(dateStr);
      if (!target) return;

      var now = new Date();
      var diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        if (kind === 'eid') {
          el.innerHTML = '<span class="countdown-ramadan-day">' + t('waqf.countdown.eid-reached', 'Eid Mubarak!') + '</span>';
          return;
        }
        // Ramadan is running: show "Ramadan · Dag N"
        var day = Math.floor((now.getTime() - target.getTime()) / 86400000) + 1;
        el.innerHTML = '<span class="countdown-ramadan-day">'
          + t('waqf.countdown.ramadan', 'Ramadan')
          + ' · ' + t('waqf.countdown.day', 'Dag') + ' ' + day + '</span>';
        return;
      }

      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var minutes = Math.floor((diff % 3600000) / 60000);
      var seconds = Math.floor((diff % 60000) / 1000);

      var nums = {
        days: days,
        hours: pad(hours),
        minutes: pad(minutes),
        seconds: pad(seconds)
      };

      el.querySelectorAll('[data-cd]').forEach(function (span) {
        var key = span.getAttribute('data-cd');
        if (key in nums) span.textContent = nums[key];
      });
    });
  }

  // i18n label refreshes also re-render the "Ramadan · Dag N" state
  window.addEventListener('languageChanged', render);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      render();
      setInterval(render, 1000);
    });
  } else {
    render();
    setInterval(render, 1000);
  }
})();
