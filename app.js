
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
  const privacyCardOriginalParent = privacyCard ? privacyCard.parentNode : null;
  const privacyCardOriginalNextSibling = privacyCard ? privacyCard.nextSibling : null;

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

  // Full metadata records are kept in memory for future features.
  const artistMetadataCache = new Map();
  const artistMetadataRequests = new Map();

  // Image cache is separate so images can be reused without re-fetching metadata.
  const artistImageCache = new Map();

  // Album artwork is resolved through the Cloudflare Worker.
  // Cloudflare KV provides persistent caching between browser sessions.
  const albumCoverCache = new Map();
  const albumCoverRequests = new Map();

  let metadataLoading = false;
  let albumCoverLoading = false;
  let metadataLoadedCount = 0;
  let metadataTotalCount = 0;

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
  // Upload messages
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
    if (processButton) processButton.disabled = !enabled;
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
      processButton.innerHTML = 'Process listening history <span>→</span>';
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
        "This file is larger than the 500 MB limit. Please check your Spotify export and try again."
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

      const header = new Uint8Array(
        await file.slice(0, 4).arrayBuffer()
      );

      const validZipSignatures = [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08]
      ];

      const hasZipSignature = validZipSignatures.some((signature) =>
        signature.every((byte, index) => header[index] === byte)
      );

      if (!hasZipSignature) {
        throw new Error(
          "This file does not appear to be a valid ZIP archive. Please select the original ZIP file downloaded from Spotify."
        );
      }

      showMessage("Opening the ZIP archive...", "info");

      const zip = await window.JSZip.loadAsync(file);

      if (thisRun !== validationRun) return;

      const historyFiles = Object.values(zip.files).filter(
        (entry) =>
          !entry.dir &&
          isSpotifyHistoryFilename(entry.name)
      );

      if (historyFiles.length === 0) {
        throw new Error(
          "We couldn't find any Spotify listening history files. Make sure you downloaded Extended Streaming History rather than your regular Spotify account data."
        );
      }

      if (historyFiles.length > MAX_JSON_FILES) {
        throw new Error(
          "This archive contains an unexpected number of history files. Please check your Spotify export."
        );
      }

      showMessage(
        `Found ${historyFiles.length} possible listening history file(s). Checking their contents...`,
        "info"
      );

      const allRecords = [];
      let readableFiles = 0;

      for (const entry of historyFiles) {
        if (thisRun !== validationRun) return;

        let contents;

        try {
          contents = await entry.async("string");
        } catch {
          throw new Error(
            `We couldn't read "${entry.name}". The ZIP archive may be damaged. Please download it again.`
          );
        }

        let parsed;

        try {
          parsed = JSON.parse(contents);
        } catch {
          throw new Error(
            `The file "${entry.name}" contains unreadable JSON. Your history was not processed. Please download a fresh Spotify export.`
          );
        }

        if (!Array.isArray(parsed)) {
          throw new Error(
            `The file "${entry.name}" does not have the expected Spotify history format.`
          );
        }

        readableFiles++;

        for (const record of parsed) {
          const normalizedRecord = getSpotifyRecordFields(record);

          if (normalizedRecord) {
            allRecords.push(normalizedRecord);
          }
        }
      }

      if (thisRun !== validationRun) return;

      if (readableFiles === 0 || allRecords.length === 0) {
        throw new Error(
          "The ZIP file was readable, but we couldn't find any recognizable song listening records. Please make sure you selected your Spotify Extended Streaming History export."
        );
      }

      validatedRecords = allRecords;
      isValidated = true;

      showMessage(
        `Your Spotify history was successfully recognized! Found ${allRecords.length.toLocaleString()} valid listening records across ${readableFiles} file(s).`,
        "success"
      );

      setButtonState(true);

    } catch (error) {
      if (thisRun !== validationRun) return;

      currentFile = file;
      validatedRecords = [];
      isValidated = false;

      setButtonState(false);

      showMessage(
        error.message ||
        "Something went wrong while checking your file. Please try again."
      );
    }
  }

  // --------------------------------------------------
  // Dashboard styling
  // --------------------------------------------------

  function addDashboardStyles() {
    if (document.getElementById("spotistats-dashboard-styles")) return;

    const style = document.createElement("style");
    style.id = "spotistats-dashboard-styles";

    style.textContent = `
      .stats-dashboard {
        width: min(1100px, calc(100% - 40px));
        margin: 50px auto 80px;
        color: #f2f3ef;
      }

      .stats-dashboard * {
        box-sizing: border-box;
      }

      .stats-topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 38px;
        flex-wrap: wrap;
      }

      .stats-eyebrow {
        color: #d5fb62;
        font: 11px "DM Mono", monospace;
        letter-spacing: 1.5px;
        margin-bottom: 10px;
      }

      .stats-dashboard h1 {
        font-size: clamp(28px, 5vw, 42px);
        line-height: 1.15;
        margin: 0;
        font-weight: 800;
      }

      .stats-dashboard h1 span {
        color: #d5fb62;
      }

      .stats-dashboard h2 {
        font-size: 19px;
        margin: 0;
        font-weight: 700;
      }

      .stats-dashboard p {
        color: #92959a;
      }

      .stats-back-button,
      .stats-period-button,
      .stats-artist-button,
      .stats-modal-close {
        cursor: pointer;
        font: inherit;
      }

      .stats-back-button {
        background: transparent;
        border: 1px solid #303238;
        color: #b9bbc0;
        border-radius: 8px;
        padding: 10px 14px;
      }

      .stats-back-button:hover {
        border-color: #d5fb62;
        color: #d5fb62;
      }

      .stats-period {
        display: flex;
        gap: 5px;
        padding: 4px;
        background: #17191c;
        border: 1px solid #292c30;
        border-radius: 9px;
        width: fit-content;
        margin: 28px 0 18px;
      }

      .stats-period-button {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #92959a;
        padding: 9px 15px;
        font-size: 12px;
      }

      .stats-period-button.active {
        background: #d5fb62;
        color: #101113;
        font-weight: 800;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
        margin-bottom: 42px;
      }

      .stats-card,
      .stats-panel {
        background: #17191c;
        border: 1px solid #292c30;
        border-radius: 12px;
      }

      .stats-card {
        padding: 22px;
      }

      .stats-card-label {
        color: #92959a;
        font: 10px "DM Mono", monospace;
        letter-spacing: 1px;
      }

      .stats-card-value {
        display: block;
        font-size: clamp(27px, 4vw, 38px);
        font-weight: 800;
        margin-top: 12px;
        letter-spacing: -1px;
      }

      .stats-card-note {
        display: block;
        font-size: 11px;
        color: #777b81;
        margin-top: 6px;
      }

      .stats-section {
        margin-top: 36px;
      }

      .stats-section-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .stats-section-label {
        color: #777b81;
        font: 10px "DM Mono", monospace;
        letter-spacing: 1px;
      }

      .stats-panel {
        padding: 22px;
      }

      .stats-search {
        width: 100%;
        background: #101113;
        border: 1px solid #303238;
        border-radius: 8px;
        padding: 13px 15px;
        color: #f2f3ef;
        font: inherit;
        outline: none;
        margin-bottom: 15px;
      }

      .stats-search:focus {
        border-color: #d5fb62;
      }

      .stats-search::placeholder {
        color: #6f7379;
      }

      .stats-artist-list,
      .stats-album-list {
        display: grid;
        gap: 8px;
      }

      .stats-artist-button {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 15px;
        text-align: left;
        width: 100%;
        padding: 13px 14px;
        background: #1d2024;
        border: 1px solid transparent;
        border-radius: 8px;
        color: #f2f3ef;
      }

      .stats-artist-button:hover {
        border-color: #d5fb62;
        background: #22262a;
      }

      .stats-artist-identity {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .stats-artist-avatar {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        display: grid;
        place-items: center;
        overflow: hidden;
        border-radius: 50%;
        background: #30343a;
        color: #d5fb62;
        font: 12px "DM Mono", monospace;
        object-fit: cover;
      }

      .stats-artist-name {
        font-weight: 700;
        font-size: 13px;
      }

      .stats-artist-plays {
        font: 11px "DM Mono", monospace;
        color: #a5a8ad;
        white-space: nowrap;
      }

      .stats-album-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 15px;
        padding: 13px 0;
        border-bottom: 1px solid #292c30;
      }

      .stats-album-row:last-child {
        border-bottom: 0;
      }

      .stats-album-identity {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .stats-album-cover,
      .stats-album-cover-placeholder {
        width: 48px;
        height: 48px;
        flex: 0 0 48px;
        border-radius: 6px;
        object-fit: cover;
        background: #30343a;
      }

      .stats-album-cover-placeholder {
        display: grid;
        place-items: center;
        color: #d5fb62;
        font: 14px "DM Mono", monospace;
      }

      .stats-album-name {
        font-size: 13px;
        font-weight: 700;
      }

      .stats-album-artist {
        color: #92959a;
        font-size: 11px;
        margin-top: 4px;
      }

      .stats-album-count {
        color: #a5a8ad;
        font: 11px "DM Mono", monospace;
        white-space: nowrap;
      }

      .stats-chart {
        display: flex;
        align-items: end;
        gap: 8px;
        height: 190px;
        padding-top: 20px;
      }

      .stats-chart-column {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: end;
        align-items: center;
        gap: 8px;
      }

      .stats-chart-bar-wrap {
        width: 100%;
        height: 145px;
        display: flex;
        align-items: end;
        justify-content: center;
      }

      .stats-chart-bar {
        width: min(34px, 75%);
        min-height: 3px;
        background: #d5fb62;
        border-radius: 4px 4px 0 0;
      }

      .stats-chart-month {
        font: 9px "DM Mono", monospace;
        color: #858990;
        text-align: center;
      }

      .stats-empty {
        color: #858990;
        font-size: 13px;
        padding: 18px 0;
        text-align: center;
      }

      .stats-disclaimer {
        color: #858990;
        font-size: 11px;
        line-height: 1.7;
        margin-top: 28px;
      }

      .stats-metadata-status {
        color: #858990;
        font: 10px "DM Mono", monospace;
        margin-top: 8px;
      }

      .stats-modal {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(0, 0, 0, 0.78);
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
      }

      .stats-modal[hidden] {
        display: none;
      }

      .stats-modal-content {
        width: min(620px, 100%);
        max-height: 85vh;
        overflow-y: auto;
        background: #17191c;
        border: 1px solid #34373c;
        border-radius: 14px;
        padding: 26px;
      }

      .stats-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 20px;
      }

      .stats-modal-close {
        background: transparent;
        border: 0;
        color: #a5a8ad;
        font-size: 26px;
      }

      .stats-modal-content h2 {
        font-size: 26px;
        overflow-wrap: anywhere;
      }

      .stats-modal-subtitle {
        color: #92959a;
        font-size: 12px;
        margin-top: 7px;
      }

      .stats-modal-metrics {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 9px;
        margin: 25px 0;
      }

      .stats-modal-metric {
        background: #202328;
        border-radius: 8px;
        padding: 14px;
      }

      .stats-modal-metric strong {
        display: block;
        font-size: 23px;
      }

      .stats-modal-metric span {
        color: #92959a;
        font: 9px "DM Mono", monospace;
        display: block;
        margin-top: 5px;
      }

      .stats-modal-content h3 {
        font-size: 13px;
        margin: 25px 0 10px;
      }

      .stats-modal-list {
        display: grid;
        gap: 9px;
      }

      .stats-modal-list-item {
        display: flex;
        justify-content: space-between;
        gap: 15px;
        font-size: 12px;
        color: #d5d7d2;
      }

      .stats-modal-list-item span:last-child {
        color: #92959a;
        font-family: "DM Mono", monospace;
        white-space: nowrap;
      }

      @media (max-width: 650px) {
        .stats-dashboard {
          width: calc(100% - 30px);
          margin-top: 30px;
        }

        .stats-grid {
          grid-template-columns: 1fr;
          gap: 9px;
        }

        .stats-card {
          padding: 17px;
        }

        .stats-card-value {
          margin-top: 7px;
        }

        .stats-panel {
          padding: 16px;
        }

        .stats-modal-metrics {
          grid-template-columns: 1fr;
        }

        .stats-modal-metric {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .stats-modal-metric span {
          margin: 0;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // --------------------------------------------------
  // Statistics calculations
  // --------------------------------------------------

  function getTrackKey(record) {
    if (record.spotifyTrackUri) {
      return `uri:${normalize(record.spotifyTrackUri)}`;
    }

    return `name:${normalize(record.artistName)}::${normalize(record.trackName)}`;
  }

  function getFilteredRecords() {
    if (selectedPeriod === "all") {
      return dashboardRecords;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (selectedPeriod === "year" ? 365 : 30));

    return dashboardRecords.filter(
      (record) => record.date >= cutoff
    );
  }

  function calculateStatistics(records) {
    const artistMap = new Map();
    const albumMap = new Map();
    const trackMap = new Map();
    const dailyMap = new Map();

    let totalMinutes = 0;

    for (const record of records) {
      const artistKey = normalizeArtistKey(record.artistName);
      const albumKey = `${artistKey}::${normalize(record.albumName || "Unknown album")}`;
      const trackKey = getTrackKey(record);

      totalMinutes += record.duration;

      if (!artistMap.has(artistKey)) {
        artistMap.set(artistKey, {
          name: record.artistName,
          plays: 0,
          minutes: 0,
          tracks: new Set(),
          records: []
        });
      }

      const artist = artistMap.get(artistKey);
      artist.plays++;
      artist.minutes += record.duration;
      artist.tracks.add(trackKey);
      artist.records.push(record);

      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, {
          name: record.albumName || "Unknown album",
          artist: record.artistName,
          plays: 0,
          minutes: 0,
          tracks: new Set(),
          spotifyTrackUri: record.spotifyTrackUri
        });
      }

      const album = albumMap.get(albumKey);
      album.plays++;
      album.minutes += record.duration;
      album.tracks.add(trackKey);

      if (!trackMap.has(trackKey)) {
        trackMap.set(trackKey, {
          name: record.trackName,
          artist: record.artistName,
          plays: 0,
          duration: 0
        });
      }

      const track = trackMap.get(trackKey);
      track.plays++;
      track.duration += record.duration;

      const dayKey = record.date.toISOString().slice(0, 10);
      dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + record.duration);
    }

    const artists = Array.from(artistMap.values())
      .map((artist) => ({
        ...artist,
        uniqueTracks: artist.tracks.size
      }))
      .sort((a, b) => b.plays - a.plays);

    const albums = Array.from(albumMap.values())
      .map((album) => ({
        ...album,
        uniqueTracks: album.tracks.size
      }))
      .sort((a, b) => b.plays - a.plays);

    const tracks = Array.from(trackMap.values())
      .sort((a, b) => b.plays - a.plays);

    return {
      totalPlays: records.length,
      totalMinutes: totalMinutes / 60000,
      uniqueTracks: trackMap.size,
      uniqueArtists: artistMap.size,
      artists,
      albums,
      tracks,
      daily: dailyMap
    };
  }

  // --------------------------------------------------
  // Artist and album metadata helpers
  // --------------------------------------------------

  function getSpotifyTrackUrl(value) {
    if (!value) return null;

    const textValue = String(value).trim();

    if (textValue.startsWith("spotify:track:")) {
      const id = textValue.split(":").pop();
      return id ? `https://open.spotify.com/track/${id}` : null;
    }

    try {
      const url = new URL(textValue);

      if (
        url.protocol === "https:" &&
        url.hostname === "open.spotify.com" &&
        url.pathname.startsWith("/track/")
      ) {
        return `https://open.spotify.com/track/${url.pathname.split("/")[2]}`;
      }
    } catch {
      return null;
    }

    return null;
  }

  function getAlbumTrackInput(album) {
    if (!album) return null;

    return getSpotifyTrackUrl(album.spotifyTrackUri);
  }

  async function fetchAlbumCover(album) {
    const trackUrl = getAlbumTrackInput(album);

    if (!trackUrl) return null;

    if (albumCoverCache.has(trackUrl)) {
      return albumCoverCache.get(trackUrl);
    }

    if (albumCoverRequests.has(trackUrl)) {
      return albumCoverRequests.get(trackUrl);
    }

    const request = (async () => {
      try {
        const response = await fetch(`${METADATA_API_URL}/api/album-cover`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            trackUrl
          })
        });

        if (!response.ok) {
          throw new Error(`Album artwork lookup failed (${response.status}).`);
        }

        const data = await response.json();
        const imageUrl = data?.imageUrl || null;

        if (imageUrl) {
          albumCoverCache.set(trackUrl, imageUrl);
        }

        return imageUrl;
      } catch (error) {
        console.warn("Album artwork lookup failed:", error);
        return null;
      } finally {
        albumCoverRequests.delete(trackUrl);
      }
    })();

    albumCoverRequests.set(trackUrl, request);

    return request;
  }

  async function loadAllAlbumCovers() {
    if (albumCoverLoading) return;

    albumCoverLoading = true;

    try {
      // Always prioritize albums by all-time play count, regardless of
      // the currently selected dashboard period.
      const allTimeStats = calculateStatistics(dashboardRecords);
      const albums = allTimeStats.albums.filter(
        (album) => getAlbumTrackInput(album)
      );

      if (!albums.length) {
        albumCoverLoading = false;
        return;
      }

      const topAlbums = albums.slice(0, 10);
      const remainingAlbums = albums.slice(10);

      const loadBatch = async (batch) => {
        await Promise.all(
          batch.map(async (album) => {
            await fetchAlbumCover(album);
          })
        );

        renderDashboard();
      };

      // Load the ten most-listened-to albums first.
      await loadBatch(topAlbums);

      // Continue with the remaining albums in manageable batches.
      for (
        let index = 0;
        index < remainingAlbums.length;
        index += METADATA_BATCH_SIZE
      ) {
        const batch = remainingAlbums.slice(
          index,
          index + METADATA_BATCH_SIZE
        );

        await loadBatch(batch);
      }
    } catch (error) {
      console.warn("Album artwork loading encountered an error:", error);
    } finally {
      albumCoverLoading = false;
    }
  }

  function getArtistMetadataImage(metadata) {
    if (!metadata || typeof metadata !== "object") return null;

    const images = metadata.images || {};

    return (
      images.artistThumb ||
      images.artistThumbHQ ||
      images.artistFanart ||
      images.artistBanner ||
      images.artistLogo ||
      images.artistClearart ||
      metadata.image ||
      null
    );
  }

  async function fetchArtistMetadata(artistName) {
    const artistKey = normalizeArtistKey(artistName);

    if (!artistKey) return null;

    if (artistMetadataCache.has(artistKey)) {
      return artistMetadataCache.get(artistKey);
    }

    if (artistMetadataRequests.has(artistKey)) {
      return artistMetadataRequests.get(artistKey);
    }

    const request = (async () => {
      try {
        const response = await fetch(`${METADATA_API_URL}/api/artist?name=${encodeURIComponent(artistName)}`);

        if (!response.ok) {
          throw new Error(`Artist metadata lookup failed (${response.status}).`);
        }

        const data = await response.json();
        const artist = data?.artist || null;

        if (artist) {
          artistMetadataCache.set(artistKey, artist);

          const image = getArtistMetadataImage(artist);

          if (image) {
            artistImageCache.set(artistKey, image);
          }
        }

        return artist;
      } catch (error) {
        console.warn(`Metadata lookup failed for ${artistName}:`, error);
        return null;
      } finally {
        artistMetadataRequests.delete(artistKey);
      }
    })();

    artistMetadataRequests.set(artistKey, request);

    return request;
  }

  async function fetchArtistMetadataBatch(artistNames) {
    const namesToFetch = artistNames.filter((name) => {
      const key = normalizeArtistKey(name);

      return (
        key &&
        !artistMetadataCache.has(key) &&
        !artistMetadataRequests.has(key)
      );
    });

    if (!namesToFetch.length) return [];

    const results = [];

    for (
      let index = 0;
      index < namesToFetch.length;
      index += METADATA_BATCH_SIZE
    ) {
      const batch = namesToFetch.slice(
        index,
        index + METADATA_BATCH_SIZE
      );

      try {
        const response = await fetch(`${METADATA_API_URL}/api/artists`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            names: batch
          })
        });

        if (!response.ok) {
          throw new Error(`Artist metadata batch failed (${response.status}).`);
        }

        const data = await response.json();
        const batchResults = Array.isArray(data?.results)
          ? data.results
          : [];

        for (const result of batchResults) {
          const requestedName = result.requestedName || "";
          const key = normalizeArtistKey(requestedName);
          const artist = result.artist || null;

          if (key && artist) {
            artistMetadataCache.set(key, artist);

            const image = getArtistMetadataImage(artist);

            if (image) {
              artistImageCache.set(key, image);
            }
          }

          results.push(result);
        }
      } catch (error) {
        console.warn("Artist metadata batch failed:", error);
      }
    }

    return results;
  }

  async function loadAllArtistMetadata() {
    if (metadataLoading) return;

    metadataLoading = true;
    metadataLoadedCount = 0;

    try {
      // Prioritize the most-listened-to artists across all time.
      const allTimeStats = calculateStatistics(dashboardRecords);
      const artists = allTimeStats.artists;

      metadataTotalCount = artists.length;

      if (!artists.length) {
        metadataLoading = false;
        return;
      }

      const topArtists = artists.slice(0, 10);
      const remainingArtists = artists.slice(10);

      const updateStatus = () => {
        const status = document.getElementById("stats-metadata-status");

        if (status) {
          status.textContent =
            `Artist images: ${metadataLoadedCount.toLocaleString()} / ${metadataTotalCount.toLocaleString()} processed`;
        }
      };

      const loadBatch = async (batch) => {
        const names = batch.map((artist) => artist.name);
        await fetchArtistMetadataBatch(names);

        metadataLoadedCount += batch.length;
        updateStatus();
        renderDashboard();
      };

      // Load the ten most-listened-to artists first.
      await loadBatch(topArtists);

      // Continue with the remaining artists in batches.
      for (
        let index = 0;
        index < remainingArtists.length;
        index += METADATA_BATCH_SIZE
      ) {
        const batch = remainingArtists.slice(
          index,
          index + METADATA_BATCH_SIZE
        );

        await loadBatch(batch);
      }
    } catch (error) {
      console.warn("Artist metadata loading encountered an error:", error);
    } finally {
      metadataLoading = false;
    }
  }

  // --------------------------------------------------
  // Artist modal
  // --------------------------------------------------

  function getArtistListeningStats(artistName) {
    const artistKey = normalizeArtistKey(artistName);

    const records = getFilteredRecords().filter(
      (record) => normalizeArtistKey(record.artistName) === artistKey
    );

    const stats = calculateStatistics(records);

    return {
      records,
      stats
    };
  }

  function showArtistModal(artistName) {
    const existing = document.querySelector(".stats-modal");

    if (existing) existing.remove();

    const { records, stats } = getArtistListeningStats(artistName);

    const modal = createElement("div", "stats-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${artistName} listening statistics`);

    const content = createElement("div", "stats-modal-content");

    const header = createElement("div", "stats-modal-header");
    const headingGroup = createElement("div");
    const heading = createElement("h2", "", artistName);
    const subtitle = createElement(
      "div",
      "stats-modal-subtitle",
      `${formatNumber(stats.totalPlays)} plays in the selected period`
    );

    headingGroup.append(heading, subtitle);

    const closeButton = createElement("button", "stats-modal-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close artist statistics");
    closeButton.addEventListener("click", () => modal.remove());

    header.append(headingGroup, closeButton);

    const metrics = createElement("div", "stats-modal-metrics");

    const metricData = [
      ["TOTAL PLAYS", formatNumber(stats.totalPlays)],
      ["LISTENING TIME", formatDuration(stats.totalMinutes * 60000)],
      ["UNIQUE SONGS", formatNumber(stats.uniqueTracks)]
    ];

    for (const [label, value] of metricData) {
      const metric = createElement("div", "stats-modal-metric");
      const strong = createElement("strong", "", value);
      const span = createElement("span", "", label);
      metric.append(strong, span);
      metrics.appendChild(metric);
    }

    const topTracksHeading = createElement("h3", "", "MOST PLAYED SONGS");
    const topTracksList = createElement("div", "stats-modal-list");

    const topTracks = stats.tracks.slice(0, 10);

    if (!topTracks.length) {
      topTracksList.appendChild(
        createElement("div", "stats-empty", "No listening data for this artist in this period.")
      );
    } else {
      for (const track of topTracks) {
        const item = createElement("div", "stats-modal-list-item");
        const name = createElement("span", "", track.name);
        const count = createElement("span", "", `${formatNumber(track.plays)} plays`);
        item.append(name, count);
        topTracksList.appendChild(item);
      }
    }

    const albumsHeading = createElement("h3", "", "MOST PLAYED ALBUMS");
    const albumsList = createElement("div", "stats-modal-list");

    if (!stats.albums.length) {
      albumsList.appendChild(
        createElement("div", "stats-empty", "No album data available.")
      );
    } else {
      for (const album of stats.albums.slice(0, 10)) {
        const item = createElement("div", "stats-modal-list-item");
        const name = createElement("span", "", album.name);
        const count = createElement("span", "", `${formatNumber(album.plays)} plays`);
        item.append(name, count);
        albumsList.appendChild(item);
      }
    }

    content.append(
      header,
      metrics,
      topTracksHeading,
      topTracksList,
      albumsHeading,
      albumsList
    );

    modal.appendChild(content);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
    });

    document.addEventListener("keydown", function handleEscape(event) {
      if (event.key === "Escape" && modal.isConnected) {
        modal.remove();
        document.removeEventListener("keydown", handleEscape);
      }
    });

    document.body.appendChild(modal);
    closeButton.focus();
  }

  // --------------------------------------------------
  // Dashboard rendering
  // --------------------------------------------------

  function renderDashboard() {
    const dashboard = document.querySelector(".stats-dashboard");

    if (!dashboard) return;

    const records = getFilteredRecords();
    const stats = calculateStatistics(records);

    const totalPlaysValue = document.getElementById("stats-total-plays");
    const totalMinutesValue = document.getElementById("stats-total-minutes");
    const uniqueTracksValue = document.getElementById("stats-unique-tracks");
    const uniqueArtistsValue = document.getElementById("stats-unique-artists");

    if (totalPlaysValue) {
      totalPlaysValue.textContent = formatNumber(stats.totalPlays);
    }

    if (totalMinutesValue) {
      totalMinutesValue.textContent = formatDuration(stats.totalMinutes * 60000);
    }

    if (uniqueTracksValue) {
      uniqueTracksValue.textContent = formatNumber(stats.uniqueTracks);
    }

    if (uniqueArtistsValue) {
      uniqueArtistsValue.textContent = formatNumber(stats.uniqueArtists);
    }

    const artistList = document.getElementById("stats-artist-list");

    if (artistList) {
      artistList.innerHTML = "";

      const topArtists = stats.artists.slice(0, 10);

      if (!topArtists.length) {
        artistList.appendChild(
          createElement("div", "stats-empty", "No artists found for this period.")
        );
      }

      for (const artist of topArtists) {
        const button = createElement("button", "stats-artist-button");
        button.type = "button";

        const identity = createElement("div", "stats-artist-identity");
        const artistKey = normalizeArtistKey(artist.name);
        const imageUrl = artistImageCache.get(artistKey);

        let avatar;

        if (imageUrl) {
          avatar = createElement("img", "stats-artist-avatar");
          avatar.src = imageUrl;
          avatar.alt = `${artist.name} profile`;
          avatar.loading = "lazy";
        } else {
          avatar = createElement(
            "div",
            "stats-artist-avatar",
            artist.name.slice(0, 1).toUpperCase()
          );
        }

        const name = createElement("span", "stats-artist-name", artist.name);
        identity.append(avatar, name);

        const plays = createElement(
          "span",
          "stats-artist-plays",
          `${formatNumber(artist.plays)} plays`
        );

        button.append(identity, plays);
        button.addEventListener("click", () => showArtistModal(artist.name));

        artistList.appendChild(button);
      }
    }

    const albumList = document.getElementById("stats-album-list");

    if (albumList) {
      albumList.innerHTML = "";

      const topAlbums = stats.albums.slice(0, 10);

      if (!topAlbums.length) {
        albumList.appendChild(
          createElement("div", "stats-empty", "No albums found for this period.")
        );
      }

      for (const album of topAlbums) {
        const row = createElement("div", "stats-album-row");
        const identity = createElement("div", "stats-album-identity");
        const trackUrl = getAlbumTrackInput(album);
        const coverUrl = trackUrl ? albumCoverCache.get(trackUrl) : null;

        if (coverUrl) {
          const image = createElement("img", "stats-album-cover");
          image.src = coverUrl;
          image.alt = `${album.name} album cover`;
          image.loading = "lazy";
          identity.appendChild(image);
        } else {
          identity.appendChild(
            createElement("div", "stats-album-cover-placeholder", "♪")
          );
        }

        const details = createElement("div");
        details.append(
          createElement("div", "stats-album-name", album.name),
          createElement("div", "stats-album-artist", album.artist)
        );

        identity.appendChild(details);

        const count = createElement(
          "span",
          "stats-album-count",
          `${formatNumber(album.plays)} plays`
        );

        row.append(identity, count);
        albumList.appendChild(row);
      }
    }

    const metadataStatus = document.getElementById("stats-metadata-status");

    if (metadataStatus && !metadataLoading) {
      metadataStatus.textContent =
        metadataLoadedCount > 0
          ? `Artist images: ${metadataLoadedCount.toLocaleString()} / ${metadataTotalCount.toLocaleString()} processed`
          : "Artist images load automatically, starting with your most-listened-to artists.";
    }

    renderListeningChart(stats);
  }

  function renderListeningChart(stats) {
    const chart = document.getElementById("stats-listening-chart");

    if (!chart) return;

    chart.innerHTML = "";

    const daily = stats.daily;
    const dates = [];

    const today = new Date();

    for (let index = 6; index >= 0; index--) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      dates.push(date);
    }

    const values = dates.map((date) => {
      const key = date.toISOString().slice(0, 10);
      return daily.get(key) || 0;
    });

    const maximum = Math.max(...values, 1);

    for (let index = 0; index < dates.length; index++) {
      const column = createElement("div", "stats-chart-column");
      const barWrap = createElement("div", "stats-chart-bar-wrap");
      const bar = createElement("div", "stats-chart-bar");

      bar.style.height = `${Math.max(3, (values[index] / maximum) * 100)}%`;
      bar.title = formatDuration(values[index]);

      const label = createElement(
        "div",
        "stats-chart-month",
        dates[index].toLocaleDateString(undefined, { weekday: "short" })
      );

      barWrap.appendChild(bar);
      column.append(barWrap, label);
      chart.appendChild(column);
    }
  }

  // --------------------------------------------------
  // Dashboard construction
  // --------------------------------------------------

  function buildDashboard() {
    addDashboardStyles();

    const uploadContainer =
      document.querySelector(".upload-section") ||
      document.querySelector("main") ||
      document.body;

    const dashboard = createElement("section", "stats-dashboard");
    dashboard.innerHTML = `
      <div class="stats-topbar">
        <div>
          <div class="stats-eyebrow">YOUR LISTENING HISTORY</div>
          <h1>Spotify <span>Stats</span></h1>
          <p>Your listening habits, organized.</p>
        </div>
        <button type="button" class="stats-back-button" id="stats-back-button">
          ← Upload another file
        </button>
      </div>

      <div class="stats-period" role="group" aria-label="Listening period">
        <button type="button" class="stats-period-button active" data-period="all">All Time</button>
        <button type="button" class="stats-period-button" data-period="year">Past Year</button>
        <button type="button" class="stats-period-button" data-period="month">Past Month</button>
      </div>

      <div class="stats-grid">
        <div class="stats-card">
          <span class="stats-card-label">TOTAL PLAYS</span>
          <strong class="stats-card-value" id="stats-total-plays">0</strong>
          <span class="stats-card-note">Recorded listening sessions</span>
        </div>

        <div class="stats-card">
          <span class="stats-card-label">LISTENING TIME</span>
          <strong class="stats-card-value" id="stats-total-minutes">0 min</strong>
          <span class="stats-card-note">Total time spent listening</span>
        </div>

        <div class="stats-card">
          <span class="stats-card-label">UNIQUE SONGS</span>
          <strong class="stats-card-value" id="stats-unique-tracks">0</strong>
          <span class="stats-card-note">Distinct songs played</span>
        </div>

        <div class="stats-card">
          <span class="stats-card-label">UNIQUE ARTISTS</span>
          <strong class="stats-card-value" id="stats-unique-artists">0</strong>
          <span class="stats-card-note">Different artists listened to</span>
        </div>
      </div>

      <section class="stats-section">
        <div class="stats-section-heading">
          <h2>Top Artists</h2>
          <span class="stats-section-label">BY PLAYS</span>
        </div>
        <div class="stats-panel">
          <div class="stats-artist-list" id="stats-artist-list"></div>
          <div class="stats-metadata-status" id="stats-metadata-status">
            Artist images load automatically.
          </div>
        </div>
      </section>

      <section class="stats-section">
        <div class="stats-section-heading">
          <h2>Top Albums</h2>
          <span class="stats-section-label">BY PLAYS</span>
        </div>
        <div class="stats-panel">
          <div class="stats-album-list" id="stats-album-list"></div>
        </div>
      </section>

      <section class="stats-section">
        <div class="stats-section-heading">
          <h2>Listening Activity</h2>
          <span class="stats-section-label">LAST 7 DAYS</span>
        </div>
        <div class="stats-panel">
          <div class="stats-chart" id="stats-listening-chart"></div>
        </div>
      </section>
    `;

    uploadContainer.appendChild(dashboard);

    const periodButtons = dashboard.querySelectorAll(".stats-period-button");

    periodButtons.forEach((button) => {
      button.addEventListener("click", () => {
        selectedPeriod = button.dataset.period;

        periodButtons.forEach((periodButton) => {
          periodButton.classList.toggle(
            "active",
            periodButton === button
          );
        });

        renderDashboard();
      });
    });

    const backButton = dashboard.querySelector("#stats-back-button");

    if (backButton) {
      backButton.addEventListener("click", () => {
        restoreUploadView();
      });
    }

    // Move the full privacy disclosure below the dashboard content.
    if (privacyCard) {
      privacyCard.hidden = false;
      dashboard.appendChild(privacyCard);
    }

    renderDashboard();
  }

  // --------------------------------------------------
  // Upload and dashboard transitions
  // --------------------------------------------------

  function restoreUploadView() {
    const dashboard = document.querySelector(".stats-dashboard");

    if (dashboard) dashboard.remove();

    // Restore the privacy disclosure to its original upload-page position.
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

    const uploadSection = document.querySelector(".upload-section");

    if (uploadSection) {
      uploadSection.hidden = false;
    }

    if (dropZone) dropZone.hidden = false;
    if (selectedFile) selectedFile.hidden = true;
    if (processButton) processButton.hidden = false;

    setButtonState(false);
  }

  function showDashboard() {
    const uploadSection = document.querySelector(".upload-section");

    if (uploadSection) {
      uploadSection.hidden = true;
    }

    if (dropZone) dropZone.hidden = true;
    if (selectedFile) selectedFile.hidden = true;
    if (processButton) processButton.hidden = true;

    buildDashboard();
    loadAllArtistMetadata();
    loadAllAlbumCovers();
  }

  // --------------------------------------------------
  // Process listening history
  // --------------------------------------------------

  async function processListeningHistory() {
    if (!isValidated || !validatedRecords.length) {
      showMessage("Please select and validate your Spotify ZIP file first.");
      return;
    }

    dashboardRecords = validatedRecords.slice();
    selectedPeriod = "all";

    showDashboard();
  }

  if (processButton) {
    processButton.addEventListener("click", processListeningHistory);
  }

  // --------------------------------------------------
  // Initial page state
  // --------------------------------------------------

  restoreUploadView();

})();
