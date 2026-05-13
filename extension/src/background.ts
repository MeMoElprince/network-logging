import { RELAY_DEFAULT_URL } from '../../shared/protocol';

const SCRIPT_IDS = { inject: 'nl-inject', content: 'nl-content' };

type Config = {
  relayUrl: string;
  patterns: string[];
};

async function getConfig(): Promise<Config> {
  const stored = await chrome.storage.sync.get(['relayUrl', 'patterns']);
  return {
    relayUrl: typeof stored.relayUrl === 'string' && stored.relayUrl ? stored.relayUrl : RELAY_DEFAULT_URL,
    patterns: Array.isArray(stored.patterns) ? (stored.patterns as string[]) : [],
  };
}

async function unregisterAll() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_IDS.inject, SCRIPT_IDS.content] });
  } catch {
    // not registered yet — ignore
  }
}

async function applyRegistration() {
  const { patterns } = await getConfig();
  await unregisterAll();
  const matches = patterns.filter((p) => typeof p === 'string' && p.includes('://'));
  if (matches.length === 0) {
    console.log('[nl-bg] no URL patterns configured; nothing registered');
    return;
  }
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_IDS.inject,
      js: ['inject.js'],
      matches,
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true,
    },
    {
      id: SCRIPT_IDS.content,
      js: ['content.js'],
      matches,
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
  console.log('[nl-bg] registered for', matches);
}

chrome.runtime.onInstalled.addListener(() => {
  applyRegistration().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  applyRegistration().catch(console.error);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'reload-registration') {
    applyRegistration()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
