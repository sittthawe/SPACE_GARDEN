const loginPanel = document.getElementById("login-panel");
const adminOverview = document.getElementById("admin-overview");
const adminGrid = document.getElementById("admin-grid");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const uploadForm = document.getElementById("upload-form");
const uploadStatus = document.getElementById("upload-status");
const adminGallery = document.getElementById("admin-gallery");
const adminEmpty = document.getElementById("admin-empty");
const adminCount = document.getElementById("admin-count");
const adminLibraryCount = document.getElementById("admin-library-count");
const adminLatest = document.getElementById("admin-latest");
const adminStorage = document.getElementById("admin-storage");
const logoutButton = document.getElementById("logout-button");
const photoInput = document.getElementById("photo-input");
const uploadPreviewShell = document.getElementById("upload-preview-shell");
const uploadPreview = document.getElementById("upload-preview");
const previewMeta = document.getElementById("preview-meta");
const previewName = document.getElementById("preview-name");

let photos = [];
let previewUrl = "";
let editingPhotoId = "";

document.addEventListener("DOMContentLoaded", () => {
  loginForm.addEventListener("submit", handleLogin);
  uploadForm.addEventListener("submit", handleUpload);
  logoutButton.addEventListener("click", handleLogout);
  photoInput.addEventListener("change", handlePreview);
  adminGallery.addEventListener("click", handleAdminGalleryClick);
  adminGallery.addEventListener("submit", handleAdminGallerySubmit);
  void bootstrapAdmin();
});

async function bootstrapAdmin() {
  const authenticated = await checkSession();
  if (authenticated) {
    showAdmin();
    await loadPhotos();
  } else {
    showLogin();
  }
}

async function checkSession() {
  try {
    const response = await fetch("/api/admin/session");
    const data = await response.json();
    return Boolean(data.authenticated);
  } catch (error) {
    loginStatus.textContent = "Server is not reachable yet.";
    return false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const password = String(formData.get("password") || "");

  loginStatus.textContent = "Checking credentials...";

  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const data = await response.json();
  if (!response.ok) {
    loginStatus.textContent = data.error || "Login failed.";
    return;
  }

  loginForm.reset();
  loginStatus.textContent = "Signed in.";
  showAdmin();
  await loadPhotos();
}

async function handleUpload(event) {
  event.preventDefault();

  const submitButton = uploadForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  uploadStatus.textContent = "Uploading photo...";

  try {
    const response = await fetch("/api/admin/photos", {
      method: "POST",
      body: new FormData(uploadForm),
    });

    const data = await response.json();
    if (!response.ok) {
      uploadStatus.textContent = data.error || "Upload failed.";
      return;
    }

    uploadForm.reset();
    clearPreview();
    uploadStatus.textContent = "Photo uploaded successfully.";
    await loadPhotos();
  } catch (error) {
    uploadStatus.textContent = "Upload failed because the server could not be reached.";
  } finally {
    submitButton.disabled = false;
  }
}

async function handleDelete(photoId) {
  const approved = window.confirm("Delete this photo from the album?");
  if (!approved) {
    return;
  }

  const response = await fetch(`/api/admin/photos/${photoId}`, {
    method: "DELETE",
  });

  const data = await response.json();
  if (!response.ok) {
    uploadStatus.textContent = data.error || "Delete failed.";
    return;
  }

  if (editingPhotoId === photoId) {
    editingPhotoId = "";
  }

  uploadStatus.textContent = "Photo deleted.";
  await loadPhotos();
}

async function handleLogout() {
  await fetch("/api/admin/logout", { method: "POST" });
  editingPhotoId = "";
  showLogin();
  loginStatus.textContent = "Logged out.";
}

async function loadPhotos() {
  const response = await fetch("/api/photos");
  const data = await response.json();
  photos = Array.isArray(data.photos) ? data.photos : [];
  if (editingPhotoId && !photos.some((photo) => photo.id === editingPhotoId)) {
    editingPhotoId = "";
  }
  updateOverview();
  renderAdminGallery();
}

function updateOverview() {
  const totalSize = photos.reduce((sum, photo) => sum + Number(photo.size || 0), 0);
  const newestPhoto = photos[0];
  const countLabel = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;

  adminCount.textContent = countLabel;
  adminLibraryCount.textContent = countLabel;
  adminLatest.textContent = newestPhoto ? formatDate(newestPhoto.createdAt, "compact") : "No uploads yet";
  adminStorage.textContent = formatFileSize(totalSize);
}

function renderAdminGallery() {
  if (photos.length === 0) {
    adminGallery.innerHTML = "";
    adminEmpty.hidden = false;
    return;
  }

  adminEmpty.hidden = true;
  adminGallery.innerHTML = photos
    .map(
      (photo, index) =>
        photo.id === editingPhotoId ? renderEditablePhotoCard(photo, index) : renderAdminPhotoCard(photo, index)
    )
    .join("");
}

function handleAdminGalleryClick(event) {
  const toggle = event.target.closest(".description-toggle");
  if (toggle) {
    event.preventDefault();
    toggleDescription(toggle);
    return;
  }

  const editButton = event.target.closest("[data-edit-id]");
  if (editButton) {
    editingPhotoId = editButton.dataset.editId || "";
    renderAdminGallery();
    return;
  }

  const cancelButton = event.target.closest("[data-cancel-edit-id]");
  if (cancelButton) {
    if (editingPhotoId === cancelButton.dataset.cancelEditId) {
      editingPhotoId = "";
      renderAdminGallery();
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) {
    void handleDelete(deleteButton.dataset.deleteId);
  }
}

async function handleAdminGallerySubmit(event) {
  const form = event.target.closest(".admin-edit-form");
  if (!form) {
    return;
  }

  event.preventDefault();
  const photoId = form.dataset.photoId || "";
  const submitButton = form.querySelector("button[type='submit']");
  const cancelButton = form.querySelector("[data-cancel-edit-id]");
  const formData = new FormData(form);
  const payload = {
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || ""),
  };

  if (submitButton) {
    submitButton.disabled = true;
  }

  if (cancelButton) {
    cancelButton.disabled = true;
  }

  uploadStatus.textContent = "Saving changes...";

  try {
    const response = await fetch(`/api/admin/photos/${photoId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      uploadStatus.textContent = data.error || "Update failed.";
      return;
    }

    editingPhotoId = "";
    uploadStatus.textContent = "Photo updated.";
    await loadPhotos();
  } catch (error) {
    uploadStatus.textContent = "Update failed because the server could not be reached.";
  } finally {
    if (submitButton && form.isConnected) {
      submitButton.disabled = false;
    }

    if (cancelButton && form.isConnected) {
      cancelButton.disabled = false;
    }
  }
}

function showAdmin() {
  loginPanel.hidden = true;
  adminOverview.hidden = false;
  adminGrid.hidden = false;
  logoutButton.hidden = false;
}

function showLogin() {
  loginPanel.hidden = false;
  adminOverview.hidden = true;
  adminGrid.hidden = true;
  logoutButton.hidden = true;
}

function handlePreview() {
  const [file] = photoInput.files || [];
  if (!file) {
    clearPreview();
    return;
  }

  clearPreview();
  previewUrl = URL.createObjectURL(file);
  uploadPreview.src = previewUrl;
  uploadPreviewShell.hidden = false;
  previewMeta.hidden = false;
  previewName.textContent = `${file.name} - ${formatFileSize(file.size)}`;
}

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  previewUrl = "";
  uploadPreview.src = "";
  uploadPreviewShell.hidden = true;
  previewMeta.hidden = true;
  previewName.textContent = "";
}

function renderAdminPhotoCard(photo, index) {
  return `
    <article class="admin-photo-card" style="animation-delay: ${Math.min(index * 55, 320)}ms">
      <div class="admin-photo-media">
        <img class="admin-photo-image" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.title)}" loading="lazy" />
        <span class="admin-photo-badge">${formatDate(photo.createdAt, "compact")}</span>
      </div>
      <div class="admin-photo-meta">
        <div class="admin-photo-headline">
          <h3>${escapeHtml(photo.title)}</h3>
          <span class="gallery-badge gallery-badge-soft">${formatFileSize(photo.size)}</span>
        </div>
        ${buildExpandableDescription(photo.description || "No description")}
        <div class="admin-photo-actions">
          <button class="button button-secondary" data-edit-id="${photo.id}" type="button">Edit</button>
          <button class="button button-danger" data-delete-id="${photo.id}" type="button">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderEditablePhotoCard(photo, index) {
  return `
    <article class="admin-photo-card is-editing" style="animation-delay: ${Math.min(index * 55, 320)}ms">
      <div class="admin-photo-media">
        <img class="admin-photo-image" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.title)}" loading="lazy" />
        <span class="admin-photo-badge">${formatDate(photo.createdAt, "compact")}</span>
      </div>
      <div class="admin-photo-meta">
        <div class="admin-photo-headline">
          <h3>Edit details</h3>
          <span class="gallery-badge gallery-badge-soft">${formatFileSize(photo.size)}</span>
        </div>
        <p class="status-line admin-edit-note">Changes publish to the live gallery right away.</p>
        <form class="admin-edit-form" data-photo-id="${photo.id}">
          <label class="field">
            <span>Title</span>
            <input type="text" name="title" maxlength="120" value="${escapeHtml(photo.title)}" placeholder="Photo title" />
          </label>
          <label class="field">
            <span>Description</span>
            <textarea name="description" rows="6" placeholder="Update the story, prompt, or infinity-inspired details">${escapeHtml(
              photo.description || ""
            )}</textarea>
          </label>
          <div class="admin-edit-actions">
            <button class="button button-primary" type="submit">Save</button>
            <button class="button button-secondary" data-cancel-edit-id="${photo.id}" type="button">Cancel</button>
          </div>
        </form>
      </div>
    </article>
  `;
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
        year: "numeric",
      }).format(new Date(value));
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: style === "long" ? "short" : undefined,
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



