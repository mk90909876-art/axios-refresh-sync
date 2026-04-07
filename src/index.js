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

    // Attach interceptor to user's axios instance immediately
    applyInterceptor(config.axiosInstance, config);

    return {
        // Call this after login or app init to start the proactive timer
        scheduleRefresh: () => scheduleRefresh(config),
    };
};