'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TranslatorFor } from '@/i18n/translate';
import {
  isApiError,
  type LlmSettingsModel,
  type LlmTestResult,
  type PutLlmSettingsRequest,
} from '@/lib/api';
import { api } from '@/lib/api/browser';

const FIELD =
  'w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

const LLM_MODEL_MAX_LENGTH = 128;
const LLM_API_KEY_MAX_LENGTH = 512;

/** Maps the saved-config test's stable code to a specific, safe message. */
function testMessage(
  { code, message }: LlmTestResult,
  t: TranslatorFor<'settings'>,
): string {
  switch (code) {
    case 'ok':
      return t('llm.test.ok');
    case 'not_configured':
      return t('llm.test.not_configured');
    case 'unauthorized':
      return t('llm.test.unauthorized');
    case 'model_not_found':
      return t('llm.test.model_not_found');
    case 'rate_limited':
      return t('llm.test.rate_limited');
    case 'timeout':
      return t('llm.test.timeout');
    case 'bad_response':
      return t('llm.test.bad_response');
    case 'network':
      return t('llm.test.network');
    case 'server_error':
      return t('llm.test.server_error');
    case 'unknown_provider':
      return t('llm.test.unknown_provider');
    default:
      // Unknown or future code: fall back to the backend's own message.
      return message.trim() !== '' ? message : t('llm.test.fallback');
  }
}

export function LlmSettingsForm({
  settings,
}: {
  settings: LlmSettingsModel;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('settings');
  // The PUT response is authoritative, so a local snapshot drives the UI
  // instead of the (stale until reload) server prop.
  const [current, setCurrent] = useState<LlmSettingsModel>(settings);
  const [providerId, setProviderId] = useState(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [keyReplace, setKeyReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const providers = settings.availableProviders;
  const selected = providers.find((provider) => provider.id === providerId);
  const isActiveProvider = providerId === current.provider;
  // Only the new `custom` provider gets a UI-localized label; the built-ins
  // keep their API-provided labels.
  const labelFor = (id: string | undefined, fallback: string): string =>
    id === 'custom' ? t('llm.providerCustom') : fallback;
  const selectedLabel = labelFor(selected?.id, selected?.label ?? providerId);

  const trimmedModel = model.trim();
  const modelDiffers = trimmedModel !== current.model;
  const isNewDefault =
    !isActiveProvider && trimmedModel === (selected?.defaultModel ?? '');
  const hasNewKey = apiKey.trim() !== '';
  const trimmedBaseUrl = baseUrl.trim();
  const baseUrlDiffers =
    providerId === 'custom' && trimmedBaseUrl !== (current.baseUrl ?? '');
  const dirty =
    providerId !== current.provider ||
    modelDiffers ||
    baseUrlDiffers ||
    clearKey ||
    hasNewKey;

  function onProviderChange(next: string): void {
    const nextId = next as LlmSettingsModel['provider'];
    const nextProvider = providers.find((provider) => provider.id === nextId);
    setProviderId(nextId);
    setModel(nextProvider?.defaultModel ?? '');
    setApiKey('');
    setClearKey(false);
    setKeyReplace(false);
    setSavedNotice(false);
    setTestResult(null);
    setTestError(null);
  }

  function buildBody(): PutLlmSettingsRequest {
    const body: PutLlmSettingsRequest = { provider: providerId };
    if (providerId === 'custom') body.baseUrl = trimmedBaseUrl;
    if (modelDiffers && !isNewDefault) body.model = trimmedModel;
    if (clearKey) body.apiKey = '';
    else if (hasNewKey) body.apiKey = apiKey.trim();
    return body;
  }

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      const updated = await api.settings.llm.put(buildBody());
      setCurrent(updated);
      setProviderId(updated.provider);
      setModel(updated.model);
      setBaseUrl(updated.baseUrl ?? '');
      setApiKey('');
      setClearKey(false);
      setKeyReplace(false);
      setSavedNotice(true);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 400) {
        setError(caught.userMessage);
        return;
      }
      setError(t('llm.error.save'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      setTestResult(await api.settings.llm.test());
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setTestError(t('llm.error.test'));
    } finally {
      setTesting(false);
    }
  }

  const modelPlaceholder = selected?.defaultModel ?? '';
  // The recommended-defaults copy names both providers' default models so it
  // stays accurate if the API's defaults change.
  const geminiModel =
    providers.find((provider) => provider.id === 'gemini')?.defaultModel ?? '';
  const openaiModel =
    providers.find((provider) => provider.id === 'openai')?.defaultModel ?? '';
  const showSavedKey =
    isActiveProvider && current.keyPresent && !keyReplace && !clearKey;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-xl border border-edge bg-shelf/40 p-4"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-fog">{t('llm.heading')}</h2>
        <p className="text-sm text-muted">
          {t.rich('llm.recommended', {
            code: (chunks) => (
              <code className="font-mono text-xs">{chunks}</code>
            ),
            geminiModel,
            openaiModel,
          })}
        </p>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="llm-provider" className={LABEL}>
          {t('llm.provider')}
        </label>
        <select
          id="llm-provider"
          value={providerId}
          onChange={(event) => {
            onProviderChange(event.target.value);
          }}
          className={FIELD}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {labelFor(provider.id, provider.label)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">{t('llm.providerHint')}</p>
      </div>

      {providerId === 'custom' && (
        <div className="space-y-1.5">
          <label htmlFor="llm-base-url" className={LABEL}>
            {t('llm.baseUrl')}
          </label>
          <input
            id="llm-base-url"
            type="text"
            inputMode="url"
            maxLength={512}
            value={baseUrl}
            placeholder={t('llm.baseUrlPlaceholder')}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setSavedNotice(false);
            }}
            className={FIELD}
          />
          <p className="text-xs text-muted">{t('llm.baseUrlHint')}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="llm-model" className={LABEL}>
          {t('llm.model')}
        </label>
        <input
          id="llm-model"
          type="text"
          maxLength={LLM_MODEL_MAX_LENGTH}
          value={model}
          placeholder={modelPlaceholder}
          onChange={(event) => {
            setModel(event.target.value);
            setSavedNotice(false);
          }}
          className={FIELD}
        />
        <p className="text-xs text-muted">
          {providerId === 'custom'
            ? t('llm.customModelHint')
            : t.rich('llm.modelHint', {
                code: (chunks) => <code className="font-mono">{chunks}</code>,
                model: modelPlaceholder,
              })}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-api-key" className={LABEL}>
          {t('llm.apiKey')}
        </label>

        {showSavedKey ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted">
              {t('llm.keySaved', { provider: selectedLabel })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setKeyReplace(true);
                  setSavedNotice(false);
                }}
                className={SECONDARY_BUTTON}
              >
                {t('llm.replaceKey')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setClearKey(true);
                  setSavedNotice(false);
                }}
                className={SECONDARY_BUTTON}
              >
                {t('llm.removeKey')}
              </button>
            </div>
          </div>
        ) : clearKey ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted">
              {t('llm.keyWillRemove')}
            </p>
            <button
              type="button"
              onClick={() => {
                setClearKey(false);
                setSavedNotice(false);
              }}
              className={SECONDARY_BUTTON}
            >
              {t('llm.undo')}
            </button>
          </div>
        ) : (
          <>
            <input
              id="llm-api-key"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={LLM_API_KEY_MAX_LENGTH}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setSavedNotice(false);
              }}
              className={FIELD}
            />
            <p className="text-xs text-muted">
              {providerId === 'custom'
                ? t('llm.customKeyHint')
                : t('llm.keyHint', { provider: selectedLabel })}
            </p>
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-edge pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty}
            className={PRIMARY_BUTTON}
          >
            {saving ? t('llm.saving') : t('llm.save')}
          </button>
          {!dirty && (
            <span className="text-sm text-muted">{t('llm.noChanges')}</span>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              void handleTest();
            }}
            disabled={testing}
            className={SECONDARY_BUTTON}
          >
            {testing ? t('llm.testing') : t('llm.testConnection')}
          </button>
          <p className="text-xs text-muted">
            {t('llm.testHint')}
            {dirty && <span className="text-danger"> {t('llm.unsaved')}</span>}
          </p>
        </div>

        {savedNotice && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-edge bg-shelf px-3 py-2 text-sm text-muted"
          >
            {current.importEnabled ? (
              <>
                {t('llm.savedImportEnabled')}{' '}
                <Link
                  href="/import"
                  className="text-accent underline underline-offset-4"
                >
                  {t('llm.goToImport')}
                </Link>
              </>
            ) : (
              t('llm.saved')
            )}
          </p>
        )}

        {testResult !== null && (
          <p
            role={testResult.ok ? 'status' : 'alert'}
            aria-live="polite"
            className={
              testResult.ok
                ? 'rounded-md border border-edge bg-shelf px-3 py-2 text-sm text-muted'
                : 'rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
            }
          >
            {testMessage(testResult, t)}
          </p>
        )}

        {testError !== null && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {testError}
          </p>
        )}
      </div>
    </form>
  );
}
