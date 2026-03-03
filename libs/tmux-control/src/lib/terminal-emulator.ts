import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;

type XtermBuffer = InstanceType<typeof Terminal>['buffer']['active'];
type XtermLine = NonNullable<ReturnType<XtermBuffer['getLine']>>;
type XtermCell = ReturnType<XtermBuffer['getNullCell']>;

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

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n');
  }

  private renderLine(line: XtermLine, cell: XtermCell): string {
    const cols = this.terminal.cols;
    let out = '';
    let styled = false;
    let prevSgr = '';

    for (let col = 0; col < cols; col++) {
      line.getCell(col, cell);
      if (!cell || cell.getWidth() === 0) continue;

      if (cell.isAttributeDefault()) {
        if (styled) {
          out += '\x1b[0m';
          styled = false;
          prevSgr = '';
        }
      } else {
        const sgr = this.cellToSgr(cell);
        if (sgr !== prevSgr) {
          out += `\x1b[${sgr}m`;
          styled = true;
          prevSgr = sgr;
        }
      }

      const ch = cell.getChars();
      out += ch || ' ';
    }

    if (styled) {
      out += '\x1b[0m';
    }

    return out.replace(/\s+$/, '');
  }

  private cellToSgr(cell: XtermCell): string {
    const params: (number | string)[] = [];

    if (cell.isBold()) params.push(1);
    if (cell.isDim()) params.push(2);
    if (cell.isItalic()) params.push(3);
    if (cell.isUnderline()) params.push(4);
    if (cell.isBlink()) params.push(5);
    if (cell.isInverse()) params.push(7);
    if (cell.isInvisible()) params.push(8);
    if (cell.isStrikethrough()) params.push(9);
    if (cell.isOverline()) params.push(53);

    this.pushColorSgr(params, cell, 'fg');
    this.pushColorSgr(params, cell, 'bg');

    return params.join(';');
  }

  private pushColorSgr(
    params: (number | string)[],
    cell: XtermCell,
    layer: 'fg' | 'bg'
  ): void {
    const isPalette = layer === 'fg' ? cell.isFgPalette() : cell.isBgPalette();
    const isRGB = layer === 'fg' ? cell.isFgRGB() : cell.isBgRGB();
    const color = layer === 'fg' ? cell.getFgColor() : cell.getBgColor();
    const base = layer === 'fg' ? 30 : 40;
    const brightBase = layer === 'fg' ? 90 : 100;
    const extPrefix = layer === 'fg' ? 38 : 48;

    if (isPalette) {
      if (color < 8) {
        params.push(base + color);
      } else if (color < 16) {
        params.push(brightBase + color - 8);
      } else {
        params.push(`${extPrefix};5;${color}`);
      }
    } else if (isRGB) {
      params.push(
        `${extPrefix};2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${
          color & 0xff
        }`
      );
    }
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
    this.terminal.onWriteParsed(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
    this.renderListeners = [];
  }
}
