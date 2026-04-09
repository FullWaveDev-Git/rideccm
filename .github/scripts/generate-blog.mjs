/**
 * CCM Daily Blog Generator
 * Calls Claude API → generates blog post → commits to GitHub → Vercel auto-deploys
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";

const OWNER = "FullWaveDev-Git";
const REPO = "rideccm";
const BRANCH = "main";
const BASE_URL = "https://rideccm.vercel.app";

const PEXELS_PHOTOS = [
  { id: "1595655", alt: "motorcycle on open road", topic: "motorcycle" },
  { id: "2549941", alt: "red sport motorcycle", topic: "motorcycle" },
  { id: "3729784", alt: "dirt bike on trail", topic: "dirt bike" },
  { id: "12983285", alt: "side-by-side UTV on dirt trail", topic: "UTV SxS" },
  { id: "13092865", alt: "ATV parked on field", topic: "ATV" },
  { id: "6907251", alt: "person riding ATV in winter", topic: "ATV winter" },
  { id: "2611690", alt: "motorcycle on highway at sunset", topic: "motorcycle" },
  { id: "1119796", alt: "motorcycle parked outdoors", topic: "motorcycle" },
];

const TOPICS = [
  "Best motorcycle roads and scenic routes near Dayton and Cincinnati Ohio",
  "Kawasaki motorcycle lineup guide for Ohio riders in 2026",
  "How to prepare your ATV for spring riding season in Ohio",
  "UTV buying guide for Ohio farmers and outdoor enthusiasts",
  "Yamaha powersports — best models for Southwest Ohio riders",
  "Motorcycle safety tips for riding in Ohio spring and summer",
  "KTM dirt bikes — which model is right for Ohio trail riding",
  "Can-Am side-by-side models guide for Ohio riders",
  "Polaris ATV and UTV lineup overview for Ohio buyers",
  "How to winterize your motorcycle in Ohio — step by step guide",
  "Triumph motorcycle guide — best models for Ohio road riders",
  "Best ATV trails and riding areas near Cincinnati and Dayton Ohio",
  "Powersports financing tips for Ohio buyers — what to know",
  "Motorcycle gear guide for Ohio weather and riding conditions",
  "How to choose between a motorcycle and a side-by-side in Ohio",
  "Used vs new ATV buying guide for Ohio riders",
  "Spring motorcycle maintenance checklist for Ohio riders",
  "Off-road riding safety tips for Ohio ATV and UTV riders",
  "Polaris Slingshot review — fun three-wheeler for Ohio roads",
  "Best beginner motorcycles for Ohio new riders in 2026",
];

async function getFileSha(octokit, path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH,
    });
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf-8") };
  } catch {
    return { sha: null, content: null };
  }
}

async function createBlob(octokit, content) {
  const { data } = await octokit.git.createBlob({
    owner: OWNER,
    repo: REPO,
    content,
    encoding: "utf-8",
  });
  return data.sha;
}

async function commitFiles(octokit, files, message) {
  // Get current commit
  const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}` });
  const currentCommitSha = refData.object.sha;
  const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: currentCommitSha });
  const treeSha = commitData.tree.sha;

  // Create blobs
  const treeItems = await Promise.all(
    files.map(async ({ path, content }) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: await createBlob(octokit, content),
    }))
  );

  // Create tree
  const { data: newTree } = await octokit.git.createTree({ owner: OWNER, repo: REPO, base_tree: treeSha, tree: treeItems });

  // Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message,
    tree: newTree.sha,
    parents: [currentCommitSha],
  });

  // Update branch ref
  await octokit.git.updateRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}`, sha: newCommit.sha });
  return newCommit.sha;
}

function todayFormatted() {
  const d = new Date();
  return {
    iso: d.toISOString().split("T")[0],
    display: d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    datetime: d.toISOString().split("T")[0],
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateBlogPost(anthropic, topic, photo, date) {
  const prompt = `You are writing an SEO-optimized blog post for Clinton County Motorsports (CCM), a powersports dealership in Wilmington, Ohio (rideccm.vercel.app).

Topic: ${topic}
Today's date: ${date.display}
Post URL base: ${BASE_URL}

Write a complete blog post with:
1. A compelling SEO title (max 65 chars)
2. Meta description (150-160 chars) — include Ohio city keywords
3. URL slug (lowercase, hyphens, no special chars, max 50 chars)
4. Category (one of: Buying Guide, Riding Tips, Maintenance, Local Rides, Brand Spotlight)
5. 5-7 content sections, each with an H2 heading and 2-3 paragraphs (~1200 words total)
   - Naturally mention: Wilmington, Cincinnati, Dayton, Columbus, Chillicothe, Xenia, Springfield
   - Mention Clinton County Motorsports or CCM as the local dealer
   - Include relevant brand names (Kawasaki, Yamaha, KTM, Polaris, Can-Am, Triumph, Suzuki as appropriate)
6. A call-to-action final section linking to /inventory and /contact

Respond in this exact JSON format:
{
  "title": "...",
  "slug": "...",
  "category": "...",
  "metaDescription": "...",
  "excerpt": "1-2 sentence teaser for blog card",
  "sections": [
    { "heading": "H2 heading text", "paragraphs": ["para 1", "para 2", "para 3"] }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].text;
  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in Claude response");
  return JSON.parse(jsonMatch[0]);
}

function buildBlogPostHTML(post, photo, date, slug) {
  const heroUrl = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
  const canonicalUrl = `${BASE_URL}/blog/${slug}`;

  const sectionsHTML = post.sections
    .map(
      (s) =>
        `  <section class="blog-section">
    <h2>${s.heading}</h2>
    ${s.paragraphs.map((p) => `    <p>${p}</p>`).join("\n")}
  </section>`
    )
    .join("\n\n");

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

  <title>${post.title} — CCM Blog | ${date.display}</title>
  <meta name="description" content="${post.metaDescription}">
  <link rel="canonical" href="${canonicalUrl}">

  <meta property="og:title" content="${post.title} — CCM Blog">
  <meta property="og:description" content="${post.metaDescription}">
  <meta property="og:image" content="${heroUrl}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Clinton County Motorsports">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="${date.iso}T09:00:00-05:00">
  <meta property="article:author" content="Clinton County Motorsports">
  <meta property="article:section" content="${post.category}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${post.title} — CCM Blog">
  <meta name="twitter:description" content="${post.metaDescription}">
  <meta name="twitter:image" content="${heroUrl}">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "${post.title}",
    "description": "${post.metaDescription}",
    "image": "${heroUrl}",
    "datePublished": "${date.iso}T09:00:00-05:00",
    "dateModified": "${date.iso}T09:00:00-05:00",
    "author": { "@type": "Organization", "name": "Clinton County Motorsports", "url": "${BASE_URL}" },
    "publisher": {
      "@type": "Organization",
      "name": "Clinton County Motorsports",
      "url": "${BASE_URL}",
      "logo": { "@type": "ImageObject", "url": "${BASE_URL}/images/clinton-county-ms-logo.png" }
    },
    "articleSection": "${post.category}",
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${canonicalUrl}" },
    "isPartOf": { "@type": "Blog", "@id": "${BASE_URL}/blog", "name": "Clinton County Motorsports Blog" },
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "${BASE_URL}/"},
        {"@type": "ListItem", "position": 2, "name": "Blog", "item": "${BASE_URL}/blog"},
        {"@type": "ListItem", "position": 3, "name": "${post.title}", "item": "${canonicalUrl}"}
      ]
    }
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/page.css">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DM5GFPDFJY"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-DM5GFPDFJY');</script>
</head>
<body>

  <nav class="navbar scrolled" id="navbar">
    <div class="nav-container">
      <a href="/" class="nav-logo" aria-label="Clinton County Motorsports Home">
        <img src="${BASE_URL}/images/clinton-county-ms-logo.png" alt="Clinton County Motorsports" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="nav-logo-text" style="display:none">CCM</span>
      </a>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-menu" id="navMenu" role="list">
        <li class="nav-item"><a href="/" class="nav-link">Home</a></li>
        <li class="nav-item dropdown">
          <a href="/inventory" class="nav-link">Inventory <span class="dropdown-arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="/inventory#new">New Units</a></li>
            <li><a href="/inventory#used">Pre-Owned</a></li>
            <li><a href="/inventory#clearance">Clearance</a></li>
          </ul>
        </li>
        <li class="nav-item"><a href="/services" class="nav-link">Service</a></li>
        <li class="nav-item"><a href="/parts" class="nav-link">Parts</a></li>
        <li class="nav-item"><a href="/financing" class="nav-link">Financing</a></li>
        <li class="nav-item active"><a href="/blog" class="nav-link">Blog</a></li>
        <li class="nav-item"><a href="/contact" class="nav-link nav-cta">Contact Us</a></li>
      </ul>
    </div>
  </nav>

  <main class="page-main" style="padding-top:5rem;">
    <div class="container" style="max-width:860px;margin:0 auto;padding:2rem 1.5rem 4rem;">

      <nav aria-label="Breadcrumb" style="margin-bottom:1.5rem;font-size:0.85rem;color:var(--color-text-muted);">
        <a href="/" style="color:var(--color-accent);">Home</a> &rsaquo;
        <a href="/blog" style="color:var(--color-accent);">Blog</a> &rsaquo;
        <span>${post.title}</span>
      </nav>

      <div class="blog-meta" style="margin-bottom:0.75rem;">
        <span class="blog-category">${post.category}</span>
        <time datetime="${date.datetime}">${date.display}</time>
      </div>

      <h1 style="font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.2;margin-bottom:1.5rem;">${post.title}</h1>

      <img
        src="${heroUrl}"
        alt="${photo.alt}"
        class="blog-hero-img"
        loading="eager"
        fetchpriority="high"
      >

${sectionsHTML}

      <section class="blog-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:2rem;margin-top:3rem;text-align:center;">
        <h2 style="margin-bottom:0.75rem;">Ready to Ride? Visit CCM in Wilmington, Ohio</h2>
        <p>Clinton County Motorsports is your local authorized powersports dealer serving Wilmington, Cincinnati, Dayton, Columbus, and all of Southwest Ohio. Browse our full inventory or get in touch with our team today.</p>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-top:1.5rem;">
          <a href="/inventory" class="btn btn-primary">Browse Inventory</a>
          <a href="/contact" class="btn btn-outline">Contact Us</a>
        </div>
      </section>

      <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--color-border);">
        <a href="/blog" style="color:var(--color-accent);font-weight:600;">← Back to Blog</a>
      </div>

    </div>
  </main>

  <footer class="footer" role="contentinfo">
    <div class="footer-main"><div class="container"><div class="footer-grid">
      <div class="footer-brand">
        <img src="${BASE_URL}/images/clinton-county-ms-logo.png" alt="Clinton County Motorsports" class="footer-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="footer-logo-fallback" style="display:none">Clinton County Motorsports</span>
        <p>Your premier authorized powersports dealer in Wilmington, OH. Proudly serving Southwest &amp; Central Ohio.</p>
      </div>
      <div class="footer-col"><h4>Shop</h4><ul>
        <li><a href="/inventory#new">New Inventory</a></li>
        <li><a href="/inventory#used">Pre-Owned</a></li>
        <li><a href="/promotions">Current Deals</a></li>
        <li><a href="/get-a-quote">Get A Quote</a></li>
      </ul></div>
      <div class="footer-col"><h4>Services</h4><ul>
        <li><a href="/services">Service Department</a></li>
        <li><a href="/parts">Parts &amp; Accessories</a></li>
        <li><a href="/schedule-service">Schedule Service</a></li>
        <li><a href="/financing">Financing</a></li>
      </ul></div>
      <div class="footer-col"><h4>Company</h4><ul>
        <li><a href="/about">About CCM</a></li>
        <li><a href="/blog">Blog</a></li>
        <li><a href="/contact">Contact Us</a></li>
        <li><a href="/hours">Hours &amp; Location</a></li>
      </ul></div>
    </div></div></div>
    <div class="footer-bottom"><div class="container">
      <p>&copy; ${new Date().getFullYear()} Clinton County Motorsports. All rights reserved. | <a href="/sitemap">Sitemap</a></p>
    </div></div>
  </footer>

  <script src="/js/main.js" defer></script>
</body>
</html>`;
}

function buildBlogCard(post, photo, date, slug) {
  const cardUrl = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=800`;
  return `
        <!-- Post — ${date.display} -->
        <article class="blog-card">
          <img
            src="${cardUrl}"
            alt="${photo.alt}"
            class="blog-card-img"
            loading="lazy"
          >
          <div class="blog-card-body">
            <div class="blog-meta">
              <span class="blog-category">${post.category}</span>
              <time datetime="${date.datetime}">${date.display}</time>
            </div>
            <h2 class="blog-card-title"><a href="/blog/${slug}">${post.title}</a></h2>
            <p class="blog-card-excerpt">${post.excerpt}</p>
            <a href="/blog/${slug}" class="blog-read-more">Read More →</a>
          </div>
        </article>`;
}

async function main() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
  if (!githubToken) throw new Error("GITHUB_TOKEN not set");

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const octokit = new Octokit({ auth: githubToken });

  const date = todayFormatted();
  const topic = pickRandom(TOPICS);
  const photo = pickRandom(PEXELS_PHOTOS);

  console.log(`📅 Date: ${date.display}`);
  console.log(`📝 Topic: ${topic}`);
  console.log(`📸 Photo ID: ${photo.id}`);

  // Generate blog post content via Claude
  console.log("🤖 Generating blog post with Claude...");
  const post = await generateBlogPost(anthropic, topic, photo, date);
  const slug = post.slug;

  console.log(`✅ Generated: "${post.title}" → /blog/${slug}`);

  // Build HTML files
  const blogPostHTML = buildBlogPostHTML(post, photo, date, slug);
  const newCard = buildBlogCard(post, photo, date, slug);

  // Get current blog/index.html
  const { content: blogIndexHTML } = await getFileSha(octokit, "blog/index.html");
  if (!blogIndexHTML) throw new Error("Could not fetch blog/index.html");

  // Prepend new card to blog grid
  const updatedBlogIndex = blogIndexHTML.replace(
    /(<div class="blog-grid"[^>]*>\s*)/,
    `$1\n${newCard}\n`
  );

  // Get current sitemap.xml
  const { content: sitemapXML } = await getFileSha(octokit, "sitemap.xml");
  if (!sitemapXML) throw new Error("Could not fetch sitemap.xml");

  // Add new URL to sitemap
  const newSitemapEntry = `  <url><loc>${BASE_URL}/blog/${slug}</loc><lastmod>${date.iso}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
  const updatedSitemap = sitemapXML.replace("</urlset>", `${newSitemapEntry}\n</urlset>`);

  // Commit all 3 files
  console.log("📤 Committing to GitHub...");
  const commitSha = await commitFiles(
    octokit,
    [
      { path: `blog/${slug}/index.html`, content: blogPostHTML },
      { path: "blog/index.html", content: updatedBlogIndex },
      { path: "sitemap.xml", content: updatedSitemap },
    ],
    `Add ${date.iso} blog: ${post.title}`
  );

  console.log(`✅ Committed: ${commitSha}`);
  console.log(`🚀 Vercel will auto-deploy in ~1 minute`);
  console.log(`🔗 New post: ${BASE_URL}/blog/${slug}`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
