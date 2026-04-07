// Proactive refresh — fires a timer 1 minute before token expiry.
// Calls through the shared lock so it can't race with the interceptor.

import { acquireLock, setLock, enqueue, flushQueue } from './lock.js';

const decodeExp = (accessToken) => {
    try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        return payload.exp ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
};

let _timer = null;

export const scheduleRefresh = (config) => {
    const {
        getAccessToken,
        getRefreshToken,
        setTokens,
        onRefreshFailed,
        minutesBefore = 1,
        refreshEndpoint,
        axiosInstance,
    } = config;

    if (_timer) clearTimeout(_timer);

    const accessToken = getAccessToken();
    if (!accessToken) return;

    const expiresAt = decodeExp(accessToken);
    if (!expiresAt) return;

    const refreshIn = expiresAt - Date.now() - minutesBefore * 60 * 1000;

    if (refreshIn <= 0) {
        // Already expired or expiring too soon — refresh immediately
        runRefresh(config);
        return;
    }

    _timer = setTimeout(() => runRefresh(config), refreshIn);
};

export const runRefresh = async (config) => {
    const {
        getRefreshToken,
        setTokens,
        onRefreshFailed,
        refreshEndpoint,
        axiosInstance,
        getAccessToken,
        minutesBefore,
    } = config;

    // If interceptor already grabbed the lock, just wait for its result
    if (acquireLock()) {
        try {
            const token = await enqueue();
            scheduleRefresh(config); // schedule next timer with new token
        } catch {
            // interceptor already handled failure + redirect
        }
        return;
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
        onRefreshFailed();
        return;
    }

    setLock(true);

    try {
        const { data } = await axiosInstance.post(refreshEndpoint, {
            refresh_token: refreshToken,
        });

        setTokens(data.access_token, data.refresh_token);
        flushQueue(null, data.access_token);
        scheduleRefresh(config); // schedule next timer
    } catch (err) {
        flushQueue(err, null);
        onRefreshFailed();
    } finally {
        setLock(false);
    }
};