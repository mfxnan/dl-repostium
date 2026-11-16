const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const root = path.join(__dirname, "public");
const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dl-repostium-"));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
};
const supportedHosts = ["tiktok.com", "instagram.com", "facebook.com", "fb.watch"];
const qualityFormats = {
  best: "best[ext=mp4]/best",
  "1080": "best[height<=1080][ext=mp4]/best[height<=1080]/best",
  "720": "best[height<=720][ext=mp4]/best[height<=720]/best",
  "480": "best[height<=480][ext=mp4]/best[height<=480]/best",
  "360": "best[height<=360][ext=mp4]/best[height<=360]/best",
};
const completedDownloads = new Map();
const maxActiveYtDlpJobs = 2;
const downloadLifetimeMs = 30 * 60 * 1000;
const maxDownloadBytes = 300 * 1024 * 1024;
let activeYtDlpJobs = 0;

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function parseBody(request, response, callback) {
  let body = "";
  let bodySize = 0;
  let tooLarge = false;
  request.on("data", (chunk) => {
    bodySize += chunk.length;
    if (bodySize > 4096) {
      if (!tooLarge) sendJson(response, 413, { error: "Permintaan terlalu besar." });
      tooLarge = true;
      return;
    }
    body += chunk;
  });
  request.on("end", () => {
    if (tooLarge) return;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(response, 400, { error: "Permintaan tidak valid." });
      return;
    }
    callback(payload);
  });
}

function validateMediaUrl(value) {
  let mediaUrl;
  try {
    mediaUrl = new URL(value);
  } catch {
    return "Masukkan tautan video yang valid.";
  }

  const hostname = mediaUrl.hostname.toLowerCase();
  const allowedHost = supportedHosts.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.username ||
    mediaUrl.password ||
    mediaUrl.port ||
    !allowedHost
  ) {
    return "Gunakan tautan publik TikTok, Instagram, atau Facebook.";
  }
  return null;
}

function runYtDlp(args, { timeoutMs = 3 * 60 * 1000, maxStdout = 16_384 } = {}) {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "yt_dlp", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let outputTooLarge = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("timeout"));
    }, timeoutMs);

    function finish(error, output) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxStdout) {
        outputTooLarge = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on("error", () => finish(new Error("unavailable")));
    child.on("close", (code) => {
      if (outputTooLarge) {
        finish(new Error("output_too_large"));
        return;
      }
      if (code !== 0) {
        if (stderr.includes("yt_dlp")) {
          finish(new Error("unavailable"));
        } else if (
          /login[_ -]required|requires? login|please log ?in|log ?in to (?:access|continue|view)|sign ?in to (?:access|continue|view|confirm)|authentication required|checkpoint required/i.test(stderr)
        ) {
          finish(new Error("login_required"));
        } else {
          finish(new Error("download"));
        }
        return;
      }
      finish(null, stdout.trim().split(/\r?\n/).pop());
    });
  });
}

function sendYtDlpError(response, error) {
  if (error.message === "unavailable") {
    sendJson(response, 503, { error: "yt-dlp belum terpasang atau tidak tersedia di server." });
  } else if (error.message === "timeout") {
    sendJson(response, 504, { error: "Proses terlalu lama dan dihentikan. Coba lagi nanti." });
  } else if (error.message === "login_required") {
    sendJson(response, 403, {
      error: "Platform meminta login untuk media ini. Downloader hanya mendukung konten publik tanpa login. Jangan unggah cookie akun ke server.",
    });
  } else if (error.message === "output_too_large") {
    sendJson(response, 502, { error: "Metadata media terlalu besar untuk diproses." });
  } else {
    sendJson(response, 422, {
      error: "Media tidak dapat diproses. Pastikan tautan publik dan media dapat diakses.",
    });
    if (error.message !== "download" && error.message !== "invalid_metadata") {
      console.error("yt-dlp request failed:", error.message);
    }
  }
}

function getThumbnail(metadata) {
  const thumbnails = Array.isArray(metadata.thumbnails) ? metadata.thumbnails : [];
  const candidates = [
    metadata.thumbnail,
    ...thumbnails.map((thumbnail) =>
      thumbnail && typeof thumbnail.url === "string" ? thumbnail.url : null,
    ),
  ];
  for (const candidate of candidates.reverse()) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") return url.href;
    } catch {
      continue;
    }
  }
  return null;
}

async function handlePreview(payload, response) {
  if (activeYtDlpJobs >= maxActiveYtDlpJobs) {
    sendJson(response, 429, { error: "Server sedang sibuk. Coba lagi sebentar." });
    return;
  }
  if (!payload || typeof payload !== "object" || typeof payload.url !== "string") {
    sendJson(response, 400, { error: "Masukkan tautan video yang valid." });
    return;
  }
  const url = payload.url.trim();
  const urlError = validateMediaUrl(url);
  if (urlError) {
    sendJson(response, 400, { error: urlError });
    return;
  }

  activeYtDlpJobs += 1;
  try {
    const output = await runYtDlp([
      "--no-playlist",
      "--no-warnings",
      "--no-check-formats",
      "--skip-download",
      "--dump-single-json",
      "--",
      url,
    ], { timeoutMs: 60_000, maxStdout: 5 * 1024 * 1024 });
    let metadata;
    try {
      metadata = JSON.parse(output);
    } catch {
      throw new Error("invalid_metadata");
    }
    if (!metadata || typeof metadata !== "object") {
      throw new Error("invalid_metadata");
    }

    sendJson(response, 200, {
      title: typeof metadata.title === "string" && metadata.title.trim()
        ? metadata.title.slice(0, 500)
        : "Tanpa judul",
      caption: typeof metadata.description === "string"
        ? metadata.description.slice(0, 10_000)
        : "",
      thumbnail: getThumbnail(metadata),
      duration: Number.isFinite(metadata.duration) ? metadata.duration : null,
      uploader: typeof metadata.uploader === "string"
        ? metadata.uploader.slice(0, 200)
        : null,
    });
  } catch (error) {
    sendYtDlpError(response, error);
  } finally {
    activeYtDlpJobs -= 1;
  }
}

async function handleDownload(payload, response) {
  if (activeYtDlpJobs >= maxActiveYtDlpJobs) {
    sendJson(response, 429, { error: "Server sedang sibuk. Coba lagi sebentar." });
    return;
  }
  if (!payload || typeof payload !== "object" || typeof payload.url !== "string") {
    sendJson(response, 400, { error: "Masukkan tautan video yang valid." });
    return;
  }
  const url = payload.url.trim();
  const urlError = validateMediaUrl(url);
  if (urlError) {
    sendJson(response, 400, { error: urlError });
    return;
  }

  const format = Object.hasOwn(qualityFormats, payload.quality)
    ? qualityFormats[payload.quality]
    : qualityFormats.best;
  activeYtDlpJobs += 1;
  let jobDirectory;
  try {
    jobDirectory = await fs.promises.mkdtemp(path.join(downloadRoot, "job-"));
    const output = await runYtDlp([
      "--no-playlist",
      "--no-warnings",
      "--max-filesize", "300M",
      "--format", format,
      "--output", "%(id)s.%(ext)s",
      "--paths", `home:${jobDirectory}`,
      "--print", "after_move:filepath",
      "--",
      url,
    ]);
    const outputPath = output.trim().split(/\r?\n/).pop();
    const resolvedOutput = path.resolve(outputPath);
    if (!resolvedOutput.startsWith(`${jobDirectory}${path.sep}`)) {
      throw new Error("download");
    }
    const stat = await fs.promises.stat(resolvedOutput);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxDownloadBytes) {
      throw new Error("download");
    }

    const id = crypto.randomUUID();
    const filename = path.basename(resolvedOutput).replace(/[^a-zA-Z0-9._-]/g, "_");
    completedDownloads.set(id, {
      directory: jobDirectory,
      filepath: resolvedOutput,
      filename,
      expiresAt: Date.now() + downloadLifetimeMs,
    });
    sendJson(response, 200, { downloadUrl: `/api/files/${id}`, filename });
  } catch (error) {
    if (jobDirectory) {
      await fs.promises.rm(jobDirectory, { recursive: true, force: true });
    }
    sendYtDlpError(response, error);
  } finally {
    activeYtDlpJobs -= 1;
  }
}

function serveDownload(id, response) {
  const entry = completedDownloads.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) {
      completedDownloads.delete(id);
      fs.promises.rm(entry.directory, { recursive: true, force: true }).catch(() => {});
    }
    sendJson(response, 404, { error: "File tidak ditemukan atau sudah kedaluwarsa." });
    return;
  }

  fs.stat(entry.filepath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendJson(response, 404, { error: "File tidak ditemukan atau sudah kedaluwarsa." });
      return;
    }
    const extension = path.extname(entry.filename).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${entry.filename}"`,
      "X-Content-Type-Options": "nosniff",
    });
    const stream = fs.createReadStream(entry.filepath);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
}

setInterval(() => {
  for (const [id, entry] of completedDownloads) {
    if (entry.expiresAt <= Date.now()) {
      completedDownloads.delete(id);
      fs.promises.rm(entry.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 60_000).unref();

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");

  if (request.method === "POST" && requestUrl.pathname === "/api/preview") {
    parseBody(request, response, (payload) => {
      handlePreview(payload, response).catch((error) => {
        if (!response.headersSent) sendYtDlpError(response, error);
      });
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/download") {
    parseBody(request, response, (payload) => {
      handleDownload(payload, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: "Terjadi kesalahan pada server." });
      });
    });
    return;
  }

  const fileMatch = requestUrl.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && fileMatch) {
    serveDownload(fileMatch[1], response);
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET, POST" });
    response.end("Method Not Allowed");
    return;
  }

  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not Found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`dl-repostium berjalan di http://localhost:${port}`);
});
