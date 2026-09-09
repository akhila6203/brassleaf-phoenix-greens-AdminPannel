import client from './client';

export const getGstReport = (params) => client.get('/gst', { params });
export const getGstExport = (params) => client.get('/gst/export', { params });

