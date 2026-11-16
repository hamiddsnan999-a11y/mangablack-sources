// مانجاتك source script (https://mangatuk.com, Next.js site that embeds its data as JSON in the page). Verified against the live site.
// Host API: fetch(url, opts) -> {status, text, url}, parseHtml(html), log(msg)
var source = {
  id: "mangatuk",
  name: "مانجاتك",
  lang: "ar",
  baseUrl: "https://mangatuk.com",
  version: 2
};

var SERIES = "series";   // path segment of a work page, e.g. "series"
var CHAPTER = "chapter-{n}"; // chapter url style: "chapter-{n}" (appended after the work url)

function abs(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("/") === 0) return source.baseUrl + u;
  return u;
}

// Next.js streams page data as self.__next_f.push([1,"..."]) string chunks; joined and unescaped they hold plain JSON.
function flight(html) {
  var out = "";
  var re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  var m;
  while ((m = re.exec(html)) !== null) out += m[1];
  return out.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
}

// Reads the balanced JSON array/object that starts right after `key` (e.g. '"chapters":').
function jsonAfter(text, key, from) {
  var i = text.indexOf(key, from || 0);
  if (i < 0) return null;
  var j = i + key.length;
  var open = text.charAt(j);
  var close = open === "[" ? "]" : open === "{" ? "}" : "";
  if (!close) return null;
  var depth = 0, inStr = false, esc = false;
  for (var k = j; k < text.length; k++) {
    var c = text.charAt(k);
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(text.substring(j, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}

function getHtml(url) {
  var r = fetch(url);
  if (r.status !== 200) throw new Error("HTTP " + r.status + " for " + url);
  return r.text;
}

// Only the site's own type word is mapped; anything else is "" (the app shows "غير معروف").
function cleanType(t) {
  t = (t || "").trim().toLowerCase();
  if (t === "manga" || t === "مانجا") return "manga";
  if (t === "manhwa" || t === "مانهوا") return "manhwa";
  if (t === "manhua" || t === "مانها") return "manhua";
  if (t === "webtoon" || t === "ويبتون") return "webtoon";
  if (t === "comic" || t === "comics" || t === "كوميكس") return "comic";
  return "";
}

function statusAr(s) {
  s = (s || "").toLowerCase();
  if (s === "ongoing") return "مستمرة";
  if (s === "completed" || s === "finished") return "مكتملة";
  if (s === "hiatus") return "متوقفة";
  if (s === "cancelled" || s === "canceled" || s === "dropped") return "ملغاة";
  return s;
}

function cardOf(o) {
  return {
    title: o.title || "",
    url: source.baseUrl + "/" + SERIES + "/" + o.slug,
    slug: o.slug,
    postId: "",
    cover: abs(o.coverImage || ""),
    type: cleanType(o.type),
    latest: []
  };
}

// Series objects embedded in a page: {"id":"...","slug":"...","title":"...", ... "type":"...","coverImage":"..."}.
// Each object is read up to the start of the next one, because long descriptions push type/cover far from the title.
function seriesIn(text) {
  var out = [], seen = {}, starts = [];
  var re = /\{"id":"[^"]+","slug":"([^"]+)","title":"((?:[^"\\]|\\.)*)"/g;
  var m;
  while ((m = re.exec(text)) !== null) starts.push({ at: m.index, slug: m[1], title: m[2] });
  for (var i = 0; i < starts.length; i++) {
    var st = starts[i];
    if (seen[st.slug]) continue;
    var end = i + 1 < starts.length ? starts[i + 1].at : st.at + 12000;
    var chunk = text.substring(st.at, Math.min(end, st.at + 12000));
    var ty = /"type":"([a-z]*)"/.exec(chunk);
    var cv = /"coverImage":"([^"]*)"/.exec(chunk);
    seen[st.slug] = true;
    out.push({ slug: st.slug, title: st.title.replace(/\\"/g, '"'), type: ty ? ty[1] : "", coverImage: cv ? cv[1] : "" });
  }
  return out;
}

// The site's own sitemap lists every work, newest first. Used for browsing beyond the home page.
function sitemapSlugs() {
  var r = fetch(source.baseUrl + "/sitemaps/series/0");
  if (r.status !== 200) return [];
  var out = [];
  var re = new RegExp("<loc>" + source.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/" + SERIES + "/([^<]+)</loc>", "g");
  var m;
  while ((m = re.exec(r.text)) !== null) out.push(m[1]);
  return out;
}

var PAGE = 6;

// Browsing: page 1 comes from the home page (full cards); later pages from the sitemap (one lightweight call per work).
function popular(page) {
  if (page <= 1) {
    var items = seriesIn(flight(getHtml(source.baseUrl + "/"))).map(cardOf);
    return { items: items, hasMore: true };
  }
  var slugs = sitemapSlugs();
  var from = (page - 1) * PAGE, part = slugs.slice(from, from + PAGE);
  var items2 = [];
  for (var i = 0; i < part.length; i++) {
    try {
      var s = seriesIn(flight(getHtml(source.baseUrl + "/" + SERIES + "/" + part[i])))[0];
      if (s) items2.push(cardOf(s));
    } catch (e) {}
  }
  return { items: items2, hasMore: from + PAGE < slugs.length };
}

function latest(page) { return popular(page); }

// The site has no public search endpoint, so search matches the query against the work names in its sitemap slugs.
function search(query, page) {
  var q = (query || "").trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-+|-+$/g, "");
  if (!q) return { items: [], hasMore: false };
  var hits = sitemapSlugs().filter(function (s) { return s.toLowerCase().indexOf(q) >= 0; });
  var from = (page - 1) * PAGE, part = hits.slice(from, from + PAGE);
  var items = [];
  for (var i = 0; i < part.length; i++) {
    try {
      var s = seriesIn(flight(getHtml(source.baseUrl + "/" + SERIES + "/" + part[i])))[0];
      if (s) items.push(cardOf(s));
    } catch (e) {}
  }
  return { items: items, hasMore: from + PAGE < hits.length };
}

function seriesObject(text, slug) {
  var i = text.indexOf('"slug":"' + slug + '"');
  if (i < 0) return null;
  var start = text.lastIndexOf('{"id":"', i);
  var seg = text.substr(start, 6000);
  function f(k) { var m = new RegExp('"' + k + '":("(?:[^"\\\\]|\\\\.)*"|null)').exec(seg); if (!m || m[1] === "null") return ""; try { return JSON.parse(m[1]); } catch (e) { return m[1].replace(/"/g, ""); } }
  return { title: f("title"), description: f("description"), author: f("author"), status: f("status"), type: f("type"), coverImage: f("coverImage") };
}

function slugFromUrl(url) {
  var m = new RegExp("/" + SERIES + "/([^/?#]+)").exec(url || "");
  return m ? m[1] : "";
}

function details(url) {
  var slug = slugFromUrl(url);
  var text = flight(getHtml(abs(url)));
  var s = seriesObject(text, slug) || {};
  var assoc = "";
  return {
    title: s.title || "",
    cover: abs(s.coverImage || ""),
    description: (s.description || "").replace(/\s+/g, " ").trim(),
    genres: [],
    type: cleanType(s.type),
    author: s.author || "", artist: "", status: statusAr(s.status),
    mangaId: slug,
    postId: slug
  };
}

function meta(url) {
  var d = details(url);
  return { genres: d.genres, type: d.type, author: d.author, artist: d.artist, status: d.status, title: d.title, cover: d.cover };
}

// Chapters are embedded in the work page. Locked (coin) and unpublished chapters are skipped. Newest first.
function chapters(url, mangaId) {
  var slug = slugFromUrl(url);
  var text = flight(getHtml(abs(url)));
  var arr = jsonAfter(text, '"chapters":') || [];
  var now = Date.now();
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var c = arr[i];
    if (c.deletedAt) continue;
    // فصول إعلانية وهمية (مثل رقم 100000 "طريقة فتح الفصول المقفولة") ليست فصولاً حقيقية
    var numChk = parseFloat(c.number);
    if (isNaN(numChk) || numChk < 0 || numChk >= 10000) continue;
    if (c.coinValue && c.coinValue > 0) {
      var s = c.coinLockStartsAt ? Date.parse(c.coinLockStartsAt) : 0, e = c.coinLockEndsAt ? Date.parse(c.coinLockEndsAt) : 0;
      if (!s || s <= now) { if (!e || e > now) continue; }
    }
    var pub = c.publishedAt || c.createdAt;
    out.push({
      number: parseFloat(c.number),
      title: (c.title && String(c.title).trim()) ? String(c.title).trim() : "الفصل " + c.number,
      url: source.baseUrl + "/" + SERIES + "/" + slug + "/" + (c.slug && /^chapter-/.test(c.slug) ? c.slug : "chapter-" + c.number),
      dateText: pub ? pub : ""
    });
  }
  out.sort(function (a, b) { return b.number - a.number; });
  return out;
}

function pages(chapterUrl) {
  var text = flight(getHtml(abs(chapterUrl)));
  var arr = jsonAfter(text, '"pages":') || [];
  var out = [];
  arr.sort(function (a, b) { return a.number - b.number; });
  for (var i = 0; i < arr.length; i++) if (arr[i].imageUrl) out.push(abs(arr[i].imageUrl));
  return out;
}

// ISO timestamps ("2026-11-15T17:54:39.694Z") are parsed exactly.
function parseDate(text) {
  var t = (text || "").trim();
  if (!t) return 0;
  var ms = Date.parse(t);
  return isNaN(ms) ? 0 : ms;
}
