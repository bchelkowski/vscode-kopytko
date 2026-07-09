import { expect } from 'chai';
import { PAY_ENDPOINTS, getEndpoint } from '../../src/client/rokuPay/endpoints';

describe('rokuPay endpoints catalog', () => {
  it('contains all 10 documented endpoints with unique ids', () => {
    expect(PAY_ENDPOINTS).to.have.length(10);
    const ids = PAY_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).to.equal(ids.length);
    expect(PAY_ENDPOINTS.filter((e) => e.category === 'web-services')).to.have.length(6);
    expect(PAY_ENDPOINTS.filter((e) => e.category === 'recovery-test')).to.have.length(4);
  });

  it('matches every {placeholder} in urlTemplate with a path field, and vice versa', () => {
    for (const endpoint of PAY_ENDPOINTS) {
      const placeholders = [...endpoint.urlTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      const pathFields = endpoint.fields.filter((f) => f.in === 'path').map((f) => f.name).sort();
      expect(placeholders, endpoint.id).to.deep.equal(pathFields);
    }
  });

  it('has exactly one secret field per endpoint, named partnerAPIKey', () => {
    for (const endpoint of PAY_ENDPOINTS) {
      const secretFields = endpoint.fields.filter((f) => f.secret);
      expect(secretFields, endpoint.id).to.have.length(1);
      expect(secretFields[0].name, endpoint.id).to.equal('partnerAPIKey');
      expect(secretFields[0].required, endpoint.id).to.equal(true);
    }
  });

  it('GET and recovery-test endpoints carry no body fields', () => {
    for (const endpoint of PAY_ENDPOINTS) {
      if (endpoint.method === 'GET' || endpoint.category === 'recovery-test') {
        expect(endpoint.fields.every((f) => f.in === 'path'), endpoint.id).to.equal(true);
      }
    }
  });

  it('recovery-test endpoints are POST against the test host with key + transaction path params', () => {
    for (const endpoint of PAY_ENDPOINTS.filter((e) => e.category === 'recovery-test')) {
      expect(endpoint.method).to.equal('POST');
      expect(endpoint.urlTemplate).to.match(
        /^https:\/\/apipub\.roku\.com\/test\/subscription-recovery\/[a-z-]+\/\{partnerAPIKey\}\/\{transactionId\}$/,
      );
    }
  });

  it('web-services endpoints target the transaction service base URL', () => {
    for (const endpoint of PAY_ENDPOINTS.filter((e) => e.category === 'web-services')) {
      expect(endpoint.urlTemplate.startsWith('https://apipub.roku.com/listen/transaction-service.svc/'), endpoint.id)
        .to.equal(true);
    }
  });

  it('getEndpoint resolves known ids and returns undefined otherwise', () => {
    expect(getEndpoint('validate-transaction')?.method).to.equal('GET');
    expect(getEndpoint('recover')?.category).to.equal('recovery-test');
    expect(getEndpoint('nope')).to.equal(undefined);
  });
});
