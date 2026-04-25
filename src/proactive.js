// Proactive refresh — fires a timer before token expiry.
// Calls through the shared lock so it can't race with the interceptor.
// Uses _refreshClient (bare axios instance) to avoid interceptor recursion.

const decodeExp = (accessToken) => {
    try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        return payload.exp ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
};

export const scheduleRefresh = (config) => {
    const {
        getAccessToken,
        minutesBefore = 1,
        _lock,
    } = config;

    _lock.clearTimer();

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

    _lock.setTimer(setTimeout(() => runRefresh(config), refreshIn));
};

export const runRefresh = async (config) => {
    const {
        getRefreshToken,
        setTokens,
        onRefreshFailed,
        refreshEndpoint,
        _refreshClient,
        _lock,
    } = config;

    const parseTokens = config.parseTokens || ((data) => ({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
    }));

    // If interceptor already grabbed the lock, just wait for its result
    if (_lock.acquireLock()) {
        try {
            await _lock.enqueue();
            scheduleRefresh(config); // schedule next timer with new token
        } catch {
            // interceptor already handled failure + redirect
        }
        return;
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
        // No refresh token — cannot refresh, session is definitively gone
        onRefreshFailed();
        return;
    }

    _lock.setLock(true);

    try {
        // Use _refreshClient — a bare axios instance with no interceptors
        const { data } = await _refreshClient.post(refreshEndpoint, {
            refresh_token: refreshToken,
        });

        const tokens = parseTokens(data);
        setTokens(tokens.accessToken, tokens.refreshToken);
        _lock.flushQueue(null, tokens.accessToken);
        scheduleRefresh(config); // schedule next timer
    } catch (err) {
        _lock.flushQueue(err, null);
        // Only destroy the session if the server definitively rejected our refresh token.
        // Network errors (no response) should NOT log the user out — they may be temporarily offline.
        const isAuthError = err.response && err.response.status < 500;
        if (isAuthError) {
            onRefreshFailed();
        }
    } finally {
        _lock.setLock(false);
    }
};