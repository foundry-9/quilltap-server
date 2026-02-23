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

// Runtime mode elements
const runtimeDockerBtn = document.getElementById('runtimeDocker');
const runtimeVMBtn = document.getElementById('runtimeVM');
const vmLabelEl = document.getElementById('vmLabel');

// Rename elements
const renameOverlay = document.getElementById('renameOverlay');
const renameInput = document.getElementById('renameInput');
const renameDialogPath = document.getElementById('renameDialogPath');
const renameSaveBtn = document.getElementById('renameSaveBtn');
const renameCancelBtn = document.getElementById('renameCancelBtn');

// Delete confirmation elements
const deleteOverlay = document.getElementById('deleteOverlay');
const deleteDialogPath = document.getElementById('deleteDialogPath');
const deleteConfigOnlyBtn = document.getElementById('deleteConfigOnlyBtn');
const deleteConfigAndDataBtn = document.getElementById('deleteConfigAndDataBtn');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');

/** Currently selected directory in the chooser */
var selectedDir = '';

/** Current sizes data (may arrive after initial directory list) */
var currentSizes = {};

/** Current runtime mode */
var currentRuntimeMode = 'vm';

/** Directory pending deletion (for the confirmation dialog) */
var pendingDeleteDir = '';

/** Directory pending rename (path of the directory being renamed) */
var pendingRenameDir = '';

/** Phase descriptions shown to the user */
var phaseMessages = {
  'choose-directory': 'Choose data directory',
  'initializing': 'Initializing...',
  'downloading': 'Downloading system image...',
  'creating-vm': 'Creating virtual machine...',
  'updating-vm': 'Updating Quilltap to latest build...',
  'starting-vm': 'Starting virtual machine...',
  'pulling-image': 'Pulling Docker image...',
  'starting-container': 'Starting Docker container...',
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

/** Update the runtime mode button visual state */
function updateRuntimeButtons() {
  if (currentRuntimeMode === 'docker') {
    runtimeDockerBtn.classList.add('selected');
    runtimeVMBtn.classList.remove('selected');
  } else {
    runtimeDockerBtn.classList.remove('selected');
    runtimeVMBtn.classList.add('selected');
  }
}

/** Show the delete confirmation dialog */
function showDeleteConfirmation(dir) {
  pendingDeleteDir = dir;
  deleteDialogPath.textContent = dir;
  deleteOverlay.classList.add('visible');
}

/** Hide the delete confirmation dialog */
function hideDeleteConfirmation() {
  pendingDeleteDir = '';
  deleteOverlay.classList.remove('visible');
}

/** Show the rename dialog for a directory */
function showRenameDialog(dir) {
  pendingRenameDir = dir.path;
  renameInput.value = dir.name;
  renameDialogPath.textContent = dir.path;
  renameOverlay.classList.add('visible');
  renameInput.focus();
  renameInput.select();
}

/** Hide the rename dialog */
function hideRenameDialog() {
  pendingRenameDir = '';
  renameOverlay.classList.remove('visible');
}

/** Render the directory list from the given info */
function renderDirectoryList(dirs, lastUsed, sizes) {
  directoryList.innerHTML = '';
  selectedDir = lastUsed || (dirs.length > 0 ? dirs[0].path : '');

  dirs.forEach(function(dir) {
    var dirPath = dir.path;
    var dirName = dir.name;

    var item = document.createElement('div');
    item.className = 'directory-item' + (dirPath === selectedDir ? ' selected' : '');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dataDir';
    radio.checked = dirPath === selectedDir;

    var infoWrap = document.createElement('div');
    infoWrap.className = 'directory-item-info';

    var nameLabel = document.createElement('span');
    nameLabel.className = 'directory-item-name';
    nameLabel.textContent = dirName;
    nameLabel.title = dirName;
    infoWrap.appendChild(nameLabel);

    var pathLabel = document.createElement('span');
    pathLabel.className = 'directory-item-path';
    pathLabel.textContent = dirPath;
    pathLabel.title = dirPath;
    infoWrap.appendChild(pathLabel);

    // Add size info if available
    var sizeText = formatSizeInfo(sizes && sizes[dirPath]);
    if (sizeText) {
      var sizeLabel = document.createElement('span');
      sizeLabel.className = 'directory-item-sizes';
      sizeLabel.textContent = sizeText;
      infoWrap.appendChild(sizeLabel);
    }

    item.appendChild(radio);
    item.appendChild(infoWrap);

    // Edit (rename) button
    var editBtn = document.createElement('button');
    editBtn.className = 'directory-item-edit';
    editBtn.textContent = '\u270E'; // pencil icon
    editBtn.title = 'Rename...';
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      showRenameDialog(dir);
    });
    item.appendChild(editBtn);

    // Delete button
    var removeBtn = document.createElement('button');
    removeBtn.className = 'directory-item-remove';
    removeBtn.textContent = '\u00d7'; // multiplication sign (x)
    removeBtn.title = 'Delete...';
    removeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      showDeleteConfirmation(dirPath);
    });
    item.appendChild(removeBtn);

    // Click to select
    item.addEventListener('click', function() {
      selectedDir = dirPath;
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

  // Show progress bar for download and Docker phases
  if (data.phase === 'downloading' && typeof data.progress === 'number') {
    progressContainer.classList.add('visible');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = data.progress + '%';
    firstRunNote.classList.add('visible');
  } else if (
    data.phase === 'creating-vm' || data.phase === 'updating-vm' || data.phase === 'starting-vm' ||
    data.phase === 'pulling-image' || data.phase === 'starting-container'
  ) {
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

  // Update runtime mode state
  currentRuntimeMode = data.runtimeMode || 'vm';
  updateRuntimeButtons();

  // Update Docker button availability
  if (data.dockerAvailable) {
    runtimeDockerBtn.disabled = false;
  } else {
    runtimeDockerBtn.disabled = true;
    // Force VM mode if Docker is not available
    if (currentRuntimeMode === 'docker') {
      currentRuntimeMode = 'vm';
      updateRuntimeButtons();
      window.quilltap.setRuntimeMode('vm');
    }
  }

  // Update VM label
  if (data.vmLabel) {
    vmLabelEl.textContent = data.vmLabel;
  }
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

/** Runtime mode: Docker button */
runtimeDockerBtn.addEventListener('click', function() {
  if (runtimeDockerBtn.disabled) return;
  currentRuntimeMode = 'docker';
  updateRuntimeButtons();
  window.quilltap.setRuntimeMode('docker');
});

/** Runtime mode: VM button */
runtimeVMBtn.addEventListener('click', function() {
  currentRuntimeMode = 'vm';
  updateRuntimeButtons();
  window.quilltap.setRuntimeMode('vm');
});

/** Delete confirmation: config only */
deleteConfigOnlyBtn.addEventListener('click', async function() {
  if (pendingDeleteDir) {
    await window.quilltap.deleteDirectory(pendingDeleteDir, 'config-only');
    hideDeleteConfirmation();
  }
});

/** Delete confirmation: config and data */
deleteConfigAndDataBtn.addEventListener('click', async function() {
  if (pendingDeleteDir) {
    await window.quilltap.deleteDirectory(pendingDeleteDir, 'config-and-data');
    hideDeleteConfirmation();
  }
});

/** Delete confirmation: cancel */
deleteCancelBtn.addEventListener('click', function() {
  hideDeleteConfirmation();
});

/** Rename: save */
renameSaveBtn.addEventListener('click', async function() {
  if (pendingRenameDir && renameInput.value.trim()) {
    await window.quilltap.renameDirectory(pendingRenameDir, renameInput.value.trim());
    hideRenameDialog();
  }
});

/** Rename: cancel */
renameCancelBtn.addEventListener('click', function() {
  hideRenameDialog();
});

/** Rename: Enter key saves, Escape cancels */
renameInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    renameSaveBtn.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideRenameDialog();
  }
});
