import client from './client';

export const getGstReport = (params) => client.get('/gst', { params });
