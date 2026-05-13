import { RELAY_DEFAULT_URL } from '../../shared/protocol';

const relayUrlInput = document.getElementById('relayUrl') as HTMLInputElement;
const patternsInput = document.getElementById('patterns') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const dot = document.getElementById('dot') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

async function load() {
  const cfg = await chrome.storage.sync.get(['relayUrl', 'patterns']);
  relayUrlInput.value = (cfg.relayUrl as string) || RELAY_DEFAULT_URL;
  patternsInput.value = Array.isArray(cfg.patterns) ? (cfg.patterns as string[]).join('\n') : '';
}

async function save() {
  const relayUrl = relayUrlInput.value.trim() || RELAY_DEFAULT_URL;
  const patterns = patternsInput.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  await chrome.storage.sync.set({ relayUrl, patterns });
  saveBtn.disabled = true;
  saveBtn.textContent = 'Reloading…';
  try {
    await chrome.runtime.sendMessage({ type: 'reload-registration' });
    saveBtn.textContent = 'Saved ✓';
  } catch (e) {
    saveBtn.textContent = 'Error';
  }
  setTimeout(() => {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Reload';
  }, 1200);
  refreshStatus();
}

async function refreshStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('closed', 'no active tab');
      return;
    }
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'get-producer-status' }).catch(() => null);
    if (!resp) {
      setStatus('closed', 'content script not loaded on this tab');
      return;
    }
    setStatus(resp.status, resp.status === 'open' ? 'connected to relay' : 'relay unreachable');
  } catch {
    setStatus('closed', 'unknown');
  }
}

function setStatus(s: 'open' | 'closed', label: string) {
  dot.classList.remove('open', 'closed');
  dot.classList.add(s);
  statusEl.textContent = label;
}

saveBtn.addEventListener('click', save);
load().then(refreshStatus);
