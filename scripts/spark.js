// Spark Manga source script. Selectors verified against real HTML from sparkmanga.net.
// Host API provided by the app: fetch(url, opts) -> {status, text, url}, parseHtml(html) -> Document-like, log(msg)
var source = {
  id: "spark",
  name: "سبارك مانجا",
  lang: "ar",
  baseUrl: "https://sparkmanga.net",
  version: 1
};

var AR_MONTHS = {
  "يناير":0,"فبراير":1,"مارس":2,"أبريل":3,"ابريل":3,"مايو":4,"يونيو":5,
  "يوليو":6,"أغسطس":7,"اغسطس":7,"سبتمبر":8,"أكتوبر":9,"اكتوبر":9,"نوفمبر":10,"ديسمبر":11
};

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
  var s = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || "";
  // prefer the largest candidate from srcset
  var ss = img.attr("srcset");
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
  // relative: "ساعتين ago", "3 ساعات ago", "14 ساعة ago", "دقيقتين", "يوم", ...
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
  // absolute: "8 نوفمبر، 2026"
  m = /(\d{1,2})\s+([^\s،,\d]+)[،,]?\s+(\d{4})/.exec(t);
  if (m && AR_MONTHS.hasOwnProperty(m[2])) {
    return Date.UTC(parseInt(m[3]), AR_MONTHS[m[2]], parseInt(m[1]), 12, 0, 0);
  }
  return 0;
}

function chapterNumberOf(text, url) {
  var t = (text || "").replace(/\s+/g, " ").trim();
  var m = /(\d+(?:\.\d+)?)/.exec(t);
  if (m) return parseFloat(m[1]);
  m = /\/(\d+(?:[.-]\d+)?)\/?$/.exec(url || "");
  if (m) return parseFloat(m[1].replace("-", "."));
  return -1;
}

function parseCards(doc, sel) {
  var out = [];
  var seen = {};
  doc.select(sel).forEach(function (card) {
    var a = card.selectFirst(".post-title h3 a") || card.selectFirst(".post-title a");
    if (!a) return;
    var url = abs(a.attr("href"));
    var slug = slugOf(url);
    if (!slug || seen[slug]) return;
    seen[slug] = true;
    var thumb = card.selectFirst(".item-thumb");
    var postId = thumb ? (thumb.attr("data-post-id") || "") : "";
    var latest = [];
    card.select(".list-chapter .chapter-item").forEach(function (ci) {
      var ca = ci.selectFirst(".chapter a");
      if (!ca) return;
      var curl = abs(ca.attr("href"));
      var dateEl = ci.selectFirst(".post-on");
      var dtxt = "";
      if (dateEl) {
        var ta = dateEl.selectFirst("a[title]");
        dtxt = ta ? ta.attr("title") : dateEl.text();
      }
      latest.push({ number: chapterNumberOf(ca.text(), curl), url: curl, dateText: (dtxt || "").trim() });
    });
    out.push({
      title: a.text().trim(),
      url: url,
      slug: slug,
      postId: postId,
      cover: coverOf(card.selectFirst("img")),
      latest: latest
    });
  });
  return out;
}

function getDoc(url) {
  var r = fetch(url);
  if (r.status !== 200) throw new Error("HTTP " + r.status + " for " + url);
  return parseHtml(r.text);
}

// Archive listing, newest first.
function popular(page) {
  var doc = getDoc(source.baseUrl + "/manga/page/" + page + "/");
  var items = parseCards(doc, ".page-item-detail");
  return { items: items, hasMore: items.length >= 10 };
}

// Home "latest chapters" section (cards with their newest chapters and dates).
function latest(page) {
  var url = page > 1 ? source.baseUrl + "/page/" + page + "/" : source.baseUrl + "/";
  var doc = getDoc(url);
  var items = parseCards(doc, ".page-item-detail");
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
    items.push({ title: a.text().trim(), url: u, slug: slug, postId: "", cover: coverOf(card.selectFirst("img")), latest: [] });
  });
  return { items: items, hasMore: items.length >= 10 };
}

function details(url) {
  var r = fetch(abs(url));
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  var doc = parseHtml(r.text);
  var title = doc.selectFirst(".post-title h1");
  var genres = [];
  doc.select(".genres-content a").forEach(function (g) { genres.push(g.text().trim()); });
  var author = "", artist = "", status = "", type = "";
  doc.select(".post-content_item").forEach(function (it) {
    var h = it.selectFirst(".summary-heading");
    var c = it.selectFirst(".summary-content");
    if (!h || !c) return;
    var k = h.text().replace(/\s+/g, " ").trim();
    var v = c.text().replace(/\s+/g, " ").trim();
    if (/المؤلف|Author/i.test(k)) author = v;
    else if (/الرسام|Artist/i.test(k)) artist = v;
    else if (/الحالة|Status/i.test(k)) status = v;
    else if (/النوع|Type/i.test(k)) type = v;
  });
  var holder = doc.selectFirst("#manga-chapters-holder");
  var mangaId = holder ? holder.attr("data-id") : "";
  if (!mangaId) {
    var m = /"manga_id"\s*:\s*"?(\d+)/.exec(r.text);
    if (m) mangaId = m[1];
  }
  var desc = doc.selectFirst(".summary__content");
  return {
    title: title ? title.text().trim() : "",
    cover: coverOf(doc.selectFirst(".summary_image img")),
    description: desc ? desc.text().replace(/\s+/g, " ").trim() : "",
    genres: genres,
    author: author, artist: artist, status: status, type: type,
    mangaId: mangaId,
    postId: mangaId
  };
}

// Chapters come from an AJAX endpoint. Newest first. Excludes the placeholder chapter (url ".../n-a/").
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
