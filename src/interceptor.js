// Reactive refresh — catches 401s from failed API calls.
// Calls through the shared lock so it can't race with the proactive timer.
// Uses _refreshClient (bare axios instance) to avoid interceptor recursion.

export const applyInterceptor = (axiosInstance, config) => {
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

    const responseInterceptorId = axiosInstance.interceptors.response.use(
        (res) => res,
        async (err) => {
            const originalRequest = err.config;

            if (err.response?.status !== 401 || originalRequest._retry) {
                return Promise.reject(err);
            }

            const refreshToken = getRefreshToken();
            if (!refreshToken) {
                // No refresh token stored — session is definitively gone
                onRefreshFailed();
                return Promise.reject(err);
            }

            // Proactive timer already grabbed the lock — join the queue
            if (_lock.acquireLock()) {
                originalRequest._retry = true;
                try {
                    const token = await _lock.enqueue();
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    return axiosInstance(originalRequest);
                } catch (e) {
                    return Promise.reject(e);
                }
            }

            originalRequest._retry = true;
            _lock.setLock(true);

            try {
                // Use _refreshClient — a bare axios instance with no interceptors
                // to prevent recursive 401 handling on the refresh call itself
                const { data } = await _refreshClient.post(refreshEndpoint, {
                    refresh_token: refreshToken,
                });

                const tokens = parseTokens(data);
                setTokens(tokens.accessToken, tokens.refreshToken);
                _lock.flushQueue(null, tokens.accessToken);

                originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
                return axiosInstance(originalRequest);
            } catch (refreshErr) {
                _lock.flushQueue(refreshErr, null);
                // Only destroy the session if the server definitively rejected our refresh token.
                // Network errors (no response) should NOT log the user out — they may be offline.
                const isAuthError = refreshErr.response && refreshErr.response.status < 500;
                if (isAuthError) {
                    onRefreshFailed();
                }
                return Promise.reject(refreshErr);
            } finally {
                _lock.setLock(false);
            }
        }
    );

    return responseInterceptorId;
};