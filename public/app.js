const galleryGrid = document.getElementById("gallery-grid");
const emptyState = document.getElementById("empty-state");
const photoCount = document.getElementById("photo-count");
const gallerySync = document.getElementById("gallery-sync");
const heroTotal = document.getElementById("hero-total");
const heroLastUpload = document.getElementById("hero-last-upload");
const heroStorage = document.getElementById("hero-storage");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxDescription = document.getElementById("lightbox-description");
const lightboxDate = document.getElementById("lightbox-date");
const lightboxClose = document.getElementById("lightbox-close");

let photos = [];

document.addEventListener("DOMContentLoaded", () => {
  void loadPhotos();
  lightboxClose.addEventListener("click", closeLightbox);
  galleryGrid.addEventListener("click", handleGalleryClick);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
    }
  });
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
        <article class="gallery-card" data-id="${photo.id}" style="animation-delay: ${Math.min(index * 55, 320)}ms">
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
              <span class="gallery-open-indicator">Open</span>
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

  const photo = photos.find((entry) => entry.id === card.dataset.id);
  if (photo) {
    openLightbox(photo);
  }
}

function openLightbox(photo) {
  lightboxImage.src = photo.url;
  lightboxImage.alt = buildAlt(photo);
  lightboxTitle.textContent = photo.title;
  lightboxDescription.textContent = photo.description || "No description was added for this image.";
  lightboxDate.textContent = formatDate(photo.createdAt, "long");
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.src = "";
  document.body.style.overflow = "";
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

