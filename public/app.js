const form = document.querySelector("#download-form");
const urlInput = document.querySelector("#media-url");
const pasteButton = document.querySelector("#paste-button");
const statusMessage = document.querySelector("#status-message");
const previewSection = document.querySelector("#media-preview");
const previewThumbnail = document.querySelector("#preview-thumbnail");
const thumbnailPlaceholder = document.querySelector("#thumbnail-placeholder");
const previewUploader = document.querySelector("#preview-uploader");
const previewTitle = document.querySelector("#preview-title");
const previewCaption = document.querySelector("#preview-caption");
const previewDuration = document.querySelector("#preview-duration");
const downloadButton = document.querySelector("#download-button");
const downloadStatus = document.querySelector("#download-status");

let previewedUrl = "";

function setStatus(element, message, success = false) {
  element.className = success ? "status-message success" : "status-message";
  element.textContent = message;
}

function clearPreview() {
  previewedUrl = "";
  previewSection.hidden = true;
  previewThumbnail.hidden = true;
  previewThumbnail.removeAttribute("src");
  thumbnailPlaceholder.hidden = false;
  previewUploader.hidden = true;
  previewDuration.hidden = true;
  downloadStatus.textContent = "";
  downloadStatus.className = "status-message";
}

function formatDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) return "";
  const seconds = Math.floor(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

pasteButton.addEventListener("click", async () => {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    setStatus(statusMessage, "Clipboard tidak tersedia. Tempel tautan secara manual.");
    return;
  }

  try {
    urlInput.value = await navigator.clipboard.readText();
    clearPreview();
    urlInput.focus();
    setStatus(statusMessage, "");
  } catch {
    setStatus(statusMessage, "Izin clipboard ditolak. Tempel tautan secara manual.");
  }
});

urlInput.addEventListener("input", () => {
  clearPreview();
  setStatus(statusMessage, "");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearPreview();
  setStatus(statusMessage, "");

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Memeriksa tautan…";

  try {
    const url = urlInput.value.trim();
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const result = await response.json();

    if (urlInput.value.trim() !== url) return;
    if (!response.ok) {
      throw new Error(result.error || "Tautan tidak dapat diperiksa.");
    }

    previewedUrl = url;
    previewTitle.textContent = result.title || "Tanpa judul";
    previewCaption.textContent = result.caption || "Tidak ada caption yang disediakan.";

    if (result.uploader) {
      previewUploader.textContent = result.uploader;
      previewUploader.hidden = false;
    }

    const duration = formatDuration(result.duration);
    if (duration) {
      previewDuration.textContent = duration;
      previewDuration.hidden = false;
    }

    if (typeof result.thumbnail === "string" && result.thumbnail.startsWith("https://")) {
      previewThumbnail.onload = () => {
        previewThumbnail.hidden = false;
        thumbnailPlaceholder.hidden = true;
      };
      previewThumbnail.onerror = () => {
        previewThumbnail.hidden = true;
        thumbnailPlaceholder.hidden = false;
      };
      previewThumbnail.src = result.thumbnail;
    }

    previewSection.hidden = false;
  } catch (error) {
    setStatus(statusMessage, error.message || "Terjadi kesalahan saat memeriksa tautan.");
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Cek tautan";
  }
});

downloadButton.addEventListener("click", async () => {
  if (!previewedUrl) return;

  setStatus(downloadStatus, "");
  downloadButton.disabled = true;
  downloadButton.querySelector("span").textContent = "Mengunduh media…";

  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: previewedUrl,
        quality: form.elements.quality.value,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Media tidak dapat diunduh.");
    }

    setStatus(downloadStatus, "Unduhan siap. ", true);
    const link = document.createElement("a");
    link.className = "result-link";
    link.href = result.downloadUrl;
    link.download = result.filename;
    link.textContent = `Simpan ${result.filename}`;
    downloadStatus.append(link);
  } catch (error) {
    setStatus(downloadStatus, error.message || "Terjadi kesalahan saat mengunduh media.");
  } finally {
    downloadButton.disabled = false;
    downloadButton.querySelector("span").textContent = "Unduh video";
  }
});
