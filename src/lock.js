// Core refresh lock — ensures only ONE refresh request fires at a time.
// Both the proactive timer and the reactive interceptor call through this.

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