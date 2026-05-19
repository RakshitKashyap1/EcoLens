// CO₂ values in grams (sourced from IEA + Shift Project)
const CO2 = {
  google: 0.3,
  chatgpt: 3.0,
  netflix: 36
};

function getSite() {
  const url = window.location.href;
  if (url.includes('google.com/search')) return 'google';
  if (url.includes('chat.openai.com')) return 'chatgpt';
  if (url.includes('netflix.com')) return 'netflix';
  return null;
}

function showBadge(site) {
  const existing = document.getElementById('ecolens-badge');
  if (existing) existing.remove();

  const grams = CO2[site];
  const badge = document.createElement('div');
  badge.id = 'ecolens-badge';
  badge.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: #0a0e0b; color: #5dbf72;
    border: 1px solid #2a4a2c; border-radius: 12px;
    padding: 10px 16px; font-family: monospace;
    font-size: 13px; z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    cursor: pointer; transition: opacity 0.3s;
  `;
  badge.innerHTML = `
    

      🌿 EcoLens
    

    ${grams}g CO₂
    
this ${site} session

  `;

  badge.onclick = () => badge.style.opacity = '0';
  document.body.appendChild(badge);

  // Save to storage for popup
  chrome.storage.local.get(['total'], (data) => {
    const prev = data.total || 0;
    chrome.storage.local.set({ total: prev + grams, lastSite: site });
  });
}

const site = getSite();
if (site) showBadge(site);
3