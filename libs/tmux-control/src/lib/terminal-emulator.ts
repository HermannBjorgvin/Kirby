import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;

export class TerminalEmulator {
  private terminal: InstanceType<typeof Terminal>;
  private renderListeners: Array<() => void> = [];
  private disposed = false;

  constructor(cols = 80, rows = 24) {
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
    });
  }

  write(data: string): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write(data, resolve);
    });
  }

  render(scrollOffset = 0): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.baseY - scrollOffset);
    const cell = buffer.getNullCell();

    for (let i = start; i < start + this.terminal.rows; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(this.renderLine(line, cell));
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n');
  }

  private renderLine(
    line: ReturnType<
      InstanceType<typeof Terminal>['buffer']['active']['getLine']
    > &
      object,
    cell: ReturnType<
      InstanceType<typeof Terminal>['buffer']['active']['getNullCell']
    >
  ): string {
    const cols = this.terminal.cols;
    let out = '';
    let styled = false;
    // Track previous cell attributes to avoid redundant SGR sequences
    let prevFgMode = -1,
      prevFgColor = -1;
    let prevBgMode = -1,
      prevBgColor = -1;
    let prevBold = 0,
      prevDim = 0,
      prevItalic = 0,
      prevUnderline = 0;
    let prevBlink = 0,
      prevInverse = 0,
      prevInvisible = 0;
    let prevStrikethrough = 0,
      prevOverline = 0;

    for (let col = 0; col < cols; col++) {
      line.getCell(col, cell);
      if (!cell || cell.getWidth() === 0) continue;

      if (cell.isAttributeDefault()) {
        if (styled) {
          out += '\x1b[0m';
          styled = false;
          prevFgMode = prevFgColor = prevBgMode = prevBgColor = -1;
          prevBold = prevDim = prevItalic = prevUnderline = 0;
          prevBlink =
            prevInverse =
            prevInvisible =
            prevStrikethrough =
            prevOverline =
              0;
        }
      } else {
        // Check if attributes changed from previous cell
        const fgMode = cell.getFgColorMode();
        const fgColor = cell.getFgColor();
        const bgMode = cell.getBgColorMode();
        const bgColor = cell.getBgColor();
        const bold = cell.isBold();
        const dim = cell.isDim();
        const italic = cell.isItalic();
        const underline = cell.isUnderline();
        const blink = cell.isBlink();
        const inverse = cell.isInverse();
        const invisible = cell.isInvisible();
        const strikethrough = cell.isStrikethrough();
        const overline = cell.isOverline();

        if (
          fgMode !== prevFgMode ||
          fgColor !== prevFgColor ||
          bgMode !== prevBgMode ||
          bgColor !== prevBgColor ||
          bold !== prevBold ||
          dim !== prevDim ||
          italic !== prevItalic ||
          underline !== prevUnderline ||
          blink !== prevBlink ||
          inverse !== prevInverse ||
          invisible !== prevInvisible ||
          strikethrough !== prevStrikethrough ||
          overline !== prevOverline
        ) {
          const sgr = this.cellToSgr(cell);
          out += `\x1b[${sgr}m`;
          styled = true;
          prevFgMode = fgMode;
          prevFgColor = fgColor;
          prevBgMode = bgMode;
          prevBgColor = bgColor;
          prevBold = bold;
          prevDim = dim;
          prevItalic = italic;
          prevUnderline = underline;
          prevBlink = blink;
          prevInverse = inverse;
          prevInvisible = invisible;
          prevStrikethrough = strikethrough;
          prevOverline = overline;
        }
      }

      const ch = cell.getChars();
      out += ch || ' ';
    }

    // Reset at end of line to prevent color bleeding
    if (styled) {
      out += '\x1b[0m';
    }

    // Trim trailing spaces (same as translateToString(true))
    return out.replace(/\s+$/, '');
  }

  private cellToSgr(
    cell: ReturnType<
      InstanceType<typeof Terminal>['buffer']['active']['getNullCell']
    >
  ): string {
    const params: (number | string)[] = [];

    // Text styles
    if (cell.isBold()) params.push(1);
    if (cell.isDim()) params.push(2);
    if (cell.isItalic()) params.push(3);
    if (cell.isUnderline()) params.push(4);
    if (cell.isBlink()) params.push(5);
    if (cell.isInverse()) params.push(7);
    if (cell.isInvisible()) params.push(8);
    if (cell.isStrikethrough()) params.push(9);
    if (cell.isOverline()) params.push(53);

    // Foreground color
    if (cell.isFgPalette()) {
      const color = cell.getFgColor();
      if (color < 8) {
        params.push(30 + color);
      } else if (color < 16) {
        params.push(90 + color - 8);
      } else {
        params.push('38;5;' + color);
      }
    } else if (cell.isFgRGB()) {
      const color = cell.getFgColor();
      params.push(
        `38;2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${color & 0xff}`
      );
    }

    // Background color
    if (cell.isBgPalette()) {
      const color = cell.getBgColor();
      if (color < 8) {
        params.push(40 + color);
      } else if (color < 16) {
        params.push(100 + color - 8);
      } else {
        params.push('48;5;' + color);
      }
    } else if (cell.isBgRGB()) {
      const color = cell.getBgColor();
      params.push(
        `48;2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${color & 0xff}`
      );
    }

    return params.join(';');
  }

  get maxScrollback(): number {
    return this.terminal.buffer.active.baseY;
  }

  get mouseTrackingMode(): 'none' | 'x10' | 'vt200' | 'drag' | 'any' {
    return this.terminal.modes.mouseTrackingMode;
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) {
      this.terminal.resize(cols, rows);
    }
  }

  onRender(cb: () => void): void {
    this.renderListeners.push(cb);
    this.terminal.onWriteParsed(() => {
      cb();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
    this.renderListeners = [];
  }
}
