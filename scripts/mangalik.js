// Manga Lik source script (mangalik.net, Madara theme). Selectors verified against real HTML from the site.
// Host API provided by the app: fetch(url, opts) -> {status, text, url}, parseHtml(html), parseCardsFast(html, sel), log(msg)
var source = {
  id: "mangalik",
  name: "مانجا ليك",
  lang: "ar",
  baseUrl: "https://mangalik.net",
  version: 2
};

var AR_MONTHS = {
  "يناير":0,"فبراير":1,"مارس":2,"أبريل":3,"ابريل":3,"مايو":4,"يونيو":5,
  "يوليو":6,"أغسطس":7,"اغسطس":7,"سبتمبر":8,"أكتوبر":9,"اكتوبر":9,"نوفمبر":10,"ديسمبر":11
};


// The site writes the work type only in its genre archives (مانهوا / مانها / مانجا), not on work pages, and only for
// ~7% of its works. A prebuilt map (slug -> type) lives next to this script in the sources repo and is refreshed there.
var TYPE_MAP_URL = "https://raw.githubusercontent.com/hamiddsnan999-a11y/mangablack-sources/main/scripts/mangalik_types.json";
var _typeMap = null;
function typeMap() {
  if (_typeMap) return _typeMap;
  try {
    var r = fetch(TYPE_MAP_URL);
    _typeMap = r.status === 200 ? JSON.parse(r.text) : {};
  } catch (e) { _typeMap = {}; }
  return _typeMap;
}
function typeOfSlug(slug) {
  if (!slug) return "";
  var k = slug;
  try { k = decodeURIComponent(slug); } catch (e) {}
  return typeMap()[k.toLowerCase()] || "";
}

function abs(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("/") === 0) return source.baseUrl + u;
  return u;
}

function slugOf(url) {
  var m = /\/manga\/([^\/]+)\/?/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}

function coverOf(img) {
  if (!img) return "";
  return coverFrom(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || "", img.attr("srcset"));
}

function coverFrom(s, ss) {
  if (ss) {
    var best = "", bw = 0, parts = ss.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim().split(/\s+/);
      var w = parseInt(p[1]) || 0;
      if (p[0] && w >= bw) { bw = w; best = p[0]; }
    }
    if (best) s = best;
  }
  return abs(s);
}

// Converts the site's date text to epoch milliseconds. nowMs is injectable for testing.
function parseDate(text, nowMs) {
  var now = nowMs || Date.now();
  var t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return 0;
  var m;
  var rel = /(\d+)?\s*(ثانية|ثواني|دقيقة|دقيقتين|دقائق|ساعة|ساعتين|ساعات|يوم|يومين|أيام|ايام|أسبوع|اسبوع|أسبوعين|اسبوعين|أسابيع|اسابيع|شهر|شهرين|أشهر|اشهر|سنة|سنتين|سنوات)/.exec(t);
  if (/ago|منذ|قبل/.test(t) && rel) {
    var n = rel[1] ? parseInt(rel[1]) : 1;
    var u = rel[2];
    var mult;
    if (/^ثان/.test(u)) mult = 1000;
    else if (/^دقيق|^دقائق/.test(u)) mult = 60000;
    else if (/^ساع/.test(u)) mult = 3600000;
    else if (/^يوم|^أيام|^ايام/.test(u)) mult = 86400000;
    else if (/^أسبوع|^اسبوع|^أسابيع|^اسابيع/.test(u)) mult = 7 * 86400000;
    else if (/^شهر|^أشهر|^اشهر/.test(u)) mult = 30 * 86400000;
    else mult = 365 * 86400000;
    if (u === "دقيقتين" || u === "ساعتين" || u === "يومين" || u === "أسبوعين" || u === "اسبوعين" || u === "شهرين" || u === "سنتين") n = 2;
    return now - n * mult;
  }
  m = /(\d{1,2})\s+([^\s،,\d]+)[،,]?\s+(\d{4})/.exec(t);
  if (m && AR_MONTHS.hasOwnProperty(m[2])) {
    return Date.UTC(parseInt(m[3]), AR_MONTHS[m[2]], parseInt(m[1]), 12, 0, 0);
  }
  // Manga Lik prints "أكتوبر 28, 2026" (month first)
  m = /([^\s،,\d]+)\s+(\d{1,2})[،,]?\s+(\d{4})/.exec(t);
  if (m && AR_MONTHS.hasOwnProperty(m[1])) {
    return Date.UTC(parseInt(m[3]), AR_MONTHS[m[1]], parseInt(m[2]), 12, 0, 0);
  }
  return 0;
}

function chapterNumberOf(text, url) {
  var t = (text || "").replace(/\s+/g, " ").trim();
  var m = /(\d+(?:\.\d+)?)/.exec(t);
  if (m) return parseFloat(m[1]);
  var u = /\/(\d+(?:[.-]\d+)?)\/?$/.exec(url || "");
  if (u) return parseFloat(u[1].replace("-", "."));
  return -1;
}

// Cards parsed natively in one call (fast), then shaped for the app.
function parseCardsFromHtml(html, sel) {
  var raw = parseCardsFast(html, sel, source.baseUrl);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var c = raw[i];
    var latest = [];
    for (var j = 0; j < c.latest.length; j++) {
      var l = c.latest[j];
      latest.push({ number: chapterNumberOf(l.numText, l.url), url: l.url, dateText: l.dateText });
    }
    out.push({
      title: c.title, url: c.url, slug: c.slug, postId: c.postId,
      cover: coverFrom(c.imgSrc, c.imgSet),
      type: typeOfSlug(c.slug),
      latest: latest
    });
  }
  return out;
}

function getHtml(url) {
  var r = fetch(url);
  if (r.status !== 200) throw new Error("HTTP " + r.status + " for " + url);
  return r.text;
}

function getDoc(url) {
  return parseHtml(getHtml(url));
}

// Archive listing.
function popular(page) {
  var items = parseCardsFromHtml(getHtml(source.baseUrl + "/manga/page/" + page + "/"), ".page-item-detail");
  return { items: items, hasMore: items.length >= 10 };
}

// Home "latest chapters": cards with their newest chapters and dates.
function latest(page) {
  var url = page > 1 ? source.baseUrl + "/page/" + page + "/" : source.baseUrl + "/";
  var items = parseCardsFromHtml(getHtml(url), ".page-item-detail");
  return { items: items, hasMore: items.length >= 10 };
}

function search(query, page) {
  var url = source.baseUrl + (page > 1 ? "/page/" + page : "") + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
  var doc = getDoc(url);
  var items = [];
  var seen = {};
  doc.select(".c-tabs-item__content").forEach(function (card) {
    var a = card.selectFirst(".post-title h3 a") || card.selectFirst(".post-title a");
    if (!a) return;
    var u = abs(a.attr("href"));
    var slug = slugOf(u);
    if (!slug || seen[slug]) return;
    seen[slug] = true;
    items.push({ title: a.text().trim(), url: u, slug: slug, postId: "", cover: coverOf(card.selectFirst("img")), type: typeOfSlug(slug), latest: [] });
  });
  return { items: items, hasMore: items.length >= 10 };
}

// Maps the site's own type words to a clean type, or "" when the site gives none (the app then shows "غير معروف").
function cleanType(words) {
  for (var i = 0; i < words.length; i++) {
    var w = (words[i] || "").trim().toLowerCase();
    if (w === "manhwa" || w === "مانهوا" || w === "مانهوه") return "manhwa";
    if (w === "manhua" || w === "مانها") return "manhua";
    if (w === "manga" || w === "مانجا") return "manga";
  }
  return "";
}

function details(url) {
  var r = fetch(abs(url));
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  var doc = parseHtml(r.text);
  var title = doc.selectFirst(".post-title h1");
  var genres = [];
  doc.select(".genres-content a").forEach(function (g) { genres.push(g.text().trim()); });
  var author = "", artist = "", status = "", typeField = "";
  doc.select(".post-content_item").forEach(function (it) {
    var h = it.selectFirst(".summary-heading");
    var c = it.selectFirst(".summary-content");
    if (!h || !c) return;
    var k = h.text().replace(/\s+/g, " ").trim();
    var v = c.text().replace(/\s+/g, " ").trim();
    if (/المؤلف|الكاتب|Author/i.test(k)) author = v;
    else if (/الرسام|Artist/i.test(k)) artist = v;
    else if (/^(النوع|Type)$/i.test(k)) typeField = v;
    else if (/الحالة|Status/i.test(k) && !status) status = v;
  });
  if (/^(-|—|n\/a|unknown|غير معروف)?$/i.test(author)) author = "";
  if (/^(-|—|n\/a|unknown|غير معروف)?$/i.test(artist)) artist = "";
  var holder = doc.selectFirst("#manga-chapters-holder");
  var mangaId = holder ? holder.attr("data-id") : "";
  if (!mangaId) {
    var m = /"manga_id"\s*:\s*"?(\d+)/.exec(r.text);
    if (m) mangaId = m[1];
  }
  var desc = doc.selectFirst(".summary__content");
  // the site's explicit "النوع" field wins; otherwise the genre tags (مانهوا / مانها / مانجا); otherwise ""
  var type = cleanType([typeField]) || cleanType(genres) || typeOfSlug(slugOf(url));
  return {
    title: title ? title.text().trim() : "",
    cover: coverOf(doc.selectFirst(".summary_image img")),
    description: desc ? desc.text().replace(/\s+/g, " ").trim() : "",
    genres: genres,
    type: type,
    author: author, artist: artist, status: status,
    mangaId: mangaId,
    postId: mangaId
  };
}

// Light call used to classify many works fast: genres/type/status/author only.
function meta(url) {
  var d = details(url);
  return { genres: d.genres, type: d.type, author: d.author, artist: d.artist, status: d.status, title: d.title, cover: d.cover };
}

// Chapters come from an AJAX endpoint. Newest first. Excludes placeholder chapters (url ".../n-a/").
function chapters(url, mangaId) {
  if (!mangaId) {
    mangaId = details(url).mangaId;
  }
  if (!mangaId) throw new Error("manga id not found");
  var r = fetch(source.baseUrl + "/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: "action=manga_get_chapters&manga=" + mangaId
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  var doc = parseHtml(r.text);
  var out = [];
  var seen = {};
  doc.select("li.wp-manga-chapter").forEach(function (li) {
    var a = li.selectFirst("a");
    if (!a) return;
    var curl = abs(a.attr("href"));
    if (!curl || /\/n-a\/?$/.test(curl) || seen[curl]) return;
    seen[curl] = true;
    var dateEl = li.selectFirst(".chapter-release-date");
    var dtxt = "";
    if (dateEl) {
      var ta = dateEl.selectFirst("a[title]");
      dtxt = ta ? ta.attr("title") : dateEl.text();
    }
    out.push({
      number: chapterNumberOf(a.text(), curl),
      title: a.text().replace(/\s+/g, " ").trim(),
      url: curl,
      dateText: (dtxt || "").replace(/\s+/g, " ").trim()
    });
  });
  return out;
}

function pages(chapterUrl) {
  var doc = getDoc(abs(chapterUrl));
  var out = [];
  doc.select(".reading-content img.wp-manga-chapter-img").forEach(function (img) {
    var s = (img.attr("data-src") || img.attr("src") || "").trim();
    if (s) out.push(abs(s));
  });
  return out;
}
