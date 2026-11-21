#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwrightMod;
try {
  playwrightMod = require("playwright");
} catch {
  playwrightMod = require("/home/awerkori/.local/share/npm-global/lib/node_modules/@playwright/cli/node_modules/playwright");
}
const { chromium, firefox } = playwrightMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.join(ROOT_DIR, rel);
      if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeIssue(num, opts = {}) {
  return {
    number: num,
    title: opts.title ?? `[Problema na extensão]: Fonte ${num}`,
    html_url: `https://github.com/ProjectNox-org/project-nox-requests/issues/${num}`,
    state: opts.state ?? "open",
    state_reason: opts.state_reason ?? null,
    created_at: opts.created_at ?? new Date(Date.UTC(2026, 10, 21, 10, 0, num % 60)).toISOString(),
    updated_at: opts.updated_at ?? new Date(Date.UTC(2026, 10, 21, 10, 0, num % 60)).toISOString(),
    closed_at: opts.state === "closed" ? (opts.closed_at ?? new Date(Date.UTC(2026, 10, 21, 11, 0, num % 60)).toISOString()) : null,
    comments: opts.comments ?? 0,
    labels: opts.labels ?? [{ name: "type:manga" }, { name: "kind:bug" }],
    reactions: opts.reactions ?? { "+1": 0, total_count: 0 },
    user: { login: opts.author ?? `user${num}` }
  };
}

async function runRegressionTests(browserType, browserName, baseUrl) {
  console.log(`\n=== [${browserName}] Testes de Regressão de Sincronização ===`);

  // 1a. Reabertura do navegador após sync parcial preserva tickets novos + ETag 304 válido
  {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `nox-reg1a-${browserName.toLowerCase()}-`));
    const snapTs = "2026-11-21T18:17:31.398475+00:00";
    const oldIssues = [
      makeIssue(171, { state: "open", created_at: "2026-11-21T18:00:00Z", updated_at: "2026-11-21T18:00:00Z" }),
      makeIssue(170, { state: "closed", created_at: "2026-11-21T17:00:00Z", updated_at: "2026-11-21T17:30:00Z" })
    ];
    const liveIssues = [
      makeIssue(173, { state: "open", created_at: "2026-11-21T23:10:18Z", updated_at: "2026-11-21T23:10:18Z" }),
      makeIssue(172, { state: "open", created_at: "2026-11-21T21:58:31Z", updated_at: "2026-11-21T21:58:31Z" }),
      ...oldIssues
    ];
    const etagUpdated = 'W/"etag-with-172-173"';

    const attachRoutes = async (context) => {
      await context.route("**/data/issues.json*", route => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: snapTs, issues: oldIssues }) });
      });
      await context.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
        const req = route.request();
        const url = new URL(req.url());
        const inm = req.headers()["if-none-match"];
        if (url.searchParams.get("sort") === "updated" && inm === etagUpdated) {
          route.fulfill({
            status: 304,
            headers: { "etag": etagUpdated, "x-ratelimit-remaining": "58", "access-control-expose-headers": "etag, x-ratelimit-remaining, link" }
          });
          return;
        }
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "etag": etagUpdated, "x-ratelimit-remaining": "57", "access-control-expose-headers": "etag, x-ratelimit-remaining, link" },
          body: JSON.stringify(liveIssues)
        });
      });
    };

    const ctx1 = await browserType.launchPersistentContext(userDataDir, { viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => { window.__NOX_POLL_INTERVAL__ = 300; });
    await attachRoutes(ctx1);
    const p1 = await ctx1.newPage();
    await p1.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await p1.waitForFunction(() => document.querySelector('.ticket-card[data-number="173"]') !== null, null, { timeout: 5000 });
    await ctx1.close();

    // Sessão 2 (reabrir navegador): #172 e #173 devem aparecer automaticamente sem clicar em Atualizar
    const ctx2 = await browserType.launchPersistentContext(userDataDir, { viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => { window.__NOX_POLL_INTERVAL__ = 300; });
    await attachRoutes(ctx2);
    const p2 = await ctx2.newPage();
    await p2.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await p2.waitForFunction(() => document.querySelector('.ticket-card[data-number="173"]') !== null, null, { timeout: 5000 });
    await p2.waitForTimeout(800);
    assert.equal(await p2.locator('.ticket-card[data-number="172"]').count(), 1);
    assert.equal(await p2.locator('.ticket-card[data-number="173"]').count(), 1);
    assert.equal(await p2.locator('[data-stat="open"]').textContent(), "3");
    await ctx2.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log(`✓ [${browserName}] 1a. Reabertura do navegador preserva tickets recentes e 304 consistente`);
  }

  // 1b. ETag órfão (CACHE_KEY ausente, mas ETag no localStorage) é invalidado quando snapshot diverge
  {
    const browser = await browserType.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const etagOld = 'W/"etag-with-172-173"';
    let sentIfNoneMatchOnFirstCall = null;

    await page.addInitScript((etag) => {
      localStorage.setItem("project-nox-live-etags-v3", JSON.stringify({
        "https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues?state=all&per_page=100&page=1&sort=updated&direction=desc": etag
      }));
      localStorage.setItem("project-nox-live-issues-v3-sig", "sig-anterior-com-173");
    }, etagOld);

    await page.route("**/data/issues.json*", route => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generated_at: "2026-11-21T18:17:31Z", issues: [makeIssue(171)] })
      });
    });
    await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
      const inm = route.request().headers()["if-none-match"] || null;
      if (sentIfNoneMatchOnFirstCall === null) sentIfNoneMatchOnFirstCall = inm;
      if (inm === etagOld) {
        route.fulfill({ status: 304, headers: { etag: etagOld, "x-ratelimit-remaining": "58" } });
        return;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { etag: etagOld, "x-ratelimit-remaining": "57" },
        body: JSON.stringify([makeIssue(171), makeIssue(173)])
      });
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.ticket-card[data-number="173"]') !== null, null, { timeout: 5000 });
    assert.equal(sentIfNoneMatchOnFirstCall, null, "ETag órfão deve ser descartado antes da primeira consulta");
    await browser.close();
    console.log(`✓ [${browserName}] 1b. ETag órfão limpo automaticamente quando cache local ausente`);
  }

  // 2. Paginação 304 na Página 1 com PRs (<100 issues válidas) não interrompe Página 2
  {
    const browser = await browserType.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__NOX_POLL_INTERVAL__ = 300;
      window.__NOX_RECONCILE_INTERVAL__ = 300;
    });

    const page1WithPRs = [
      ...Array.from({ length: 85 }, (_, i) => makeIssue(200 - i, { state: "open" })),
      ...Array.from({ length: 15 }, (_, i) => ({ number: 900 + i, title: `PR ${i}`, state: "open", pull_request: { url: "..." }, labels: [] }))
    ];
    const page2Issues = Array.from({ length: 60 }, (_, i) => makeIssue(100 - i, { state: "open" }));
    let page2Updated = false;

    await page.route("**/data/issues.json*", route => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: "2026-11-21T18:00:00Z", issues: [makeIssue(200)] }) });
    });

    await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
      const url = new URL(route.request().url());
      const p = Number(url.searchParams.get("page") || "1");
      const sort = url.searchParams.get("sort");
      const inm = route.request().headers()["if-none-match"];
      if (sort === "created") {
        if (p === 1) {
          if (inm === '"p1"') {
            route.fulfill({ status: 304, headers: { etag: '"p1"', "x-ratelimit-remaining": "55", "access-control-expose-headers": "etag, link, x-ratelimit-remaining" } });
            return;
          }
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
              etag: '"p1"',
              link: `<${url.origin}${url.pathname}?state=all&per_page=100&page=2&sort=created&direction=desc>; rel="next"`,
              "x-ratelimit-remaining": "55",
              "access-control-expose-headers": "etag, link, x-ratelimit-remaining"
            },
            body: JSON.stringify(page1WithPRs)
          });
          return;
        }
        if (p === 2) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { etag: page2Updated ? '"p2-new"' : '"p2"', "x-ratelimit-remaining": "54", "access-control-expose-headers": "etag, link, x-ratelimit-remaining" },
            body: JSON.stringify(page2Issues)
          });
          return;
        }
      }
      route.fulfill({ status: 200, contentType: "application/json", headers: { "x-ratelimit-remaining": "55" }, body: JSON.stringify(page1WithPRs.slice(0, 85)) });
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#refresh-data").click();
    await page.waitForFunction(() => document.querySelector('[data-stat="total"]')?.textContent === "145", null, { timeout: 5000 });

    page2Issues[0].state = "closed";
    page2Issues[0].updated_at = "2026-11-21T23:45:00Z";
    page2Updated = true;

    await page.waitForFunction(() => document.querySelector('[data-stat="closed"]')?.textContent === "1", null, { timeout: 5000 });
    assert.equal(await page.locator('[data-stat="total"]').textContent(), "145");
    await browser.close();
    console.log(`✓ [${browserName}] 2. Paginação 304 com PRs na página 1 continua para página 2`);
  }

  // 3 & 4. Status honesto antes da API responder + expiração de rateLimitRemaining<15 após 1h + sync imediato no startup
  {
    const browser = await browserType.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    let releaseApi;
    const apiGate = new Promise(r => { releaseApi = r; });
    let apiCalls = 0;

    await page.addInitScript(() => {
      localStorage.setItem("project-nox-live-issues-v3", JSON.stringify([{ number: 142, title: "Old cached", state: "open", labels: [], reactions: { "+1": 0 } }]));
      localStorage.setItem("project-nox-live-issues-v3-time", "2026-11-21T19:00:00Z");
      localStorage.setItem("project-nox-live-issues-v3-live-time", "2026-11-21T19:00:00Z");
      // Rate limit <15 de 2 horas atrás deve expirar automaticamente
      localStorage.setItem("project-nox-rate-limit-v3", JSON.stringify({ remaining: 10, until: 0, updatedAt: Date.now() - 2 * 3600 * 1000 }));
      // Último sync há 70s (> 65s normais, < 180s throttled)
      localStorage.setItem("project-nox-last-api-sync-time-v3", String(Date.now() - 70 * 1000));
    });

    await page.route("**/data/issues.json*", route => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: "2026-11-21T18:17:31Z", issues: [makeIssue(142)] }) });
    });
    await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", async route => {
      apiCalls++;
      await apiGate;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-ratelimit-remaining": "59" },
        body: JSON.stringify([makeIssue(142), makeIssue(175)])
      });
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('[data-stat="open"]')?.textContent === "1", null, { timeout: 5000 });
    const statusBeforeApi = await page.locator("#updated").textContent();
    assert.ok(!statusBeforeApi.includes("Atualizado"), `Status antes da API não pode afirmar 'Atualizado': ${statusBeforeApi}`);
    assert.ok(statusBeforeApi.includes("Cache local"), `Esperado 'Cache local', obtido: ${statusBeforeApi}`);
    assert.equal(apiCalls, 1, "Consulta inicial à API deve ocorrer imediatamente no startup após expirar rate limit antigo");

    releaseApi();
    await page.waitForFunction(() => document.querySelector('.ticket-card[data-number="175"]') !== null, null, { timeout: 5000 });
    const statusAfterApi = await page.locator("#updated").textContent();
    assert.ok(statusAfterApi.includes("Atualizado"), `Esperado 'Atualizado' após resposta real da API: ${statusAfterApi}`);

    await browser.close();
    console.log(`✓ [${browserName}] 3 & 4. Status honesto pré-API, expiração de cota >1h e sync imediato no startup OK`);
  }

  // 5. Retorno à aba inativa (visibilitychange) e bfcache (pageshow persisted) disparam sincronização
  {
    const browser = await browserType.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let phase = 0;

    await page.addInitScript(() => {
      window.__NOX_POLL_INTERVAL__ = 200;
    });
    await page.route("**/data/issues.json*", route => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: "2026-11-21T18:00:00Z", issues: [makeIssue(10)] }) });
    });
    await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
      const list = phase === 0 ? [makeIssue(10)] : [makeIssue(10), makeIssue(180)];
      route.fulfill({ status: 200, contentType: "application/json", headers: { "x-ratelimit-remaining": "55" }, body: JSON.stringify(list) });
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('.ticket-card[data-number="10"]') !== null && document.querySelector("#updated")?.textContent?.includes("Atualizado"), null, { timeout: 5000 });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    phase = 1;
    await page.waitForTimeout(450);
    // Enquanto oculta, não deve ter buscado #180
    assert.equal(await page.locator('.ticket-card[data-number="180"]').count(), 0);

    // Simular retorno via bfcache (pageshow persisted) e visibilidade restaurada
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('.ticket-card[data-number="180"]') !== null, null, { timeout: 5000 });
    await browser.close();
    console.log(`✓ [${browserName}] 5. Retorno à aba inativa / bfcache (pageshow persisted) sincroniza OK`);
  }
}

const { server, baseUrl } = await startStaticServer();
try {
  await runRegressionTests(chromium, "Chromium", baseUrl);
  await runRegressionTests(firefox, "Firefox", baseUrl);
  console.log("\n✅ TODOS OS TESTES DE REGRESSÃO DE SINCRONIZAÇÃO (CHROMIUM + FIREFOX) PASSARAM!");
} finally {
  server.close();
}
