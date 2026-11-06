/* Hilfsfunktionen: Sonnenstand (nach SunCalc-Formeln, Astronomical Algorithms),
   Berliner Ortszeit, Oeffnungszeiten (Teilmenge von OSM opening_hours). Keine Abhaengigkeiten. */
(function (g) {
  'use strict';
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, E = rad * 23.4397;

  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));

  /** Sonnenstand: Hoehe [rad] und Kompasspeilung [rad, Nord=0, im Uhrzeigersinn]. */
  function sunPosition(date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date);
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = declination(L, 0), ra = rightAscension(L, 0);
    const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    return { alt, bearing: (az + Math.PI + 2 * Math.PI) % (2 * Math.PI) };
  }

  // ---- Berliner Ortszeit (Sommer-/Winterzeit ueber Intl)
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  function berlinParts(utcMs) {
    const p = {};
    fmt.formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
    const y = +p.year, mo = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute;
    const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7; // Mo=0
    return { y, mo, d, h, mi, dow };
  }
  function berlinOffsetMin(utcMs) {
    const p = berlinParts(utcMs);
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(utcMs / 60000) * 60000) / 60000);
  }
  function berlinToUTC(y, mo, d, h, mi) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const t = guess - berlinOffsetMin(guess) * 60000;
    return guess - berlinOffsetMin(t) * 60000;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60);

  /** Auf-/Untergang (Berliner Minuten ab 0 Uhr) per Minutenraster; null bei Polartag/-nacht. */
  function sunTimes(y, mo, d, lat, lon) {
    let rise = null, set = null, prev = null;
    for (let m = 0; m <= 1440; m += 1) {
      const u = berlinToUTC(y, mo, d, Math.floor(m / 60) % 24 + (m >= 1440 ? 24 : 0), m % 60);
      const a = sunPosition(new Date(u), lat, lon).alt / rad;
      if (prev !== null) {
        if (prev < -0.833 && a >= -0.833 && rise === null) rise = m;
        if (prev >= -0.833 && a < -0.833) set = m;
      }
      prev = a;
    }
    return { rise, set };
  }

  const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const compass = (bearing) => COMPASS[Math.round(bearing / (Math.PI / 4)) % 8];

  // ---- Oeffnungszeiten (Teilmenge)
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function parseDays(s) {
    const set = new Set();
    for (const part of s.split(',')) {
      const t = part.trim();
      if (!t || t === 'PH' || t === 'SH') continue;
      const m = t.match(/^([A-Za-z]{2})(?:-([A-Za-z]{2}))?$/);
      if (!m || DAYS.indexOf(m[1]) < 0 || (m[2] && DAYS.indexOf(m[2]) < 0)) return null;
      let a = DAYS.indexOf(m[1]);
      const b = m[2] ? DAYS.indexOf(m[2]) : a;
      for (let i = 0; i < 7; i++) { set.add(a); if (a === b) break; a = (a + 1) % 7; }
    }
    return set;
  }

  /** Liefert {week:[7 x [[von,bis],...]]} oder null, wenn nicht auswertbar. */
  function parseOpeningHours(oh) {
    if (!oh) return null;
    const week = Array.from({ length: 7 }, () => []);
    const text = oh.trim();
    if (text === '24/7') return { week: week.map(() => [[0, 1440]]) };
    for (const rule of text.split(';')) {
      const r = rule.trim();
      if (!r) continue;
      const tok = r.split(/\s+/);
      let k = tok.findIndex((t) => /^\d/.test(t) || t === 'off' || t === 'closed');
      if (k < 0) return null;
      const dayStr = tok.slice(0, k).join(' ');
      const timeStr = tok.slice(k).join('');
      const days = dayStr ? parseDays(dayStr) : new Set([0, 1, 2, 3, 4, 5, 6]);
      if (!days) return null;
      let iv = [];
      if (timeStr === 'off' || timeStr === 'closed') iv = [];
      else {
        for (const seg of timeStr.split(',')) {
          const m = seg.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
          if (!m) return null;
          const a = +m[1] * 60 + +m[2];
          let b = +m[3] * 60 + +m[4];
          if (b <= a) b = 1440;
          iv.push([a, b]);
        }
      }
      days.forEach((dd) => { week[dd] = iv.slice(); });
    }
    return { week };
  }

  /** Status zum Zeitpunkt now={dow,h,mi}: {state:'open'|'closed'|'unknown', text}. */
  function openStatus(oh, now) {
    const parsed = parseOpeningHours(oh);
    if (!parsed) return { state: 'unknown', text: oh ? 'Zeiten siehe Angabe' : 'Öffnungszeiten nicht verifiziert' };
    const min = now.h * 60 + now.mi;
    for (const [a, b] of parsed.week[now.dow]) {
      if (a === 0 && b === 1440) return { state: 'open', text: 'durchgehend geöffnet' };
      if (min >= a && min < b) return { state: 'open', text: 'geöffnet bis ' + hhmm(b % 1440 === 0 ? 0 : b) };
    }
    for (let i = 0; i < 8; i++) {
      const dd = (now.dow + i) % 7;
      for (const [a] of parsed.week[dd]) {
        if (i === 0 && a <= min) continue;
        const when = i === 0 ? 'heute' : i === 1 ? 'morgen' : DAYS_DE[dd];
        return { state: 'closed', text: 'geschlossen, öffnet ' + when + ' ' + hhmm(a) };
      }
    }
    return { state: 'closed', text: 'geschlossen' };
  }

  g.AL = Object.assign(g.AL || {}, {
    rad, sunPosition, berlinParts, berlinToUTC, sunTimes, compass, hhmm, pad,
    parseOpeningHours, openStatus, DAYS_DE,
  });
})(window);
