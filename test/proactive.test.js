import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { createRefreshManager } from '../src/index.js';

// Helper: creates a minimal JWT with a given exp timestamp
const createJwt = (expMs) => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }));
    return `${header}.${payload}.signature`;
};

const createMockAdapter = () => {
    let handler = null;
    const adapter = (config) => {
        if (handler) return handler(config);
        return Promise.reject(new Error('No mock handler set'));
    };
    adapter.setHandler = (fn) => { handler = fn; };
    return adapter;
};

describe('Proactive refresh', () => {
    let api;
    let mockAdapter;
    let tokens;
    let refreshCallCount;
    let refreshFailedCalled;
    let manager;

    beforeEach(() => {
        mockAdapter = createMockAdapter();
        api = axios.create({
            baseURL: 'http://localhost:9999',
            adapter: mockAdapter,
        });
        refreshCallCount = 0;
        refreshFailedCalled = false;
    });

    afterEach(() => {
        if (manager) manager.destroy();
    });

    it('schedules a refresh and fires it before expiry', async () => {
        // Token expires in 2 seconds, minutesBefore = 0.025 (1.5s)
        // So refresh should fire ~0.5s from now
        tokens = {
            access: createJwt(Date.now() + 2000),
            refresh: 'my_refresh',
        };

        mockAdapter.setHandler((config) => {
            if (config.url === '/api/auth/refresh') {
                refreshCallCount++;
                return Promise.resolve({
                    status: 200,
                    data: {
                        access_token: createJwt(Date.now() + 30 * 60 * 1000),
                        refresh_token: 'refreshed_token',
                    },
                    headers: {},
                    config,
                });
            }
            return Promise.resolve({ status: 200, data: {}, headers: {}, config });
        });

        manager = createRefreshManager({
            axiosInstance: api,
            refreshEndpoint: '/api/auth/refresh',
            getAccessToken: () => tokens.access,
            getRefreshToken: () => tokens.refresh,
            setTokens: (a, r) => { tokens.access = a; tokens.refresh = r; },
            onRefreshFailed: () => { refreshFailedCalled = true; },
            minutesBefore: 0.025, // 1.5 seconds
        });

        manager.scheduleRefresh();

        // Wait 1 second — should have fired by now
        await new Promise(r => setTimeout(r, 1000));
        assert.equal(refreshCallCount, 1);
        assert.equal(tokens.refresh, 'refreshed_token');
        assert.equal(refreshFailedCalled, false);
    });

    it('refreshes immediately if token is already expired', async () => {
        tokens = {
            access: createJwt(Date.now() - 1000), // already expired
            refresh: 'my_refresh',
        };

        mockAdapter.setHandler((config) => {
            if (config.url === '/api/auth/refresh') {
                refreshCallCount++;
                return Promise.resolve({
                    status: 200,
                    data: {
                        access_token: createJwt(Date.now() + 30 * 60 * 1000),
                        refresh_token: 'new_ref',
                    },
                    headers: {},
                    config,
                });
            }
            return Promise.resolve({ status: 200, data: {}, headers: {}, config });
        });

        manager = createRefreshManager({
            axiosInstance: api,
            refreshEndpoint: '/api/auth/refresh',
            getAccessToken: () => tokens.access,
            getRefreshToken: () => tokens.refresh,
            setTokens: (a, r) => { tokens.access = a; tokens.refresh = r; },
            onRefreshFailed: () => { refreshFailedCalled = true; },
        });

        manager.scheduleRefresh();

        // Give it a moment to complete the async refresh
        await new Promise(r => setTimeout(r, 100));
        assert.equal(refreshCallCount, 1);
    });

    it('does not schedule if no access token', () => {
        tokens = { access: null, refresh: 'ref' };

        manager = createRefreshManager({
            axiosInstance: api,
            refreshEndpoint: '/api/auth/refresh',
            getAccessToken: () => tokens.access,
            getRefreshToken: () => tokens.refresh,
            setTokens: () => {},
            onRefreshFailed: () => { refreshFailedCalled = true; },
        });

        // Should not throw, just silently skip
        manager.scheduleRefresh();
        assert.equal(refreshCallCount, 0);
    });

    it('destroy prevents scheduled timer from firing', async () => {
        // Use a token that expires in 10 seconds with minutesBefore=0.1 (6s)
        // This gives refreshIn ~4s, well within timer range and immune to
        // Math.floor rounding in JWT exp (which can lose up to 999ms)
        tokens = {
            access: createJwt(Date.now() + 10000),
            refresh: 'my_refresh',
        };

        mockAdapter.setHandler((config) => {
            if (config.url === '/api/auth/refresh') {
                refreshCallCount++;
                return Promise.resolve({
                    status: 200,
                    data: { access_token: 'new', refresh_token: 'new_r' },
                    headers: {},
                    config,
                });
            }
            return Promise.resolve({ status: 200, data: {}, headers: {}, config });
        });

        manager = createRefreshManager({
            axiosInstance: api,
            refreshEndpoint: '/api/auth/refresh',
            getAccessToken: () => tokens.access,
            getRefreshToken: () => tokens.refresh,
            setTokens: (a, r) => { tokens.access = a; tokens.refresh = r; },
            onRefreshFailed: () => { refreshFailedCalled = true; },
            minutesBefore: 0.1, // 6 seconds before expiry
        });

        manager.scheduleRefresh();
        manager.destroy();
        manager = null;

        // Wait past when the timer would have fired (if not cancelled)
        await new Promise(r => setTimeout(r, 500));
        assert.equal(refreshCallCount, 0);
    });
});
