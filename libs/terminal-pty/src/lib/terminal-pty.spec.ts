import { terminalPty } from './terminal-pty.js';

describe('terminalPty', () => {
  it('should work', () => {
    expect(terminalPty()).toEqual('terminal-pty');
  });
});
