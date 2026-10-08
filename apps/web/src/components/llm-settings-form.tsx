'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  'rounded-md bg-accent px-4 py-2 font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

const LLM_MODEL_MAX_LENGTH = 128;
const LLM_API_KEY_MAX_LENGTH = 512;

/** Maps the saved-config test's stable code to a specific, safe message. */
function testMessage({ code, message }: LlmTestResult): string {
  switch (code) {
    case 'ok':
      return 'Connection succeeded — the provider accepted the request.';
    case 'not_configured':
      return 'No API key is saved for this provider yet. Save a key first.';
    case 'unauthorized':
      return 'The provider rejected the API key. Check the key and try again.';
    case 'model_not_found':
      return 'The configured model does not exist for this provider. Choose a different model.';
    case 'rate_limited':
      return 'The provider rate-limited the request. Wait a moment and try again.';
    case 'timeout':
      return 'The provider did not respond in time. Try again.';
    case 'bad_response':
      return 'The provider returned an unexpected response.';
    case 'network':
      return 'Couldn’t reach the provider. Check the connection and try again.';
    case 'server_error':
      return 'The provider had a server error. Try again later.';
    case 'unknown_provider':
      return 'That provider is not available.';
    default:
      // Unknown or future code: fall back to the backend's own message.
      return message.trim() !== ''
        ? message
        : 'The connection test returned an unexpected result.';
  }
}

export function LlmSettingsForm({
  settings,
}: {
  settings: LlmSettingsModel;
}): React.ReactElement {
  const router = useRouter();
  // The PUT response is authoritative, so a local snapshot drives the UI
  // instead of the (stale until reload) server prop.
  const [current, setCurrent] = useState<LlmSettingsModel>(settings);
  const [providerId, setProviderId] = useState(settings.provider);
  const [model, setModel] = useState(settings.model);
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

  const trimmedModel = model.trim();
  const modelDiffers = trimmedModel !== current.model;
  const isNewDefault =
    !isActiveProvider && trimmedModel === (selected?.defaultModel ?? '');
  const hasNewKey = apiKey.trim() !== '';
  const dirty =
    providerId !== current.provider || modelDiffers || clearKey || hasNewKey;

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
      setError(
        "We couldn't save the LLM settings. Check your connection and try again.",
      );
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
      setTestError(
        "Couldn't run the connection test. Check your connection and try again.",
      );
    } finally {
      setTesting(false);
    }
  }

  const modelPlaceholder = selected?.defaultModel ?? '';
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
        <h2 className="text-lg font-medium text-fog">Game recognition</h2>
        <p className="text-sm text-muted">
          Recommended default: <span className="text-fog">Google Gemini</span> (
          <code className="font-mono text-xs">gemini-3.8-flash</code>) — a
          generous free tier, fast, and reliable at reading box text. OpenAI (
          <code className="font-mono text-xs">gpt-4o-mini</code>) is a solid
          paid alternative. Each photo costs one vision call, roughly a fraction
          of a cent to a few cents depending on provider and image size;
          recognition is only charged for imported photos.
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
          Provider
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
              {provider.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          Switching provider resets the saved key and model unless you enter new
          ones.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-model" className={LABEL}>
          Model
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
          Leave as the default{' '}
          <code className="font-mono">{modelPlaceholder}</code> unless you need
          a specific model.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="llm-api-key" className={LABEL}>
          API key
        </label>

        {showSavedKey ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted">
              A key is saved for {selected?.label ?? providerId}.
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
                Replace key
              </button>
              <button
                type="button"
                onClick={() => {
                  setClearKey(true);
                  setSavedNotice(false);
                }}
                className={SECONDARY_BUTTON}
              >
                Remove key
              </button>
            </div>
          </div>
        ) : clearKey ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted">
              The key will be removed when you save.
            </p>
            <button
              type="button"
              onClick={() => {
                setClearKey(false);
                setSavedNotice(false);
              }}
              className={SECONDARY_BUTTON}
            >
              Undo
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
              Paste a key from {selected?.label ?? providerId}. It is stored
              encrypted and never shown again.
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
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {!dirty && <span className="text-sm text-muted">No changes</span>}
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
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <p className="text-xs text-muted">
            The test uses the saved settings. Save your changes before testing.
            {dirty && (
              <span className="text-danger"> You have unsaved changes.</span>
            )}
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
                Saved. Photo import is enabled.{' '}
                <Link
                  href="/import"
                  className="text-accent underline underline-offset-4"
                >
                  Go to photo import
                </Link>
              </>
            ) : (
              'Saved.'
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
            {testMessage(testResult)}
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
