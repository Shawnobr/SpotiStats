
(() => {
  "use strict";

  const fileInput = document.getElementById("file-input");
  const dropZone = document.getElementById("drop-zone");
  const selectedFile = document.getElementById("selected-file");
  const fileName = document.getElementById("file-name");
  const fileSize = document.getElementById("file-size");
  const removeFileButton = document.getElementById("remove-file");
  const validationMessage = document.getElementById("validation-message");
  const validationText = document.getElementById("validation-text");
  const processButton = document.getElementById("process-button");

  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  const MAX_JSON_FILES = 1000;

  let currentFile = null;
  let validatedRecords = [];
  let validationRun = 0;
  let isValidated = false;

  // --------------------------------------------------
  // Display helpers
  // --------------------------------------------------

  function formatFileSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function showMessage(message, type = "error") {
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
    validationMessage.hidden = true;
    validationText.textContent = "";
    validationMessage.style.background = "";
    validationMessage.style.borderColor = "";
    validationMessage.style.color = "";
  }

  function setButtonState(enabled) {
    processButton.disabled = !enabled;
  }

  // --------------------------------------------------
  // File display and reset
  // --------------------------------------------------

  function displaySelectedFile(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    selectedFile.hidden = false;
  }

  function resetUpload() {
    validationRun++;

    currentFile = null;
    validatedRecords = [];
    isValidated = false;

    fileInput.value = "";
    selectedFile.hidden = true;

    fileName.textContent = "";
    fileSize.textContent = "";

    hideMessage();
    setButtonState(false);

    processButton.innerHTML =
      'Process listening history <span>→</span>';
  }

  // --------------------------------------------------
  // File selection
  // --------------------------------------------------

  function handleFileSelection(file) {
    if (!file) {
      return;
    }

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

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    handleFileSelection(file);
  });

  removeFileButton.addEventListener("click", () => {
    resetUpload();
  });

  // --------------------------------------------------
  // Drag and drop
  // --------------------------------------------------

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

    if (file) {
      handleFileSelection(file);
    }
  });

  // --------------------------------------------------
  // Spotify record recognition
  // --------------------------------------------------

  function getSpotifyRecordFields(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return null;
    }

    // Older Spotify Extended Streaming History format.
    const oldTrackName = record.trackName;
    const oldArtistName = record.artistName;
    const oldTimestamp = record.endTime;
    const oldDuration = record.msPlayed;

    // Newer Spotify streaming history format.
    const newTrackName = record.master_metadata_track_name;
    const newArtistName = record.master_metadata_album_artist_name;
    const newTimestamp = record.ts;
    const newDuration = record.ms_played;

    const trackName = oldTrackName || newTrackName;
    const artistName = oldArtistName || newArtistName;
    const timestamp = oldTimestamp || newTimestamp;

    const duration =
      typeof oldDuration === "number"
        ? oldDuration
        : newDuration;

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

    return {
      trackName: trackName.trim(),
      artistName: artistName.trim(),
      timestamp,
      duration,
      albumName:
        record.albumName ||
        record.master_metadata_album_album_name ||
        null,
      spotifyTrackUri:
        record.spotify_track_uri ||
        null
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

      // Check the ZIP file signature before attempting extraction.
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

      if (thisRun !== validationRun) {
        return;
      }

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
        if (thisRun !== validationRun) {
          return;
        }

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

      if (thisRun !== validationRun) {
        return;
      }

      if (readableFiles === 0 || allRecords.length === 0) {
        throw new Error(
          "The ZIP file was readable, but we couldn't find any recognizable song listening records. Please make sure you selected your Spotify Extended Streaming History export."
        );
      }

      // Validation succeeded. Keep records in memory only.
      validatedRecords = allRecords;
      isValidated = true;

      showMessage(
        `Your Spotify history was successfully recognized! Found ${allRecords.length.toLocaleString()} valid listening records across ${readableFiles} file(s).`,
        "success"
      );

      setButtonState(true);

    } catch (error) {
      if (thisRun !== validationRun) {
        return;
      }

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
  // Processing button
  // --------------------------------------------------

  processButton.addEventListener("click", () => {
    if (!currentFile || !isValidated || validatedRecords.length === 0) {
      return;
    }
    showMessage(
      `Your file passed validation. ${validatedRecords.length.toLocaleString()} listening records are ready for statistics processing. The statistics dashboard is the next step.`,
      "success"
    );

    processButton.disabled = true;
    processButton.textContent = "File validated successfully";
  });

  // --------------------------------------------------
  // Clear imported data when leaving the page
  // --------------------------------------------------

  window.addEventListener("pagehide", () => {
    currentFile = null;
    validatedRecords = [];
    isValidated = false;
  });

})();
