// ────────────────────────────────────────────────────────────────
// Al-Salam Waqf Campaign — single source of truth
// Load this BEFORE js/main.js on every page that shows campaign
// numbers (homepage, /waqf, /stats, /admin, /donations).
// ────────────────────────────────────────────────────────────────
window.CAMPAIGN = {
  // Phase-1 fundraising goal (SEK) — first year of the 5-year,
  // 50 000 000 kr Folkets Hus purchase project.
  goal: 10000000,

  // Already collected when the Ramadan 2027 push started (live stats).
  baseline: 5600000,

  // Payment rails
  bankgiro: '5349 1643',
  swish: '1235000559',
  swishQR: '/img/swishwakfQR.png',

  // Stripe rails (reused from /donations)
  stripeOneTimeUrl: 'https://script.google.com/macros/s/AKfycbwz_fAOfZ_vuI7RlEzMt0i-jJtL8q-hOcAjRZrXND6otuV49mdIshBQ32oQjAIlRukL/exec',
  stripeMonthlyBuyButtonId: 'buy_btn_1S3O36G84lZUxh2hb3x1mP1b',
  stripePublishableKey: 'pk_live_51QOjFxG84lZUxh2hwRThSaug3j7zlPSL9Ts5OXxkOMw5KxHnvxusRgNIME8PtWpsFEGI9x2tSEvisU0269pHsNnm00kHzyvueL',

  // Live stats endpoints (Swish + Stripe)
  statsSwishUrl: 'https://script.google.com/macros/s/AKfycbxLXBaGS2rdrrvtFAxMGCAeK2elGSfbvRmjtxBhjbORf9gdHBHduzOXIzP2FCI501cMWA/exec',
  statsStripeUrl: 'https://script.google.com/macros/s/AKfycby4xd1YkqdDe-xvshIuMpj53wCLM9kUClwb84Qtx5amrPd6xrUjKjJxiYSdEppweq4/exec',

  // Ramadan 2027 dates (moon sighting may shift by ±1 day)
  ramadanStart: '2027-02-07',
  eid: '2027-03-09',

  // The building (Folkets Hus, Södergatan 65–67, Helsingborg)
  building: {
    address: 'Södergatan 65–67, 252 25 Helsingborg',
    areaSqm: 4887,
    totalBudget: 50000000,
    orgNr: '802513-6808'
  },

  // Donation tiers
  tiers: {
    squareMeter: 3000,   // "Adopt a square meter"
    foundingMember: 25000
  },

  links: {
    waqf: '/waqf/',
    donations: '/donations/',
    stats: '/stats/',
    milestone: '/admin/milestone.html',
    email: 'info@alsalamcenter.se',
    phone: '+46 73 739 54 90'
  }
};
