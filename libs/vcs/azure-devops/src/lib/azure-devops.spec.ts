import { azureDevops } from './azure-devops.js';

describe('azureDevops', () => {
  it('should work', () => {
    expect(azureDevops()).toEqual('azure-devops');
  });
});
