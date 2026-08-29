import { toast } from 'sonner';
import {
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../../lib/desktop-prefs.js';
import { useTheme, type ThemePreference } from '../../lib/theme.js';
import { errorMessage } from '../../lib/utils.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { RowShell } from './RowShell.js';

/** The Appearance group. These are the only settings the desktop owns
 *  itself — everything else on the page comes from the host's catalog,
 *  shared with the terminal UI. */
export function AppearanceRows() {
  const { preference, setPreference } = useTheme();
  const prefs = useDesktopPrefs();
  return (
    <>
      <RowShell
        label="Theme"
        description="Follow the system, or force light / dark."
        control={
          <Select
            value={preference}
            onValueChange={(v) => setPreference(v as ThemePreference)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <RowShell
        htmlFor="pref-native-frame"
        label="Native window frame"
        description="Use the operating system's title bar and menu bar instead of Kirby's compact header. Takes effect the next time Kirby starts."
        control={
          <Switch
            id="pref-native-frame"
            checked={prefs.nativeFrame}
            onCheckedChange={(c) =>
              void updateDesktopPrefs({ nativeFrame: c })
                .then(() =>
                  toast.success(
                    c
                      ? 'Native frame on next launch'
                      : 'Compact header on next launch'
                  )
                )
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          />
        }
      />
    </>
  );
}
