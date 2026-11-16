// MangaTime source script (mangatime.org). Public tRPC API at /api/trpc (no account needed).
// The site itself labels every work: manga / manhwa / manhua / webtoon / comic (novels are excluded).
// Premium chapters the reader cannot open are hidden and appear once the site makes them free.
var source = {
  id: "mangatime",
  name: "مانجا تايم",
  lang: "ar",
  baseUrl: "https://mangatime.org",
  version: 1
};

var API = "https://mangatime.org/api/trpc/";
var PAGE = 24;   // the feed allows up to 50 per page

function trpc(proc, input) {
  var url = API + proc + "?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": { json: input } }));
  var r = fetch(url, { headers: { "Accept": "application/json", "X-MT-Platform": "web" } });
  if (r.status !== 200) throw new Error("HTTP " + r.status + " for " + proc);
  var d = JSON.parse(r.text)[0];
  if (d.error) throw new Error("API: " + (d.error.json && d.error.json.message || "error").toString().slice(0, 120));
  return d.result.data.json;
}

// The site's own type -> app type. Anything not one of these five is not shown (e.g. novels).
function mapType(t) {
  t = (t || "").toString().toLowerCase();
  if (t === "manga" || t === "manhwa" || t === "manhua" || t === "webtoon" || t === "comic") return t;
  return "";
}

function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return source.baseUrl + (u.charAt(0) === "/" ? "" : "/") + u;
}

// Work page: https://mangatime.org/{type}/{slug}   Chapter: https://mangatime.org/{type}/{slug}/chapter/{n}
function workUrl(type, slug) { return source.baseUrl + "/" + (type || "manhwa") + "/" + slug; }
function chapterUrl(type, slug, n) { return workUrl(type, slug) + "/chapter/" + n; }

function slugFromUrl(url) {
  var m = /mangatime\.org\/[a-z]+\/([^\/?#]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}
function chapterNoFromUrl(url) {
  var m = /\/chapter\/([0-9.]+)/.exec(url || "");
  return m ? parseFloat(m[1]) : NaN;
}

function cardOf(s) {
  var type = mapType(s.type);
  var rc = s.recentChapters || [];
  var latest = [];
  for (var i = 0; i < rc.length; i++) {
    latest.push({
      number: rc[i].number,
      url: chapterUrl(type, s.slug, rc[i].number),
      dateText: rc[i].publishedAt || ""
    });
  }
  if (!latest.length && s.latestChapter) {
    latest.push({ number: s.latestChapter.number, url: chapterUrl(type, s.slug, s.latestChapter.number), dateText: s.latestChapter.releasedAt || "" });
  }
  latest.sort(function (a, b) { return b.number - a.number; });
  return {
    title: (s.title || s.nameEn || s.nameAr || "").trim(),
    url: workUrl(type, s.slug),
    slug: s.slug,
    postId: String(s.id),
    cover: abs(s.coverUrl),
    type: type,
    latest: latest
  };
}

function keepable(card) { return card.type !== ""; }

// "Latest chapters": the site's own latest-releases feed, newest first.
function latest(page) {
  var d = trpc("homepage.getLatestReleases", { limit: PAGE, page: page });
  var items = [];
  for (var i = 0; i < (d.items || []).length; i++) {
    var c = cardOf(d.items[i]);
    if (keepable(c)) items.push(c);
  }
  return { items: items, hasMore: d.hasMore === true };
}

// Library search: the site caps a search at 100 results and has no paging, so a search returns its best matches.
function search(query, page) {
  if (page > 1) return { items: [], hasMore: false };
  var d = trpc("content.search", { query: query, limit: 100, sortBy: "relevance" });
  var res = d.results || [];
  var items = [];
  for (var i = 0; i < res.length; i++) {
    var s = res[i].series;
    if (!s || res[i].isBlocked) continue;
    var type = mapType(s.type);
    if (!type) continue;
    items.push({
      title: (s.title || s.nameEn || s.nameAr || "").trim(),
      url: workUrl(type, s.slug),
      slug: s.slug,
      postId: String(s.id),
      cover: abs(s.coverUrl),
      type: type,
      latest: s.latestChapter ? [{ number: s.latestChapter, url: chapterUrl(type, s.slug, s.latestChapter), dateText: s.updatedAt || "" }] : []
    });
  }
  return { items: items, hasMore: false };
}

// Browsing the whole library uses the same paged feed (about 76 pages, newest update first).
function popular(page) { return latest(page); }

function details(url) {
  var slug = slugFromUrl(url);
  if (!slug) throw new Error("bad url " + url);
  var d = trpc("content.getSeriesBySlug", { slug: slug });
  var genres = [];
  for (var i = 0; i < (d.genres || []).length; i++) if (d.genres[i].name) genres.push(d.genres[i].name);
  return {
    title: (d.title || d.nameEn || "").trim(),
    cover: abs(d.coverUrl),
    description: (d.description || "").replace(/\s+/g, " ").trim(),
    genres: genres,
    type: mapType(d.type),
    author: (d.author || "").trim(),
    artist: (d.artist || "").trim(),
    status: (d.status || "").toString().toLowerCase(),
    mangaId: String(d.id),
    postId: String(d.id)
  };
}

function meta(url) {
  var d = details(url);
  return { genres: d.genres, type: d.type, author: d.author, artist: d.artist, status: d.status, title: d.title, cover: d.cover };
}

// Chapters the reader can open now. Premium chapters that are still locked are skipped.
function chapters(url, mangaId) {
  var slug = slugFromUrl(url);
  var typ = (/mangatime\.org\/([a-z]+)\//.exec(url) || [])[1] || "manhwa";
  if (!mangaId) mangaId = details(url).mangaId;
  if (!mangaId) throw new Error("series id not found");
  var d = trpc("content.getChapters", { seriesId: mangaId, limit: 2000 });
  var out = [];
  var seen = {};
  var list = d.chapters || [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.isBlocked === true) continue;
    if (c.isPremium === true && c.isUnlocked !== true) continue;
    if (c.format && c.format !== "images") continue;
    var n = typeof c.number === "number" ? c.number : parseFloat(c.number);
    if (isNaN(n) || seen[n]) continue;
    seen[n] = true;
    out.push({
      number: n,
      title: (c.title || "").trim(),
      url: chapterUrl(typ, slug, n),
      dateText: c.publishedAt || c.createdAt || ""
    });
  }
  return out;
}

function pages(chapterUrlStr) {
  var slug = slugFromUrl(chapterUrlStr);
  var n = chapterNoFromUrl(chapterUrlStr);
  if (!slug || isNaN(n)) throw new Error("bad chapter url");
  var d = trpc("content.getChapterPagesWeb", { seriesSlug: slug, chapterNumber: n });
  if (d.isPremium === true && d.isUnlocked !== true) return [];
  var out = [];
  var p = d.pages || [];
  for (var i = 0; i < p.length; i++) if (p[i]) out.push(abs(p[i]));
  return out;
}
