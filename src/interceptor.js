// Reactive refresh — catches 401s from failed API calls.
// Calls through the shared lock so it can't race with the proactive timer.

import { acquireLock, setLock, enqueue, flushQueue } from './lock.js';

export const applyInterceptor = (axiosInstance, config) => {
    const {
        getRefreshToken,
        setTokens,
        onRefreshFailed,
        refreshEndpoint,
    } = config;

    axiosInstance.interceptors.response.use(
        (res) => res,
        async (err) => {
            const originalRequest = err.config;

            if (err.response?.status !== 401 || originalRequest._retry) {
                return Promise.reject(err);
            }

            const refreshToken = getRefreshToken();
            if (!refreshToken) {
                onRefreshFailed();
                return Promise.reject(err);
            }

            // Proactive timer already grabbed the lock — join the queue
            if (acquireLock()) {
                try {
                    const token = await enqueue();
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    return axiosInstance(originalRequest);
                } catch (e) {
                    return Promise.reject(e);
                }
            }

            originalRequest._retry = true;
            setLock(true);

            try {
                const { data } = await axiosInstance.post(refreshEndpoint, {
                    refresh_token: refreshToken,
                });

                setTokens(data.access_token, data.refresh_token);
                flushQueue(null, data.access_token);

                originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
                return axiosInstance(originalRequest);
            } catch (refreshErr) {
                flushQueue(refreshErr, null);
                onRefreshFailed();
                return Promise.reject(refreshErr);
            } finally {
                setLock(false);
            }
        }
    );
};