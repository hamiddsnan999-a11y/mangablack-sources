/*
 * ============================================================================
 *  Azora Moon (azoramoon.com) — سكربت مصدر مستقل (azoramoon)
 * ============================================================================
 *  العقد (واجهة عامة لسكربتات المصادر):
 *    خمس دوال إلزامية: Scraper.scrapeHome / scrapeSearch / scrapeDetails /
 *                      scrapeChapters / scrapePages
 *    الشبكة عبر الجسر فقط:
 *      window.MangaBlackBridge.nativeHttpGet(url, headersJson) → HTML خام
 *      window.MangaBlackBridge.nativeHttpPost(url, body)
 *      window.MangaBlackBridge.postResult(json) / postError(msg)
 *    لا Jsoup ولا fetch — السكربت يحلل HTML بنفسه ويرجع JSON موحّد.
 *
 *  المحدّدات أدناه كلها مأخوذة من HTML حقيقي جُلب من الموقع (2026-11-16)
 *  واختُبرت على الصفحات المحفوظة — لا شيء مُخترع:
 *    ✔ h1[itemProp="name"]                         → العنوان
 *      (تحقّق: "A fortune-telling princess")
 *    ✔ [itemProp="description"] ثم og:description   → الوصف الخام
 *    ✔ [itemProp="genre"]                           → التصنيفات
 *      (تحقّق: كوميدي، شوجو، فنتازيا)
 *    ✔ meta[property="og:image"]                    → الغلاف
 *    ✔ meta[name="keywords"]                        → نوع العمل (manhwa/manga/manhua)
 *    ✔ flight data: slug:"chapter-N",number:N,title:"…"
 *                                                   → الفصول (44 فصلًا في العينة)
 *    ✔ storage.azorafly.com/upload/series/{slug}/{uuid}/page-NNNN_*.jpg
 *                                                   → صفحات الفصل بالترتيب
 *      (تحقّق على chapter-174: 15 صورة مباشرة ومرتّبة داخل HTML)
 *    ✘ الحالة / الكاتب / الرسّام                    → غير موجودة في الصفحة = null
 *      (لا تخمين — القاعدة: الغائب يبقى فارغًا)
 *
 *  حدود معروفة (غير مُتحقَّق):
 *    - /search?q= لا يرجع نتائج من الخادم (تحميل client-side) → قد يعود فارغًا.
 *    - قائمة الفصول تعود بأحدث ما يظهر في الصفحة الواحدة (~44)؛ ترقيم صفحات
 *      الفصول غير مكتشف في HTML الثابت.
 * ============================================================================
 */

var AZ = {
  baseUrl: "https://azoramoon.com",
  serverId: "azoramoon",
  headers: {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Referer": "https://azoramoon.com/",
    "Accept-Language": "ar,ar-SA;q=0.9,en;q=0.7"
  }
};

function AZ_get(url) {
  var body = window.MangaBlackBridge.nativeHttpGet(url, JSON.stringify(AZ.headers));
  return (body === null || body === undefined) ? "" : String(body);
}

function AZ_abs(u) {
  if (!u) return "";
  u = String(u).trim();
  if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return (u.charAt(0) === "/") ? AZ.baseUrl + u : AZ.baseUrl + "/" + u;
}

function AZ_slugOfUrl(u) {
  var s = String(u || "").split("?")[0].split("#")[0];
  s = s.replace(/\/+$/, "");
  var i = s.lastIndexOf("/");
  return i >= 0 ? s.substring(i + 1) : s;
}

function AZ_txt(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

/* ---- قائمة أعمال من أي صفحة عرض: كل <a href="/series/slug"> يجمع غلافه وعنوانه ---- */
function AZ_seriesFrom(html) {
  var map = {};
  var re = /<a\s[^>]*href="\/series\/([a-z0-9][a-z0-9-]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    if (slug.indexOf("chapter-") === 0) continue;   // روابط الفصول ليست أعمالًا
    var e = map[slug];
    if (!e) { e = map[slug] = { slug: slug, title: "", image: "" }; }
    var inner = m[2];
    if (!e.image) {
      var im = inner.match(/(?:src|data-src|data-lazy-src|data-original)\s*=\s*"(https:\/\/storage\.azorafly\.com\/[^"']+\.(?:jpg|jpeg|png|webp))"/i)
             || inner.match(/(?:src|data-src|data-lazy-src|data-original)\s*=\s*"([^"']+\.(?:jpg|jpeg|png|webp))"/i);
      if (im) e.image = AZ_abs(im[1]);
    }
    if (!e.title) {
      var t = inner.match(/itemProp="name"[^>]*>([^<]+)/i)
           || inner.match(/<h[1-6][^>]*>([^<]+)</i)
           || inner.match(/alt="([^"]{2,100})"/i);
      if (t) e.title = AZ_txt(t[1]);
    }
  }
  var out = [];
  for (var slug in map) {
    if (!map.hasOwnProperty(slug)) continue;
    var e = map[slug];
    out.push({
      slug: e.slug,
      title: e.title || e.slug,          // fallback حقيقي: معرّف الرابط نفسه
      image: e.image || null,
      url: AZ_abs("/series/" + e.slug),
      author: null, genres: [], type: null, status: null,
      chapterCount: null, lastChapter: null, lastChapterAt: null,
      isHot: false, isNew: false, isPinned: false,
      referer: AZ.baseUrl + "/"
    });
  }
  return out;
}

/* ---- الفصول: أولاً من flight data (أرقام دقيقة + عناوين)، ثم href كاحتياط ---- */
function AZ_chaptersFromFlight(html) {
  var out = [], seen = {};
  var re = /slug:"(chapter-[0-9.]+)",number:([0-9.]+),title:"([^"]*)"/g, m;
  while ((m = re.exec(html)) !== null) {
    var num = parseFloat(m[2]);
    if (seen[num]) continue;
    seen[num] = 1;
    out.push({
      number: num,
      slug: m[1],
      title: m[3] ? AZ_txt(m[3]) : null,
      addedAt: null,
      url: AZ.baseUrl + "/series/__S__/" + m[1]
    });
  }
  return out;
}

function AZ_chaptersFromLinks(html, seriesSlug) {
  var out = [], seen = {};
  var re = new RegExp('href="/series/' + seriesSlug + '/chapter-([0-9.]+)"', "g"), m;
  while ((m = re.exec(html)) !== null) {
    var num = parseFloat(m[1]);
    if (seen[num]) continue;
    seen[num] = 1;
    out.push({ number: num, slug: "chapter-" + m[1], title: null, addedAt: null,
               url: AZ.baseUrl + "/series/" + seriesSlug + "/chapter-" + m[1] });
  }
  return out;
}

/* ---- صفحات الفصل: صور storage المباشرة بنمط page-NNNN (مرتّبة كما وردت) ---- */
function AZ_pagesFrom(html) {
  var out = [], seen = {};
  var re = /https:\/\/storage\.azorafly\.com\/upload\/series\/[a-z0-9-]+\/[a-f0-9-]+\/page-\d+[^"'\s]*?\.(?:jpg|jpeg|png|webp)/gi, m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[0]]) continue;
    seen[m[0]] = 1;
    out.push({ pageNum: out.length + 1, imgUrl: m[0] });
  }
  if (out.length === 0) {  // احتياط عام لأي نمط page- داخل storage
    var re2 = /(?:src|data-src)\s*=\s*"(https:\/\/storage\.azorafly\.com\/[^"']*page-[^"']+\.(?:jpg|jpeg|png|webp))"/gi, m2;
    while ((m2 = re2.exec(html)) !== null) {
      if (seen[m2[1]]) continue;
      seen[m2[1]] = 1;
      out.push({ pageNum: out.length + 1, imgUrl: m2[1] });
    }
  }
  return out;
}

/* ================================ الدوال الخمس ================================ */

/** params: {query, title, page} أو نص مسار — query مثال "/" أو "/latest-updates" */
Scraper.scrapeHome = function (arg) {
  var params = (arg && typeof arg === "object") ? arg : { query: String(arg || "/") };
  var query = params.query || "/";
  var page = params.page || 1;
  var url = (query.indexOf("http") === 0) ? query : AZ_abs(query.charAt(0) === "/" ? query : "/" + query);
  var html = AZ_get(url);
  if (!html) { window.MangaBlackBridge.postError("Azora: تعذّر جلب الصفحة الرئيسية"); return; }
  var items = AZ_seriesFrom(html);
  var group = {
    title: params.title || "", query: query, page: page,
    hasMore: false, server: AZ.serverId,
    success: items.length > 0, data: items
  };
  window.MangaBlackBridge.postResult(JSON.stringify({
    data: [group], server: AZ.serverId, success: items.length > 0
  }));
};

/** البحث: صفحة /search?q= تحمّل نتائجها client-side — قد يعود فارغًا (غير مُتحقَّق) */
Scraper.scrapeSearch = function (arg) {
  var q = (arg && typeof arg === "object") ? (arg.query || "") : String(arg || "");
  if (!q) { window.MangaBlackBridge.postResult(JSON.stringify({ data: [], success: true })); return; }
  var html = AZ_get(AZ.baseUrl + "/search?q=" + encodeURIComponent(q));
  var items = AZ_seriesFrom(html);
  window.MangaBlackBridge.postResult(JSON.stringify({ data: items, success: true }));
};

/** arg = slug أو رابط مطلق لصفحة العمل */
Scraper.scrapeDetails = function (arg) {
  var v = (arg && typeof arg === "object") ? (arg.url || arg.slug) : arg;
  var url = AZ_abs(String(v));
  var html = AZ_get(url);
  if (!html) { window.MangaBlackBridge.postError("Azora: تعذّر جلب صفحة العمل"); return; }

  var t = html.match(/<h1[^>]*itemProp="name"[^>]*>([^<]+)/i) || html.match(/<h1[^>]*>([^<]+)</i);
  if (!t) { window.MangaBlackBridge.postError("Azora: لم يُعثر على عنوان العمل"); return; }

  var synopsis = null;
  var de = html.match(/itemProp="description"[^>]*>([\s\S]{0,6000}?)<\/div>/i);
  if (de) synopsis = AZ_txt(de[1]);
  if (!synopsis) {
    var og = html.match(/property="og:description"\s+content="([^"]+)"/i);
    if (og) synopsis = AZ_txt(og[1]);
  }

  var genres = [], gr = /itemProp="genre"[^>]*>([^<]+)/gi, gm;
  while ((gm = gr.exec(html)) !== null) {
    var g = AZ_txt(gm[1]);
    if (g && genres.indexOf(g) < 0) genres.push(g);
  }

  var cov = html.match(/property="og:image"\s+content="([^"]+)"/i);
  var image = cov ? AZ_abs(cov[1]) : null;
  if (!image) {
    var st = html.match(/https:\/\/storage\.azorafly\.com\/upload\/series\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
    if (st) image = st[0];
  }

  var seriesType = null;                       // من keywords فقط — لا تخمين
  var kw = html.match(/name="keywords"\s+content="([^"]+)"/i);
  if (kw) {
    var k = kw[1].toLowerCase();
    if (k.indexOf("manhwa") >= 0 || k.indexOf("مانهوا") >= 0) seriesType = "manhwa";
    else if (k.indexOf("manhua") >= 0 || k.indexOf("مانها") >= 0) seriesType = "manhua";
    else if (k.indexOf("manga") >= 0 || k.indexOf("مانجا") >= 0) seriesType = "manga";
  }

  var details = {
    slug: AZ_slugOfUrl(url), url: url, title: AZ_txt(t[1]),
    altTitle: null, author: null, artist: null,   // غير موجودة في الصفحة → null
    synopsis: synopsis, genres: genres,
    seriesType: seriesType, seriesStatus: null,
    image: image, chapterCount: null,
    averageRating: null, totalRatings: null, views: null, isPlus18: null,
    latestChapters: AZ_chaptersFromFlight(html).slice(0, 12),
    recommendations: [],
    referer: AZ.baseUrl + "/"
  };
  window.MangaBlackBridge.postResult(JSON.stringify(details));
};

/** arg = slug أو رابط صفحة العمل — يرجع الفصول تنازليًا (الأحدث أولًا) */
Scraper.scrapeChapters = function (arg) {
  var v = (arg && typeof arg === "object") ? (arg.url || arg.slug) : arg;
  var url = AZ_abs(String(v));
  var seriesSlug = AZ_slugOfUrl(url);
  var html = AZ_get(url);
  if (!html) { window.MangaBlackBridge.postError("Azora: تعذّر جلب الفصول"); return; }

  var chapters = AZ_chaptersFromFlight(html);
  var i, c;
  for (i = 0; i < chapters.length; i++) {
    chapters[i].url = chapters[i].url.replace("__S__", seriesSlug);
  }
  if (chapters.length === 0) chapters = AZ_chaptersFromLinks(html, seriesSlug);

  chapters.sort(function (a, b) { return b.number - a.number; });
  window.MangaBlackBridge.postResult(JSON.stringify({
    data: chapters, hasMore: false, page: 1,
    server: AZ.serverId, success: chapters.length > 0, totalPages: 1
  }));
};

/** arg = رابط الفصل المطلق — يرجع صور الصفحات مرتّبة */
Scraper.scrapePages = function (arg) {
  var v = (arg && typeof arg === "object") ? (arg.url || arg.slug) : arg;
  var url = AZ_abs(String(v));
  var html = AZ_get(url);
  if (!html) { window.MangaBlackBridge.postError("Azora: تعذّر جلب صفحات الفصل"); return; }

  var pages = AZ_pagesFrom(html);
  if (pages.length === 0) {
    window.MangaBlackBridge.postError("Azora: لم تُعثر على صور في هذا الفصل");
    return;
  }
  window.MangaBlackBridge.postResult(JSON.stringify({
    data: pages, server: AZ.serverId, success: true
  }));
};
