import { tmuxControl } from './tmux-control.js';

describe('tmuxControl', () => {
  it('should work', () => {
    expect(tmuxControl()).toEqual('tmux-control');
  });
});
