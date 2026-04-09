/**
 * CCM Daily Blog Generator
 * Calls Claude API → generates SEO blog post matching site style → commits to GitHub → Vercel auto-deploys
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";

const OWNER = "FullWaveDev-Git";
const REPO = "rideccm";
const BRANCH = "main";
const BASE_URL = "https://rideccm.vercel.app";

// All confirmed working Pexels photo IDs with descriptions
const ALL_PHOTOS = [
  { id: "1595655",  alt: "motorcycle on open road at sunset",         topic: "motorcycle road" },
  { id: "2549941",  alt: "red sport motorcycle parked on hillside",   topic: "sport motorcycle" },
  { id: "3729784",  alt: "dirt bike rider on trail through trees",    topic: "dirt bike trail" },
  { id: "12983285", alt: "muddy side-by-side UTV on dirt trail",      topic: "UTV SxS offroad" },
  { id: "13092865", alt: "ATV parked on open field",                  topic: "ATV field" },
  { id: "6907251",  alt: "ATV rider on snow-covered trail",           topic: "ATV winter" },
  { id: "2611690",  alt: "motorcycle on highway at golden hour",      topic: "motorcycle highway" },
  { id: "1119796",  alt: "motorcycle parked on scenic overlook",      topic: "motorcycle scenic" },
  { id: "1413412",  alt: "mechanic working on motorcycle engine",     topic: "motorcycle maintenance" },
  { id: "2116475",  alt: "motorcycle gear and helmet on workbench",   topic: "gear & accessories" },
  { id: "5622291",  alt: "group of motorcycles on country road",      topic: "group ride" },
  { id: "2236828",  alt: "motorcycle riding through mountain curves", topic: "mountain road" },
  { id: "2457825",  alt: "adventure motorcycle on gravel road",       topic: "adventure riding" },
  { id: "4389614",  alt: "close-up of motorcycle wheel and engine",   topic: "motorcycle detail" },
  { id: "3807517",  alt: "motorcycle showroom floor with bikes",      topic: "dealership" },
  { id: "1715994",  alt: "off-road ATV splashing through mud",        topic: "ATV mud" },
  { id: "2519374",  alt: "two motorcycles parked on rural road",      topic: "cruiser road" },
  { id: "3766078",  alt: "sport bike leaning into a curve",           topic: "sport bike corner" },
  { id: "4390793",  alt: "UTV driving through wooded trail",          topic: "UTV woods" },
  { id: "9553951",  alt: "polaris slingshot on open road",            topic: "slingshot" },
];

const TOPICS = [
  "Best motorcycle roads and scenic routes near Dayton and Cincinnati Ohio for 2026",
  "Kawasaki motorcycle full lineup guide for Ohio riders — which model is right for you",
  "How to prepare your ATV for spring riding season in Ohio — complete checklist",
  "UTV buying guide for Ohio farmers, hunters, and outdoor enthusiasts",
  "Yamaha powersports guide — best models for Southwest Ohio riders in 2026",
  "Motorcycle safety tips for riding Ohio roads in spring and summer",
  "KTM dirt bikes and adventure bikes — which model fits Ohio trail riding",
  "Can-Am side-by-side and Spyder lineup guide for Ohio buyers",
  "Polaris ATV and Ranger UTV overview — which Polaris is right for Ohio",
  "How to properly winterize your motorcycle in Ohio — step by step",
  "Triumph motorcycle guide — best models for Ohio road and touring riders",
  "Best ATV and UTV trails near Cincinnati, Dayton, and Chillicothe Ohio",
  "Powersports financing tips for Ohio buyers — how to get the best deal",
  "Motorcycle gear guide for Ohio weather — what to wear every season",
  "Motorcycle vs side-by-side — how Ohio riders should choose",
  "Used vs new powersports buying guide for Ohio riders",
  "Top 5 motorcycle maintenance jobs every Ohio rider should know",
  "Off-road riding safety tips for Ohio ATV and UTV families",
  "Polaris Slingshot review — the three-wheeled thrill ride for Ohio roads",
  "Best beginner motorcycles for new Ohio riders in 2026",
  "Kawasaki KLX and KX dirt bike guide for Ohio trail riders",
  "Adventure motorcycle touring routes from Wilmington through southern Ohio",
  "How to choose the right ATV size for your Ohio property",
  "Spring motorcycle gear checklist — Ohio riders edition",
  "Yamaha Ténéré 700 vs KTM 890 Adventure — Ohio adventure bike shootout",
];

async function getFileFromGitHub(octokit, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf-8") };
  } catch {
    return { sha: null, content: null };
  }
}

async function createBlob(octokit, content) {
  const { data } = await octokit.git.createBlob({ owner: OWNER, repo: REPO, content, encoding: "utf-8" });
  return data.sha;
}

async function commitFiles(octokit, files, message) {
  const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}` });
  const currentCommitSha = refData.object.sha;
  const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: currentCommitSha });
  const treeSha = commitData.tree.sha;

  const treeItems = await Promise.all(
    files.map(async ({ path, content }) => ({
      path, mode: "100644", type: "blob", sha: await createBlob(octokit, content),
    }))
  );

  const { data: newTree } = await octokit.git.createTree({ owner: OWNER, repo: REPO, base_tree: treeSha, tree: treeItems });
  const { data: newCommit } = await octokit.git.createCommit({ owner: OWNER, repo: REPO, message, tree: newTree.sha, parents: [currentCommitSha] });
  await octokit.git.updateRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}`, sha: newCommit.sha });
  return newCommit.sha;
}

function todayFormatted() {
  const d = new Date();
  return {
    iso: d.toISOString().split("T")[0],
    display: d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    datetime: d.toISOString().split("T")[0],
    year: d.getFullYear(),
  };
}

// Find which photos are already used in the repo so we never duplicate
async function getUsedPhotoIds(octokit) {
  try {
    const { content: sitemapContent } = await getFileFromGitHub(octokit, "sitemap.xml");
    const { content: blogIndex } = await getFileFromGitHub(octokit, "blog/index.html");
    const combined = (sitemapContent || "") + (blogIndex || "");
    const matches = combined.match(/pexels-photo-(\d+)/g) || [];
    return new Set(matches.map(m => m.replace("pexels-photo-", "")));
  } catch {
    return new Set();
  }
}

function pickTopic(usedToday) {
  const remaining = TOPICS.filter(t => !usedToday.includes(t));
  const pool = remaining.length > 0 ? remaining : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickPhoto(usedIds) {
  const available = ALL_PHOTOS.filter(p => !usedIds.has(p.id));
  const pool = available.length > 0 ? available : ALL_PHOTOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateBlogPost(anthropic, topic, date) {
  const prompt = `You are a professional blog writer for Clinton County Motorsports (CCM), an authorized powersports dealership at 6002 U.S. 68 N, Wilmington, Ohio 45177. Phone: (937) 283-2220. Hours: Tue–Fri 10am–6pm, Sat 9am–3pm.

Write a detailed, SEO-optimized blog post on this topic: "${topic}"

Requirements:
- Today's date: ${date.display}
- Write for Ohio powersports buyers and riders
- Naturally mention these cities: Wilmington, Cincinnati, Dayton, Columbus, Chillicothe, Xenia, Springfield, Washington Court House, Hillsboro
- Reference CCM (Clinton County Motorsports) as the local dealer
- Include relevant brand names where natural (Kawasaki, Yamaha, KTM, Polaris, Can-Am, Triumph, Suzuki)
- Write 6-8 content sections, each with a specific H2 heading and 2-4 paragraphs
- Include 1-2 "callout" tip boxes (formatted as: CALLOUT: Title | Body text)
- Include at least one bulleted or numbered list
- End with a section about visiting/contacting CCM
- Total length: 1,200-1,600 words
- Tone: knowledgeable, local, direct — like a shop owner talking to a customer

Respond in this exact JSON format (no markdown, raw JSON only):
{
  "title": "SEO title under 65 chars",
  "slug": "url-slug-lowercase-hyphens-max-50-chars",
  "category": "one of: Buying Guide | Riding Tips | Maintenance | Local Rides | Brand Spotlight",
  "articleSection": "2-3 word section label for schema",
  "metaDescription": "150-160 char description with Ohio keyword",
  "keywords": "comma-separated SEO keywords string",
  "excerpt": "2 sentence teaser for blog card",
  "readTime": "X min read",
  "heroAlt": "descriptive alt text for hero image",
  "sections": [
    {
      "heading": "H2 heading text",
      "content": "Full HTML for this section body — use <p>, <ul>, <ol>, <li>, <strong>, <em> tags. For callout boxes use: <div class=\\"blog-callout\\"><strong>Title</strong><p>body</p></div>"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response:\n" + text.substring(0, 300));
  return JSON.parse(jsonMatch[0]);
}

function buildBlogPostHTML(post, photo, date) {
  const heroUrl  = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
  const canonical = `${BASE_URL}/blog/${post.slug}`;
  const shortTitle = post.title.length > 35 ? post.title.substring(0, post.title.lastIndexOf(" ", 35)) + "…" : post.title;

  const sectionsHTML = post.sections.map(s => `
          <h2>${s.heading}</h2>
          ${s.content}`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="192x192" href="/favicon.png">
  <meta charset="UTF-8">
  <meta name="google-site-verification" content="lvCwIvj5ePqW5UfC5DyeB_LwEMLtjNhMzYAKjQq4G7M" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${post.title} | CCM Blog</title>
  <meta name="description" content="${post.metaDescription}">
  <meta name="keywords" content="${post.keywords}">
  <link rel="canonical" href="${canonical}">

  <meta property="og:title" content="${post.title}">
  <meta property="og:description" content="${post.metaDescription}">
  <meta property="og:image" content="${heroUrl}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Clinton County Motorsports">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="${date.iso}T09:00:00-05:00">
  <meta property="article:author" content="Clinton County Motorsports">
  <meta property="article:section" content="${post.articleSection}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${post.title}">
  <meta name="twitter:description" content="${post.metaDescription}">
  <meta name="twitter:image" content="${heroUrl}">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": "${canonical}",
        "headline": "${post.title}",
        "description": "${post.metaDescription}",
        "image": "${heroUrl}",
        "url": "${canonical}",
        "datePublished": "${date.iso}T09:00:00-05:00",
        "dateModified": "${date.iso}T09:00:00-05:00",
        "author": { "@type": "Organization", "name": "Clinton County Motorsports", "url": "${BASE_URL}" },
        "publisher": {
          "@type": "Organization",
          "name": "Clinton County Motorsports",
          "url": "${BASE_URL}",
          "logo": { "@type": "ImageObject", "url": "${BASE_URL}/images/clinton-county-ms-logo.png" }
        },
        "articleSection": "${post.articleSection}",
        "keywords": "${post.keywords}",
        "isPartOf": { "@type": "Blog", "@id": "${BASE_URL}/blog", "name": "Clinton County Motorsports Blog" }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {"@type": "ListItem", "position": 1, "name": "Home", "item": "${BASE_URL}/"},
          {"@type": "ListItem", "position": 2, "name": "Blog", "item": "${BASE_URL}/blog"},
          {"@type": "ListItem", "position": 3, "name": "${post.title}", "item": "${canonical}"}
        ]
      }
    ]
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900;1,14..32,400&family=Bebas+Neue&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/page.css">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DM5GFPDFJY"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-DM5GFPDFJY');</script>
</head>
<body>

  <nav class="navbar scrolled" id="navbar">
    <div class="nav-container">
      <a href="/" class="nav-logo">
        <img src="${BASE_URL}/images/clinton-county-ms-logo.png" alt="Clinton County Motorsports" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="nav-logo-text" style="display:none">CCM</span>
      </a>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-menu" id="navMenu" role="list">
        <li class="nav-item"><a href="/" class="nav-link">Home</a></li>
        <li class="nav-item dropdown">
          <button class="nav-link dropdown-toggle" aria-haspopup="true" aria-expanded="false">Inventory <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <ul class="dropdown-menu" role="menu">
            <li role="none"><a href="/inventory" role="menuitem">All Inventory</a></li>
            <li role="none"><a href="/inventory#new" role="menuitem">New Units</a></li>
            <li role="none"><a href="/inventory#used" role="menuitem">Pre-Owned</a></li>
            <li role="none"><a href="/inventory#clearance" role="menuitem">Clearance Units</a></li>
            <li role="none"><a href="/get-a-quote" role="menuitem">Get A Quote</a></li>
          </ul>
        </li>
        <li class="nav-item"><a href="/promotions" class="nav-link">Promotions</a></li>
        <li class="nav-item dropdown">
          <button class="nav-link dropdown-toggle" aria-haspopup="true" aria-expanded="false">Services <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <ul class="dropdown-menu" role="menu">
            <li role="none"><a href="/services" role="menuitem">Service Dept.</a></li>
            <li role="none"><a href="/schedule-service" role="menuitem">Schedule Service</a></li>
            <li role="none"><a href="/parts" role="menuitem">Parts &amp; Accessories</a></li>
          </ul>
        </li>
        <li class="nav-item"><a href="/financing" class="nav-link">Financing</a></li>
        <li class="nav-item"><a href="/about" class="nav-link">About</a></li>
        <li class="nav-item"><a href="/blog" class="nav-link active">Blog</a></li>
        <li class="nav-item"><a href="/service-areas" class="nav-link">Service Areas</a></li>
        <li class="nav-item"><a href="/contact" class="nav-link nav-cta-link">Contact Us</a></li>
      </ul>
    </div>
  </nav>

  <!-- PAGE HERO -->
  <section class="page-hero">
    <div class="page-hero-content">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/blog">Blog</a>
        <span class="breadcrumb-sep">›</span>
        <span>${shortTitle}</span>
      </nav>
      <h1>${post.title}</h1>
      <p>${post.excerpt}</p>
      <div class="red-divider"></div>
    </div>
  </section>

  <!-- ARTICLE -->
  <section class="section">
    <div class="container">
      <article class="blog-article">

        <div class="blog-article-header">
          <div class="blog-meta">
            <span class="blog-category">${post.category}</span>
            <time datetime="${date.datetime}">${date.display}</time>
            <span>·</span>
            <span>${post.readTime}</span>
          </div>
        </div>

        <img
          src="${heroUrl}"
          alt="${post.heroAlt}"
          class="blog-hero-img"
        >

        <div class="blog-byline">
          <div class="blog-byline-avatar">CCM</div>
          <div class="blog-byline-info">
            <div class="blog-byline-name">Clinton County Motorsports</div>
            <div class="blog-byline-role">Your Authorized Powersports Dealer — Wilmington, OH</div>
          </div>
        </div>

        <div class="blog-body">
${sectionsHTML}
        </div><!-- /.blog-body -->

        <!-- CTA Bar -->
        <div style="background:var(--bg-card);border:1px solid var(--border-red);border-radius:var(--radius-lg);padding:2rem;margin:3rem 0;text-align:center;">
          <h3 style="font-size:1.3rem;color:var(--white);margin-bottom:0.5rem;">Shop Bikes, Gear &amp; Parts at <span class="text-red">CCM</span></h3>
          <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:1.5rem;">6002 U.S. 68 N, Wilmington, OH &nbsp;·&nbsp; Tue–Fri 10am–6pm &nbsp;·&nbsp; Sat 9am–3pm</p>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
            <a href="/inventory" class="btn btn-primary">Shop Inventory</a>
            <a href="/parts" class="btn btn-outline">Parts &amp; Gear</a>
          </div>
        </div>

        <!-- Back to Blog -->
        <div style="text-align:center;margin:2rem 0;">
          <a href="/blog" style="font-size:0.9rem;color:var(--text-muted);display:inline-flex;align-items:center;gap:0.5rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back to Blog
          </a>
        </div>

      </article>
    </div>
  </section>

  <!-- BOTTOM CTA -->
  <section style="padding:4rem 0;border-top:1px solid var(--border);">
    <div class="container">
      <div class="cta-banner" data-animate="fade-up">
        <div class="cta-banner-text">
          <h3>Clinton County Motorsports — <span class="text-red">Wilmington, OH</span></h3>
          <p>6002 U.S. 68 N, Wilmington, OH 45177 &nbsp;&middot;&nbsp; Tue–Fri 10am–6pm &nbsp;&middot;&nbsp; Sat 9am–3pm</p>
        </div>
        <div class="cta-banner-actions">
          <a href="tel:9372832220" class="btn btn-primary">Call (937) 283-2220</a>
          <a href="/contact" class="btn btn-outline">Contact Us</a>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer" role="contentinfo">
    <div class="footer-main"><div class="container"><div class="footer-grid">
      <div class="footer-brand">
        <img src="${BASE_URL}/images/clinton-county-ms-logo.png" alt="Clinton County Motorsports" class="footer-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="footer-logo-fallback" style="display:none">Clinton County Motorsports</span>
        <p>Your premier authorized powersports dealer in Wilmington, OH. Proudly serving Southwest &amp; Central Ohio.</p>
        <a href="https://www.facebook.com/rideccm" class="fb-link" aria-label="Like us on Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Like us on Facebook</a>
      </div>
      <div class="footer-col"><h4>Shop</h4><ul>
        <li><a href="/inventory#new">New Inventory</a></li><li><a href="/inventory#used">Pre-Owned</a></li>
        <li><a href="/inventory#clearance">Clearance Units</a></li><li><a href="/promotions">Current Deals</a></li><li><a href="/get-a-quote">Get A Quote</a></li>
      </ul></div>
      <div class="footer-col"><h4>Services</h4><ul>
        <li><a href="/services">Service Dept.</a></li><li><a href="/schedule-service">Schedule Service</a></li>
        <li><a href="/parts">Parts Dept.</a></li><li><a href="http://clintoncounty.dealerspikeparts.com/">OEM Parts Finder</a></li><li><a href="/financing">Financing</a></li>
      </ul></div>
      <div class="footer-col"><h4>Contact</h4><address><ul class="footer-contact">
        <li>6002 U.S. 68 N<br>Wilmington, OH 45177</li>
        <li><a href="tel:9372832220">Ph: 937.283.2220</a></li>
        <li>Fax: 937.283.2219</li>
        <li><a href="mailto:jason@emailccm.com">jason@emailccm.com</a></li>
      </ul></address></div>
    </div></div></div>
    <div class="footer-bottom"><div class="container">
      <div class="footer-areas"><strong>Service Areas:</strong>
        <a href="/service-areas/cincinnati">Cincinnati</a> &nbsp;&middot;&nbsp;<a href="/service-areas/dayton">Dayton</a> &nbsp;&middot;&nbsp;
        <a href="/service-areas/columbus">Columbus</a> &nbsp;&middot;&nbsp;<a href="/service-areas/chillicothe">Chillicothe</a> &nbsp;&middot;&nbsp;
        <a href="/service-areas/xenia">Xenia</a> &nbsp;&middot;&nbsp;<a href="/service-areas/springfield">Springfield</a> &nbsp;&middot;&nbsp;
        <a href="/service-areas/washington-court-house">Washington Court House</a> &nbsp;&middot;&nbsp;<a href="/service-areas/hillsboro">Hillsboro</a>
      </div>
      <p>&copy; ${date.year} Clinton County Motorsports. All Rights Reserved.</p>
      <p class="disclaimer">Advertised pricing excludes applicable taxes, title and licensing, dealer set up, destination, reconditioning and are subject to change without notice.</p>
      <nav class="footer-legal" aria-label="Legal links"><a href="#">Privacy Policy</a><a href="#">Terms of Use</a><a href="/sitemap">Site Map</a></nav>
    </div></div>
  </footer>

  <a href="tel:9372832220" class="fab-call" aria-label="Call us">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.59 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>
  </a>
  <script src="/js/main.js"></script>
</body>
</html>`;
}

function buildBlogCard(post, photo, date) {
  const cardUrl = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=800`;
  return `
        <!-- Post — ${date.display} -->
        <article class="blog-card">
          <img
            src="${cardUrl}"
            alt="${post.heroAlt}"
            class="blog-card-img"
            loading="lazy"
          >
          <div class="blog-card-body">
            <div class="blog-meta">
              <span class="blog-category">${post.category}</span>
              <time datetime="${date.datetime}">${date.display}</time>
            </div>
            <h3><a href="/blog/${post.slug}">${post.title}</a></h3>
            <p>${post.excerpt}</p>
            <a href="/blog/${post.slug}" class="blog-read-more">Read Article <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
          </div>
        </article>`;
}

async function main() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const githubToken  = process.env.GITHUB_TOKEN;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
  if (!githubToken)  throw new Error("GITHUB_TOKEN not set");

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const octokit   = new Octokit({ auth: githubToken });
  const date      = todayFormatted();

  // Find already-used photos to avoid duplicates
  console.log("🔍 Checking used photos...");
  const usedPhotoIds = await getUsedPhotoIds(octokit);
  console.log(`   ${usedPhotoIds.size} photos already used`);

  const topic = pickTopic([]);
  const photo = pickPhoto(usedPhotoIds);

  console.log(`📅 Date:    ${date.display}`);
  console.log(`📝 Topic:   ${topic}`);
  console.log(`📸 Photo:   ID ${photo.id} — ${photo.alt}`);

  // Generate content via Claude
  console.log("🤖 Generating with Claude...");
  const post = await generateBlogPost(anthropic, topic, date);
  console.log(`✅ Title:   "${post.title}"`);
  console.log(`✅ Slug:    /blog/${post.slug}`);

  // Build HTML
  const blogPostHTML = buildBlogPostHTML(post, photo, date);
  const newCard      = buildBlogCard(post, photo, date);

  // Fetch and update blog index
  const { content: blogIndexHTML } = await getFileFromGitHub(octokit, "blog/index.html");
  if (!blogIndexHTML) throw new Error("Could not fetch blog/index.html");
  const updatedBlogIndex = blogIndexHTML.replace(
    /(<div class="blog-grid"[^>]*>\s*)/,
    `$1\n${newCard}\n`
  );

  // Fetch and update sitemap
  const { content: sitemapXML } = await getFileFromGitHub(octokit, "sitemap.xml");
  if (!sitemapXML) throw new Error("Could not fetch sitemap.xml");
  const newSitemapEntry = `  <url><loc>${BASE_URL}/blog/${post.slug}</loc><lastmod>${date.iso}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
  const updatedSitemap  = sitemapXML.replace("</urlset>", `${newSitemapEntry}\n</urlset>`);

  // Commit all files
  console.log("📤 Committing to GitHub...");
  const sha = await commitFiles(
    octokit,
    [
      { path: `blog/${post.slug}/index.html`, content: blogPostHTML },
      { path: "blog/index.html",              content: updatedBlogIndex },
      { path: "sitemap.xml",                  content: updatedSitemap },
    ],
    `Add ${date.iso} blog: ${post.title}`
  );

  console.log(`✅ Committed: ${sha}`);
  console.log(`🚀 Vercel deploying → ${BASE_URL}/blog/${post.slug}`);
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
