import { useMemo, useState } from 'react';
import { useConfig } from '../context/ConfigContext.js';
import type { SettingsField } from './SettingsPanel.js';
import { WelcomeStep } from './onboarding/WelcomeStep.js';
import { FieldsStep } from './onboarding/FieldsStep.js';
import { PreferencesStep } from './onboarding/PreferencesStep.js';
import { DoneStep } from './onboarding/DoneStep.js';
import { useGithubAutodetect } from './onboarding/useGithubAutodetect.js';

type Step = 'welcome' | 'fields' | 'preferences' | 'done';

// Orchestrator: tracks the current step and mounts one step component
// at a time via switch(step). No useInput here — each step owns its
// own useInput({ isActive: step === 'x' }) so the hooks don't fight
// over the same keypress.
export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { config, provider } = useConfig();
  const [step, setStep] = useState<Step>('welcome');
  const { ghUsername, ghChecked } = useGithubAutodetect(provider);

  const wizardFields = useMemo<SettingsField[]>(() => {
    const fields: SettingsField[] = [
      { label: 'Email', key: 'email', configBag: 'project' },
    ];
    if (provider) {
      for (const f of provider.authFields) {
        fields.push({
          label: f.label,
          key: f.key,
          masked: f.masked,
          configBag: 'vendorAuth',
        });
      }
      for (const f of provider.projectFields) {
        fields.push({
          label: f.label,
          key: f.key,
          configBag: 'vendorProject',
        });
      }
    }
    return fields;
  }, [provider]);

  if (!provider) return null;

  switch (step) {
    case 'welcome':
      return (
        <WelcomeStep
          provider={provider}
          config={config}
          isActive={step === 'welcome'}
          onContinue={() => setStep('fields')}
          onSkip={onComplete}
        />
      );
    case 'fields':
      return (
        <FieldsStep
          provider={provider}
          config={config}
          fields={wizardFields}
          ghUsername={ghUsername}
          ghChecked={ghChecked}
          isActive={step === 'fields'}
          onAdvance={() => setStep('preferences')}
          onSkip={onComplete}
        />
      );
    case 'preferences':
      return (
        <PreferencesStep
          config={config}
          isActive={step === 'preferences'}
          onAdvance={() => setStep('done')}
          onSkip={onComplete}
        />
      );
    case 'done':
      return (
        <DoneStep
          provider={provider}
          isActive={step === 'done'}
          onDone={onComplete}
        />
      );
  }
}
