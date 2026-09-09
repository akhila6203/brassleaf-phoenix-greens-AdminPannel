import client from './client';

export const getPayments = (params) => client.get('/payments', { params });
export const getPayment = (id) => client.get(`/payments/${id}`);
// export const getPaymentStats = () => client.get('/payments/stats/summary');
export const getPaymentStats = (params = {}) =>
  client.get('/payments/stats/summary', {
    params,
  });
export const reconcilePayment = (id, data) => client.patch(`/payments/${id}`, data);
