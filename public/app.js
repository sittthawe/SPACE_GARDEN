const galleryGrid = document.getElementById("gallery-grid");
const emptyState = document.getElementById("empty-state");
const photoCount = document.getElementById("photo-count");
const gallerySync = document.getElementById("gallery-sync");
const lightbox = document.getElementById("lightbox");
const lightboxMediaShell = document.getElementById("lightbox-media-shell");
const lightboxMeta = lightbox.querySelector(".lightbox-meta");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxDescription = document.getElementById("lightbox-description");
const lightboxDate = document.getElementById("lightbox-date");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const lightboxCounter = document.getElementById("lightbox-counter");
const lightboxActions = document.getElementById("lightbox-actions");

let photos = [];
let activeLightboxIndex = -1;
let touchStartX = 0;
let touchStartY = 0;
let touchStartScrollTop = 0;
let touchSurface = "";
let accumulatedWheelDelta = 0;

const MIN_SWIPE_DISTANCE = 44;
const NAVIGATION_WHEEL_THRESHOLD = 40;
const SCROLL_BOUNDARY_TOLERANCE = 2;

document.addEventListener("DOMContentLoaded", () => {
  void loadPhotos();
  lightboxClose.addEventListener("click", closeLightbox);
  lightboxPrev.addEventListener("click", () => showAdjacentPhoto(-1));
  lightboxNext.addEventListener("click", () => showAdjacentPhoto(1));
  galleryGrid.addEventListener("click", handleGalleryClick);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });
  lightboxMediaShell.addEventListener("wheel", handleLightboxMediaWheel, { passive: false });
  lightboxMeta.addEventListener("wheel", handleLightboxTextWheel, { passive: false });
  lightboxMeta.addEventListener("click", handleLightboxClick);
  lightboxMediaShell.addEventListener("touchstart", (event) => handleTouchStart(event, "media"), { passive: true });
  lightboxMediaShell.addEventListener("touchend", handleTouchEnd, { passive: true });
  lightboxMeta.addEventListener("touchstart", (event) => handleTouchStart(event, "text"), { passive: true });
  lightboxMeta.addEventListener("touchend", handleTouchEnd, { passive: true });
  document.addEventListener("keydown", handleKeydown);
});

async function loadPhotos() {
  try {
    const response = await fetch("/api/photos");
    const data = await response.json();
    photos = Array.isArray(data.photos) ? data.photos : [];
    updateHeroStats();
    renderGallery();
  } catch (error) {
    galleryGrid.innerHTML = `
      <article class="empty-state-card">
        <p class="section-kicker">Load failed</p>
        <h2>The gallery could not load right now.</h2>
        <p>Refresh the page after the server is running.</p>
      </article>
    `;
  }
}

function updateHeroStats() {
  const newestPhoto = photos[0];

  photoCount.textContent = `${photos.length} Piece${photos.length === 1 ? "" : "s"}`;
  gallerySync.textContent = newestPhoto ? `Updated ${formatDate(newestPhoto.createdAt, "compact")}` : "Ready to sync";
}

function renderGallery() {
  if (photos.length === 0) {
    galleryGrid.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  galleryGrid.innerHTML = photos
    .map(
      (photo, index) => `
        <article class="gallery-card" data-id="${photo.id}" data-index="${index}" style="animation-delay: ${Math.min(index * 55, 320)}ms">
          <div class="gallery-media">
            <img class="gallery-image" src="${escapeHtml(photo.url)}" alt="${escapeHtml(buildAlt(photo))}" loading="lazy" />
          </div>
          <div class="gallery-meta">
            <div class="gallery-title-row">
              <h3>${escapeHtml(photo.title)}</h3>
            </div>
            ${buildExpandableDescription(photo.description || "Freshly added to the album.")}
            <div class="gallery-actions">
              ${buildGalleryActionButton("download", index, "Download", "download")}
              ${buildGalleryActionButton("copy-description", index, "Copy description", "copy")}
            </div>
            <div class="meta-row">
              <span>${formatDate(photo.createdAt, "long")}</span>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function handleGalleryClick(event) {
  const actionButton = event.target.closest("[data-gallery-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    await handleActionButtonClick(actionButton);
    return;
  }

  const toggle = event.target.closest(".description-toggle");
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    openCardFromElement(toggle);
    return;
  }

  const card = event.target.closest(".gallery-card");
  if (!card) {
    return;
  }

  openCardFromElement(card);
}

function openLightbox(index) {
  if (!photos[index]) {
    return;
  }

  activeLightboxIndex = index;
  renderLightbox();
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

async function handleLightboxClick(event) {
  const actionButton = event.target.closest("[data-gallery-action]");
  if (!actionButton) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  await handleActionButtonClick(actionButton);
}

async function handleActionButtonClick(actionButton) {
  const index = Number(actionButton.dataset.index);
  if (Number.isNaN(index)) {
    return;
  }

  if (actionButton.dataset.galleryAction === "download") {
    downloadPhoto(index);
    return;
  }

  if (actionButton.dataset.galleryAction === "copy-description") {
    await copyPhotoDescription(index, actionButton);
  }
}

function renderLightbox() {
  const photo = photos[activeLightboxIndex];
  if (!photo) {
    closeLightbox();
    return;
  }

  lightboxImage.src = photo.url;
  lightboxImage.alt = buildAlt(photo);
  lightboxTitle.textContent = photo.title;
  lightboxActions.innerHTML = `
    ${buildGalleryActionButton("download", activeLightboxIndex, "Download", "download")}
    ${buildGalleryActionButton("copy-description", activeLightboxIndex, "Copy description", "copy")}
  `;
  lightboxDescription.textContent = photo.description || "No description was added for this image.";
  lightboxDate.textContent = formatDate(photo.createdAt, "long");
  lightboxCounter.textContent = `${activeLightboxIndex + 1} / ${photos.length}`;
  lightboxPrev.disabled = photos.length <= 1;
  lightboxNext.disabled = photos.length <= 1;
  lightboxMeta.scrollTop = 0;
  lightbox.scrollTop = 0;
  accumulatedWheelDelta = 0;
}

function showAdjacentPhoto(direction) {
  if (photos.length <= 1 || activeLightboxIndex === -1) {
    return;
  }

  activeLightboxIndex = (activeLightboxIndex + direction + photos.length) % photos.length;
  renderLightbox();
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.src = "";
  activeLightboxIndex = -1;
  accumulatedWheelDelta = 0;
  document.body.style.overflow = "";
}

function handleKeydown(event) {
  if (lightbox.hidden) {
    return;
  }

  if (event.key === "Escape") {
    closeLightbox();
    return;
  }

  if (event.key === "ArrowLeft") {
    showAdjacentPhoto(-1);
    return;
  }

  if (event.key === "ArrowRight") {
    showAdjacentPhoto(1);
  }
}

function handleLightboxMediaWheel(event) {
  if (photos.length <= 1) {
    return;
  }

  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
    return;
  }

  event.preventDefault();
  queueWheelNavigation(event.deltaY);
}

function handleLightboxTextWheel(event) {
  if (photos.length <= 1) {
    return;
  }

  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
    return;
  }

  if (!isTryingToLeaveScrollableText(event.deltaY)) {
    accumulatedWheelDelta = 0;
    return;
  }

  event.preventDefault();
  queueWheelNavigation(event.deltaY);
}

function queueWheelNavigation(deltaY) {
  accumulatedWheelDelta += deltaY;

  if (Math.abs(accumulatedWheelDelta) < NAVIGATION_WHEEL_THRESHOLD) {
    return;
  }

  showAdjacentPhoto(accumulatedWheelDelta > 0 ? 1 : -1);
  accumulatedWheelDelta = 0;
}

function handleTouchStart(event, surface) {
  const touch = event.changedTouches[0];
  touchStartX = touch?.clientX || 0;
  touchStartY = touch?.clientY || 0;
  touchStartScrollTop = getTextScrollElement().scrollTop;
  touchSurface = surface;
}

function handleTouchEnd(event) {
  if (photos.length <= 1) {
    return;
  }

  const textScrollElement = getTextScrollElement();
  const touch = event.changedTouches[0];
  const deltaX = (touch?.clientX || 0) - touchStartX;
  const deltaY = (touch?.clientY || 0) - touchStartY;

  if (touchSurface === "media") {
    if (Math.abs(deltaX) >= MIN_SWIPE_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY)) {
      showAdjacentPhoto(deltaX < 0 ? 1 : -1);
      return;
    }

    if (Math.abs(deltaY) >= MIN_SWIPE_DISTANCE && Math.abs(deltaY) >= Math.abs(deltaX)) {
      showAdjacentPhoto(deltaY < 0 ? 1 : -1);
    }
    return;
  }

  if (touchSurface !== "text") {
    return;
  }

  if (Math.abs(deltaY) < MIN_SWIPE_DISTANCE || Math.abs(deltaY) < Math.abs(deltaX)) {
    return;
  }

  if (deltaY < 0 && isScrolledToBottom(textScrollElement)) {
    showAdjacentPhoto(1);
    return;
  }

  if (deltaY > 0 && touchStartScrollTop <= SCROLL_BOUNDARY_TOLERANCE && isScrolledToTop(textScrollElement)) {
    showAdjacentPhoto(-1);
  }
}

function isTryingToLeaveScrollableText(deltaY) {
  const textScrollElement = getTextScrollElement();
  if (deltaY > 0) {
    return isScrolledToBottom(textScrollElement);
  }

  return isScrolledToTop(textScrollElement);
}

function getTextScrollElement() {
  return lightboxMeta.scrollHeight > lightboxMeta.clientHeight + SCROLL_BOUNDARY_TOLERANCE ? lightboxMeta : lightbox;
}

function isScrolledToTop(element) {
  return element.scrollTop <= SCROLL_BOUNDARY_TOLERANCE;
}

function isScrolledToBottom(element) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - SCROLL_BOUNDARY_TOLERANCE;
}

function buildAlt(photo) {
  if (!photo.description) {
    return photo.title;
  }

  return `${photo.title}. ${String(photo.description).replace(/\s+/g, " ").trim()}`;
}

function buildExpandableDescription(text, threshold = 180) {
  const normalized = String(text || "").trim();
  const needsToggle = normalized.length > threshold;

  return `
    <div class="description-block">
      <p class="description-copy${needsToggle ? " is-collapsed" : ""}">${escapeHtml(normalized)}</p>
      ${needsToggle ? '<button class="description-toggle" type="button">View details</button>' : ""}
    </div>
  `;
}

function buildGalleryActionButton(action, index, label, icon) {
  return `
    <button
      class="gallery-action-button"
      type="button"
      data-gallery-action="${action}"
      data-index="${index}"
      data-default-label="${escapeHtml(label)}"
      data-default-icon="${escapeHtml(icon)}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
    >
      ${buildGalleryActionIcon(icon)}
      <span class="sr-only">${escapeHtml(label)}</span>
    </button>
  `;
}

function buildGalleryActionIcon(icon) {
  if (icon === "download") {
    return `
      <svg class="gallery-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 4v10" />
        <path d="m8.5 11.5 3.5 3.5 3.5-3.5" />
        <path d="M5 18.5h14" />
      </svg>
    `;
  }

  if (icon === "check") {
    return `
      <svg class="gallery-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    `;
  }

  return `
    <svg class="gallery-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  `;
}

function openCardFromElement(element) {
  const card = element.closest(".gallery-card");
  if (!card) {
    return;
  }

  const index = Number(card.dataset.index);
  if (!Number.isNaN(index)) {
    openLightbox(index);
  }
}

function downloadPhoto(index) {
  const photo = photos[index];
  if (!photo?.url) {
    return;
  }

  const link = document.createElement("a");
  link.href = photo.url;
  link.download = buildDownloadFilename(photo);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function copyPhotoDescription(index, button) {
  const photo = photos[index];
  if (!photo) {
    return;
  }

  const description = String(photo.description || "").trim() || "No description was added for this image.";

  try {
    await writeClipboardText(description);
    flashActionFeedback(button, "Copied", "check");
  } catch (error) {
    flashActionFeedback(button, "Copy failed", "copy", 2000);
  }
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function flashActionFeedback(button, label, icon, duration = 1600) {
  if (!button) {
    return;
  }

  const originalLabel = button.dataset.defaultLabel || button.getAttribute("aria-label") || "";
  const originalIcon = button.dataset.defaultIcon || "copy";
  button.disabled = true;
  setGalleryActionButtonContent(button, label, icon);

  const existingTimer = Number(button.dataset.feedbackTimer || 0);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    setGalleryActionButtonContent(button, originalLabel, originalIcon);
    button.disabled = false;
    button.dataset.feedbackTimer = "";
  }, duration);

  button.dataset.feedbackTimer = String(timer);
}

function setGalleryActionButtonContent(button, label, icon) {
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `${buildGalleryActionIcon(icon)}<span class="sr-only">${escapeHtml(label)}</span>`;
}

function buildDownloadFilename(photo) {
  const baseName = slugifyFilenamePart(photo.title || "spacegarden-image");
  return `${baseName}${resolvePhotoExtension(photo)}`;
}

function slugifyFilenamePart(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "spacegarden-image";
}

function resolvePhotoExtension(photo) {
  try {
    const pathname = new URL(photo.url, window.location.origin).pathname;
    const match = pathname.match(/\.[a-z0-9]+$/i);
    if (match) {
      return match[0].toLowerCase();
    }
  } catch (error) {
    // Fall through to mime type defaults.
  }

  const extensionsByMimeType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };

  return extensionsByMimeType[String(photo.mimeType || "").toLowerCase()] || ".jpg";
}

function formatDate(value, style = "long") {
  try {
    if (style === "compact") {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value));
    }

    if (style === "short") {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(new Date(value));
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(value));
  } catch (error) {
    return "Recent upload";
  }
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}







