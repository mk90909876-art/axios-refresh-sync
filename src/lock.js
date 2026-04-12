// Factory function — each createRefreshManager() gets its own isolated lock.
// Prevents cross-instance state corruption when multiple managers exist.

export const createLock = (tokenStorageKey = 'access_token') => {
    let isRefreshing = false;
    let failedQueue = [];
    let _timer = null;

    const processQueue = (error, token = null) => {
        failedQueue.forEach(({ resolve, reject }) => {
            if (error) reject(error);
            else resolve(token);
        });
        failedQueue = [];
    };

    const acquireLock = () => isRefreshing;
    const setLock = (val) => { isRefreshing = val; };

    const enqueue = () => {
        return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
        });
    };

    const flushQueue = (error, token) => {
        processQueue(error, token);
    };

    // Timer management — lives inside the lock so each instance is isolated
    const getTimer = () => _timer;
    const setTimer = (val) => { _timer = val; };
    const clearTimer = () => {
        if (_timer) {
            clearTimeout(_timer);
            _timer = null;
        }
    };

    // Multi-tab sync — if another tab refreshed the token,
    // flush the queue with the new token so this tab doesn't refresh again
    let storageHandler = null;

    if (typeof window !== "undefined") {
        storageHandler = (e) => {
            if (e.key === tokenStorageKey && e.newValue && isRefreshing) {
                isRefreshing = false;
                processQueue(null, e.newValue);
            }
        };
        window.addEventListener("storage", storageHandler);
    }

    // Cleanup — removes event listener, clears timer, resets state
    const cleanup = () => {
        clearTimer();
        if (typeof window !== "undefined" && storageHandler) {
            window.removeEventListener("storage", storageHandler);
            storageHandler = null;
        }
        // Reject any pending requests in the queue
        processQueue(new Error('RefreshManager destroyed'), null);
        isRefreshing = false;
    };

    return {
        acquireLock,
        setLock,
        enqueue,
        flushQueue,
        getTimer,
        setTimer,
        clearTimer,
        cleanup,
    };
};