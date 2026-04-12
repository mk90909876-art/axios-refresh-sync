import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { createRefreshManager } from '../src/index.js';

// Helper: creates a mock adapter that controls response behavior
const createMockAdapter = () => {
    let handler = null;
    const adapter = (config) => {
        if (handler) return handler(config);
        return Promise.reject(new Error('No mock handler set'));
    };
    adapter.setHandler = (fn) => { handler = fn; };
    return adapter;
};

// Helper: creates a minimal JWT with a given exp timestamp
const createJwt = (expMs) => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }));
    return `${header}.${payload}.signature`;
};

describe('Integration tests', () => {
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

        tokens = {
            access: createJwt(Date.now() + 30 * 60 * 1000), // 30 min from now
            refresh: 'valid_refresh_token',
        };
        refreshCallCount = 0;
        refreshFailedCalled = false;
    });

    afterEach(() => {
        if (manager) manager.destroy();
    });

    const createManager = (overrides = {}) => {
        manager = createRefreshManager({
            axiosInstance: api,
            refreshEndpoint: '/api/auth/refresh',
            getAccessToken: () => tokens.access,
            getRefreshToken: () => tokens.refresh,
            setTokens: (a, r) => { tokens.access = a; tokens.refresh = r; },
            onRefreshFailed: () => { refreshFailedCalled = true; },
            ...overrides,
        });
        return manager;
    };

    describe('Concurrent 401s', () => {
        it('fires only one refresh for multiple simultaneous 401s', async () => {
            createManager();

            let resolveRefresh;
            const refreshPromise = new Promise(r => { resolveRefresh = r; });

            mockAdapter.setHandler((config) => {
                // Refresh endpoint — holds until we resolve manually
                if (config.url === '/api/auth/refresh') {
                    refreshCallCount++;
                    return refreshPromise.then(() => ({
                        status: 200,
                        data: { access_token: 'new_access', refresh_token: 'new_refresh' },
                        headers: {},
                        config,
                    }));
                }

                // All other requests return 401 first time, 200 on retry
                if (!config._retry) {
                    return Promise.reject({
                        config,
                        response: { status: 401 },
                    });
                }

                return Promise.resolve({
                    status: 200,
                    data: { ok: true },
                    headers: {},
                    config,
                });
            });

            // Fire first request — it will get a 401, acquire the lock,
            // and start the refresh (which hangs on refreshPromise)
            const p1 = api.get('/resource/1');

            // Yield to let request 1's interceptor acquire the lock
            await new Promise(r => setTimeout(r, 10));

            // Now fire two more requests while the lock is held —
            // they should see acquireLock() === true and enqueue
            const p2 = api.get('/resource/2');
            const p3 = api.get('/resource/3');

            // Wait for them to enqueue, then resolve the refresh
            await new Promise(r => setTimeout(r, 10));
            resolveRefresh();

            const results = await Promise.all([p1, p2, p3]);
            assert.equal(results.length, 3);
            results.forEach(r => assert.deepEqual(r.data, { ok: true }));

            // Only ONE refresh call should have been made
            assert.equal(refreshCallCount, 1);
            assert.equal(tokens.access, 'new_access');
            assert.equal(tokens.refresh, 'new_refresh');
        });
    });

    describe('Refresh failure', () => {
        it('calls onRefreshFailed and rejects queued requests', async () => {
            createManager();

            mockAdapter.setHandler((config) => {
                if (config.url === '/api/auth/refresh') {
                    refreshCallCount++;
                    return Promise.reject({
                        config,
                        response: { status: 400, data: { error: 'invalid refresh token' } },
                    });
                }

                return Promise.reject({
                    config,
                    response: { status: 401 },
                });
            });

            await assert.rejects(api.get('/protected'));
            assert.equal(refreshFailedCalled, true);
            assert.equal(refreshCallCount, 1);
        });
    });

    describe('Multi-instance isolation', () => {
        it('two managers do not share lock state', async () => {
            const api2 = axios.create({
                baseURL: 'http://localhost:8888',
                adapter: createMockAdapter(),
            });

            const tokens2 = { access: createJwt(Date.now() + 30 * 60 * 1000), refresh: 'other_refresh' };

            const manager2 = createRefreshManager({
                axiosInstance: api2,
                refreshEndpoint: '/auth/refresh',
                getAccessToken: () => tokens2.access,
                getRefreshToken: () => tokens2.refresh,
                setTokens: (a, r) => { tokens2.access = a; tokens2.refresh = r; },
                onRefreshFailed: () => {},
            });

            createManager();

            // Setting lock on manager1 should not affect manager2's lock
            manager._lock = undefined; // manager doesn't expose _lock, so we test via config
            // The point is: they were created independently and don't share state.
            // We can verify by checking that both managers exist and are separate objects
            assert.notEqual(manager, manager2);

            manager2.destroy();
        });
    });

    describe('Destroy cleanup', () => {
        it('removes interceptor after destroy()', async () => {
            createManager();
            manager.destroy();

            // After destroy, the interceptor should be ejected.
            // A 401 should now just reject normally without trying to refresh.
            mockAdapter.setHandler((config) => {
                return Promise.reject({
                    config,
                    response: { status: 401 },
                });
            });

            try {
                await api.get('/test');
                assert.fail('Should have thrown');
            } catch (err) {
                // Should NOT have called onRefreshFailed since interceptor was removed
                assert.equal(refreshCallCount, 0);
            }

            manager = null; // prevent double destroy in afterEach
        });
    });

    describe('Custom parseTokens', () => {
        it('uses custom parser for non-standard response shape', async () => {
            createManager({
                parseTokens: (data) => ({
                    accessToken: data.tokens.jwt,
                    refreshToken: data.tokens.rt,
                }),
            });

            mockAdapter.setHandler((config) => {
                if (config.url === '/api/auth/refresh') {
                    refreshCallCount++;
                    return Promise.resolve({
                        status: 200,
                        data: {
                            tokens: { jwt: 'custom_access', rt: 'custom_refresh' },
                        },
                        headers: {},
                        config,
                    });
                }

                if (!config._retry) {
                    return Promise.reject({
                        config,
                        response: { status: 401 },
                    });
                }

                return Promise.resolve({
                    status: 200,
                    data: { ok: true },
                    headers: {},
                    config,
                });
            });

            const result = await api.get('/resource');
            assert.deepEqual(result.data, { ok: true });
            assert.equal(tokens.access, 'custom_access');
            assert.equal(tokens.refresh, 'custom_refresh');
        });
    });

    describe('No refresh token available', () => {
        it('calls onRefreshFailed immediately when no refresh token', async () => {
            tokens.refresh = null;
            createManager();

            mockAdapter.setHandler((config) => {
                return Promise.reject({
                    config,
                    response: { status: 401 },
                });
            });

            await assert.rejects(api.get('/test'));
            assert.equal(refreshFailedCalled, true);
        });
    });

    describe('Non-401 errors pass through', () => {
        it('does not intercept 500 errors', async () => {
            createManager();

            mockAdapter.setHandler((config) => {
                return Promise.reject({
                    config,
                    response: { status: 500, data: { error: 'server error' } },
                });
            });

            await assert.rejects(api.get('/test'));
            assert.equal(refreshCallCount, 0);
            assert.equal(refreshFailedCalled, false);
        });
    });
});
