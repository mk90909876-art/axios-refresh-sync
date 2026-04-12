# axios-refresh-sync

Coordinates proactive (timer-based) and reactive (interceptor-based) JWT refresh under a single lock for Axios.

## The Problem

Most auth implementations use two refresh strategies:
- **Proactive** — a timer fires before token expiry
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

// Add your own request interceptor for attaching tokens
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

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

  // optional
  minutesBefore: 1,
  tokenStorageKey: 'access_token',
})

// After login or app init
manager.scheduleRefresh()
```

## Cleanup

Call `destroy()` on logout or when tearing down the manager. This clears the proactive timer, removes the 401 interceptor, detaches the multi-tab storage listener, and rejects any queued requests.

```javascript
// On logout
manager.destroy()
```

## Config

| Option | Required | Description |
|---|---|---|
| `axiosInstance` | ✓ | Your axios instance |
| `refreshEndpoint` | ✓ | Backend endpoint to refresh tokens |
| `getAccessToken` | ✓ | Function that returns current access token |
| `getRefreshToken` | ✓ | Function that returns current refresh token |
| `setTokens` | ✓ | `(accessToken, refreshToken) => void` — saves new tokens |
| `onRefreshFailed` | ✓ | Called when refresh fails (e.g. redirect to login) |
| `minutesBefore` | ✗ | Minutes before expiry to proactively refresh (default: `1`) |
| `tokenStorageKey` | ✗ | localStorage key for multi-tab sync (default: `"access_token"`) |
| `parseTokens` | ✗ | `(responseData) => { accessToken, refreshToken }` — custom response parser |

### Custom response format

If your backend returns tokens in a different shape, use `parseTokens`:

```javascript
const manager = createRefreshManager({
  // ...required options
  parseTokens: (data) => ({
    accessToken: data.tokens.access,
    refreshToken: data.tokens.refresh,
  }),
})
```

Default assumes `{ access_token, refresh_token }` in the response body.

## Multi-tab sync

If a token is refreshed in one tab, other tabs detect the update via the
`localStorage` storage event and flush their queues automatically — 
no duplicate refresh requests across tabs.

The storage listener watches for changes to the key specified by `tokenStorageKey` (defaults to `"access_token"`).

## How it works

Both the proactive timer and the reactive interceptor call through a single shared lock. If one is already refreshing, the other joins a queue and waits for the result — no second request is sent to your backend.

Each call to `createRefreshManager()` creates an isolated lock instance, so multiple managers (e.g. for different APIs) don't interfere with each other.

The refresh HTTP call itself is made on a separate bare Axios instance with no interceptors attached, preventing infinite recursion if the refresh endpoint returns a 401.

## License

MIT