/* Bönetider widget — fetches the monthly prayer-times table from the Google
 * Apps Script proxy (bonetider/api/bonetider.gs) and renders:
 *   - header: title, live clock, today's Gregorian + Hijri date, location
 *   - a "next prayer" strip with a live countdown (Soluppgång is excluded —
 *     it is informational, not a prayer)
 *   - today's prayer table with the next prayer highlighted
 *   - a week view modal ("Visa hela veckans bönetider")
 * If no data can be fetched (and nothing valid is cached), the widget is
 * hidden and the old my-masjid iframe (#bonetider-fallback) is shown.
 */
(function () {
    "use strict";

    // ==== Config ====
    // Backend: the GAS proxy deployed from bonetider/api/bonetider.gs.
    // Location is configurable here: BT_CITY must be a city supported by
    // islamiskaforbundet.se ("<City>, SE"); the backend echoes the display
    // name back in the payload.
    const BT_API_URL = "https://script.google.com/macros/s/AKfycbyLHYT0Nx-HdWIeJy3bTNDcb83re93shgzgyd6NN7c93ZzaRnmeXumS2Knhub4B_YVT3g/exec";
    const BT_CITY = "Helsingborg, SE";

    const BT_CACHE_KEY = "alsalam-bonetider-v1:" + BT_CITY;
    const BT_CACHE_TTL = 12 * 60 * 60 * 1000; // warm-cache freshness gate only
    // The five daily prayers — used for "next prayer" and the countdown.
    // Shuruk (sunrise) is shown in the table as information only.
    const PRAYERS = ["fajr", "dhohr", "asr", "magrib", "isha"];
    const TABLE_PRAYERS = ["fajr", "shuruk", "dhohr", "asr", "magrib", "isha"];
    const PRAYER_ICONS = {
        fajr: "fa-cloud-moon",
        shuruk: "fa-sun",
        dhohr: "fa-cloud-sun",
        asr: "fa-hourglass-half",
        magrib: "fa-moon",
        isha: "fa-star-and-crescent"
    };
    const LOCALES = { sv: "sv-SE", en: "en-GB", ar: "ar-EG" };

    const widgetEl = document.getElementById("bonetider-widget");
    const fallbackEl = document.getElementById("bonetider-fallback");
    const clockEl = document.getElementById("bt-clock");
    const gregEl = document.getElementById("bt-gregorian");
    const hijriEl = document.getElementById("bt-hijri");
    const cityEl = document.getElementById("bt-city");
    const nextNameEl = document.getElementById("bt-next-name");
    const countdownEl = document.getElementById("bt-countdown");
    const tbodyEl = document.querySelector("#bt-table tbody");
    const loadingEl = document.getElementById("bt-loading");
    const weekBodyEl = document.getElementById("bt-week-body");
    if (!widgetEl || !fallbackEl || !tbodyEl) return;

    let payload = null;   // last known good payload
    let timeline = [];    // sorted [{ name, date }] — the 5 prayers only
    let todayKey = "";    // for midnight detection
    let fetching = false; // guards concurrent server fetches

    /* --- i18n helpers -------------------------------------------------- */

    function t(key, fallback) {
        try {
            if (typeof window.getTranslation === "function") {
                const value = window.getTranslation(key);
                if (typeof value === "string" && value) return value;
            }
        } catch (e) { /* i18n module not ready yet */ }
        return fallback || key;
    }

    function currentLocale() {
        try {
            const lang = localStorage.getItem("lang") || "sv";
            return LOCALES[lang] || "sv-SE";
        } catch (e) {
            return "sv-SE";
        }
    }

    /* --- data ---------------------------------------------------------- */

    function isValidPayload(p) {
        return !!(p && p.ok && Array.isArray(p.days) && p.days.length);
    }

    // Sorted timeline of the five daily prayers across the current + next
    // month, so "next prayer" works across midnight and month boundaries.
    // Dates are built in browser-local time (visitors are in Sweden);
    // the backend always supplies Stockholm-local times.
    function buildTimeline(p) {
        const rows = [];
        [p, p.next].forEach((m) => {
            if (!m || !Array.isArray(m.days)) return;
            m.days.forEach((d) => {
                PRAYERS.forEach((name) => {
                    if (!d[name]) return;
                    const parts = String(d[name]).split(":");
                    const h = parseInt(parts[0], 10);
                    const min = parseInt(parts[1], 10);
                    if (isNaN(h) || isNaN(min)) return;
                    // NOTE: month "13" (Ramadan) spans two calendar months;
                    // see the TODO in bonetider.gs.
                    rows.push({
                        name,
                        date: new Date(m.year, parseInt(m.month, 10) - 1, d.day, h, min)
                    });
                });
            });
        });
        // Dedupe identical month pairs (Ramadan: next === current table).
        const seen = new Set();
        return rows
            .filter((r) => {
                const key = r.date.getTime() + "|" + r.name;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => a.date - b.date);
    }

    function applyPayload(p) {
        payload = p;
        timeline = buildTimeline(p);
        if (p.city && cityEl) cityEl.textContent = p.city;
        renderDates();
        renderTable();
        renderWeek();
        recomputeNow();
        try {
            localStorage.setItem(
                BT_CACHE_KEY,
                JSON.stringify(Object.assign({}, p, { cached_at: Date.now() }))
            );
        } catch (e) { /* storage unavailable */ }
    }

    function loadWarmCache() {
        try {
            const raw = localStorage.getItem(BT_CACHE_KEY);
            if (!raw) return false;
            const p = JSON.parse(raw);
            if (!isValidPayload(p)) return false;
            if (Date.now() - (p.cached_at || 0) > BT_CACHE_TTL) return false;
            // Only trust the cache while it still covers the current month.
            const now = new Date();
            if (String(p.month) !== String(now.getMonth() + 1)) return false;
            applyPayload(p);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function fetchPayload() {
        const url = BT_API_URL + "?city=" + encodeURIComponent(BT_CITY);
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const json = await resp.json();
        if (!isValidPayload(json)) {
            throw new Error(json && json.error ? json.error : "no data");
        }
        return json;
    }

    async function refreshFromServer() {
        if (fetching) return;
        fetching = true;
        try {
            const json = await fetchPayload();
            applyPayload(json);
            showWidget();
        } catch (err) {
            console.warn("Bönetider kunde inte hämtas:", err);
            if (payload) showWidget(); // stale cache beats the iframe
            else showFallback();
        } finally {
            fetching = false;
        }
    }

    /* --- rendering ------------------------------------------------------ */

    function renderDates() {
        const now = new Date();
        const locale = currentLocale();
        try {
            gregEl.textContent = new Intl.DateTimeFormat(locale, {
                weekday: "long", day: "numeric", month: "long", year: "numeric"
            }).format(now);
        } catch (e) {
            gregEl.textContent = now.toLocaleDateString();
        }
        // Hijri via Intl (islamic-umalqura). This is an algorithmic
        // approximation and may differ a day from moon-sighting calendars;
        // Safari lacks umalqura, so fall back to the tabular calendar.
        try {
            hijriEl.textContent = new Intl.DateTimeFormat(locale + "-u-ca-islamic-umalqura", {
                day: "numeric", month: "long", year: "numeric"
            }).format(now);
        } catch (e) {
            try {
                hijriEl.textContent = new Intl.DateTimeFormat(locale + "-u-ca-islamic", {
                    day: "numeric", month: "long", year: "numeric"
                }).format(now);
            } catch (e2) {
                hijriEl.textContent = "";
            }
        }
    }

    function renderTable() {
        if (!payload) return;
        loadingEl.classList.add("d-none");

        const now = new Date();
        const todayDay = now.getDate();
        const isCurrentMonth = String(payload.month) === String(now.getMonth() + 1);
        // Today's row; clamp to an available row when the visitor's local
        // month does not match the payload (timezone edge at month boundary).
        const todaysRow = isCurrentMonth
            ? (payload.days || []).find((d) => d.day === todayDay)
                || (payload.days || []).find((d) => d.day > todayDay)
                || (payload.days || [])[(payload.days || []).length - 1]
            : null;
        const nextEntry = timeline.find((r) => r.date > now);

        const rows = [];
        const addRow = (name, time, day, labelSuffix) => {
            const icon = PRAYER_ICONS[name] || "fa-clock";
            const isInfo = name === "shuruk";
            const label = t("bonetider." + name, name) + (labelSuffix ? " · " + labelSuffix : "");
            rows.push(
                '<tr class="bonetider-row' + (isInfo ? " bonetider-row--info" : "") + '"' +
                ' data-name="' + name + '" data-day="' + day + '">' +
                '<td class="bonetider-name"><i class="fas ' + icon + '" aria-hidden="true"></i>' +
                label + "</td>" +
                '<td class="bonetider-time">' + time + "</td></tr>"
            );
        };

        if (todaysRow) {
            TABLE_PRAYERS.forEach((name) => {
                if (todaysRow[name]) addRow(name, todaysRow[name], todaysRow.day, "");
            });
        }
        // After Isha the next prayer is tomorrow's Fajr — append its row.
        if (nextEntry && !isSameDay(nextEntry.date, now)) {
            const hh = String(nextEntry.date.getHours()).padStart(2, "0");
            const mm = String(nextEntry.date.getMinutes()).padStart(2, "0");
            addRow(nextEntry.name, hh + ":" + mm, nextEntry.date.getDate(),
                t("bonetider.tomorrow", "Imorgon"));
        }

        tbodyEl.innerHTML = rows.join("");
        highlightNextRow(nextEntry);
    }

    function isSameDay(a, b) {
        return a.getDate() === b.getDate()
            && a.getMonth() === b.getMonth()
            && a.getFullYear() === b.getFullYear();
    }

    function highlightNextRow(entry) {
        tbodyEl.querySelectorAll(".bonetider-row--next").forEach((row) => {
            row.classList.remove("bonetider-row--next");
        });
        if (!entry) return;
        const match = tbodyEl.querySelector(
            '.bonetider-row[data-name="' + entry.name + '"][data-day="' + entry.date.getDate() + '"]'
        );
        if (match) match.classList.add("bonetider-row--next");
    }

    function recomputeNow() {
        if (!payload) return;
        const now = new Date();
        const next = timeline.find((r) => r.date > now);
        if (!next) {
            nextNameEl.textContent = "–";
            countdownEl.textContent = "--:--";
            countdownEl.classList.remove("bonetider-countdown--soon");
            return;
        }
        const tomorrow = !isSameDay(next.date, now);
        nextNameEl.textContent = t("bonetider." + next.name, next.name)
            + (tomorrow ? " · " + t("bonetider.tomorrow", "Imorgon") : "");
        const ms = next.date.getTime() - now.getTime();
        countdownEl.textContent = formatCountdown(ms);
        countdownEl.classList.toggle("bonetider-countdown--soon", ms < 60 * 60 * 1000);
        highlightNextRow(next);
    }

    function formatCountdown(ms) {
        if (ms < 0) return "--:--";
        const totalSec = Math.ceil(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return h + " h " + String(m).padStart(2, "0") + " min";
        return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }

    // Week view: today + the next 6 days, each with all six times.
    function renderWeek() {
        if (!payload || !weekBodyEl) return;
        const now = new Date();
        const locale = currentLocale();
        const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
        const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
        const blocks = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
            const row = findDayRow(d);
            let times = "";
            if (row) {
                TABLE_PRAYERS.forEach((name) => {
                    if (!row[name]) return;
                    const isInfo = name === "shuruk";
                    times += '<div class="bonetider-week-row' + (isInfo ? " bonetider-week-row--info" : "") + '">' +
                        "<span>" + t("bonetider." + name, name) + "</span>" +
                        '<span class="bonetider-week-time">' + row[name] + "</span></div>";
                });
            } else {
                times = '<div class="bonetider-week-row"><span>' + t("bonetider.loading", "…") + "</span></div>";
            }
            blocks.push(
                '<div class="bonetider-week-day' + (i === 0 ? " bonetider-week-day--today" : "") + '">' +
                '<div class="bonetider-week-day-header"><span>' + dayFmt.format(d) + "</span>" +
                '<span class="bonetider-week-day-date">' + dateFmt.format(d) + "</span></div>" +
                times + "</div>"
            );
        }
        weekBodyEl.innerHTML = blocks.join("");
    }

    function findDayRow(d) {
        const month = String(d.getMonth() + 1);
        const year = d.getFullYear();
        const day = d.getDate();
        const search = (m) => {
            if (!m || !Array.isArray(m.days)) return null;
            if (String(m.month) !== month || m.year !== year) return null;
            return m.days.find((row) => row.day === day) || null;
        };
        return search(payload) || search(payload.next);
    }

    function updateClock() {
        const now = new Date();
        clockEl.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map((n) => String(n).padStart(2, "0"))
            .join(":");
        // Midnight rollover: re-render for the new day and refresh the
        // backend data (also picks up month rollovers).
        const key = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
        if (todayKey && todayKey !== key) {
            renderDates();
            renderTable();
            renderWeek();
            recomputeNow();
            refreshFromServer();
        }
        todayKey = key;
    }

    function onLanguageChanged() {
        renderDates();
        renderTable();
        renderWeek();
        recomputeNow();
    }

    /* --- init ----------------------------------------------------------- */

    function showFallback() {
        widgetEl.classList.add("d-none");
        fallbackEl.classList.remove("d-none");
    }

    function showWidget() {
        widgetEl.classList.remove("d-none");
        fallbackEl.classList.add("d-none");
    }

    function init() {
        const hasCache = loadWarmCache(); // renders instantly when valid
        if (!hasCache && loadingEl) loadingEl.classList.remove("d-none");

        refreshFromServer();

        updateClock();
        setInterval(() => {
            updateClock();
            if (payload) recomputeNow();
        }, 1000);

        window.addEventListener("languageChanged", onLanguageChanged);

        const weekModal = document.getElementById("bt-week-modal");
        if (weekModal) {
            weekModal.addEventListener("show.bs.modal", renderWeek);
        }
    }

    init();
})();
