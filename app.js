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

  let currentFile = null;
  let validatedRecords = [];
  let validationRun = 0;
  let isValidated = false;
  let dashboardRecords = [];
  let selectedPeriod = "month";
  const artistImageCache = new Map();
  const artistImageRequests = new Map();
  const THEAUDIODB_API_KEY = "123";
  let artistMetadataQueue = Promise.resolve();
  let lastArtistMetadataRequestAt = 0;

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
        gap: 15px;
        padding: 13px 0;
        border-bottom: 1px solid #292c30;
      }

      .stats-album-row:last-child {
        border-bottom: 0;
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
    cutoff.setDate(cutoff.getDate() - 30);

    return dashboardRecords.filter(
      (record) => record.date >= cutoff
    );
  }

  function calculateStatistics(records) {
    const artists = new Map();
    const albums = new Map();
    const tracks = new Map();

    let totalDuration = 0;

    records.forEach((record) => {
      totalDuration += record.duration;

      const artistKey = normalize(record.artistName);

      if (!artists.has(artistKey)) {
        artists.set(artistKey, {
          name: record.artistName,
          plays: 0,
          duration: 0,
          tracks: new Map(),
          albums: new Map(),
          monthly: new Map()
        });
      }

      const artist = artists.get(artistKey);
      artist.plays++;
      artist.duration += record.duration;

      const trackKey = getTrackKey(record);

      if (!tracks.has(trackKey)) {
        tracks.set(trackKey, {
          name: record.trackName,
          artistName: record.artistName,
          artistKey,
          plays: 0,
          duration: 0
        });
      }

      const track = tracks.get(trackKey);
      track.plays++;
      track.duration += record.duration;

      artist.tracks.set(trackKey, track);

      const monthKey = [
        record.date.getFullYear(),
        String(record.date.getMonth() + 1).padStart(2, "0")
      ].join("-");

      artist.monthly.set(
        monthKey,
        (artist.monthly.get(monthKey) || 0) + 1
      );

      if (record.albumName) {
        const albumKey =
          `${artistKey}::${normalize(record.albumName)}`;

        if (!albums.has(albumKey)) {
          albums.set(albumKey, {
            name: record.albumName,
            artistName: record.artistName,
            plays: 0,
            tracks: new Set()
          });
        }

        const album = albums.get(albumKey);
        album.plays++;
        album.tracks.add(trackKey);

        artist.albums.set(albumKey, album);
      }
    });

    return {
      totalPlays: records.length,
      uniqueSongs: tracks.size,
      uniqueArtists: artists.size,
      totalDuration,
      artists: [...artists.values()].sort((a, b) => b.plays - a.plays),
      albums: [...albums.values()].sort((a, b) => b.plays - a.plays),
      tracks: [...tracks.values()]
    };
  }

  function getMonthlyActivity(records) {
    const months = new Map();

    records.forEach((record) => {
      const key = [
        record.date.getFullYear(),
        String(record.date.getMonth() + 1).padStart(2, "0")
      ].join("-");

      months.set(key, (months.get(key) || 0) + 1);
    });

    const sorted = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]));

    return sorted.slice(-12);
  }

  // --------------------------------------------------
  // Dashboard construction
  // --------------------------------------------------

  function createDashboard() {
    addDashboardStyles();

    const existing = document.getElementById("stats-dashboard");
    if (existing) existing.remove();

    const dashboard = createElement("main", "stats-dashboard");
    dashboard.id = "stats-dashboard";

    const topbar = createElement("div", "stats-topbar");

    const heading = createElement("div");
    heading.appendChild(
      createElement("div", "stats-eyebrow", "YOUR LISTENING HISTORY")
    );

    const title = createElement("h1");
    title.append("Your music. ");
    title.appendChild(createElement("span", "", "Your stats."));
    heading.appendChild(title);

    const backButton = createElement(
      "button",
      "stats-back-button",
      "← Import another file"
    );
    backButton.type = "button";
    backButton.addEventListener("click", returnToUpload);

    topbar.append(heading, backButton);
    dashboard.appendChild(topbar);

    const period = createElement("div", "stats-period");

    const monthButton = createElement(
      "button",
      "stats-period-button active",
      "Past month"
    );
    monthButton.type = "button";
    monthButton.dataset.period = "month";

    const allButton = createElement(
      "button",
      "stats-period-button",
      "All time"
    );
    allButton.type = "button";
    allButton.dataset.period = "all";

    monthButton.addEventListener("click", () => setPeriod("month"));
    allButton.addEventListener("click", () => setPeriod("all"));

    period.append(monthButton, allButton);
    dashboard.appendChild(period);

    const dateNote = createElement("p", "stats-date-note");
    dateNote.id = "stats-date-note";
    dashboard.appendChild(dateNote);

    const grid = createElement("div", "stats-grid");
    grid.id = "stats-summary-grid";
    dashboard.appendChild(grid);

    // Artist search appears before Top Artists.
    const artistSection = createElement("section", "stats-section");

    const artistHeading = createElement(
      "div",
      "stats-section-heading"
    );
    artistHeading.appendChild(createElement("h2", "", "Artist Search"));
    artistHeading.appendChild(
      createElement("span", "stats-section-label", "YOUR LIBRARY")
    );

    const artistPanel = createElement("div", "stats-panel");

    const search = document.createElement("input");
    search.type = "search";
    search.className = "stats-search";
    search.id = "stats-artist-search";
    search.placeholder = "Search artists in your listening history...";

    const artistList = createElement("div", "stats-artist-list");
    artistList.id = "stats-artist-list";

    search.addEventListener("input", renderArtistList);

    artistPanel.append(search, artistList);
    artistSection.append(artistHeading, artistPanel);
    dashboard.appendChild(artistSection);

    const topArtistsSection = createElement("section", "stats-section");
    const topArtistsHeading = createElement(
      "div",
      "stats-section-heading"
    );
    topArtistsHeading.appendChild(createElement("h2", "", "Top Artists"));
    topArtistsHeading.appendChild(
      createElement("span", "stats-section-label", "RANKED BY PLAYS")
    );

    const topArtistsPanel = createElement("div", "stats-panel");
    const topArtistsList = createElement("div", "stats-artist-list");
    topArtistsList.id = "stats-top-artists";

    topArtistsPanel.appendChild(topArtistsList);
    topArtistsSection.append(topArtistsHeading, topArtistsPanel);
    dashboard.appendChild(topArtistsSection);

    const albumsSection = createElement("section", "stats-section");
    const albumsHeading = createElement(
      "div",
      "stats-section-heading"
    );
    albumsHeading.appendChild(createElement("h2", "", "Top Albums"));
    albumsHeading.appendChild(
      createElement("span", "stats-section-label", "RANKED BY PLAYS")
    );

    const albumsPanel = createElement("div", "stats-panel");
    const albumsList = createElement("div", "stats-album-list");
    albumsList.id = "stats-top-albums";

    albumsPanel.appendChild(albumsList);
    albumsSection.append(albumsHeading, albumsPanel);
    dashboard.appendChild(albumsSection);

    const activitySection = createElement("section", "stats-section");
    const activityHeading = createElement(
      "div",
      "stats-section-heading"
    );
    activityHeading.appendChild(createElement("h2", "", "Monthly Activity"));
    activityHeading.appendChild(
      createElement("span", "stats-section-label", "TOTAL PLAYS")
    );

    const activityPanel = createElement("div", "stats-panel");
    const chart = createElement("div", "stats-chart");
    chart.id = "stats-monthly-chart";

    activityPanel.appendChild(chart);
    activitySection.append(activityHeading, activityPanel);
    dashboard.appendChild(activitySection);

    dashboard.appendChild(
      createElement(
        "p",
        "stats-disclaimer",
        "Statistics are calculated locally from your Spotify Extended Streaming History. Artist profile images and MusicBrainz artist IDs are matched through TheAudioDB when available. Artists without a reliable matching profile keep the default placeholder."
      )
    );

    const privacy = createElement(
      "p",
      "stats-disclaimer",
      "Your listening history remains in this browser session. No listening records are uploaded or permanently stored."
    );

    dashboard.appendChild(privacy);

    const uploadSection = document.querySelector(".upload-section");

    if (uploadSection) uploadSection.hidden = true;

    // Move the full privacy disclosure below the dashboard content.
    if (privacyCard) {
      privacyCard.hidden = false;
      dashboard.appendChild(privacyCard);
    }

    const pageShell = document.querySelector(".page-shell") || document.body;
    const footer = document.querySelector(".site-footer");

    if (footer && footer.parentNode === pageShell) {
      pageShell.insertBefore(dashboard, footer);
    } else {
      pageShell.appendChild(dashboard);
    }

    createArtistModal();
    renderDashboard();
  }

  // --------------------------------------------------
  // Dashboard rendering
  // --------------------------------------------------

  function setPeriod(period) {
    selectedPeriod = period;

    document.querySelectorAll(".stats-period-button").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.period === period
      );
    });

    renderDashboard();
  }

  function renderDashboard() {
    const records = getFilteredRecords();
    const stats = calculateStatistics(records);

    const grid = document.getElementById("stats-summary-grid");
    const dateNote = document.getElementById("stats-date-note");

    if (!grid) return;

    grid.replaceChildren();

    const cards = [
      {
        label: "UNIQUE SONGS",
        value: stats.uniqueSongs,
        note: "Individual tracks listened to"
      },
      {
        label: "UNIQUE ARTISTS",
        value: stats.uniqueArtists,
        note: "Different artists listened to"
      },
      {
        label: "TOTAL PLAYS",
        value: stats.totalPlays,
        note: "Recorded listening sessions"
      }
    ];

    cards.forEach((card) => {
      const element = createElement("div", "stats-card");
      element.appendChild(
        createElement("div", "stats-card-label", card.label)
      );
      element.appendChild(
        createElement("strong", "stats-card-value", formatNumber(card.value))
      );
      element.appendChild(
        createElement("span", "stats-card-note", card.note)
      );
      grid.appendChild(element);
    });

    if (dateNote) {
      dateNote.textContent =
        selectedPeriod === "month"
          ? "Showing the last 30 days"
          : `Showing all ${formatNumber(dashboardRecords.length)} recorded plays`;
    }

    renderArtistList();
    renderTopArtists(stats.artists);
    renderTopAlbums(stats.albums);
    renderMonthlyActivity();
  }

  // --------------------------------------------------
  // Artist search and lists
  // --------------------------------------------------

  function renderArtistList() {
    const container = document.getElementById("stats-artist-list");
    const search = document.getElementById("stats-artist-search");

    if (!container) return;

    const stats = calculateStatistics(getFilteredRecords());
    const query = normalize(search ? search.value : "");

    const matchingArtists = stats.artists.filter((artist) =>
      normalize(artist.name).includes(query)
    );

    container.replaceChildren();

    if (matchingArtists.length === 0) {
      container.appendChild(
        createElement(
          "div",
          "stats-empty",
          query
            ? "No matching artists found in this listening period."
            : "No artist listening records found."
        )
      );
      return;
    }

    matchingArtists.slice(0, 15).forEach((artist) => {
      container.appendChild(createArtistButton(artist, true));
    });
  }

  function createArtistButton(artist, showImage = false) {
    const button = createElement("button", "stats-artist-button");
    button.type = "button";

    const identity = createElement("span", "stats-artist-identity");

    if (showImage) {
      const avatar = createElement("span", "stats-artist-avatar");
      avatar.textContent = "♪";
      avatar.setAttribute("aria-hidden", "true");
      identity.appendChild(avatar);
      loadArtistImage(artist.name, avatar);
    }

    const name = createElement("span", "stats-artist-name", artist.name);
    identity.appendChild(name);

    const plays = createElement(
      "span",
      "stats-artist-plays",
      `${formatNumber(artist.plays)} plays`
    );

    button.append(identity, plays);

    button.addEventListener("click", () => {
      openArtistModal(artist.name);
    });

    return button;
  }

  // TheAudioDB provides music-specific artist profiles and artwork.
  // Only the artist name is sent; listening records and statistics stay local.
  // Requests are serialized to stay below the free API's 30 requests/minute limit.
  function fetchTheAudioDB(url) {
    const request = artistMetadataQueue.then(async () => {
      const minimumInterval = 2100;
      const elapsed = Date.now() - lastArtistMetadataRequestAt;
      const wait = Math.max(0, minimumInterval - elapsed);

      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      lastArtistMetadataRequestAt = Date.now();
      const response = await fetch(url);

      if (response.status === 429) {
        throw new Error("TheAudioDB rate limit reached");
      }

      if (!response.ok) {
        throw new Error(`TheAudioDB request failed (${response.status})`);
      }

      return response.json();
    });

    artistMetadataQueue = request.catch(() => null);
    return request;
  }

  function normalizeArtistMatchName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function getExactArtistMatch(artists, requestedName) {
    const requested = normalizeArtistMatchName(requestedName);
    if (!Array.isArray(artists) || !requested) return null;

    return artists.find((artist) => {
      const primaryName = normalizeArtistMatchName(artist.strArtist);
      const strippedName = normalizeArtistMatchName(artist.strArtistStripped);
      const alternateNames = String(artist.strArtistAlternate || "")
        .split(/[;,|]/)
        .map(normalizeArtistMatchName);

      return (
        primaryName === requested ||
        strippedName === requested ||
        alternateNames.includes(requested)
      );
    }) || null;
  }

  async function loadArtistImage(artistName, avatar) {
    const key = normalize(artistName);
    if (!key || !avatar) return;

    const applyImage = (image) => {
      if (!image || !avatar.isConnected) return;

      const img = document.createElement("img");
      img.className = "stats-artist-avatar";
      img.src = image.url;
      img.alt = `${artistName} profile`;
      img.title = image.attribution || `${artistName} · TheAudioDB`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.replaceWith(avatar);
      }, { once: true });
      avatar.replaceWith(img);
    };

    if (artistImageCache.has(key)) {
      applyImage(artistImageCache.get(key));
      return;
    }

    if (artistImageRequests.has(key)) {
      const image = await artistImageRequests.get(key);
      applyImage(image);
      return;
    }

    const request = (async () => {
      try {
        const url =
          `https://www.theaudiodb.com/api/v1/json/${THEAUDIODB_API_KEY}/search.php?s=${encodeURIComponent(artistName)}`;
        const data = await fetchTheAudioDB(url);
        const artist = getExactArtistMatch(data?.artists, artistName);

        if (!artist) return null;

        const imageUrl =
          artist.strArtistThumb ||
          artist.strArtistWideThumb ||
          artist.strArtistFanart ||
          artist.strArtistFanart2 ||
          artist.strArtistFanart3 ||
          artist.strArtistFanart4 ||
          null;

        if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return null;

        return {
          url: imageUrl,
          artistName: artist.strArtist || artistName,
          musicBrainzArtistId: artist.strMusicBrainzID || null,
          attribution: `${artist.strArtist || artistName} · TheAudioDB`
        };
      } catch (error) {
        console.warn(`Could not load TheAudioDB profile for ${artistName}:`, error);
        return null;
      }
    })();

    artistImageRequests.set(key, request);
    const image = await request;
    artistImageCache.set(key, image);
    artistImageRequests.delete(key);
    applyImage(image);
  }

  function renderTopArtists(artists) {
    const container = document.getElementById("stats-top-artists");
    if (!container) return;

    container.replaceChildren();

    if (artists.length === 0) {
      container.appendChild(
        createElement("div", "stats-empty", "No artists found.")
      );
      return;
    }

    artists.slice(0, 10).forEach((artist) => {
      container.appendChild(createArtistButton(artist));
    });
  }

  function renderTopAlbums(albums) {
    const container = document.getElementById("stats-top-albums");
    if (!container) return;

    container.replaceChildren();

    if (albums.length === 0) {
      container.appendChild(
        createElement("div", "stats-empty", "No album information found.")
      );
      return;
    }

    albums.slice(0, 10).forEach((album) => {
      const row = createElement("div", "stats-album-row");
      const info = createElement("div");

      info.appendChild(
        createElement("div", "stats-album-name", album.name)
      );
      info.appendChild(
        createElement("div", "stats-album-artist", album.artistName)
      );

      row.append(
        info,
        createElement(
          "span",
          "stats-album-count",
          `${formatNumber(album.plays)} plays`
        )
      );

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
        createElement("div", "stats-empty", "No monthly activity found.")
      );
      return;
    }

    const maxPlays = Math.max(...activity.map((item) => item[1]), 1);

    activity.forEach(([key, plays]) => {
      const [year, month] = key.split("-").map(Number);
      const date = new Date(year, month - 1, 1);

      const column = createElement("div", "stats-chart-column");
      const barWrap = createElement("div", "stats-chart-bar-wrap");
      const bar = createElement("div", "stats-chart-bar");

      bar.style.height = `${Math.max(3, (plays / maxPlays) * 100)}%`;
      bar.title = `${formatNumber(plays)} plays`;

      barWrap.appendChild(bar);

      const label = createElement(
        "span",
        "stats-chart-month",
        date.toLocaleDateString(undefined, { month: "short" })
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

    const subtitle = createElement("div", "stats-modal-subtitle");
    subtitle.id = "stats-modal-subtitle";

    titleArea.append(title, subtitle);

    const close = createElement("button", "stats-modal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close artist details");
    close.addEventListener("click", closeArtistModal);

    header.append(titleArea, close);

    const metrics = createElement("div", "stats-modal-metrics");
    metrics.id = "stats-modal-metrics";

    const songsHeading = createElement("h3", "", "MOST PLAYED SONGS");
    const songs = createElement("div", "stats-modal-list");
    songs.id = "stats-modal-songs";

    const albumsHeading = createElement("h3", "", "TOP ALBUMS");
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
      if (event.target === modal) closeArtistModal();
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

    document.getElementById("stats-modal-title").textContent = artist.name;

    document.getElementById("stats-modal-subtitle").textContent =
      selectedPeriod === "month"
        ? "Personal listening statistics · Past 30 days"
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
      const metric = createElement("div", "stats-modal-metric");
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
        createElement("div", "stats-empty", "No songs found.")
      );
    } else {
      topTracks.forEach((track) => {
        songs.appendChild(
          createModalListItem(track.name, `${formatNumber(track.plays)} plays`)
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
        createElement("div", "stats-empty", "No album information found.")
      );
    } else {
      topAlbums.forEach((album) => {
        albums.appendChild(
          createModalListItem(album.name, `${formatNumber(album.plays)} plays`)
        );
      });
    }

    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function createModalListItem(name, value) {
    const item = createElement("div", "stats-modal-list-item");

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
    if (!currentFile || !isValidated || validatedRecords.length === 0) {
      return;
    }

    dashboardRecords = validatedRecords.slice();
    selectedPeriod = "month";

    createDashboard();

    // Release the original upload references after creating the dashboard.
    validatedRecords = [];
    currentFile = null;
    isValidated = false;
  }

  function returnToUpload() {
    const dashboard = document.getElementById("stats-dashboard");
    const modal = document.getElementById("stats-artist-modal");

    if (dashboard) dashboard.remove();
    if (modal) modal.remove();

    const uploadSection = document.querySelector(".upload-section");
    if (uploadSection) uploadSection.hidden = false;

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

    dashboardRecords = [];
    selectedPeriod = "month";

    resetUpload();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (processButton) {
    processButton.addEventListener("click", startStatistics);
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
