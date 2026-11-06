
(() => {
  "use strict";

  // --------------------------------------------------
  // Elements and settings
  // --------------------------------------------------

  const fileInput = document.getElementById("file-input");
  const dropZone = document.getElementById("drop-zone");
  const selectedFile = document.getElementById("selected-file");
  const fileName = document.getElementById("file-name");
  const fileSize = document.getElementById("file-size");
  const removeFileButton = document.getElementById("remove-file");
  const validationMessage = document.getElementById("validation-message");
  const validationText = document.getElementById("validation-text");
  const processButton = document.getElementById("process-button");
  const privacyCard = document.querySelector(".privacy-card");

  const privacyCardOriginalParent = privacyCard
    ? privacyCard.parentNode
    : null;

  const privacyCardOriginalNextSibling = privacyCard
    ? privacyCard.nextSibling
    : null;

  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  const MAX_JSON_FILES = 1000;

  const METADATA_API_URL =
    "https://spotistats-metadata.shawnfinkle6.workers.dev";

  const METADATA_BATCH_SIZE = 10;

  let currentFile = null;
  let validatedRecords = [];
  let validationRun = 0;
  let isValidated = false;
  let dashboardRecords = [];
  let selectedPeriod = "all";

  const artistMetadataCache = new Map();
  const artistMetadataRequests = new Map();
  const artistImageCache = new Map();

  const albumCoverCache = new Map();
  const albumCoverRequests = new Map();

  let metadataLoading = false;
  let albumCoverLoading = false;
  let artistImageLoading = false;

  let metadataLoadedCount = 0;
  let metadataTotalCount = 0;
  let artistImagesLoadedCount = 0;

  // --------------------------------------------------
  // General helpers
  // --------------------------------------------------

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeArtistKey(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatDuration(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) return `${minutes} min`;

    return `${hours.toLocaleString()} hr ${remainingMinutes} min`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;

    return element;
  }

  // --------------------------------------------------
  // Upload messages and button state
  // --------------------------------------------------

  function showMessage(message, type = "error") {
    if (!validationText || !validationMessage) return;

    validationText.textContent = message;
    validationMessage.hidden = false;

    if (type === "success") {
      validationMessage.style.background = "rgba(168, 230, 160, 0.07)";
      validationMessage.style.borderColor = "rgba(168, 230, 160, 0.25)";
      validationMessage.style.color = "#a8e6a0";
    } else if (type === "info") {
      validationMessage.style.background = "rgba(213, 251, 98, 0.06)";
      validationMessage.style.borderColor = "rgba(213, 251, 98, 0.2)";
      validationMessage.style.color = "#d5fb62";
    } else {
      validationMessage.style.background = "";
      validationMessage.style.borderColor = "";
      validationMessage.style.color = "";
    }
  }

  function hideMessage() {
    if (!validationMessage || !validationText) return;

    validationMessage.hidden = true;
    validationText.textContent = "";
    validationMessage.style.background = "";
    validationMessage.style.borderColor = "";
    validationMessage.style.color = "";
  }

  function setButtonState(enabled) {
    if (processButton) {
      processButton.disabled = !enabled;
    }
  }

  // --------------------------------------------------
  // Upload display and reset
  // --------------------------------------------------

  function displaySelectedFile(file) {
    if (!fileName || !fileSize || !selectedFile) return;

    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    selectedFile.hidden = false;
  }

  function resetUpload() {
    validationRun++;

    currentFile = null;
    validatedRecords = [];
    isValidated = false;

    if (fileInput) fileInput.value = "";
    if (selectedFile) selectedFile.hidden = true;
    if (fileName) fileName.textContent = "";
    if (fileSize) fileSize.textContent = "";

    hideMessage();
    setButtonState(false);

    if (processButton) {
      processButton.innerHTML =
        'Process listening history <span>→</span>';
    }
  }

  // --------------------------------------------------
  // File selection
  // --------------------------------------------------

  function handleFileSelection(file) {
    if (!file) return;

    resetUpload();

    currentFile = file;
    displaySelectedFile(file);

    if (!file.name.toLowerCase().endsWith(".zip")) {
      currentFile = null;

      showMessage(
        "This file is not a ZIP archive. Please select your Spotify Extended Streaming History ZIP file."
      );

      return;
    }

    if (file.size === 0) {
      currentFile = null;

      showMessage(
        "This file is empty. Please download your Spotify data again and try another file."
      );

      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      currentFile = null;

      showMessage(
        "This file is larger than the 500 MB limit. Please check your Spotify export and try another file."
      );

      return;
    }

    validateSpotifyFile(file);
  }

  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      handleFileSelection(event.target.files[0]);
    });
  }

  if (removeFileButton) {
    removeFileButton.addEventListener("click", resetUpload);
  }

  // --------------------------------------------------
  // Drag and drop
  // --------------------------------------------------

  if (dropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();

        dropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();

        dropZone.classList.remove("drag-over");
      });
    });

    dropZone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files[0];

      if (file) handleFileSelection(file);
    });
  }

  // --------------------------------------------------
  // Spotify record recognition
  // --------------------------------------------------

  function getSpotifyRecordFields(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return null;
    }

    const trackName =
      record.trackName || record.master_metadata_track_name;

    const artistName =
      record.artistName ||
      record.master_metadata_album_artist_name;

    const timestamp = record.endTime || record.ts;

    const duration =
      typeof record.msPlayed === "number"
        ? record.msPlayed
        : record.ms_played;

    if (
      typeof trackName !== "string" ||
      !trackName.trim() ||
      typeof artistName !== "string" ||
      !artistName.trim() ||
      typeof timestamp !== "string" ||
      !timestamp.trim() ||
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration < 0
    ) {
      return null;
    }

    const parsedDate = new Date(timestamp);

    if (Number.isNaN(parsedDate.getTime())) return null;

    return {
      trackName: trackName.trim(),
      artistName: artistName.trim(),
      timestamp,
      date: parsedDate,
      duration,
      albumName:
        record.albumName ||
        record.master_metadata_album_album_name ||
        null,
      spotifyTrackUri: record.spotify_track_uri || null
    };
  }

  function isSpotifyHistoryFilename(filename) {
    const basename = filename.split("/").pop();

    return /^(Streaming_History.*|endsong.*)\.json$/i.test(basename);
  }

  // --------------------------------------------------
  // ZIP and JSON validation
  // --------------------------------------------------

  async function validateSpotifyFile(file) {
    const thisRun = validationRun;

    isValidated = false;
    validatedRecords = [];

    setButtonState(false);

    showMessage("Checking your ZIP file...", "info");

    try {
      if (!window.JSZip) {
        throw new Error(
          "The ZIP-reading library could not be loaded. Please refresh the page and try again."
        );
      }

      const zip = await window.JSZip.loadAsync(file);

      if (thisRun !== validationRun) return;

      const jsonFiles = Object.values(zip.files).filter(
        (entry) =>
          !entry.dir && isSpotifyHistoryFilename(entry.name)
      );

      if (jsonFiles.length === 0) {
        throw new Error(
          "No Spotify streaming history files were found. Make sure you selected your Extended Streaming History ZIP."
        );
      }

      if (jsonFiles.length > MAX_JSON_FILES) {
        throw new Error(
          `Your ZIP contains too many history files. The current limit is ${MAX_JSON_FILES}.`
        );
      }

      showMessage(
        `Found ${formatNumber(jsonFiles.length)} history files. Reading your listening data...`,
        "info"
      );

      const records = [];

      for (let index = 0; index < jsonFiles.length; index++) {
        if (thisRun !== validationRun) return;

        const fileEntry = jsonFiles[index];
        const content = await fileEntry.async("string");

        let parsed;

        try {
          parsed = JSON.parse(content);
        } catch {
          throw new Error(
            `Could not read ${fileEntry.name}. The JSON file appears to be invalid.`
          );
        }

        if (!Array.isArray(parsed)) continue;

        parsed.forEach((record) => {
          const normalized = getSpotifyRecordFields(record);

          if (normalized) records.push(normalized);
        });

        if (
          (index + 1) % 10 === 0 ||
          index === jsonFiles.length - 1
        ) {
          showMessage(
            `Reading listening history... ${formatNumber(index + 1)} of ${formatNumber(jsonFiles.length)} files`,
            "info"
          );
        }
      }

      if (thisRun !== validationRun) return;

      if (records.length === 0) {
        throw new Error(
          "No valid listening records were found in your ZIP file."
        );
      }

      records.sort((a, b) => a.date - b.date);

      validatedRecords = records;
      isValidated = true;

      showMessage(
        `Successfully read ${formatNumber(records.length)} listening records. Your data is ready.`,
        "success"
      );

      setButtonState(true);

    } catch (error) {
      if (thisRun !== validationRun) return;

      console.error("Spotify ZIP validation failed:", error);

      validatedRecords = [];
      isValidated = false;

      setButtonState(false);

      showMessage(
        error.message ||
        "Something went wrong while reading your Spotify data."
      );
    }
  }

  // --------------------------------------------------
  // Statistics calculations
  // --------------------------------------------------

  function getUniqueArtistNames() {
    const names = new Map();

    dashboardRecords.forEach((record) => {
      const key = normalizeArtistKey(record.artistName);

      if (key && !names.has(key)) {
        names.set(key, record.artistName);
      }
    });

    return [...names.values()].sort(
      (a, b) => a.localeCompare(b)
    );
  }

  function getUniqueAlbumNames() {
    const albums = new Map();

    dashboardRecords.forEach((record) => {
      if (!record.albumName) return;

      const key =
        `${normalizeArtistKey(record.artistName)}::${normalize(record.albumName)}`;

      if (!albums.has(key)) {
        albums.set(key, {
          name: record.albumName,
          artistName: record.artistName
        });
      }
    });

    return [...albums.values()];
  }

  function getFilteredRecords() {
    if (selectedPeriod === "all") return dashboardRecords;

    const now = new Date();
    const days = selectedPeriod === "month" ? 30 : 365;
    const cutoff = new Date(now);

    cutoff.setDate(cutoff.getDate() - days);

    return dashboardRecords.filter(
      (record) => record.date >= cutoff
    );
  }

  function calculateStatistics(records) {
    const artists = new Map();
    const albums = new Map();
    const tracks = new Map();

    let totalDuration = 0;
    let totalPlays = 0;

    records.forEach((record) => {
      totalDuration += record.duration;
      totalPlays++;

      const artistKey = normalizeArtistKey(record.artistName);

      if (!artists.has(artistKey)) {
        artists.set(artistKey, {
          name: record.artistName,
          plays: 0,
          duration: 0,
          tracks: new Map(),
          albums: new Map()
        });
      }

      const artist = artists.get(artistKey);

      artist.plays++;
      artist.duration += record.duration;

      const trackKey =
        `${artistKey}::${normalize(record.trackName)}`;

      if (!tracks.has(trackKey)) {
        tracks.set(trackKey, {
          name: record.trackName,
          artistName: record.artistName,
          plays: 0
        });
      }

      tracks.get(trackKey).plays++;

      if (!artist.tracks.has(normalize(record.trackName))) {
        artist.tracks.set(normalize(record.trackName), {
          name: record.trackName,
          plays: 0
        });
      }

      artist.tracks.get(normalize(record.trackName)).plays++;

      if (record.albumName) {
        const albumKey =
          `${artistKey}::${normalize(record.albumName)}`;

        if (!albums.has(albumKey)) {
          albums.set(albumKey, {
            name: record.albumName,
            artistName: record.artistName,
            plays: 0,
            duration: 0,
            trackUri: record.spotifyTrackUri || null
          });
        }

        const album = albums.get(albumKey);

        album.plays++;
        album.duration += record.duration;

        if (!album.trackUri && record.spotifyTrackUri) {
          album.trackUri = record.spotifyTrackUri;
        }

        if (!artist.albums.has(normalize(record.albumName))) {
          artist.albums.set(normalize(record.albumName), {
            name: record.albumName,
            plays: 0
          });
        }

        artist.albums.get(normalize(record.albumName)).plays++;
      }
    });

    return {
      totalPlays,
      totalDuration,
      uniqueSongs: tracks.size,
      uniqueArtists: artists.size,
      artists: [...artists.values()].sort(
        (a, b) => b.plays - a.plays
      ),
      albums: [...albums.values()].sort(
        (a, b) => b.plays - a.plays
      ),
      tracks: [...tracks.values()].sort(
        (a, b) => b.plays - a.plays
      )
    };
  }

  function getMonthlyActivity(records) {
    const activity = new Map();

    records.forEach((record) => {
      const date = record.date;

      const key =
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      activity.set(key, (activity.get(key) || 0) + 1);
    });

    return [...activity.entries()].sort(
      (a, b) => a[0].localeCompare(b[0])
    );
  }

  // --------------------------------------------------
  // Artist metadata helpers
  // --------------------------------------------------

  function getArtistMetadata(name) {
    return artistMetadataCache.get(normalizeArtistKey(name)) || null;
  }

  function storeArtistMetadata(record) {
    if (!record) return;

    const requestedName =
      record.requestedName || record.identity?.name;

    if (!requestedName) return;

    const key = normalizeArtistKey(requestedName);

    artistMetadataCache.set(key, record);

    const imageUrl =
      record.images?.spotifyArtistImage ||
      record.images?.artistThumb ||
      null;

    if (imageUrl) {
      artistImageCache.set(key, imageUrl);
    }
  }

  async function fetchArtistMetadataBatch(names) {
    const response = await fetch(`${METADATA_API_URL}/api/artists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ names })
    });

    if (!response.ok) {
      const details = await response.text();

      throw new Error(
        `Artist metadata request failed: HTTP ${response.status} ${details.slice(0, 250)}`
      );
    }

    return response.json();
  }

  function updateMetadataStatus(message) {
    const status = document.getElementById("stats-metadata-status");

    if (status) {
      status.textContent = message;
    }
  }

  async function loadAllArtistMetadata() {
    if (metadataLoading) return;

    // getAllTimeArtists() is already sorted by play count.
    // This means the most-listened-to artists are processed first.
    const names = getAllTimeArtists().map((artist) => artist.name);

    metadataTotalCount = names.length;
    metadataLoadedCount = 0;

    if (names.length === 0) {
      updateMetadataStatus("No artist metadata to load.");
      return;
    }

    const uncachedNames = names.filter(
      (name) => !getArtistMetadata(name)
    );

    if (uncachedNames.length === 0) {
      metadataLoadedCount = names.length;

      updateMetadataStatus(
        `Artist metadata ready · ${formatNumber(names.length)} artists`
      );

      refreshArtistImages();
      await loadAllArtistImages();
      return;
    }

    metadataLoading = true;

    updateMetadataStatus(
      `Loading artist metadata · 0 of ${formatNumber(names.length)}`
    );

    try {
      for (
        let start = 0;
        start < uncachedNames.length;
        start += METADATA_BATCH_SIZE
      ) {
        const batch = uncachedNames.slice(
          start,
          start + METADATA_BATCH_SIZE
        );

        const requestNames = batch.filter((name) => {
          const key = normalizeArtistKey(name);

          return !artistMetadataRequests.has(key);
        });

        if (requestNames.length > 0) {
          requestNames.forEach((name) => {
            artistMetadataRequests.set(
              normalizeArtistKey(name),
              true
            );
          });

          try {
            const data =
              await fetchArtistMetadataBatch(requestNames);

            (data.results || []).forEach((result) => {
              if (result.artist) {
                storeArtistMetadata(result.artist);
              } else {
                console.warn(
                  `No metadata found for ${result.requestedName}:`,
                  result.error || "No provider match."
                );
              }
            });

          } finally {
            requestNames.forEach((name) => {
              artistMetadataRequests.delete(
                normalizeArtistKey(name)
              );
            });
          }
        }

        metadataLoadedCount = Math.min(
          names.length,
          metadataLoadedCount + batch.length
        );

        updateMetadataStatus(
          `Loading artist metadata · ${formatNumber(metadataLoadedCount)} of ${formatNumber(names.length)}`
        );

        refreshArtistImages();
      }

      const foundCount = names.filter(
        (name) => getArtistMetadata(name)
      ).length;

      updateMetadataStatus(
        `Artist metadata ready · ${formatNumber(foundCount)} of ${formatNumber(names.length)} artists matched`
      );

      refreshArtistImages();

      await loadAllArtistImages();

      updateMetadataStatus(
        `Artist images loaded · ${formatNumber(artistImagesLoadedCount)} of ${formatNumber(names.length)} artists`
      );

    } catch (error) {
      console.error("Artist metadata loading failed:", error);

      updateMetadataStatus(
        "Artist metadata could not finish loading. Reload the page to try again."
      );

    } finally {
      metadataLoading = false;
    }
  }

  // --------------------------------------------------
  // Album artwork lookup and prioritized loading
  // --------------------------------------------------

  function getAlbumKey(album) {
    return `${normalizeArtistKey(album.artistName)}::${normalize(album.name)}`;
  }

  function getSpotifyTrackUrl(trackUri) {
    if (typeof trackUri !== "string" || !trackUri.trim()) {
      return null;
    }

    const uri = trackUri.trim();

    if (/^spotify:track:[A-Za-z0-9]+$/.test(uri)) {
      const id = uri.split(":").pop();

      return `https://open.spotify.com/track/${id}`;
    }

    try {
      const parsed = new URL(uri);

      if (
        parsed.protocol === "https:" &&
        parsed.hostname === "open.spotify.com" &&
        /^\/track\/[A-Za-z0-9]+\/?$/.test(parsed.pathname)
      ) {
        return `https://open.spotify.com${parsed.pathname}`;
      }

    } catch {
      return null;
    }

    return null;
  }

  async function fetchAlbumCover(trackUri) {
    const trackUrl = getSpotifyTrackUrl(trackUri);

    if (!trackUrl) return null;

    const response = await fetch(`${METADATA_API_URL}/api/album-cover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ trackUrl })
    });

    if (!response.ok) {
      const details = await response.text();

      throw new Error(
        `Album artwork request failed: HTTP ${response.status} ${details.slice(0, 200)}`
      );
    }

    const data = await response.json();

    return data.imageUrl || null;
  }

  async function getAlbumCover(album) {
    const key = getAlbumKey(album);

    if (albumCoverCache.has(key)) {
      return albumCoverCache.get(key);
    }

    if (albumCoverRequests.has(key)) {
      return albumCoverRequests.get(key);
    }

    const trackUri = album.trackUri;

    if (!trackUri) {
      albumCoverCache.set(key, null);
      return null;
    }

    const request = fetchAlbumCover(trackUri)
      .then((imageUrl) => {
        albumCoverCache.set(key, imageUrl);
        return imageUrl;
      })
      .catch((error) => {
        console.warn(
          `Album artwork unavailable for ${album.name}:`,
          error
        );

        albumCoverCache.set(key, null);
        return null;
      })
      .finally(() => {
        albumCoverRequests.delete(key);
      });

    albumCoverRequests.set(key, request);

    return request;
  }

  function getAllTimeAlbums() {
    const stats = calculateStatistics(dashboardRecords);

    return stats.albums;
  }

  async function loadAlbumCoverForAlbum(album) {
    const imageUrl = await getAlbumCover(album);

    if (!imageUrl) return;

    const key = getAlbumKey(album);

    const image = document.querySelector(
      `[data-album-key="${CSS.escape(key)}"]`
    );

    if (image && image.tagName === "IMG") {
      image.src = imageUrl;
      image.hidden = false;

      const placeholder =
        image.parentElement?.querySelector(
          ".stats-album-cover-placeholder"
        );

      if (placeholder) placeholder.hidden = true;
    }
  }

  async function loadAllAlbumCovers() {
    if (albumCoverLoading) return;

    albumCoverLoading = true;

    try {
      const albums = getAllTimeAlbums();

      if (!albums.length) return;

      const prioritized = albums.slice(0, 10);
      const remaining = albums.slice(10);

      const loadGroup = async (group) => {
        for (const album of group) {
          await loadAlbumCoverForAlbum(album);
        }
      };

      await loadGroup(prioritized);
      await loadGroup(remaining);

    } finally {
      albumCoverLoading = false;
    }
  }

  // --------------------------------------------------
  // Artist image rendering and background preloading
  // --------------------------------------------------

  function getArtistImageUrl(name) {
    const metadata = getArtistMetadata(name);

    if (!metadata) return null;

    return (
      metadata.images?.spotifyArtistImage ||
      metadata.images?.artistThumb ||
      artistImageCache.get(normalizeArtistKey(name)) ||
      null
    );
  }

  function refreshArtistImages() {
    document.querySelectorAll("[data-artist-image]").forEach((image) => {
      const name = image.dataset.artistImage;
      const imageUrl = getArtistImageUrl(name);

      if (!imageUrl || image.src === imageUrl) return;

      image.src = imageUrl;
      image.hidden = false;

      const placeholder =
        image.parentElement?.querySelector(
          ".stats-artist-image-placeholder"
        );

      if (placeholder) placeholder.hidden = true;
    });
  }

  function getAllTimeArtists() {
    const stats = calculateStatistics(dashboardRecords);

    return stats.artists;
  }

  async function loadArtistImageForArtist(name) {
    const metadata = getArtistMetadata(name);

    if (!metadata) return false;

    const imageUrl = getArtistImageUrl(name);

    if (!imageUrl) return false;

    const key = normalizeArtistKey(name);

    artistImageCache.set(key, imageUrl);

    // Preload the image even when the artist is not currently visible.
    // This also allows the browser to reuse the downloaded image later.
    return new Promise((resolve) => {
      const preload = new Image();

      preload.onload = () => {
        const image = document.querySelector(
          `[data-artist-image="${CSS.escape(name)}"]`
        );

        if (image) {
          image.src = imageUrl;
          image.hidden = false;

          const placeholder =
            image.parentElement?.querySelector(
              ".stats-artist-image-placeholder"
            );

          if (placeholder) placeholder.hidden = true;
        }

        resolve(true);
      };

      preload.onerror = () => {
        console.warn(`Artist image unavailable for ${name}`);
        resolve(false);
      };

      preload.src = imageUrl;
    });
  }

  async function loadAllArtistImages() {
    if (artistImageLoading) return;

    const artists = getAllTimeArtists();

    if (!artists.length) return;

    artistImageLoading = true;
    artistImagesLoadedCount = 0;

    // Artists are sorted by all-time plays, highest first.
    const prioritized = artists.slice(0, 10);
    const remaining = artists.slice(10);

    const loadGroup = async (group) => {
      for (const artist of group) {
        const loaded = await loadArtistImageForArtist(artist.name);

        if (loaded) {
          artistImagesLoadedCount++;
        }

        updateMetadataStatus(
          `Loading artist images · ${formatNumber(artistImagesLoadedCount)} loaded · ${formatNumber(artists.length)} artists`
        );
      }
    };

    try {
      // Load the ten most-listened-to artists first.
      await loadGroup(prioritized);

      // Then load all remaining artists sequentially.
      await loadGroup(remaining);

    } finally {
      artistImageLoading = false;
    }
  }

  // --------------------------------------------------
  // Dashboard structure and styling
  // --------------------------------------------------

  function injectDashboardStyles() {
    if (document.getElementById("stats-dashboard-styles")) return;

    const style = createElement("style");

    style.id = "stats-dashboard-styles";

    style.textContent = `
      .stats-dashboard {
        width: 100%;
        max-width: 1180px;
        margin: 0 auto;
        padding: 42px 0 80px;
        color: #f1f3ed;
      }

      .stats-dashboard *,
      .stats-dashboard *::before,
      .stats-dashboard *::after {
        box-sizing: border-box;
      }

      .stats-dashboard-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 34px;
      }

      .stats-dashboard-eyebrow {
        color: #d5fb62;
        font-family: "DM Mono", monospace;
        font-size: 10px;
        letter-spacing: 0.14em;
        margin-bottom: 12px;
      }

      .stats-dashboard-title {
        margin: 0;
        color: #f1f3ed;
        font-family: "Manrope", sans-serif;
        font-size: clamp(30px, 5vw, 46px);
        font-weight: 700;
        letter-spacing: -0.055em;
        line-height: 1.05;
      }

      .stats-dashboard-subtitle {
        margin-top: 12px;
        color: #92988e;
        font-size: 13px;
        line-height: 1.6;
      }

      .stats-dashboard-back {
        flex-shrink: 0;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 7px;
        padding: 10px 13px;
        background: transparent;
        color: #c6cbbf;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        transition: 0.2s ease;
      }

      .stats-dashboard-back:hover {
        border-color: rgba(213,251,98,0.45);
        color: #d5fb62;
      }

      .stats-period-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }

      .stats-period-label {
        color: #8e958b;
        font-family: "DM Mono", monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
      }

      .stats-period-control {
        display: flex;
        gap: 5px;
        padding: 4px;
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 8px;
        background: rgba(255,255,255,0.025);
      }

      .stats-period-button {
        border: 0;
        border-radius: 5px;
        padding: 8px 12px;
        background: transparent;
        color: #8e958b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        transition: 0.2s ease;
      }

      .stats-period-button:hover {
        color: #f1f3ed;
      }

      .stats-period-button.active {
        background: #d5fb62;
        color: #171a13;
        font-weight: 700;
      }

      .stats-metrics-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 30px;
      }

      .stats-metric-card {
        min-width: 0;
        padding: 20px;
        border: 1px solid rgba(255,255,255,0.085);
        border-radius: 9px;
        background: rgba(255,255,255,0.025);
      }

      .stats-metric-label {
        color: #92988e;
        font-family: "DM Mono", monospace;
        font-size: 9px;
        letter-spacing: 0.1em;
        line-height: 1.5;
      }

      .stats-metric-value {
        margin-top: 12px;
        color: #f1f3ed;
        font-family: "Manrope", sans-serif;
        font-size: clamp(23px, 3vw, 32px);
        font-weight: 700;
        letter-spacing: -0.045em;
        overflow-wrap: anywhere;
      }

      .stats-metric-detail {
        margin-top: 5px;
        color: #70786e;
        font-size: 10px;
      }

      .stats-dashboard-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
        gap: 14px;
        margin-bottom: 14px;
      }

      .stats-panel {
        min-width: 0;
        padding: 22px;
        border: 1px solid rgba(255,255,255,0.085);
        border-radius: 9px;
        background: rgba(255,255,255,0.025);
      }

      .stats-panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 20px;
      }

      .stats-panel-title {
        margin: 0;
        color: #f1f3ed;
        font-family: "Manrope", sans-serif;
        font-size: 14px;
        font-weight: 700;
      }

      .stats-panel-kicker {
        color: #777f74;
        font-family: "DM Mono", monospace;
        font-size: 9px;
        letter-spacing: 0.08em;
      }

      .stats-artist-list,
      .stats-album-list {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      .stats-artist-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-width: 0;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: 0.18s ease;
      }

      .stats-artist-row:hover {
        border-color: rgba(213,251,98,0.14);
        background: rgba(213,251,98,0.035);
      }

      .stats-artist-image-wrap {
        position: relative;
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 42px;
        height: 42px;
        overflow: hidden;
        border-radius: 50%;
        background: rgba(255,255,255,0.06);
      }

      .stats-artist-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .stats-artist-image-placeholder {
        color: #aab19f;
        font-size: 16px;
      }

      .stats-artist-info {
        flex: 1;
        min-width: 0;
      }

      .stats-artist-name {
        overflow: hidden;
        color: #e7eadf;
        font-size: 12px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stats-artist-plays {
        margin-top: 4px;
        color: #7e8679;
        font-family: "DM Mono", monospace;
        font-size: 9px;
      }

      .stats-artist-count {
        flex-shrink: 0;
        color: #a5ad9e;
        font-family: "DM Mono", monospace;
        font-size: 10px;
      }

      .stats-artist-spotify-link {
        flex-shrink: 0;
        color: #a6b092;
        font-size: 9px;
        text-decoration: none;
      }

      .stats-artist-spotify-link:hover {
        color: #d5fb62;
        text-decoration: underline;
      }

      .stats-album-row {
        display: flex;
        align-items: center;
        gap: 11px;
        min-width: 0;
        padding: 7px 0;
      }

      .stats-album-identity {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        gap: 11px;
      }

      .stats-album-cover-wrap {
        position: relative;
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 42px;
        height: 42px;
        overflow: hidden;
        border-radius: 5px;
        background: rgba(255,255,255,0.06);
      }

      .stats-album-cover {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .stats-album-cover-placeholder {
        color: #aab19f;
        font-size: 16px;
      }

      .stats-album-info {
        flex: 1;
        min-width: 0;
      }

      .stats-album-name {
        overflow: hidden;
        color: #e7eadf;
        font-size: 11px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stats-album-artist {
        overflow: hidden;
        margin-top: 4px;
        color: #7e8679;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stats-album-count {
        flex-shrink: 0;
        color: #a5ad9e;
        font-family: "DM Mono", monospace;
        font-size: 9px;
      }

      .stats-chart {
        display: flex;
        align-items: stretch;
        gap: 8px;
        height: 190px;
        padding-top: 10px;
      }

      .stats-chart-column {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        min-width: 0;
        gap: 8px;
      }

      .stats-chart-bar-wrap {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        width: 100%;
        height: 150px;
      }

      .stats-chart-bar {
        width: min(100%, 28px);
        min-height: 3px;
        border-radius: 4px 4px 1px 1px;
        background: #d5fb62;
        opacity: 0.85;
        transition: height 0.3s ease;
      }

      .stats-chart-month {
        color: #737c70;
        font-family: "DM Mono", monospace;
        font-size: 8px;
      }

      .stats-empty {
        padding: 24px 10px;
        color: #747d70;
        font-size: 11px;
        text-align: center;
      }

      .stats-metadata-status {
        margin-top: 14px;
        color: #737c70;
        font-family: "DM Mono", monospace;
        font-size: 9px;
        line-height: 1.6;
      }

      .stats-modal {
        position: fixed;
        z-index: 9999;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(0,0,0,0.78);
        backdrop-filter: blur(8px);
      }

      .stats-modal[hidden] {
        display: none;
      }

      .stats-modal-content {
        width: min(100%, 560px);
        max-height: min(85vh, 760px);
        overflow-y: auto;
        padding: 25px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 11px;
        background: #171b15;
      }

      .stats-modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 22px;
      }

      .stats-modal-header h2 {
        margin: 0;
        color: #f1f3ed;
        font-family: "Manrope", sans-serif;
        font-size: 24px;
        letter-spacing: -0.04em;
      }

      .stats-modal-subtitle {
        margin-top: 6px;
        color: #858d7f;
        font-size: 10px;
      }

      .stats-modal-close {
        width: 32px;
        height: 32px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        background: transparent;
        color: #c6cbbf;
        font-size: 21px;
        cursor: pointer;
      }

      .stats-modal-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 9px;
        margin-bottom: 25px;
      }

      .stats-modal-metric {
        padding: 13px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 7px;
        background: rgba(255,255,255,0.025);
      }

      .stats-modal-metric strong {
        display: block;
        color: #d5fb62;
        font-family: "Manrope", sans-serif;
        font-size: 20px;
      }

      .stats-modal-metric span {
        display: block;
        margin-top: 5px;
        color: #7d8678;
        font-family: "DM Mono", monospace;
        font-size: 8px;
        letter-spacing: 0.07em;
      }

      .stats-modal-content h3 {
        margin: 22px 0 10px;
        color: #8b9485;
        font-family: "DM Mono", monospace;
        font-size: 9px;
        font-weight: 400;
        letter-spacing: 0.1em;
      }

      .stats-modal-list {
        display: flex;
        flex-direction: column;
      }

      .stats-modal-list-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 15px;
        padding: 10px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        color: #dfe3d8;
        font-size: 11px;
      }

      .stats-modal-list-item span:last-child {
        flex-shrink: 0;
        color: #879080;
        font-family: "DM Mono", monospace;
        font-size: 9px;
      }

      @media (max-width: 760px) {
        .stats-dashboard {
          padding-top: 28px;
        }

        .stats-metrics-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .stats-dashboard-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 480px) {
        .stats-dashboard-header {
          flex-direction: column;
          gap: 17px;
        }

        .stats-dashboard-back {
          order: 2;
        }

        .stats-period-row {
          align-items: flex-start;
          flex-direction: column;
        }

        .stats-period-control {
          width: 100%;
        }

        .stats-period-button {
          flex: 1;
          padding-inline: 7px;
        }

        .stats-panel {
          padding: 17px;
        }

        .stats-metric-card {
          padding: 15px;
        }

        .stats-chart {
          gap: 4px;
        }

        .stats-modal-content {
          padding: 19px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createDashboard() {
    injectDashboardStyles();

    const existing = document.getElementById("stats-dashboard");

    if (existing) existing.remove();

    const dashboard = createElement("section", "stats-dashboard");

    dashboard.id = "stats-dashboard";

    const header = createElement("div", "stats-dashboard-header");
    const heading = createElement("div");

    heading.append(
      createElement(
        "div",
        "stats-dashboard-eyebrow",
        "YOUR LISTENING, IN NUMBERS"
      ),
      createElement(
        "h1",
        "stats-dashboard-title",
        "Your listening history"
      ),
      createElement(
        "p",
        "stats-dashboard-subtitle",
        `${formatNumber(dashboardRecords.length)} listening records analyzed`
      )
    );

    const backButton = createElement(
      "button",
      "stats-dashboard-back",
      "← Upload another file"
    );

    backButton.type = "button";
    backButton.addEventListener("click", returnToUpload);

    header.append(heading, backButton);

    const periodRow = createElement("div", "stats-period-row");

    periodRow.appendChild(
      createElement(
        "span",
        "stats-period-label",
        "LISTENING PERIOD"
      )
    );

    const periodControl = createElement(
      "div",
      "stats-period-control"
    );

    [
      ["all", "All time"],
      ["year", "Past year"],
      ["month", "Past month"]
    ].forEach(([value, label]) => {
      const button = createElement(
        "button",
        "stats-period-button",
        label
      );

      button.type = "button";

      if (value === selectedPeriod) {
        button.classList.add("active");
      }

      button.addEventListener("click", () => {
        selectedPeriod = value;

        periodControl.querySelectorAll("button").forEach((item) => {
          item.classList.toggle(
            "active",
            item.dataset.period === selectedPeriod
          );
        });

        renderDashboard();
      });

      button.dataset.period = value;

      periodControl.appendChild(button);
    });

    periodRow.appendChild(periodControl);

    const metrics = createElement("div", "stats-metrics-grid");
    metrics.id = "stats-metrics-grid";

    const grid = createElement("div", "stats-dashboard-grid");

    const artistsPanel = createElement("section", "stats-panel");

    artistsPanel.appendChild(
      createPanelHeading("Top Artists", "MOST LISTENED")
    );

    const artists = createElement("div", "stats-artist-list");
    artists.id = "stats-top-artists";

    artistsPanel.appendChild(artists);

    const albumsPanel = createElement("section", "stats-panel");

    albumsPanel.appendChild(
      createPanelHeading("Top Albums", "MOST LISTENED")
    );

    const albums = createElement("div", "stats-album-list");
    albums.id = "stats-top-albums";

    albumsPanel.appendChild(albums);

    grid.append(artistsPanel, albumsPanel);

    const chartPanel = createElement("section", "stats-panel");

    chartPanel.appendChild(
      createPanelHeading("Listening activity", "MONTHLY PLAYS")
    );

    const chart = createElement("div", "stats-chart");
    chart.id = "stats-monthly-chart";

    chartPanel.appendChild(chart);

    const metadataStatus = createElement(
      "div",
      "stats-metadata-status",
      "Preparing artist metadata..."
    );

    metadataStatus.id = "stats-metadata-status";

    chartPanel.appendChild(metadataStatus);

    dashboard.append(
      header,
      periodRow,
      metrics,
      grid,
      chartPanel
    );

    const uploadSection = document.querySelector(".upload-section");

    const dashboardContainer =
      uploadSection?.parentElement ||
      document.querySelector(".page-shell") ||
      document.querySelector("main") ||
      document.body;

    dashboardContainer.appendChild(dashboard);

    if (uploadSection) {
      uploadSection.hidden = true;
    }

    if (privacyCard) {
      privacyCard.hidden = true;
    }

    renderDashboard();
    createArtistModal();

    loadAllArtistMetadata();
    loadAllAlbumCovers();
  }

  function createPanelHeading(title, kicker) {
    const heading = createElement("div", "stats-panel-heading");

    heading.append(
      createElement("h2", "stats-panel-title", title),
      createElement("span", "stats-panel-kicker", kicker)
    );

    return heading;
  }

  // --------------------------------------------------
  // Dashboard rendering
  // --------------------------------------------------

  function renderDashboard() {
    const records = getFilteredRecords();
    const stats = calculateStatistics(records);

    renderMetrics(stats);
    renderTopArtists(stats);
    renderTopAlbums(stats);
    renderMonthlyActivity();
  }

  function renderMetrics(stats) {
    const container = document.getElementById("stats-metrics-grid");

    if (!container) return;

    container.replaceChildren();

    const metrics = [
      {
        label: "TOTAL PLAYS",
        value: formatNumber(stats.totalPlays),
        detail: "Listening sessions"
      },
      {
        label: "LISTENING TIME",
        value: formatDuration(stats.totalDuration),
        detail: "Total time listened"
      },
      {
        label: "UNIQUE SONGS",
        value: formatNumber(stats.uniqueSongs),
        detail: "Distinct tracks played"
      },
      {
        label: "UNIQUE ARTISTS",
        value: formatNumber(stats.uniqueArtists),
        detail: "Distinct artists"
      }
    ];

    metrics.forEach((item) => {
      const card = createElement("div", "stats-metric-card");

      card.append(
        createElement("div", "stats-metric-label", item.label),
        createElement("div", "stats-metric-value", item.value),
        createElement("div", "stats-metric-detail", item.detail)
      );

      container.appendChild(card);
    });
  }

  function renderTopArtists(stats) {
    const container = document.getElementById("stats-top-artists");

    if (!container) return;

    container.replaceChildren();

    const artists = stats.artists.slice(0, 10);

    if (artists.length === 0) {
      container.appendChild(
        createElement(
          "div",
          "stats-empty",
          "No artists found for this period."
        )
      );

      return;
    }

    artists.forEach((artist, index) => {
      const row = createElement("button", "stats-artist-row");

      row.type = "button";

      row.addEventListener("click", () => {
        openArtistModal(artist.name);
      });

      const imageWrap = createElement(
        "span",
        "stats-artist-image-wrap"
      );

      const image = createElement("img", "stats-artist-image");

      image.alt = `${artist.name} profile`;
      image.loading = "lazy";
      image.dataset.artistImage = artist.name;
      image.hidden = true;

      const placeholder = createElement(
        "span",
        "stats-artist-image-placeholder",
        "♪"
      );

      placeholder.setAttribute("aria-hidden", "true");

      image.addEventListener("error", () => {
        image.hidden = true;
        placeholder.hidden = false;
      }, { once: true });

      imageWrap.append(image, placeholder);

      const info = createElement("span", "stats-artist-info");

      info.append(
        createElement("span", "stats-artist-name", artist.name),
        createElement(
          "span",
          "stats-artist-plays",
          `${formatNumber(artist.plays)} plays`
        )
      );

      const spotifyLink = createElement(
        "a",
        "stats-artist-spotify-link",
        "Spotify ↗"
      );

      spotifyLink.href =
        getArtistMetadata(artist.name)?.links?.spotifyArtist ||
        `https://open.spotify.com/search/${encodeURIComponent(artist.name)}`;

      spotifyLink.target = "_blank";
      spotifyLink.rel = "noopener noreferrer";

      spotifyLink.setAttribute(
        "aria-label",
        `Open ${artist.name} on Spotify`
      );

      spotifyLink.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      row.append(
        imageWrap,
        info,
        createElement(
          "span",
          "stats-artist-count",
          `#${index + 1}`
        ),
        spotifyLink
      );

      container.appendChild(row);
    });

    refreshArtistImages();
  }

  function renderTopAlbums(stats) {
    const container = document.getElementById("stats-top-albums");

    if (!container) return;

    container.replaceChildren();

    const albums = stats.albums.slice(0, 10);

    if (albums.length === 0) {
      container.appendChild(
        createElement(
          "div",
          "stats-empty",
          "No albums found for this period."
        )
      );

      return;
    }

    albums.forEach((album) => {
      const row = createElement("div", "stats-album-row");

      const identity = createElement(
        "div",
        "stats-album-identity"
      );

      const coverWrap = createElement(
        "div",
        "stats-album-cover-wrap"
      );

      const cover = createElement("img", "stats-album-cover");

      cover.alt = `${album.name} album cover`;
      cover.loading = "lazy";
      cover.dataset.albumKey = getAlbumKey(album);
      cover.hidden = true;

      const placeholder = createElement(
        "span",
        "stats-album-cover-placeholder",
        "♪"
      );

      placeholder.setAttribute("aria-hidden", "true");

      cover.addEventListener("error", () => {
        const fallback = createElement(
          "span",
          "stats-album-cover-placeholder",
          "♪"
        );

        fallback.setAttribute("aria-hidden", "true");

        cover.replaceWith(fallback);

        albumCoverCache.set(getAlbumKey(album), null);
      }, { once: true });

      coverWrap.append(cover, placeholder);

      const info = createElement("div", "stats-album-info");

      info.append(
        createElement("div", "stats-album-name", album.name),
        createElement(
          "div",
          "stats-album-artist",
          album.artistName
        )
      );

      identity.append(coverWrap, info);

      const rowStats = createElement(
        "span",
        "stats-album-count",
        `${formatNumber(album.plays)} plays`
      );

      row.append(identity, rowStats);

      container.appendChild(row);
    });
  }

  // --------------------------------------------------
  // Monthly activity chart
  // --------------------------------------------------

  function renderMonthlyActivity() {
    const container = document.getElementById("stats-monthly-chart");

    if (!container) return;

    container.replaceChildren();

    const activity = getMonthlyActivity(dashboardRecords);

    if (activity.length === 0) {
      container.appendChild(
        createElement(
          "div",
          "stats-empty",
          "No monthly activity found."
        )
      );

      return;
    }

    const maxPlays = Math.max(
      ...activity.map((item) => item[1]),
      1
    );

    activity.forEach(([key, plays]) => {
      const [year, month] = key.split("-").map(Number);

      const date = new Date(year, month - 1, 1);

      const column = createElement("div", "stats-chart-column");
      const barWrap = createElement("div", "stats-chart-bar-wrap");
      const bar = createElement("div", "stats-chart-bar");

      bar.style.height =
        `${Math.max(3, (plays / maxPlays) * 100)}%`;

      bar.title = `${formatNumber(plays)} plays`;

      barWrap.appendChild(bar);

      const label = createElement(
        "span",
        "stats-chart-month",
        date.toLocaleDateString(undefined, {
          month: "short"
        })
      );

      column.append(barWrap, label);

      container.appendChild(column);
    });
  }

  // --------------------------------------------------
  // Artist details modal
  // --------------------------------------------------

  function createArtistModal() {
    if (document.getElementById("stats-artist-modal")) return;

    const modal = createElement("div", "stats-modal");

    modal.id = "stats-artist-modal";
    modal.hidden = true;

    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "stats-modal-title");

    const content = createElement("div", "stats-modal-content");

    const header = createElement("div", "stats-modal-header");
    const titleArea = createElement("div");

    const title = createElement("h2");

    title.id = "stats-modal-title";

    const subtitle = createElement(
      "div",
      "stats-modal-subtitle"
    );

    subtitle.id = "stats-modal-subtitle";

    titleArea.append(title, subtitle);

    const close = createElement(
      "button",
      "stats-modal-close",
      "×"
    );

    close.type = "button";

    close.setAttribute(
      "aria-label",
      "Close artist details"
    );

    close.addEventListener("click", closeArtistModal);

    header.append(titleArea, close);

    const metrics = createElement("div", "stats-modal-metrics");

    metrics.id = "stats-modal-metrics";

    const songsHeading = createElement(
      "h3",
      "",
      "MOST PLAYED SONGS"
    );

    const songs = createElement("div", "stats-modal-list");

    songs.id = "stats-modal-songs";

    const albumsHeading = createElement(
      "h3",
      "",
      "TOP ALBUMS"
    );

    const albums = createElement("div", "stats-modal-list");

    albums.id = "stats-modal-albums";

    content.append(
      header,
      metrics,
      songsHeading,
      songs,
      albumsHeading,
      albums
    );

    modal.appendChild(content);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeArtistModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeArtistModal();
      }
    });

    document.body.appendChild(modal);
  }

  function openArtistModal(artistName) {
    const modal = document.getElementById("stats-artist-modal");

    if (!modal) return;

    const stats = calculateStatistics(getFilteredRecords());

    const artist = stats.artists.find(
      (item) => normalize(item.name) === normalize(artistName)
    );

    if (!artist) return;

    document.getElementById("stats-modal-title").textContent =
      artist.name;

    document.getElementById("stats-modal-subtitle").textContent =
      selectedPeriod === "month"
        ? "Personal listening statistics · Past 30 days"
        : selectedPeriod === "year"
          ? "Personal listening statistics · Past 365 days"
          : "Personal listening statistics · All time";

    const totalDuration = artist.duration;

    const share = stats.totalDuration > 0
      ? ((totalDuration / stats.totalDuration) * 100).toFixed(1)
      : "0.0";

    const metrics = document.getElementById("stats-modal-metrics");

    metrics.replaceChildren();

    [
      ["PLAYS", formatNumber(artist.plays)],
      ["UNIQUE SONGS", formatNumber(artist.tracks.size)],
      ["LISTENING SHARE", `${share}%`]
    ].forEach(([label, value]) => {
      const metric = createElement(
        "div",
        "stats-modal-metric"
      );

      metric.append(
        createElement("strong", "", value),
        createElement("span", "", label)
      );

      metrics.appendChild(metric);
    });

    const songs = document.getElementById("stats-modal-songs");

    songs.replaceChildren();

    const topTracks = [...artist.tracks.values()]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 10);

    if (topTracks.length === 0) {
      songs.appendChild(
        createElement(
          "div",
          "stats-empty",
          "No songs found."
        )
      );
    } else {
      topTracks.forEach((track) => {
        songs.appendChild(
          createModalListItem(
            track.name,
            `${formatNumber(track.plays)} plays`
          )
        );
      });
    }

    const albums = document.getElementById("stats-modal-albums");

    albums.replaceChildren();

    const topAlbums = [...artist.albums.values()]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 10);

    if (topAlbums.length === 0) {
      albums.appendChild(
        createElement(
          "div",
          "stats-empty",
          "No album information found."
        )
      );
    } else {
      topAlbums.forEach((album) => {
        albums.appendChild(
          createModalListItem(
            album.name,
            `${formatNumber(album.plays)} plays`
          )
        );
      });
    }

    modal.hidden = false;

    document.body.style.overflow = "hidden";
  }

  function createModalListItem(name, value) {
    const item = createElement(
      "div",
      "stats-modal-list-item"
    );

    item.append(
      createElement("span", "", name),
      createElement("span", "", value)
    );

    return item;
  }

  function closeArtistModal() {
    const modal = document.getElementById("stats-artist-modal");

    if (modal) modal.hidden = true;

    document.body.style.overflow = "";
  }

  // --------------------------------------------------
  // Start and return from dashboard
  // --------------------------------------------------

  function startStatistics() {
    if (
      !currentFile ||
      !isValidated ||
      validatedRecords.length === 0
    ) {
      showMessage(
        "Your listening history is not ready yet. Please wait for validation to finish.",
        "info"
      );

      return;
    }

    dashboardRecords = validatedRecords.slice();

    selectedPeriod = "all";

    artistMetadataCache.clear();
    artistImageCache.clear();
    artistMetadataRequests.clear();

    albumCoverCache.clear();
    albumCoverRequests.clear();

    metadataLoading = false;
    albumCoverLoading = false;
    artistImageLoading = false;

    metadataLoadedCount = 0;
    metadataTotalCount = 0;
    artistImagesLoadedCount = 0;

    try {
      createDashboard();

      validatedRecords = [];
      currentFile = null;
      isValidated = false;

    } catch (error) {
      console.error("Dashboard creation failed:", error);

      showMessage(
        "Your data was successfully read, but the dashboard could not be created. Check the browser Console for details."
      );
    }
  }

  function returnToUpload() {
    const dashboard = document.getElementById("stats-dashboard");
    const modal = document.getElementById("stats-artist-modal");

    if (dashboard) dashboard.remove();
    if (modal) modal.remove();

    const uploadSection = document.querySelector(".upload-section");

    if (uploadSection) {
      uploadSection.hidden = false;
    }

    if (privacyCard && privacyCardOriginalParent) {
      if (
        privacyCardOriginalNextSibling &&
        privacyCardOriginalNextSibling.parentNode === privacyCardOriginalParent
      ) {
        privacyCardOriginalParent.insertBefore(
          privacyCard,
          privacyCardOriginalNextSibling
        );
      } else {
        privacyCardOriginalParent.appendChild(privacyCard);
      }

      privacyCard.hidden = false;
    }

    dashboardRecords = [];
    selectedPeriod = "all";

    artistMetadataCache.clear();
    artistImageCache.clear();
    artistMetadataRequests.clear();

    albumCoverCache.clear();
    albumCoverRequests.clear();

    metadataLoading = false;
    albumCoverLoading = false;
    artistImageLoading = false;

    metadataLoadedCount = 0;
    metadataTotalCount = 0;
    artistImagesLoadedCount = 0;

    resetUpload();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  // --------------------------------------------------
  // Process button
  // --------------------------------------------------

  if (processButton) {
    processButton.type = "button";

    processButton.addEventListener("click", (event) => {
      event.preventDefault();

      startStatistics();
    });
  }

  // --------------------------------------------------
  // Clear imported data when leaving the page
  // --------------------------------------------------

  window.addEventListener("pagehide", () => {
    currentFile = null;
    validatedRecords = [];
    dashboardRecords = [];
    isValidated = false;
  });

})();
