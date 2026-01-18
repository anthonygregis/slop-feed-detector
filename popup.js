// Popup script for AI Slop Feed Detector settings

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Load current settings
  await loadSettings();

  // Load stats
  await loadStats();

  // Set up event listeners
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('enabled').addEventListener('change', toggleEnabled);
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });

    document.getElementById('apiKey').value = response.apiKey || '';
    document.getElementById('enabled').checked = response.enabled !== false;
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'getStats' });

    document.getElementById('totalAnalyzed').textContent = stats.totalAnalyzed || 0;
    document.getElementById('lowCount').textContent = stats.low || 0;
    document.getElementById('mediumCount').textContent = stats.medium || 0;
    document.getElementById('highCount').textContent = stats.high || 0;
    document.getElementById('certainCount').textContent = stats.certain || 0;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function saveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const enabled = document.getElementById('enabled').checked;

  const statusEl = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');

  // Validate API key format
  if (apiKey && !apiKey.startsWith('sk-')) {
    showStatus('error', 'Invalid API key format. Should start with "sk-"');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: { apiKey, enabled }
    });

    showStatus('success', 'Settings saved successfully!');
  } catch (error) {
    showStatus('error', 'Failed to save settings');
    console.error('Error saving settings:', error);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
}

async function toggleEnabled() {
  const enabled = document.getElementById('enabled').checked;

  try {
    await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: { enabled }
    });
  } catch (error) {
    console.error('Error toggling enabled state:', error);
  }
}

function showStatus(type, message) {
  const statusEl = document.getElementById('status');
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusEl.className = 'status';
    statusEl.textContent = '';
  }, 3000);
}
