import axios from 'axios';
import { createLock } from './lock.js';
import { scheduleRefresh } from './proactive.js';
import { applyInterceptor } from './interceptor.js';

export const createRefreshManager = (config) => {
    // Validate required config
    const required = [
        'refreshEndpoint',
        'getAccessToken',
        'getRefreshToken',
        'setTokens',
        'onRefreshFailed',
        'axiosInstance',
    ];

    required.forEach((key) => {
        if (!config[key]) throw new Error(`axios-refresh-sync: missing required config "${key}"`);
    });

    // Create isolated lock instance for this manager
    const tokenStorageKey = config.tokenStorageKey || 'access_token';
    const lock = createLock(tokenStorageKey);
    config._lock = lock;

    // Create a bare axios instance for refresh calls — no interceptors attached.
    // This prevents the 401 interceptor from firing on the refresh request itself,
    // which would cause infinite recursion if the refresh token is also expired.
    const refreshClientConfig = {
        baseURL: config.axiosInstance.defaults.baseURL,
        headers: { ...config.axiosInstance.defaults.headers.common },
    };
    // Carry over the adapter so custom/mock adapters work for refresh calls too
    if (config.axiosInstance.defaults.adapter) {
        refreshClientConfig.adapter = config.axiosInstance.defaults.adapter;
    }
    const _refreshClient = axios.create(refreshClientConfig);
    config._refreshClient = _refreshClient;

    // Attach response interceptor to user's axios instance
    const responseInterceptorId = applyInterceptor(config.axiosInstance, config);

    return {
        // Call this after login or app init to start the proactive timer
        scheduleRefresh: () => scheduleRefresh(config),

        // Call this on logout or when tearing down — clears timer,
        // removes interceptor, removes storage listener, rejects queued requests
        destroy: () => {
            lock.cleanup();
            if (responseInterceptorId !== undefined) {
                config.axiosInstance.interceptors.response.eject(responseInterceptorId);
            }
        },
    };
};