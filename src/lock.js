let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach(({ resolve, reject }) => {
        if (error) reject(error);
        else resolve(token);
    });
    failedQueue = [];
};

export const acquireLock = () => isRefreshing;
export const setLock = (val) => { isRefreshing = val; };

export const enqueue = () => {
    return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
    });
};

export const flushQueue = (error, token) => {
    processQueue(error, token);
};

// Multi-tab sync — if another tab refreshed the token,
// flush the queue with the new token so this tab doesn't refresh again
if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
        if (e.key === "access_token" && e.newValue && isRefreshing) {
            isRefreshing = false;
            processQueue(null, e.newValue);
        }
    });
}