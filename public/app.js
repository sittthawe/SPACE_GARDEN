const galleryGrid = document.getElementById("gallery-grid");
const emptyState = document.getElementById("empty-state");
const photoCount = document.getElementById("photo-count");
const gallerySync = document.getElementById("gallery-sync");
const heroTotal = document.getElementById("hero-total");
const heroLastUpload = document.getElementById("hero-last-upload");
const heroStorage = document.getElementById("hero-storage");
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
  const totalSize = photos.reduce((sum, photo) => sum + Number(photo.size || 0), 0);
  const newestPhoto = photos[0];

  heroTotal.textContent = String(photos.length);
  heroLastUpload.textContent = newestPhoto ? formatDate(newestPhoto.createdAt, "short") : "Waiting";
  heroStorage.textContent = formatFileSize(totalSize);
  photoCount.textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"} live`;
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
            <div class="gallery-badge-row">
              <span class="gallery-badge">${index === 0 ? "Newest" : formatDate(photo.createdAt, "compact")}</span>
              <span class="gallery-badge gallery-badge-soft">${formatFileSize(photo.size)}</span>
            </div>
          </div>
          <div class="gallery-meta">
            <div class="gallery-title-row">
              <h3>${escapeHtml(photo.title)}</h3>
            </div>
            ${buildExpandableDescription(photo.description || "Freshly added to the album.")}
            <div class="meta-row">
              <span>${formatDate(photo.createdAt, "long")}</span>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function handleGalleryClick(event) {
  const toggle = event.target.closest(".description-toggle");
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleDescription(toggle);
    return;
  }

  const card = event.target.closest(".gallery-card");
  if (!card) {
    return;
  }

  const index = Number(card.dataset.index);
  if (!Number.isNaN(index)) {
    openLightbox(index);
  }
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

function renderLightbox() {
  const photo = photos[activeLightboxIndex];
  if (!photo) {
    closeLightbox();
    return;
  }

  lightboxImage.src = photo.url;
  lightboxImage.alt = buildAlt(photo);
  lightboxTitle.textContent = photo.title;
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
      ${needsToggle ? '<button class="description-toggle" type="button">See more</button>' : ""}
    </div>
  `;
}

function toggleDescription(button) {
  const block = button.closest(".description-block");
  const copy = block?.querySelector(".description-copy");
  if (!copy) {
    return;
  }

  const expanded = copy.classList.toggle("is-expanded");
  copy.classList.toggle("is-collapsed", !expanded);
  button.textContent = expanded ? "See less" : "See more";
}

function formatDate(value, style = "long") {
  try {
    if (style === "compact") {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
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

function formatFileSize(bytes) {
  const numeric = Number(bytes || 0);
  if (numeric < 1024) {
    return `${numeric} B`;
  }
  if (numeric < 1024 * 1024) {
    return `${Math.round(numeric / 1024)} KB`;
  }
  return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}




