/**
 * TV Slides API — returns thumbnail URLs for every slide.
 *
 * REQUIRED SETUP (2 clicks in GAS editor):
 *   1. In the left sidebar, click the "Services" ⊕ button
 *   2. Find "Google Slides API" (identifier: Slides, version: v1) → Add
 *   3. Save (Ctrl+S), then Deploy → New deployment → Web app
 *
 * Script properties:
 *   TV_PRESENTATION_ID = the presentation ID from the URL
 */

var CACHE_KEY_ = 'tv_slides_v5';
var CACHE_TTL_SECONDS_ = 5 * 60;

function doGet(e) {
  try {
    var presentationId = PropertiesService.getScriptProperties().getProperty('TV_PRESENTATION_ID');
    if (!presentationId) {
      return json_({ ok: false, error: 'TV_PRESENTATION_ID not configured' });
    }

    var presentation = SlidesApp.openById(presentationId);
    var apiSlides = presentation.getSlides();
    if (apiSlides.length === 0) {
      return json_({ ok: false, error: 'Presentation has zero slides' });
    }

    var slides = [];
    for (var i = 0; i < apiSlides.length; i++) {
      try {
        var thumbnail = Slides.Presentations.Pages.getThumbnail(
          presentationId,
          apiSlides[i].getObjectId(),
          { 'thumbnailProperties.thumbnailSize': 'LARGE' }
        );
        slides.push({
          index: i,
          contentUrl: thumbnail.contentUrl,
          width: thumbnail.width || 0,
          height: thumbnail.height || 0
        });
      } catch (err) {
        slides.push({
          index: i,
          error: String(err)
        });
      }
    }

    var validSlides = slides.filter(function(s) { return !!s.contentUrl; });

    var data = {
      slides: slides,
      validCount: validSlides.length,
      totalCount: apiSlides.length,
      fetchedAt: new Date().toISOString()
    };

    var cache = CacheService.getScriptCache();
    cache.put(CACHE_KEY_, JSON.stringify(data), CACHE_TTL_SECONDS_);

    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
