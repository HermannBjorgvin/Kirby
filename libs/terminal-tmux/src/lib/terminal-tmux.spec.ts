import { terminalTmux } from './terminal-tmux.js';

describe('terminalTmux', () => {
  it('should work', () => {
    expect(terminalTmux()).toEqual('terminal-tmux');
  });
});
