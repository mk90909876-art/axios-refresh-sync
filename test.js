import axios from 'axios';
import { createRefreshManager } from './src/index.js';

const api = axios.create({ baseURL: 'http://localhost:3001' });

const manager = createRefreshManager({
  axiosInstance: api,
  refreshEndpoint: '/api/auth/refresh',
  getAccessToken: () => 'fake_access_token',
  getRefreshToken: () => 'fake_refresh_token',
  setTokens: (a, r) => console.log('tokens set:', a, r),
  onRefreshFailed: () => console.log('refresh failed'),
});

manager.scheduleRefresh();
console.log('✓ createRefreshManager initialized without errors');