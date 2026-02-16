// @ts-check
/// <reference path="../types.ts" />

const statusEl = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const detailEl = document.getElementById('detail');
const firstRunNote = document.getElementById('firstRunNote');
const loadingContainer = document.getElementById('loading');
const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const quitBtn = document.getElementById('quitBtn');
const logo = document.getElementById('logo');

// Directory chooser elements
const directoryContainer = document.getElementById('directoryContainer');
const directoryList = document.getElementById('directoryList');
const addDirBtn = document.getElementById('addDirBtn');
const startBtn = document.getElementById('startBtn');
const chooserQuitBtn = document.getElementById('chooserQuitBtn');
const autoStartCheckbox = document.getElementById('autoStartCheckbox');
const changeDirLink = document.getElementById('changeDirLink');

/** Currently selected directory in the chooser */
let selectedDir = '';

/** Current sizes data (may arrive after initial directory list) */
let currentSizes = {};

/** Phase descriptions shown to the user */
const phaseMessages = {
  'choose-directory': 'Choose data directory',
  'initializing': 'Initializing...',
  'downloading': 'Downloading system image...',
  'creating-vm': 'Creating virtual machine...',
  'updating-vm': 'Updating Quilltap to latest build...',
  'starting-vm': 'Starting virtual machine...',
  'waiting-health': 'Waiting for server...',
  'ready': 'Ready!',
  'error': 'Something went wrong',
};

/**
 * Format a byte count into a human-readable string.
 * Duplicated from disk-utils since splash.js has no Node access.
 */
function formatBytes(bytes) {
  if (bytes < 0) return '';
  if (bytes === 0) return '0 B';

  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var k = 1024;
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  var value = bytes / Math.pow(k, i);

  return value.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Build a size summary string for a directory.
 * Returns empty string if no size data available.
 */
function formatSizeInfo(sizeInfo) {
  if (!sizeInfo) return '';

  var parts = [];
  if (sizeInfo.dataSize >= 0) {
    parts.push('Data: ' + formatBytes(sizeInfo.dataSize));
  }
  if (sizeInfo.vmSize >= 0) {
    parts.push('VM: ' + formatBytes(sizeInfo.vmSize));
  } else {
    parts.push('No VM');
  }

  return parts.join(' \u2022 '); // bullet separator
}

/** Show one UI section and hide the others */
function showSection(section) {
  loadingContainer.classList.add('hidden');
  errorContainer.classList.remove('visible');
  directoryContainer.classList.remove('visible');

  if (section === 'loading') {
    loadingContainer.classList.remove('hidden');
  } else if (section === 'error') {
    errorContainer.classList.add('visible');
  } else if (section === 'directory') {
    directoryContainer.classList.add('visible');
  }
}

/** Render the directory list from the given info */
function renderDirectoryList(dirs, lastUsed, sizes) {
  directoryList.innerHTML = '';
  selectedDir = lastUsed || (dirs.length > 0 ? dirs[0] : '');

  dirs.forEach(function(dir) {
    var item = document.createElement('div');
    item.className = 'directory-item' + (dir === selectedDir ? ' selected' : '');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dataDir';
    radio.checked = dir === selectedDir;

    var infoWrap = document.createElement('div');
    infoWrap.className = 'directory-item-info';

    var pathLabel = document.createElement('span');
    pathLabel.className = 'directory-item-path';
    pathLabel.textContent = dir;
    pathLabel.title = dir;
    infoWrap.appendChild(pathLabel);

    // Add size info if available
    var sizeText = formatSizeInfo(sizes && sizes[dir]);
    if (sizeText) {
      var sizeLabel = document.createElement('span');
      sizeLabel.className = 'directory-item-sizes';
      sizeLabel.textContent = sizeText;
      infoWrap.appendChild(sizeLabel);
    }

    item.appendChild(radio);
    item.appendChild(infoWrap);

    // Only show remove button if there's more than one directory
    if (dirs.length > 1) {
      var removeBtn = document.createElement('button');
      removeBtn.className = 'directory-item-remove';
      removeBtn.textContent = '\u00d7'; // multiplication sign (x)
      removeBtn.title = 'Remove from list';
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.quilltap.removeDirectory(dir);
      });
      item.appendChild(removeBtn);
    }

    // Click to select
    item.addEventListener('click', function() {
      selectedDir = dir;
      // Update visual selection
      directoryList.querySelectorAll('.directory-item').forEach(function(el) {
        el.classList.remove('selected');
        el.querySelector('input[type="radio"]').checked = false;
      });
      item.classList.add('selected');
      radio.checked = true;
    });

    directoryList.appendChild(item);
  });
}

/** Handle splash update from main process */
window.quilltap.onUpdate(function(data) {
  if (data.phase === 'choose-directory') {
    // Show directory chooser
    showSection('directory');
    logo.classList.remove('pulse');
    changeDirLink.classList.remove('visible');
    return;
  }

  // Show loading, hide error and directory chooser
  showSection('loading');
  logo.classList.add('pulse');

  // Update status message
  statusEl.textContent = data.message || phaseMessages[data.phase] || data.phase;

  // Show the "change directory" button during startup phases (hide once ready)
  if (data.phase !== 'ready') {
    changeDirLink.classList.add('visible');
  } else {
    changeDirLink.classList.remove('visible');
  }

  // Show progress bar for download phase
  if (data.phase === 'downloading' && typeof data.progress === 'number') {
    progressContainer.classList.add('visible');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = data.progress + '%';
    firstRunNote.classList.add('visible');
  } else if (data.phase === 'creating-vm' || data.phase === 'updating-vm' || data.phase === 'starting-vm') {
    progressContainer.classList.add('visible');
    progressBar.classList.add('indeterminate');
    progressBar.style.width = '';
    firstRunNote.classList.add('visible');
  } else if (data.phase === 'waiting-health') {
    progressContainer.classList.add('visible');
    progressBar.classList.add('indeterminate');
    progressBar.style.width = '';
  } else {
    progressContainer.classList.remove('visible');
  }

  // Update detail text with color coding based on log level
  detailEl.textContent = data.detail || '';
  detailEl.className = 'detail-text';
  if (data.detail && data.detailLevel) {
    detailEl.classList.add('detail-' + data.detailLevel);
  }
});

/** Handle error from main process */
window.quilltap.onError(function(data) {
  showSection('error');
  logo.classList.remove('pulse');
  changeDirLink.classList.remove('visible');

  errorMessage.textContent = data.message || 'An unexpected error occurred';

  if (!data.canRetry) {
    retryBtn.style.display = 'none';
  } else {
    retryBtn.style.display = '';
  }
});

/** Handle directory info updates from main process */
window.quilltap.onDirectories(function(data) {
  currentSizes = data.sizes || {};
  renderDirectoryList(data.dirs, data.lastUsed, currentSizes);
  autoStartCheckbox.checked = data.autoStart;
});

/** Retry button */
retryBtn.addEventListener('click', function() {
  window.quilltap.retry();
});

/** Quit button (error state) */
quitBtn.addEventListener('click', function() {
  window.quilltap.quit();
});

/** Quit button (directory chooser) */
chooserQuitBtn.addEventListener('click', function() {
  window.quilltap.quit();
});

/** Add directory button */
addDirBtn.addEventListener('click', async function() {
  var path = await window.quilltap.selectDirectory();
  if (path) {
    selectedDir = path;
    // The main process sends updated directory info via onDirectories
  }
});

/** Start button */
startBtn.addEventListener('click', function() {
  if (selectedDir) {
    window.quilltap.startWithDirectory(selectedDir);
  }
});

/** Auto-start checkbox */
autoStartCheckbox.addEventListener('change', function() {
  window.quilltap.setAutoStart(autoStartCheckbox.checked);
});

/** Change directory button during loading */
changeDirLink.addEventListener('click', function() {
  window.quilltap.showDirectoryChooser();
});
