import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLock } from '../src/lock.js';

describe('createLock', () => {
    let lock;

    beforeEach(() => {
        lock = createLock('access_token');
    });

    it('starts unlocked', () => {
        assert.equal(lock.acquireLock(), false);
    });

    it('can set and read lock state', () => {
        lock.setLock(true);
        assert.equal(lock.acquireLock(), true);
        lock.setLock(false);
        assert.equal(lock.acquireLock(), false);
    });

    it('enqueues and flushes with resolved value', async () => {
        const promise = lock.enqueue();
        lock.flushQueue(null, 'new_token');
        const result = await promise;
        assert.equal(result, 'new_token');
    });

    it('enqueues and flushes with rejection', async () => {
        const promise = lock.enqueue();
        lock.flushQueue(new Error('refresh failed'), null);
        await assert.rejects(promise, { message: 'refresh failed' });
    });

    it('flushes multiple queued promises', async () => {
        const p1 = lock.enqueue();
        const p2 = lock.enqueue();
        const p3 = lock.enqueue();
        lock.flushQueue(null, 'token_abc');

        const results = await Promise.all([p1, p2, p3]);
        assert.deepEqual(results, ['token_abc', 'token_abc', 'token_abc']);
    });

    it('timer management is isolated', () => {
        assert.equal(lock.getTimer(), null);

        const timerId = setTimeout(() => {}, 99999);
        lock.setTimer(timerId);
        assert.notEqual(lock.getTimer(), null);

        lock.clearTimer();
        assert.equal(lock.getTimer(), null);
    });

    it('cleanup rejects queued promises and resets state', async () => {
        lock.setLock(true);
        const timerId = setTimeout(() => {}, 99999);
        lock.setTimer(timerId);
        const promise = lock.enqueue();

        lock.cleanup();

        assert.equal(lock.acquireLock(), false);
        assert.equal(lock.getTimer(), null);
        await assert.rejects(promise, { message: 'RefreshManager destroyed' });
    });

    it('two lock instances are fully isolated', async () => {
        const lock2 = createLock('other_key');

        lock.setLock(true);
        assert.equal(lock.acquireLock(), true);
        assert.equal(lock2.acquireLock(), false);

        const p1 = lock.enqueue();
        const p2 = lock2.enqueue();

        lock.flushQueue(null, 'token_1');
        lock2.flushQueue(null, 'token_2');

        assert.equal(await p1, 'token_1');
        assert.equal(await p2, 'token_2');

        lock2.cleanup();
    });
});
