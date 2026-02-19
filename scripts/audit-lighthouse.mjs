import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const RUNS_PER_TARGET = 3;
const REQUIRED_CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
];

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const distDir = path.join(projectRoot, 'dist');
const reportsDir = path.join(projectRoot, '.lighthouse');
const lighthouseCliPath = path.join(
  projectRoot,
  'node_modules',
  'lighthouse',
  'cli',
  'index.js'
);

const presetArg = process.argv
  .slice(2)
  .find(arg => arg.startsWith('--preset='));
const requestedPreset = presetArg ? presetArg.split('=')[1] : 'both';

if (!['both', 'mobile', 'desktop'].includes(requestedPreset)) {
  throw new Error(`Unsupported preset "${requestedPreset}". Use both, mobile, or desktop.`);
}

const targets =
  requestedPreset === 'both' ? ['mobile', 'desktop'] : [requestedPreset];

const run = async function (command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      ...options,
    });

    childProcess.on('error', reject);
    childProcess.on('exit', exitCode => {
      if (exitCode === 0) resolve();
      else reject(new Error(`${command} exited with code ${exitCode}`));
    });
  });
};

const fileExists = async function (filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveChromePath = async function () {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return null;
};

const startStaticServer = async function () {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requestPath = decodeURIComponent(requestUrl.pathname);
      const relativePath = requestPath.replace(/^\/+/, '');
      const targetPath = relativePath === '' ? 'index.html' : relativePath;
      const filePath = path.join(distDir, targetPath);
      const resolvedPath = path.resolve(filePath);

      if (!resolvedPath.startsWith(distDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      let body;
      let outputPath = resolvedPath;

      try {
        const stats = await fs.stat(outputPath);
        if (stats.isDirectory()) outputPath = path.join(outputPath, 'index.html');
        body = await fs.readFile(outputPath);
      } catch {
        outputPath = path.join(distDir, 'index.html');
        body = await fs.readFile(outputPath);
      }

      const ext = path.extname(outputPath);
      response.setHeader(
        'Content-Type',
        MIME_TYPES[ext] ?? 'application/octet-stream'
      );
      response.setHeader('Cache-Control', 'no-store');
      response.writeHead(200);
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve local server address.');
  }

  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};

const formatScores = function (scores) {
  return REQUIRED_CATEGORIES.map(category => `${category}: ${scores[category]}`).join(
    ', '
  );
};

const runLighthouseAudit = async function (target, runNumber, url, chromePath) {
  const reportPath = path.join(
    reportsDir,
    `${target}-run-${runNumber}-${Date.now()}.json`
  );
  const userDataDir = path.join(
    os.tmpdir(),
    `forkify-lighthouse-${target}-${runNumber}-${Date.now()}`
  );

  await fs.mkdir(userDataDir, { recursive: true });

  const chromeFlags = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
  ].join(' ');

  const lighthouseArgs = [
    lighthouseCliPath,
    url,
    '--output=json',
    `--output-path=${reportPath}`,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--quiet',
    `--chrome-flags=${chromeFlags}`,
  ];

  if (target === 'desktop') lighthouseArgs.push('--preset=desktop');
  if (chromePath) lighthouseArgs.push(`--chrome-path=${chromePath}`);

  try {
    await run(process.execPath, lighthouseArgs);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    const categoryScores = REQUIRED_CATEGORIES.reduce((scores, category) => {
      const rawScore = report.categories?.[category]?.score;

      if (typeof rawScore !== 'number') {
        throw new Error(`Missing Lighthouse score for category "${category}".`);
      }

      scores[category] = Math.round(rawScore * 100);
      return scores;
    }, {});

    return { reportPath, categoryScores };
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
};

const main = async function () {
  await fs.mkdir(reportsDir, { recursive: true });

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  console.log('Building production bundle...');
  await run(npmCommand, ['run', 'build']);

  if (!(await fileExists(lighthouseCliPath))) {
    throw new Error('Lighthouse CLI is not installed. Run npm install first.');
  }

  const chromePath = await resolveChromePath();
  const server = await startStaticServer();
  const targetUrl = `http://127.0.0.1:${server.port}/`;

  console.log(`Serving dist at ${targetUrl}`);

  try {
    for (const target of targets) {
      console.log(`\nRunning ${target} audits (${RUNS_PER_TARGET} runs)...`);

      for (let runNumber = 1; runNumber <= RUNS_PER_TARGET; runNumber += 1) {
        const { reportPath, categoryScores } = await runLighthouseAudit(
          target,
          runNumber,
          targetUrl,
          chromePath
        );

        console.log(
          `[${target} run ${runNumber}] ${formatScores(categoryScores)}`
        );
        console.log(`Report: ${path.relative(projectRoot, reportPath)}`);

        const failedCategories = REQUIRED_CATEGORIES.filter(
          category => categoryScores[category] < 100
        );

        if (failedCategories.length > 0) {
          throw new Error(
            `${target} run ${runNumber} failed: ${failedCategories.join(', ')} below 100.`
          );
        }
      }
    }

    console.log('\nAll Lighthouse runs passed with 100/100/100/100.');
  } finally {
    await server.close();
  }
};

main().catch(error => {
  console.error(`\nLighthouse audit failed: ${error.message}`);
  process.exitCode = 1;
});
