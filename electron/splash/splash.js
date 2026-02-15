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

/** Phase descriptions shown to the user */
const phaseMessages = {
  'initializing': 'Initializing...',
  'downloading': 'Downloading system image...',
  'creating-vm': 'Creating virtual machine...',
  'updating-vm': 'Updating Quilltap to latest build...',
  'starting-vm': 'Starting virtual machine...',
  'waiting-health': 'Waiting for server...',
  'ready': 'Ready!',
  'error': 'Something went wrong',
};

/** Handle splash update from main process */
window.quilltap.onUpdate((data) => {
  // Show loading, hide error
  loadingContainer.classList.remove('hidden');
  errorContainer.classList.remove('visible');
  logo.classList.add('pulse');

  // Update status message
  statusEl.textContent = data.message || phaseMessages[data.phase] || data.phase;

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

  // Update detail text
  detailEl.textContent = data.detail || '';
});

/** Handle error from main process */
window.quilltap.onError((data) => {
  // Show error, hide loading
  loadingContainer.classList.add('hidden');
  errorContainer.classList.add('visible');
  logo.classList.remove('pulse');

  errorMessage.textContent = data.message || 'An unexpected error occurred';

  if (!data.canRetry) {
    retryBtn.style.display = 'none';
  } else {
    retryBtn.style.display = '';
  }
});

/** Retry button */
retryBtn.addEventListener('click', () => {
  window.quilltap.retry();
});

/** Quit button */
quitBtn.addEventListener('click', () => {
  window.quilltap.quit();
});
