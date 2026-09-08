import client from './client';

export const getInventory = (params) => client.get('/inventory', { params });
