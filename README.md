# axios-refresh-sync

Coordinates proactive (timer-based) and reactive (interceptor-based) JWT refresh under a single lock for Axios.

## The Problem

Most auth implementations use two refresh strategies:
- **Proactive** — a timer fires 1 minute before token expiry
- **Reactive** — an Axios interceptor catches 401 errors

The problem: if both fire at the same time, they send the same refresh token to your backend simultaneously. Since refresh tokens rotate, the first one succeeds and invalidates the token — the second one fails, logs the user out.

Existing libraries like `axios-auth-refresh` only solve concurrent 401s. They don't coordinate with proactive timers. This library solves both.

## Install
```bash
npm install axios-refresh-sync
```

## Usage
```javascript
import axios from 'axios'
import { createRefreshManager } from 'axios-refresh-sync'

const api = axios.create({ baseURL: 'https://your-api.com' })

const manager = createRefreshManager({
  axiosInstance: api,
  refreshEndpoint: '/api/auth/refresh',

  getAccessToken: () => localStorage.getItem('access_token'),
  getRefreshToken: () => localStorage.getItem('refresh_token'),
  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem('access_token', accessToken)
    localStorage.setItem('refresh_token', refreshToken)
  },

  onRefreshFailed: () => {
    window.location.href = '/login'
  },

  minutesBefore: 1, // optional, default: 1
})

// After login or app init
manager.scheduleRefresh()
```

## Config

| Option | Required | Description |
|---|---|---|
| `axiosInstance` | ✓ | Your axios instance |
| `refreshEndpoint` | ✓ | Backend endpoint to refresh tokens |
| `getAccessToken` | ✓ | Function that returns current access token |
| `getRefreshToken` | ✓ | Function that returns current refresh token |
| `setTokens` | ✓ | Function that saves new tokens |
| `onRefreshFailed` | ✓ | Called when refresh fails (e.g. redirect to login) |
| `minutesBefore` | ✗ | Minutes before expiry to proactively refresh (default: 1) |

## How it works

Both the proactive timer and the reactive interceptor call through a single shared lock. If one is already refreshing, the other joins a queue and waits for the result — no second request is sent to your backend.

## License

MIT