// "local" = stage 1 (everything in this browser's localStorage, no accounts)
// "api"   = stage 2 (Cloudflare Worker + D1, accounts, teacher dashboard)
window.APP_CONFIG = {
  MODE: 'local',
  API_BASE: '/api'
};
