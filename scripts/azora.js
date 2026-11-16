// Azora source script (azorafly.com). Public JSON API at api.azorafly.com (no auth).
// Host API provided by the app: fetch(url, opts) -> {status, text, url}, parseHtml(html), log(msg)
// Locked (paid) chapters are NEVER returned: they appear in the app only once the site makes them free.
var source = {
  id: "azora",
  name: "أزورا",
  lang: "ar",
  baseUrl: "https://azorafly.com",
  version: 3
};

var API = "https://api.azorafly.com/api";

// The site's own seriesType is NOT reliable: it says MANHWA for almost everything (about 1 in 6 are really manga, manhua,
// webtoon or comics). So the type is only shown when it is confirmed, otherwise it stays unknown (no guessing):
//   1) a verified map (slug -> type) built from MangaTime, which labels every work with its real type; or
//   2) an explicit type tag the work itself carries (مانها / مانجا / مانهوا / ويبتون / كوميكس).
var TYPE_MAP_URL = "https://raw.githubusercontent.com/hamiddsnan999-a11y/mangablack-sources/main/scripts/azora_types.json";
var _typeMap = null;
function typeMap() {
  if (_typeMap) return _typeMap;
  try {
    var r = fetch(TYPE_MAP_URL);
    _typeMap = r.status === 200 ? JSON.parse(r.text) : {};
  } catch (e) { _typeMap = {}; }
  return _typeMap;
}
var TAG_TYPES = { "مانجا": "manga", "مانها": "manhua", "مانهوا": "manhwa", "ويبتون": "webtoon", "كوميكس": "comic", "كومكس": "comic" };
function typeFromTags(genres) {
  var found = {};
  var n = 0;
  for (var i = 0; i < (genres || []).length; i++) {
    var t = TAG_TYPES[((genres[i].name || genres[i]) + "").trim()];
    if (t && !found[t]) { found[t] = true; n++; }
  }
  if (n !== 1) return "";
  for (var k in found) return k;
  return "";
}
// A work tagged both a country type and "ويبتون" (a format, not an origin): the country type wins.
function resolveType(slug, genres) {
  var m = typeMap()[slug];
  if (m) return m;
  var names = [];
  for (var i = 0; i < (genres || []).length; i++) names.push(((genres[i].name || genres[i]) + "").trim());
  var origin = [];
  for (var j = 0; j < names.length; j++) if (names[j] === "مانجا" || names[j] === "مانها" || names[j] === "مانهوا") origin.push(TAG_TYPES[names[j]]);
  var uniq = origin.filter(function (v, i2) { return origin.indexOf(v) === i2; });
  if (uniq.length === 1) return uniq[0];
  if (uniq.length === 0) return typeFromTags(genres);
  return "";
}

function getJson(url) {
  var r = fetch(url, { headers: { "Accept": "application/json" } });
  if (r.status !== 200) throw new Error("HTTP " + r.status + " for " + url);
  return JSON.parse(r.text);
}

function workUrl(slug) { return source.baseUrl + "/series/" + slug; }
function chapterUrl(slug, chapterSlug) { return source.baseUrl + "/series/" + slug + "/" + chapterSlug; }

// "/series/{slug}" or "/series/{slug}/{chapter}" -> slug
function slugFromUrl(url) {
  var m = /\/series\/([^\/?#]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}
function chapterSlugFromUrl(url) {
  var m = /\/series\/[^\/?#]+\/([^\/?#]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}

// Only the newest chapters that are open to everyone are shown on cards.
function openChapters(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    if (c.isLocked === true || c.isAccessible === false) continue;
    out.push(c);
  }
  return out;
}

function cardOf(p) {
  var latest = [];
  var open = openChapters(p.chapters);
  for (var i = 0; i < open.length; i++) {
    var c = open[i];
    latest.push({
      number: typeof c.number === "number" ? c.number : parseFloat(c.number),
      url: chapterUrl(p.slug, c.slug),
      dateText: c.createdAt || ""
    });
  }
  // newest first
  latest.sort(function (a, b) { return b.number - a.number; });
  return {
    title: (p.postTitle || "").trim(),
    url: workUrl(p.slug),
    slug: p.slug,
    postId: String(p.id),
    cover: p.featuredImage || "",
    type: resolveType(p.slug, p.genres),
    latest: latest
  };
}

function listPage(page, extra) {
  var url = API + "/query?perPage=24&page=" + page + (extra || "");
  var d = getJson(url);
  var posts = d.posts || [];
  var items = [];
  for (var i = 0; i < posts.length; i++) {
    // novels are text, not images: the app reader can't show them
    if (posts[i].seriesType === "NOVEL") continue;
    items.push(cardOf(posts[i]));
  }
  var total = d.totalCount || 0;
  return { items: items, hasMore: page * 24 < total };
}

// Archive (most recent first as the site orders it)
function popular(page) { return listPage(page, ""); }

// "Latest chapters": the site's query already returns works ordered by newest chapter first.
function newestMs(card) {
  var t = card.latest.length ? Date.parse(card.latest[0].dateText) : 0;
  return isNaN(t) ? 0 : t;
}

// "Latest chapters": the site's own order counts LOCKED (paid) chapters too, so the first pages would be works whose
// newest chapter we hide. We read the first LATEST_PAGES pages, keep works that have an open chapter, order them by
// the real date of their newest OPEN chapter, then page the result for the app.
var LATEST_PAGES = 8;
var LATEST_PAGE_SIZE = 24;
function latest(page) {
  var all = [];
  var seen = {};
  for (var p = 1; p <= LATEST_PAGES; p++) {
    var r;
    try { r = listPage(p, "&orderBy=lastChapterAddedAt&order=desc"); } catch (e) { if (p === 1) throw e; break; }
    for (var i = 0; i < r.items.length; i++) {
      var c = r.items[i];
      if (seen[c.postId] || !c.latest.length) continue;
      seen[c.postId] = true;
      all.push(c);
    }
    if (!r.hasMore) break;
  }
  all.sort(function (a, b) { return newestMs(b) - newestMs(a); });
  var from = (page - 1) * LATEST_PAGE_SIZE;
  return { items: all.slice(from, from + LATEST_PAGE_SIZE), hasMore: from + LATEST_PAGE_SIZE < all.length };
}

function search(query, page) {
  return listPage(page, "&searchTerm=" + encodeURIComponent(query));
}

function stripHtml(h) {
  return (h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function genreNames(g) {
  var out = [];
  for (var i = 0; i < (g || []).length; i++) {
    var n = (g[i].name || "").trim();
    if (n) out.push(n);
  }
  return out;
}

function details(url) {
  var slug = slugFromUrl(url);
  if (!slug) throw new Error("bad url " + url);
  var d = getJson(API + "/post?postSlug=" + encodeURIComponent(slug));
  var p = d.post || d;
  var status = (p.seriesStatus || "").toString().toLowerCase();
  return {
    title: (p.postTitle || "").trim(),
    cover: p.featuredImage || "",
    description: stripHtml(p.postContent),
    genres: genreNames(p.genres),
    type: resolveType(p.slug, p.genres),
    author: (p.author || "").trim(),
    artist: (p.artist || "").trim(),
    status: status,
    mangaId: String(p.id),
    postId: String(p.id)
  };
}

// Light call used to classify many works fast.
function meta(url) {
  var d = details(url);
  return { genres: d.genres, type: d.type, author: d.author, artist: d.artist, status: d.status, title: d.title, cover: d.cover };
}

// Only chapters open to everyone. Locked (paid) chapters are skipped and show up once the site opens them.
function chapters(url, mangaId) {
  var slug = slugFromUrl(url);
  if (!mangaId) mangaId = details(url).mangaId;
  if (!mangaId) throw new Error("post id not found");
  var out = [];
  var seen = {};
  var page = 1;
  while (page <= 30) {
    var d = getJson(API + "/chapters?postId=" + mangaId + "&perPage=100&page=" + page);
    var list = (d.post && d.post.chapters) || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.isLocked === true || c.isAccessible === false || c.isPermanentlyLocked === true) continue;
      var no = typeof c.number === "number" ? c.number : parseFloat(c.number);
      if (isNaN(no) || seen[c.slug]) continue;
      seen[c.slug] = true;
      out.push({
        number: no,
        title: (c.title || "").trim(),
        url: chapterUrl(slug, c.slug),
        dateText: c.createdAt || ""
      });
    }
    if (list.length < 100) break;
    page++;
  }
  return out;
}

function pages(chapterUrlStr) {
  var slug = slugFromUrl(chapterUrlStr);
  var cs = chapterSlugFromUrl(chapterUrlStr);
  if (!slug || !cs) throw new Error("bad chapter url");
  var d = getJson(API + "/chapter?mangaslug=" + encodeURIComponent(slug) + "&chapterslug=" + encodeURIComponent(cs));
  var ch = d.chapter || {};
  if (ch.isLocked === true || ch.isAccessible === false) return [];
  var imgs = (ch.images || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  var out = [];
  for (var i = 0; i < imgs.length; i++) if (imgs[i].url) out.push(imgs[i].url);
  return out;
}
