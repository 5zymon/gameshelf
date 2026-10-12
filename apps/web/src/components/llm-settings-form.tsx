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
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

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

  const providerLabel = t('llm.providerCustom');
  const trimmedModel = model.trim();
  const modelDiffers = trimmedModel !== current.model;
  const hasNewKey = apiKey.trim() !== '';
  const trimmedBaseUrl = baseUrl.trim();
  const baseUrlMissing = trimmedBaseUrl === '';
  const baseUrlDiffers = trimmedBaseUrl !== (current.baseUrl ?? '');
  const dirty = modelDiffers || baseUrlDiffers || clearKey || hasNewKey;

  function buildBody(): PutLlmSettingsRequest {
    const body: PutLlmSettingsRequest = {
      provider: current.provider,
      baseUrl: trimmedBaseUrl,
    };
    if (modelDiffers) body.model = trimmedModel;
    if (clearKey) body.apiKey = '';
    else if (hasNewKey) body.apiKey = apiKey.trim();
    return body;
  }

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || !dirty || baseUrlMissing) return;
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      const updated = await api.settings.llm.put(buildBody());
      setCurrent(updated);
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

  const showSavedKey = current.keyPresent && !keyReplace && !clearKey;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)]"
    >
      <h2 className="text-lg font-semibold text-ink">{t('llm.heading')}</h2>

      {error !== null && (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        <p className={LABEL}>{t('llm.provider')}</p>
        <p className="text-sm font-medium text-ink">{providerLabel}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-base-url" className={LABEL}>
          {t('llm.baseUrl')}
        </label>
        <input
          id="llm-base-url"
          type="text"
          inputMode="url"
          required
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
        {dirty && baseUrlMissing && (
          <p className="text-xs text-danger">{t('llm.baseUrlRequired')}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-model" className={LABEL}>
          {t('llm.model')}
        </label>
        <input
          id="llm-model"
          type="text"
          maxLength={LLM_MODEL_MAX_LENGTH}
          value={model}
          onChange={(event) => {
            setModel(event.target.value);
            setSavedNotice(false);
          }}
          className={FIELD}
        />
        <p className="text-xs text-muted">{t('llm.customModelHint')}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-api-key" className={LABEL}>
          {t('llm.apiKey')}
        </label>

        {showSavedKey ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted">
              {t('llm.keySaved', { provider: providerLabel })}
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
            <p className="text-xs text-muted">{t('llm.customKeyHint')}</p>
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-edge pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty || baseUrlMissing}
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
            className="rounded-control border border-edge bg-surface px-3 py-2 text-sm text-muted"
          >
            {current.importEnabled ? (
              <>
                {t('llm.savedImportEnabled')}{' '}
                <Link
                  href="/import"
                  className="text-accent-text underline underline-offset-4"
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
                ? 'rounded-control border border-edge bg-surface px-3 py-2 text-sm text-muted'
                : 'rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
            }
          >
            {testMessage(testResult, t)}
          </p>
        )}

        {testError !== null && (
          <p
            role="alert"
            className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {testError}
          </p>
        )}
      </div>
    </form>
  );
}
